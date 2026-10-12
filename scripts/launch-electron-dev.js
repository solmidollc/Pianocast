#!/usr/bin/env node
/* eslint-env node */
/* global require, process */
//
// Launch Electron.app via LaunchServices (`open -a`) instead of spawning
// the binary directly as a Terminal child process.
//
// Why this exists
//   macOS TCC won't display the camera/microphone permission prompt for an
//   Electron dev app spawned as a child of Terminal — even with a valid
//   ad-hoc signature, hardened runtime, entitlements, NSCameraUsageDescription,
//   and app.focus({ steal: true }). LaunchServices treats a Terminal-child
//   process as a background helper of Terminal, not a first-class GUI app,
//   and TCC silently drops the prompt. Launching via `open -a` makes
//   LaunchServices register the app under its own bundle id
//   (com.pianokeys.dev), which is what TCC keys off. After that, the prompt
//   appears normally and getUserMedia returns real frames.
//
// Log streaming
//   `open` detaches the launched app so we lose stdout/stderr. We can't pass
//   `--stdout /dev/stdout` because npm/concurrently pipes this launcher's
//   stdout, meaning /dev/stdout resolves to a fd LaunchServices can't
//   reopen (fails with -10810). Instead we write to a real temp file and
//   `tail -F` it here so [electron] logs still land in the dev terminal
//   under concurrently's namespacing.
//
// `-W` blocks until the app exits, so `npm run dev` cleanly tears everything
// down when you Cmd+Q the Electron window.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const repo = path.resolve(__dirname, '..');
const electronApp = path.join(repo, 'node_modules', 'electron', 'dist', 'Electron.app');
const mainScript = path.join(repo, 'dist-electron', 'main.js');
const logFile = path.join(os.tmpdir(), `pianokeys-electron-${process.pid}.log`);

// Create/truncate log file so tail -F starts from empty.
fs.writeFileSync(logFile, '');

// Tail the log to our stdout. `-F` follows renames/truncations.
const tail = spawn('tail', ['-F', '-n', '+1', logFile], { stdio: ['ignore', 'inherit', 'inherit'] });

const open = spawn('open', [
  '-W',
  '-n',
  '--stdout', logFile,
  '--stderr', logFile,
  '--env', `NODE_ENV=${process.env.NODE_ENV || 'development'}`,
  '-a', electronApp,
  '--args', mainScript,
], { stdio: 'inherit' });

function cleanup(code, signal) {
  try { tail.kill('SIGTERM'); } catch { /* noop */ }
  try { fs.unlinkSync(logFile); } catch { /* noop */ }
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
}

open.on('exit', cleanup);
process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));
