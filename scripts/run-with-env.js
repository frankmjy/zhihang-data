#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const [, , nodeEnv, command, ...args] = process.argv;
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');

if (!nodeEnv || !command) {
  console.error('Usage: node scripts/run-with-env.js <NODE_ENV> <command> [...args]');
  process.exit(1);
}

function loadDotEnv() {
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const envMap = {};
  const content = fs.readFileSync(envPath, 'utf8');

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    envMap[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }

  return envMap;
}

const dotEnv = loadDotEnv();

const child = spawn(command, args, {
  env: {
    ...process.env,
    ...dotEnv,
    NODE_ENV: nodeEnv,
  },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
