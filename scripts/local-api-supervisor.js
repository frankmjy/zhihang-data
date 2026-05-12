#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LOCAL_API_SCRIPT = path.join(__dirname, 'risk-local-api.js');
const RESTART_DELAY_MS = Number(process.env.LOCAL_API_RESTART_DELAY_MS || 5000);
const MAX_RESTARTS = Number(process.env.LOCAL_API_MAX_RESTARTS || 20);

let stopping = false;
let restartCount = 0;
let child = null;

function nowLabel() {
  return new Date().toISOString();
}

function startChild() {
  child = spawn(process.execPath, [LOCAL_API_SCRIPT], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    windowsHide: false,
  });

  console.log(`[local-api-supervisor] ${nowLabel()} started risk-local-api pid=${child.pid}`);

  child.on('exit', (code, signal) => {
    const exitLabel = signal ? `signal=${signal}` : `code=${code}`;
    console.log(`[local-api-supervisor] ${nowLabel()} risk-local-api exited ${exitLabel}`);
    child = null;

    if (stopping) {
      process.exit(code || 0);
      return;
    }

    restartCount += 1;
    if (restartCount > MAX_RESTARTS) {
      console.error(`[local-api-supervisor] ${nowLabel()} restart limit reached (${MAX_RESTARTS}), giving up`);
      process.exit(1);
      return;
    }

    const delayMs = Math.min(RESTART_DELAY_MS * restartCount, 30000);
    console.warn(`[local-api-supervisor] ${nowLabel()} restarting local API in ${Math.round(delayMs / 1000)}s`);
    setTimeout(startChild, delayMs);
  });
}

function stop(signal) {
  stopping = true;
  if (child && !child.killed) {
    child.kill(signal);
    return;
  }

  process.exit(0);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGHUP', () => stop('SIGHUP'));

startChild();
