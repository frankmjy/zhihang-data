#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const command = process.platform === 'win32'
  ? path.resolve(process.cwd(), 'node_modules', '.bin', 'fullstack-cli.cmd')
  : 'fullstack-cli';

const result = spawnSync(fs.existsSync(command) ? command : 'fullstack-cli', ['action-plugin', 'init'], {
  stdio: 'inherit',
  shell: false,
});

if (result.error || result.status !== 0) {
  const message = result.error?.message || `exit code ${result.status}`;
  console.warn(`[postinstall] action plugin initialization skipped: ${message}`);
  console.warn('[postinstall] Run `fullstack-cli action-plugin init` manually if action plugin assets need to be refreshed.');
}
