/**
 * codegraph-live daemon
 *
 * Watches all codegraph-initialized projects in $HOME for file changes and
 * triggers incremental sync automatically. Designed to run as a systemd
 * user service so the graph stays fresh even when Claude Code is closed.
 *
 * Architecture:
 * - Per-project: @parcel/watcher subscription with 1000ms debounce → CodeGraph.sync()
 * - Discovery: periodic re-scan of $HOME every 30s to pick up newly initialized projects
 * - Locking: CodeGraph's built-in Mutex + FileLock ensures safe coexistence with MCP server
 */

import * as path from 'path';
import * as os from 'os';
import type { CodeGraph } from '../index';
import { DaemonLogger } from './logger';
import { writePid, clearPid } from './pid';
import { scanForProjects } from './discovery';

const DEBOUNCE_MS = 1000;
const DISCOVERY_INTERVAL_MS = 30_000; // re-scan for new projects every 30s
const HOME = os.homedir();

const log = new DaemonLogger();

// Map from project root → active debounce timer (null = no pending sync)
const projectTimers = new Map<string, ReturnType<typeof setTimeout> | null>();

// Map from project root → @parcel/watcher subscription
const projectSubs = new Map<string, { unsubscribe: () => Promise<void> }>();

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

async function syncProject(projectRoot: string): Promise<void> {
  // Lazy-load to keep startup fast
  const { CodeGraph } = await import('../index');
  let cg: CodeGraph | null = null;
  try {
    cg = await CodeGraph.open(projectRoot);
    const result = await cg.sync();
    if (result.filesAdded + result.filesModified + result.filesRemoved > 0) {
      log.info(
        `synced ${projectRoot}: ` +
        `+${result.filesAdded} ~${result.filesModified} -${result.filesRemoved} ` +
        `(${result.durationMs}ms)`
      );
    }
  } catch (err) {
    log.error(`sync failed for ${projectRoot}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    cg?.close();
  }
}

function scheduleSync(projectRoot: string): void {
  const existing = projectTimers.get(projectRoot);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    projectTimers.set(projectRoot, null);
    syncProject(projectRoot).catch(() => {});
  }, DEBOUNCE_MS);

  projectTimers.set(projectRoot, timer);
}

// ---------------------------------------------------------------------------
// Per-project watcher
// ---------------------------------------------------------------------------

async function watchProject(projectRoot: string): Promise<void> {
  if (projectSubs.has(projectRoot)) return; // already watching

  log.info(`watching ${projectRoot}`);
  projectTimers.set(projectRoot, null);

  try {
    // Import lazily — @parcel/watcher has a native addon
    const { subscribe } = await import('@parcel/watcher');

    const sub = await subscribe(
      projectRoot,
      (err, events) => {
        if (err) {
          log.error(`watcher error for ${projectRoot}: ${err.message}`);
          return;
        }

        // Detect .codegraph deletion → stop watching this project
        const codegraphGone = events.some(
          e =>
            e.type === 'delete' &&
            (e.path === path.join(projectRoot, '.codegraph', 'codegraph.db') ||
              e.path === path.join(projectRoot, '.codegraph'))
        );

        if (codegraphGone) {
          log.info(`${projectRoot} uninitialized — stopping watch`);
          unwatchProject(projectRoot).catch(() => {});
          return;
        }

        // Ignore events from inside .codegraph/ to avoid sync loops
        // (the DB writes that sync produces would otherwise re-trigger sync)
        const relevant = events.filter(
          e => !e.path.startsWith(path.join(projectRoot, '.codegraph') + path.sep) &&
               e.path !== path.join(projectRoot, '.codegraph')
        );

        if (relevant.length > 0) {
          scheduleSync(projectRoot);
        }
      },
      {
        ignore: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/__pycache__/**',
          '**/target/**',
          '**/.cargo/**',
          '**/*.pyc',
          '**/*.o',
          '**/*.so',
        ],
      }
    );

    projectSubs.set(projectRoot, sub);
  } catch (err) {
    log.error(`failed to watch ${projectRoot}: ${err instanceof Error ? err.message : String(err)}`);
    projectTimers.delete(projectRoot);
  }
}

async function unwatchProject(projectRoot: string): Promise<void> {
  const timer = projectTimers.get(projectRoot);
  if (timer) clearTimeout(timer);
  projectTimers.delete(projectRoot);

  const sub = projectSubs.get(projectRoot);
  projectSubs.delete(projectRoot);
  if (sub) {
    try { await sub.unsubscribe(); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Discovery loop
// ---------------------------------------------------------------------------

async function discoverAndWatch(): Promise<void> {
  const found = scanForProjects(HOME);
  for (const projectRoot of found) {
    if (!projectSubs.has(projectRoot)) {
      await watchProject(projectRoot);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log.info(`daemon starting (PID ${process.pid})`);
  writePid();

  async function shutdown(): Promise<void> {
    log.info('daemon shutting down');
    clearPid();
    for (const projectRoot of [...projectSubs.keys()]) {
      await unwatchProject(projectRoot).catch(() => {});
    }
    process.exit(0);
  }

  process.on('SIGTERM', () => { shutdown().catch(() => process.exit(1)); });
  process.on('SIGINT',  () => { shutdown().catch(() => process.exit(1)); });

  // Initial discovery
  log.info(`scanning ${HOME} for codegraph projects...`);
  await discoverAndWatch();
  log.info(`watching ${projectSubs.size} project(s) — daemon ready`);

  // Periodic re-discovery to pick up newly initialized projects
  setInterval(() => {
    discoverAndWatch().catch(err => {
      log.error(`discovery error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, DISCOVERY_INTERVAL_MS);

  // Keep the process alive (the watcher subscriptions keep the event loop running,
  // but the setInterval also ensures we stay alive even if all subs are removed)
}

main().catch(err => {
  log.error(`daemon fatal error: ${err instanceof Error ? err.message : String(err)}`);
  clearPid();
  process.exit(1);
});
