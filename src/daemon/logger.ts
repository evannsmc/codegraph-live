import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export function getDataDir(): string {
  return path.join(os.homedir(), '.local', 'share', 'codegraph-live');
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export class DaemonLogger {
  private logPath: string;

  constructor() {
    const dir = ensureDataDir();
    this.logPath = path.join(dir, 'daemon.log');
  }

  private write(level: string, msg: string): void {
    const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
    try {
      fs.appendFileSync(this.logPath, line);
    } catch {
      // best-effort; don't crash the daemon over a log write
    }
  }

  info(msg: string): void { this.write('INFO', msg); }
  warn(msg: string): void { this.write('WARN', msg); }
  error(msg: string): void { this.write('ERROR', msg); }

  getLogPath(): string { return this.logPath; }
}
