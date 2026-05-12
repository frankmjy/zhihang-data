#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const SCRIPT_DIR = __dirname;
const ROOT = path.basename(SCRIPT_DIR).toLowerCase() === 'scripts'
  ? path.resolve(SCRIPT_DIR, '..')
  : SCRIPT_DIR;

loadDotEnvFiles();

const cli = parseArgs(process.argv.slice(2));

if (cli.help) {
  printHelp();
  process.exit(0);
}

const config = buildConfig(cli);

if (cli.printConfig) {
  printConfig(config);
  process.exit(0);
}

if (!config.enabled) {
  log('keepalive disabled by INTRANET_KEEPALIVE_ENABLED/RISK_KEEPALIVE_ENABLED=false');
  process.exit(0);
}

if (typeof fetch !== 'function' || typeof AbortController !== 'function' || typeof WebSocket !== 'function') {
  console.error('Node.js 22 or newer is required because this script uses built-in fetch and WebSocket.');
  console.error('Install Node.js LTS 22+, then run: node intranet-keepalive.js');
  process.exit(1);
}

let stopping = false;
let launchedBrowserPid = 0;

process.on('SIGINT', () => {
  stopping = true;
  log('stopping after current heartbeat...');
});

process.on('SIGTERM', () => {
  stopping = true;
});

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

async function main() {
  if (config.origins.length === 0) {
    throw new Error('No intranet origins configured. Set INTRANET_KEEPALIVE_ORIGINS or RISK_INTRANET_ORIGIN.');
  }

  log(`debug port=${config.debugPort}`);
  log(`profile=${config.profileDir}`);
  log(`origins=${config.origins.join(', ')}`);

  if (cli.once) {
    const result = await runKeepAliveOnce(config);
    process.exit(result.ok ? 0 : 2);
  }

  log(`first heartbeat in ${formatDuration(config.startDelayMs)}, interval=${formatDuration(config.intervalMs)}`);
  await sleep(config.startDelayMs);

  let consecutiveFailures = 0;
  while (!stopping) {
    const result = await runKeepAliveOnce(config);
    if (stopping) break;

    let delayMs = config.intervalMs;
    if (result.ok) {
      consecutiveFailures = 0;
    } else if (result.recoverable) {
      consecutiveFailures = 0;
      delayMs = config.retryMs;
    } else {
      consecutiveFailures += 1;
      delayMs = getBackoffDelay(config, consecutiveFailures);
    }

    log(`next heartbeat in ${formatDuration(delayMs)}`);
    await sleep(delayMs);
  }

  if (launchedBrowserPid) {
    log(`browser pid ${launchedBrowserPid} was launched by this script and is left open for the login session`);
  }
}

