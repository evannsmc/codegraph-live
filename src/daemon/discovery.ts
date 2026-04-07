import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Directories that are never worth recursing into
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '__pycache__',
  '.cache', '.npm', '.yarn', '.pnpm', 'venv', '.venv', 'env',
  'target', '.cargo', '.rustup', 'vendor', '.gradle', '.m2',
]);

/**
 * Recursively scan a root directory for codegraph-initialized projects.
 * A project is identified by the presence of `.codegraph/codegraph.db`.
 */
export function scanForProjects(root: string = os.homedir()): string[] {
  const projects: string[] = [];

  function recurse(dir: string, depth: number): void {
    if (depth > 8) return; // cap to avoid pathological symlink loops

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // permission denied or other I/O error
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Skip hidden dirs except .codegraph itself
      if (entry.name.startsWith('.') && entry.name !== '.codegraph') continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.name === '.codegraph') {
        const dbPath = path.join(fullPath, 'codegraph.db');
        if (fs.existsSync(dbPath)) {
          projects.push(dir); // parent of .codegraph is the project root
        }
        continue; // never recurse into .codegraph
      }

      recurse(fullPath, depth + 1);
    }
  }

  recurse(root, 0);
  return projects;
}
