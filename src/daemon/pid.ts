import * as fs from 'fs';
import * as path from 'path';
import { getDataDir, ensureDataDir } from './logger';

export function getPidPath(): string {
  return path.join(getDataDir(), 'daemon.pid');
}

export function writePid(): void {
  ensureDataDir();
  fs.writeFileSync(getPidPath(), String(process.pid), 'utf-8');
}

export function readPid(): number | null {
  try {
    const content = fs.readFileSync(getPidPath(), 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function clearPid(): void {
  try {
    fs.unlinkSync(getPidPath());
  } catch {
    // already gone
  }
}

export function isDaemonRunning(): boolean {
  const pid = readPid();
  if (pid === null) return false;
  try {
    // Signal 0 = check if process exists without sending a real signal
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH: no such process — stale PID file
    clearPid();
    return false;
  }
}