async function runKeepAliveOnce(activeConfig) {
  const results = [];
  const errors = [];

  log('heartbeat started');

  for (const origin of activeConfig.origins) {
    try {
      const target = await findIntranetTarget(origin, activeConfig);
      await assertTargetOrigin(target.webSocketDebuggerUrl, origin, activeConfig);
      const pingResult = await pingIntranetTargetWithRecovery(origin, target, activeConfig);
      const status = Number(pingResult?.status || 0);
      results.push({
        origin,
        status,
        href: pingResult?.href || target.url || '',
        recovered: Boolean(pingResult?.recovered),
      });
      log(`ok ${origin} HTTP ${status || '--'}${pingResult?.recovered ? ' after reload' : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ origin, message });
      warn(`failed ${origin}: ${message}`);
    }
  }

  if (results.length === 0) {
    const message = formatKeepAliveErrors(errors) || 'all intranet heartbeat checks failed';
    const recoverable = errors.some((item) => isRecoverableKeepAliveIssueMessage(item.message));
    warn(recoverable ? `waiting: ${message}` : `degraded: ${message}`);
    return { ok: false, recoverable, results, errors };
  }

  if (errors.length > 0) {
    warn(`partial heartbeat success ${results.length}/${activeConfig.origins.length}: ${formatKeepAliveErrors(errors)}`);
    return { ok: true, partial: true, recoverable: false, results, errors };
  }

  log(`heartbeat healthy ${results.map((item) => `${item.origin}:${item.status || '--'}`).join(', ')}`);
  return { ok: true, partial: false, recoverable: false, results, errors };
}

async function findIntranetTarget(origin, activeConfig) {
  let targets;
  try {
    targets = await fetchDevtoolsJson('/json', {}, activeConfig);
  } catch (error) {
    if (activeConfig.noLaunch) {
      throw error;
    }

    warn(`debug port ${activeConfig.debugPort} is not reachable, launching browser...`);
    await launchDebugBrowser(activeConfig);
    targets = await fetchDevtoolsJson('/json', {}, activeConfig);
  }

  const pages = targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  const activeTarget = await findUsableIntranetTarget(pages, origin, activeConfig);
  if (activeTarget) return activeTarget;

  await openIntranetTarget(origin, activeConfig);
  const newTarget = await waitForUsableIntranetTarget(origin, activeConfig);
  if (!newTarget) {
    throw new Error(`tab for ${origin} is not ready; finish VPN/intranet login in the opened browser tab`);
  }

  return newTarget;
}

async function findUsableIntranetTarget(pages, origin, activeConfig) {
  for (const target of pages) {
    const location = await getTargetLocation(target, activeConfig);
    if (location?.origin === origin) {
      target.currentLocation = location;
      return target;
    }
  }

  return null;
}

async function waitForUsableIntranetTarget(origin, activeConfig) {
  for (let attempt = 0; attempt < activeConfig.targetDiscoveryRetries; attempt += 1) {
    if (attempt > 0) {
      await sleep(activeConfig.targetDiscoveryIntervalMs);
    }

    const targets = await fetchDevtoolsJson('/json', {}, activeConfig);
    const pages = targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    const target = await findUsableIntranetTarget(pages, origin, activeConfig);
    if (target) return target;
  }

  return null;
}

async function launchDebugBrowser(activeConfig) {
  const browserPath = getBrowserExecutable(activeConfig);
  if (!browserPath) {
    throw new Error('Chrome or Edge was not found. Set INTRANET_KEEPALIVE_BROWSER_PATH or RISK_BROWSER_PATH.');
  }

  fs.mkdirSync(activeConfig.profileDir, { recursive: true });
  fs.mkdirSync(activeConfig.runDir, { recursive: true });

  const browserArgs = [
    `--remote-debugging-port=${activeConfig.debugPort}`,
    `--user-data-dir=${activeConfig.profileDir}`,
    '--no-first-run',
    '--new-window',
    ...activeConfig.openUrls,
  ];

  const child = spawn(browserPath, browserArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });

  const spawnError = await new Promise((resolve) => {
    child.once('error', resolve);
    child.once('spawn', () => resolve(null));
  });
  if (spawnError) {
    throw spawnError;
  }

  child.unref();
  launchedBrowserPid = Number(child.pid || 0);
  fs.writeFileSync(path.join(activeConfig.runDir, 'intranet-keepalive-browser.pid'), String(child.pid || ''), 'utf8');

  await waitForDevtoolsReady(activeConfig);
  log(`browser launched pid=${child.pid || ''}`);
}

async function waitForDevtoolsReady(activeConfig) {
  const deadline = Date.now() + activeConfig.browserStartWaitMs;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      await fetchDevtoolsJson('/json/version', {}, activeConfig);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(500);
    }
  }

  throw new Error(lastError || `debug port ${activeConfig.debugPort} was not ready in ${formatDuration(activeConfig.browserStartWaitMs)}`);
}

async function openIntranetTarget(origin, activeConfig) {
  const targetUrl = `${origin}/`;
  const route = `/json/new?${encodeURIComponent(targetUrl)}`;

  try {
    return await fetchDevtoolsJson(route, { method: 'PUT' }, activeConfig);
  } catch {
    return fetchDevtoolsJson(route, { method: 'GET' }, activeConfig);
  }
}

async function fetchDevtoolsJson(route, init, activeConfig) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), activeConfig.devtoolsTimeoutMs);

  try {
    const response = await fetch(`http://127.0.0.1:${activeConfig.debugPort}${route}`, {
      ...init,
      signal: init?.signal || controller.signal,
    });
    if (!response.ok) {
      throw new Error(`debug port returned HTTP ${response.status}`);
    }
    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`debug port ${activeConfig.debugPort} timed out`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getTargetLocation(target, activeConfig) {
  try {
    return await evaluateInTarget(
      target.webSocketDebuggerUrl,
      '({ origin: window.location.origin, href: window.location.href, title: document.title })',
      activeConfig,
      5000,
    );
  } catch (error) {
    return {
      origin: '',
      href: target.url || '',
      title: target.title || '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function assertTargetOrigin(webSocketDebuggerUrl, origin, activeConfig) {
  const location = await evaluateInTarget(
    webSocketDebuggerUrl,
    '({ origin: window.location.origin, href: window.location.href })',
    activeConfig,
    5000,
  );

  if (location?.origin !== origin) {
    throw new Error(`current tab is not on ${origin}; current page is ${location?.href || 'unknown'}`);
  }
}

async function pingIntranetTarget(target, activeConfig) {
  const result = await evaluateInTarget(
    target.webSocketDebuggerUrl,
    buildKeepAlivePingExpression(activeConfig.requestTimeoutMs, activeConfig.pingPath),
    activeConfig,
    activeConfig.requestTimeoutMs + 3000,
  );

  if (result?.browserError) {
    throw new Error(result.browserError);
  }

  const status = Number(result?.status || 0);
  if (status === 401 || status === 403) {
    throw new Error(`login session may be expired, HTTP ${status}`);
  }
  if (status >= 500) {
    throw new Error(`intranet page returned HTTP ${status}`);
  }

  return result;
}

async function recoverIntranetTarget(origin, target, activeConfig) {
  if (!activeConfig.recoveryEnabled) {
    return target;
  }

  const activeTarget = target || await findIntranetTarget(origin, activeConfig);
  try {
    await sendDevtoolsCommand(activeTarget.webSocketDebuggerUrl, 'Page.enable', {}, activeConfig, 5000);
  } catch (error) {
    // Page may already be enabled.
  }

  try {
    await sendDevtoolsCommand(activeTarget.webSocketDebuggerUrl, 'Page.reload', { ignoreCache: true }, activeConfig, 10000);
  } catch (error) {
    await sendDevtoolsCommand(activeTarget.webSocketDebuggerUrl, 'Page.navigate', { url: `${origin}/` }, activeConfig, 10000);
  }

  await sleep(activeConfig.recoveryWaitMs);
  return await waitForUsableIntranetTarget(origin, activeConfig) || activeTarget;
}

async function pingIntranetTargetWithRecovery(origin, target, activeConfig) {
  try {
    return await pingIntranetTarget(target, activeConfig);
  } catch (error) {
    if (!activeConfig.recoveryEnabled) {
      throw error;
    }

    const firstMessage = error instanceof Error ? error.message : String(error);
    warn(`reload recovery ${origin}: ${firstMessage}`);
    let recoveredTarget;
    try {
      recoveredTarget = await recoverIntranetTarget(origin, target, activeConfig);
    } catch (recoveryError) {
      const recoveryMessage = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
      throw new Error(`${firstMessage}; recovery reload failed: ${recoveryMessage}`);
    }

    try {
      const retryResult = await pingIntranetTarget(recoveredTarget, activeConfig);
      return {
        ...retryResult,
        recovered: true,
        recoveryReason: firstMessage,
      };
    } catch (retryError) {
      const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(`${firstMessage}; recovery reload still failed: ${retryMessage}`);
    }
  }
}

function buildKeepAlivePingExpression(timeoutMs, pingPath) {
  return `
    (() => new Promise((resolve) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ${Number(timeoutMs)});
      const pingUrl = new URL(${JSON.stringify(pingPath)}, window.location.origin).href;
      try {
        window.localStorage && window.localStorage.setItem('__zhihang_keepalive_at', String(Date.now()));
      } catch (error) {}
      fetch(pingUrl, {
        method: 'GET',
        credentials: 'include',
        cache: 'reload',
        mode: 'same-origin',
        redirect: 'follow',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        signal: controller.signal
      })
        .then((response) => resolve({
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          origin: window.location.origin,
          href: window.location.href,
          title: document.title
        }))
        .catch((error) => resolve({
          ok: false,
          browserError: error && error.name === 'AbortError' ? 'heartbeat timeout' : (error && error.message ? error.message : String(error)),
          origin: window.location.origin,
          href: window.location.href,
          title: document.title
        }))
        .finally(() => clearTimeout(timer));
    }))()
  `;
}

function evaluateInTarget(webSocketDebuggerUrl, expression, activeConfig, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    const requestId = 1;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('browser evaluation timed out'));
    }, timeoutMs);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: requestId,
        method: 'Runtime.evaluate',
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        },
      }));
    });

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== requestId) return;

      clearTimeout(timer);
      ws.close();

      if (message.error) {
        reject(new Error(message.error.message || 'DevTools command failed'));
        return;
      }

      if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.text || message.result.exceptionDetails.exception?.description || 'browser evaluation failed'));
        return;
      }

      resolve(message.result?.result?.value);
    });

    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`DevTools WebSocket connection failed on port ${activeConfig.debugPort}`));
    });
  });
}

