#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RUN_WITH_ENV_SCRIPT = path.join(__dirname, 'run-with-env.js');
const RESTART_DELAY_MS = Number(process.env.CLIENT_RESTART_DELAY_MS || 5000);
const MAX_RESTARTS = Number(process.env.CLIENT_MAX_RESTARTS || 50);
const CLIENT_NODE_ENV = process.env.CLIENT_NODE_ENV || 'production';
const CLIENT_RSPACK_MODE = process.env.CLIENT_RSPACK_MODE || CLIENT_NODE_ENV;

let stopping = false;
let restartCount = 0;
let child = null;

function nowLabel() {
  return new Date().toISOString();
}

function getLocalBin(name) {
  const fileName = process.platform === 'win32' ? `${name}.cmd` : name;
  return path.join(ROOT, 'node_modules', '.bin', fileName);
}

function startChild() {
  const rspackPath = getLocalBin('rspack');
  if (!fs.existsSync(rspackPath)) {
    console.error(`[client-supervisor] ${nowLabel()} missing ${rspackPath}, please run npm install first`);
    process.exit(1);
  }

  child = spawn(
    process.execPath,
    [
      RUN_WITH_ENV_SCRIPT,
      CLIENT_NODE_ENV,
      rspackPath,
      'serve',
      '--config',
      'rspack.config.js',
      '--env',
      `mode=${CLIENT_RSPACK_MODE}`,
    ],
    {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      windowsHide: false,
    },
  );

  console.log(`[client-supervisor] ${nowLabel()} started frontend pid=${child.pid} nodeEnv=${CLIENT_NODE_ENV} rspackMode=${CLIENT_RSPACK_MODE}`);

  child.on('exit', (code, signal) => {
    const exitLabel = signal ? `signal=${signal}` : `code=${code}`;
    console.log(`[client-supervisor] ${nowLabel()} frontend exited ${exitLabel}`);
    child = null;

    if (stopping) {
      process.exit(code || 0);
      return;
    }

    restartCount += 1;
    if (restartCount > MAX_RESTARTS) {
      console.error(`[client-supervisor] ${nowLabel()} restart limit reached (${MAX_RESTARTS}), giving up`);
      process.exit(1);
      return;
    }

    const delayMs = Math.min(RESTART_DELAY_MS * restartCount, 30000);
    console.warn(`[client-supervisor] ${nowLabel()} restarting frontend in ${Math.round(delayMs / 1000)}s`);
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
