#!/usr/bin/env node
/**
 * codegraph-live daemon entry point
 *
 * This script IS the daemon process. It is not meant to be run directly by the
 * user — it is spawned detached by `codegraph-live daemon start` and registered
 * as the ExecStart target in the systemd user service.
 *
 * Usage (internal):
 *   node dist/bin/daemon.js
 *
 * User-facing management:
 *   codegraph-live daemon start | stop | status | restart
 */

// Importing the daemon module starts it immediately
import '../daemon/index';