function sendDevtoolsCommand(webSocketDebuggerUrl, method, params = {}, activeConfig, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    const requestId = 1;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`DevTools command timed out: ${method}`));
    }, timeoutMs);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: requestId,
        method,
        params,
      }));
    });

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== requestId) return;

      clearTimeout(timer);
      ws.close();

      if (message.error) {
        reject(new Error(message.error.message || `DevTools command failed: ${method}`));
        return;
      }

      resolve(message.result);
    });

    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`DevTools WebSocket connection failed on port ${activeConfig.debugPort}: ${method}`));
    });
  });
}

function buildConfig(parsedCli) {
  const defaultOrigins = [
    env('RISK_INTRANET_ORIGIN', 'https://risk.example.internal'),
    env('CHANGE_INTRANET_ORIGIN', 'https://change.example.internal'),
    env('DRILL_INTRANET_ORIGIN', 'https://drill.example.internal'),
    env('EVENT_INTRANET_ORIGIN', 'https://event.example.internal'),
  ];
  const cliOrigins = parsedCli.origins.length > 0 ? parsedCli.origins : null;
  const origins = normalizeOrigins(cliOrigins || parseList(
    firstEnv('INTRANET_KEEPALIVE_ORIGINS', 'RISK_KEEPALIVE_ORIGINS'),
    defaultOrigins,
  ));
  const openUrls = parseList(firstEnv('INTRANET_KEEPALIVE_OPEN_URLS', 'RISK_KEEPALIVE_OPEN_URLS'), origins.map((origin) => `${origin}/`))
    .map((value) => normalizeUrl(value))
    .filter(Boolean);
  const runDir = path.resolve(firstEnv('INTRANET_KEEPALIVE_RUN_DIR', 'RISK_KEEPALIVE_RUN_DIR') || path.join(ROOT, '.run'));

  return {
    enabled: parseBoolean(firstEnv('INTRANET_KEEPALIVE_ENABLED', 'RISK_KEEPALIVE_ENABLED'), true),
    debugPort: normalizeInteger(parsedCli.port || firstEnv('INTRANET_KEEPALIVE_DEBUG_PORT', 'RISK_BROWSER_DEBUG_PORT'), 9222, 1, 65535),
    origins,
    openUrls: openUrls.length > 0 ? openUrls : origins.map((origin) => `${origin}/`),
    pingPath: firstEnv('INTRANET_KEEPALIVE_PATH', 'RISK_KEEPALIVE_PATH') || '/',
    browserPath: parsedCli.browser || firstEnv('INTRANET_KEEPALIVE_BROWSER_PATH', 'RISK_BROWSER_PATH', 'BROWSER_PATH') || '',
    profileDir: path.resolve(parsedCli.profileDir || firstEnv('INTRANET_KEEPALIVE_PROFILE_DIR', 'RISK_BROWSER_PROFILE_DIR') || path.join(runDir, 'intranet-keepalive-profile')),
    runDir,
    noLaunch: Boolean(parsedCli.noLaunch || parseBoolean(firstEnv('INTRANET_KEEPALIVE_NO_LAUNCH', 'RISK_KEEPALIVE_NO_LAUNCH'), false)),
    intervalMs: normalizeInteger(parsedCli.intervalMs || firstEnv('INTRANET_KEEPALIVE_INTERVAL_MS', 'RISK_KEEPALIVE_INTERVAL_MS'), 2 * 60 * 1000, 10 * 1000, 24 * 60 * 60 * 1000),
    startDelayMs: normalizeInteger(parsedCli.startDelayMs || firstEnv('INTRANET_KEEPALIVE_START_DELAY_MS', 'RISK_KEEPALIVE_START_DELAY_MS'), 30 * 1000, 0, 60 * 60 * 1000),
    retryMs: normalizeInteger(parsedCli.retryMs || firstEnv('INTRANET_KEEPALIVE_RETRY_MS', 'RISK_KEEPALIVE_SKIP_RETRY_MS'), 60 * 1000, 5 * 1000, 60 * 60 * 1000),
    maxFailureBackoffMs: normalizeInteger(firstEnv('INTRANET_KEEPALIVE_MAX_FAILURE_BACKOFF_MS', 'RISK_KEEPALIVE_MAX_FAILURE_BACKOFF_MS'), 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
    requestTimeoutMs: normalizeInteger(firstEnv('INTRANET_KEEPALIVE_REQUEST_TIMEOUT_MS', 'RISK_KEEPALIVE_REQUEST_TIMEOUT_MS'), 8 * 1000, 1000, 60 * 1000),
    recoveryEnabled: parseBoolean(firstEnv('INTRANET_KEEPALIVE_RECOVERY_ENABLED', 'RISK_KEEPALIVE_RECOVERY_ENABLED'), true),
    recoveryWaitMs: normalizeInteger(firstEnv('INTRANET_KEEPALIVE_RECOVERY_WAIT_MS', 'RISK_KEEPALIVE_RECOVERY_WAIT_MS'), 3000, 500, 30 * 1000),
    devtoolsTimeoutMs: normalizeInteger(firstEnv('INTRANET_KEEPALIVE_DEVTOOLS_TIMEOUT_MS', 'RISK_DEVTOOLS_HTTP_TIMEOUT_MS'), 5 * 1000, 1000, 60 * 1000),
    browserStartWaitMs: normalizeInteger(firstEnv('INTRANET_KEEPALIVE_BROWSER_START_WAIT_MS', 'RISK_BROWSER_START_WAIT_MS'), 10 * 1000, 1000, 120 * 1000),
    targetDiscoveryRetries: normalizeInteger(firstEnv('INTRANET_KEEPALIVE_TARGET_DISCOVERY_RETRIES', 'RISK_TARGET_DISCOVERY_RETRIES'), 4, 1, 20),
    targetDiscoveryIntervalMs: normalizeInteger(firstEnv('INTRANET_KEEPALIVE_TARGET_DISCOVERY_INTERVAL_MS', 'RISK_TARGET_DISCOVERY_INTERVAL_MS'), 1500, 200, 30 * 1000),
  };
}

function parseArgs(argv) {
  const result = {
    help: false,
    once: false,
    noLaunch: false,
    printConfig: false,
    origins: [],
    port: '',
    browser: '',
    profileDir: '',
    intervalMs: '',
    startDelayMs: '',
    retryMs: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const [flag, inlineValue] = raw.includes('=') ? raw.split(/=(.*)/s, 2) : [raw, undefined];
    const nextValue = () => inlineValue !== undefined ? inlineValue : argv[++index];

    switch (flag) {
      case '-h':
      case '--help':
        result.help = true;
        break;
      case '--once':
        result.once = true;
        break;
      case '--no-launch':
        result.noLaunch = true;
        break;
      case '--print-config':
        result.printConfig = true;
        break;
      case '--origin':
        result.origins.push(nextValue());
        break;
      case '--origins':
        result.origins.push(...parseList(nextValue(), []));
        break;
      case '--port':
        result.port = nextValue();
        break;
      case '--browser':
        result.browser = nextValue();
        break;
      case '--profile-dir':
        result.profileDir = nextValue();
        break;
      case '--interval-ms':
        result.intervalMs = nextValue();
        break;
      case '--start-delay-ms':
        result.startDelayMs = nextValue();
        break;
      case '--retry-ms':
        result.retryMs = nextValue();
        break;
      default:
        throw new Error(`Unknown argument: ${raw}`);
    }
  }

  return result;
}

function getBrowserExecutable(activeConfig) {
  if (activeConfig.browserPath) {
    return activeConfig.browserPath;
  }

  const localAppData = process.env.LOCALAPPDATA || '';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || '';
  const programFiles = process.env.ProgramFiles || '';
  const candidates = [
    localAppData && path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
    programFilesX86 && path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
    programFiles && path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
    programFilesX86 && path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    programFiles && path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
  ].filter(Boolean);

  const installedPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (installedPath) return installedPath;

  const commands = process.platform === 'win32'
    ? ['chrome.exe', 'msedge.exe']
    : ['google-chrome', 'chromium-browser', 'chromium', 'microsoft-edge'];
  return findCommandOnPath(commands);
}

function findCommandOnPath(commands) {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  for (const command of commands) {
    const result = spawnSync(lookup, [command], { encoding: 'utf8' });
    const firstLine = String(result.stdout || '').split(/\r?\n/).find(Boolean);
    if (result.status === 0 && firstLine) {
      return firstLine.trim();
    }
  }

  return '';
}

function normalizeOrigins(values) {
  return values
    .map((value) => normalizeOrigin(value))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function normalizeOrigin(value) {
  if (!value) return '';
  try {
    return new URL(String(value).trim()).origin;
  } catch {
    return '';
  }
}

function normalizeUrl(value) {
  if (!value) return '';
  try {
    return new URL(String(value).trim()).href;
  } catch {
    return '';
  }
}

function parseList(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  if (!value) {
    return fallback;
  }

  return String(value)
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== '') {
      return value;
    }
  }

  return '';
}

