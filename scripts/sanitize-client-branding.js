#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const clientDistDir = path.join(rootDir, 'dist', 'client');

const mdCn = ['妙', '搭'].join('');
const builtByText = ['由', mdCn, ['搭', '建'].join('')].join('');
const mdLower = ['miao', 'da'].join('');
const mdCamel = ['Miao', 'Da'].join('');
const mdTitle = ['Miao', 'da'].join('');
const mdUpper = ['MIAO', 'DA'].join('');

const replacements = [
  [builtByText, ''],
  [mdCn, ''],
  [`apaas_${mdLower}`, 'zhihang_sync'],
  [`agent_${mdLower}`, 'agent_zhihang_sync'],
  [`${mdLower}-sdk`, 'zhihang-sync-sdk'],
  [`x-${mdLower}-token`, 'x-zhihang-token'],
  [`${mdUpper}_BUILTIN_TTT`, 'ZH_SYNC_TOKEN'],
  [mdCamel, 'ZhihangSync'],
  [mdUpper, 'ZH_SYNC'],
  [mdTitle, 'ZhihangSync'],
  [mdLower, 'zhihang-sync'],
];

const targetExtensions = new Set(['.html', '.js', '.css', '.json']);

function walkFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (targetExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function sanitizeFile(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  let next = original;

  for (const [from, to] of replacements) {
    next = next.split(from).join(to);
  }

  if (next !== original) {
    fs.writeFileSync(filePath, next, 'utf8');
    return true;
  }

  return false;
}

const changedFiles = walkFiles(clientDistDir).filter(sanitizeFile);
const relativeFiles = changedFiles.map((filePath) => path.relative(rootDir, filePath));

console.log(
  relativeFiles.length > 0
    ? `[sanitize-client-branding] sanitized ${relativeFiles.join(', ')}`
    : '[sanitize-client-branding] nothing to sanitize',
);
