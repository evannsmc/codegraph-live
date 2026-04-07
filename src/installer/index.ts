/**
 * CodeGraph Interactive Installer
 *
 * Uses @clack/prompts for a polished interactive CLI experience.
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  writeMcpConfig, writePermissions, writeClaudeMd, writeHooks,
  hasMcpConfig, hasPermissions, hasHooks,
} from './config-writer';
import type { InstallLocation } from './config-writer';


// Dynamic import helper — tsc compiles import() to require() in CJS mode,
// which fails for ESM-only packages. This bypasses the transformation.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importESM = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<typeof import('@clack/prompts')>;

/**
 * Format a number with commas
 */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Get the package version
 */
function getVersion(): string {
  try {
    const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version;
  } catch {
    return '0.0.0';
  }
}

/**
 * Run the one-time global system installer (codegraph-live install).
 *
 * Writes to ~/.claude/ (global):
 *   - ~/.claude.json          MCP server registration
 *   - ~/.claude/settings.json permissions + hooks
 *   - ~/.claude/CLAUDE.md     CodeGraph usage instructions for all projects
 *
 * Then optionally initializes the current directory as a project.
 */
export async function runGlobalInstaller(): Promise<void> {
  const clack = await importESM('@clack/prompts');

  clack.intro(`CodeGraph Live v${getVersion()} — Global Setup`);
  clack.log.info('Writing global Claude Code configuration (~/.claude/)');

  // Write global config (MCP, permissions, hooks, CLAUDE.md → ~/.claude/)
  writeConfigs(clack, 'global', true);

  // Offer to initialize current directory if it isn't already
  const projectPath = process.cwd();
  let CodeGraph: typeof import('../index').default | undefined;
  try {
    CodeGraph = (await import('../index')).default;
  } catch {
    // Native modules unavailable — skip project init offer
  }

  if (CodeGraph && !CodeGraph.isInitialized(projectPath)) {
    const shouldInit = await clack.confirm({
      message: `Initialize CodeGraph in the current directory? (${projectPath})`,
      initialValue: true,
    });

    if (clack.isCancel(shouldInit) || !shouldInit) {
      clack.log.info(`Skipped. Run \`codegraph-live init\` inside any project later.`);
    } else {
      await initializeLocalProject(clack, projectPath);
    }
  } else if (CodeGraph?.isInitialized(projectPath)) {
    clack.log.info('Current directory already has CodeGraph initialized.');
  }

  clack.outro('Done! Restart Claude Code to activate CodeGraph.');
}

/**
 * Run the per-project initializer (codegraph-live init [path]).
 *
 * Writes to ./.claude/ (local):
 *   - .claude.json            MCP server registration
 *   - .claude/settings.json   permissions + hooks
 *
 * Then indexes the project (creates .codegraph/).
 * Does NOT write CLAUDE.md — that belongs globally in ~/.claude/CLAUDE.md.
 */
export async function runProjectInit(projectPath: string): Promise<void> {
  const clack = await importESM('@clack/prompts');

  clack.intro(`CodeGraph Live v${getVersion()} — Project Init`);
  clack.log.info(`Setting up ${projectPath}`);

  // Write local MCP + hooks only (no CLAUDE.md — global installer handles that)
  writeConfigs(clack, 'local', true, /* skipClaudeMd */ true);

  // Index the project
  let CodeGraph: typeof import('../index').default;
  try {
    CodeGraph = (await import('../index')).default;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    clack.log.error(`Could not load native modules: ${msg}`);
    clack.log.info('Skipping project indexing. Run "codegraph-live reindex" later.');
    clack.outro('Partial setup complete.');
    return;
  }

  if (CodeGraph.isInitialized(projectPath)) {
    clack.log.info('CodeGraph already initialized in this project — skipping index.');
  } else {
    await initializeLocalProject(clack, projectPath);
  }

  clack.outro('Done! The daemon will keep the graph up to date automatically.');
}

/**
 * Write all configuration files and log results.
 * Pass skipClaudeMd=true for per-project init — CLAUDE.md lives globally in ~/.claude/.
 */
function writeConfigs(
  clack: typeof import('@clack/prompts'),
  location: InstallLocation,
  autoAllow: boolean,
  skipClaudeMd = false,
): void {
  const locationLabel = location === 'global' ? '~/.claude' : './.claude';

  // MCP config
  const mcpAction = hasMcpConfig(location) ? 'Updated' : 'Added';
  writeMcpConfig(location);
  clack.log.success(`${mcpAction} MCP server in ${locationLabel}.json`);

  // Permissions
  if (autoAllow) {
    const permAction = hasPermissions(location) ? 'Updated' : 'Added';
    writePermissions(location);
    clack.log.success(`${permAction} permissions in ${locationLabel}/settings.json`);
  }

  // Hooks
  const hookAction = hasHooks(location) ? 'Updated' : 'Added';
  writeHooks(location);
  clack.log.success(`${hookAction} auto-sync hooks in ${locationLabel}/settings.json`);

  // CLAUDE.md — skip for per-project init; only written by global installer
  if (!skipClaudeMd) {
    const claudeMdResult = writeClaudeMd(location);
    const claudeMdPath = `${locationLabel}/CLAUDE.md`;
    if (claudeMdResult.created) {
      clack.log.success(`Created ${claudeMdPath}`);
    } else if (claudeMdResult.updated) {
      clack.log.success(`Updated ${claudeMdPath}`);
    } else {
      clack.log.success(`Added CodeGraph Live instructions to ${claudeMdPath}`);
    }
  }
}

/**
 * Initialize and fully index a project, showing shimmer progress.
 */
async function initializeLocalProject(
  clack: typeof import('@clack/prompts'),
  projectPath: string,
): Promise<void> {
  // Lazy-load CodeGraph (requires native modules)
  let CodeGraph: typeof import('../index').default;
  try {
    CodeGraph = (await import('../index')).default;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    clack.log.error(`Could not load native modules: ${msg}`);
    clack.log.info('Skipping project initialization. Run "codegraph-live init" later.');
    return;
  }

  // Check if already initialized
  if (CodeGraph.isInitialized(projectPath)) {
    clack.log.info('CodeGraph already initialized in this project');
    return;
  }

  // Initialize
  const cg = await CodeGraph.init(projectPath);
  clack.log.success('Created .codegraph/ directory');

  // Index the project with shimmer progress (worker thread for smooth animation)
  const { createShimmerProgress } = await import('../ui/shimmer-progress');
  process.stdout.write(`\x1b[2m│\x1b[0m\n`);
  const progress = createShimmerProgress();

  const result = await cg.indexAll({
    onProgress: progress.onProgress,
  });

  await progress.stop();

  if (result.filesErrored > 0) {
    clack.log.success(`Indexed ${formatNumber(result.filesIndexed)} files (${formatNumber(result.filesErrored)} failed, ${formatNumber(result.nodesCreated)} symbols)`);
  } else {
    clack.log.success(`Indexed ${formatNumber(result.filesIndexed)} files (${formatNumber(result.nodesCreated)} symbols)`);
  }

  cg.close();
}

// Re-export for CLI
export type { InstallLocation };