function env(key, fallback = '') {
  return process.env[key] || fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeInteger(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function getBackoffDelay(activeConfig, consecutiveFailures) {
  return activeConfig.maxFailureBackoffMs;
}

function isRecoverableKeepAliveIssueMessage(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('tab for')
    || text.includes('not ready')
    || text.includes('debug port')
    || text.includes('websocket connection failed')
    || text.includes('login session may be expired')
    || text.includes('http 401')
    || text.includes('http 403')
    || text.includes('vpn')
    || text.includes('login');
}

function formatKeepAliveErrors(errors) {
  return errors
    .map((item) => `${item.origin}: ${item.message}`)
    .join('; ');
}

function loadDotEnvFiles() {
  const envPath = process.env.INTRANET_KEEPALIVE_ENV_PATH;
  const candidates = [
    envPath,
    path.join(process.cwd(), '.env.keepalive'),
    path.join(SCRIPT_DIR, '.env.keepalive'),
    path.join(ROOT, '.env.keepalive'),
    path.join(process.cwd(), '.env'),
    path.join(SCRIPT_DIR, '.env'),
    path.join(ROOT, '.env'),
  ]
    .filter(Boolean)
    .map((item) => path.resolve(item));
  const uniqueCandidates = candidates.filter((item, index, list) => list.indexOf(item) === index);

  for (const filePath of uniqueCandidates) {
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = stripEnvValue(rawValue);
    }
  }
}

function stripEnvValue(rawValue) {
  let value = String(rawValue || '').trim();
  if (!value) return '';
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).replace(/\\"/g, '"');
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, '').trim();
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  console.log(`[${new Date().toISOString()}] [keepalive] ${message}`);
}

