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
 * Run the interactive setup for the current project.
 * Always writes local config (./.claude/) since the user ran this
 * from inside the project they want to initialize.
 */
export async function runInstaller(): Promise<void> {
  const clack = await importESM('@clack/prompts');

  clack.intro(`CodeGraph Live v${getVersion()}`);
  clack.log.info(`Setting up ${process.cwd()}`);

  // Write local Claude Code config (MCP server, hooks, permissions, CLAUDE.md)
  writeConfigs(clack, 'local', true);

  // Index the project
  await initializeLocalProject(clack);

  clack.outro('Done! Restart Claude Code to activate the graph.');
}

/**
 * Write all configuration files and log results
 */
function writeConfigs(
  clack: typeof import('@clack/prompts'),
  location: InstallLocation,
  autoAllow: boolean,
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

  // CLAUDE.md
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

/**
 * Initialize CodeGraph in the current project (for local installs)
 */
async function initializeLocalProject(clack: typeof import('@clack/prompts')): Promise<void> {
  const projectPath = process.cwd();

  // Lazy-load CodeGraph (requires native modules)
  let CodeGraph: typeof import('../index').default;
  try {
    CodeGraph = (await import('../index')).default;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    clack.log.error(`Could not load native modules: ${msg}`);
    clack.log.info('Skipping project initialization. Run "codegraph init -i" later.');
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