function warn(message) {
  console.warn(`[${new Date().toISOString()}] [keepalive] ${message}`);
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return restSeconds ? `${minutes}m${restSeconds}s` : `${minutes}m`;
}

function printConfig(activeConfig) {
  const printable = {
    ...activeConfig,
    browserPath: activeConfig.browserPath || '(auto)',
  };
  console.log(JSON.stringify(printable, null, 2));
}

function printHelp() {
  console.log(`
Usage:
  node scripts/intranet-keepalive.js [options]

Options:
  --once                         Run one heartbeat and exit.
  --no-launch                    Do not auto-launch Chrome/Edge if the debug port is closed.
  --print-config                 Print resolved config and exit.
  --origin <url>                 Add one intranet origin. Can be repeated.
  --origins <url1,url2>          Replace origins with a comma-separated list.
  --port <number>                DevTools debug port. Default: 9222.
  --browser <path>               Chrome/Edge executable path.
  --profile-dir <path>           Dedicated browser profile directory.
  --interval-ms <number>         Healthy heartbeat interval. Default: 120000.
  --start-delay-ms <number>      Delay before first heartbeat. Default: 30000.
  --retry-ms <number>            Retry delay when browser/login is not ready. Default: 60000.

Environment:
  INTRANET_KEEPALIVE_ORIGINS     Preferred generic origins list.
  RISK_KEEPALIVE_ORIGINS         Compatible with the existing risk project.
  RISK_INTRANET_ORIGIN           Risk system origin.
  CHANGE_INTRANET_ORIGIN         Change system origin.
  DRILL_INTRANET_ORIGIN          Drill system origin.
  EVENT_INTRANET_ORIGIN          Event system origin.
  INTRANET_KEEPALIVE_BROWSER_PATH or RISK_BROWSER_PATH
  INTRANET_KEEPALIVE_DEBUG_PORT or RISK_BROWSER_DEBUG_PORT

First run:
  1. Connect VPN.
  2. Run this script.
  3. Complete intranet login in the Chrome/Edge window it opens.
  4. Keep this terminal window open while you need the VPN/intranet session kept alive.
`.trim());
}
