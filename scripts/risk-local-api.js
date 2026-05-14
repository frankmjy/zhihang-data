#!/usr/bin/env node
'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const { FeishuOpenApiClient } = require('./feishu-open-api');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const DEFAULT_ORIGIN = 'https://risk.example.internal';
const DEFAULT_CHANGE_ORIGIN = 'https://change.example.internal';
const LEGACY_DRILL_ORIGIN = 'https://drill.example.internal';
const DEFAULT_DRILL_ORIGIN = 'https://emergencydrill.meta42.indc.vnet.com';
const DEFAULT_EVENT_ORIGIN = 'https://event.example.internal';
const DEFAULT_INSPECT_ORIGIN = 'https://inspect2.meta42.indc.vnet.com';
const DEFAULT_DRILL_LIST_URL = `${DEFAULT_DRILL_ORIGIN}/api/emergencydrill/exercisePlan/queryExercisePlanList`;
const DEFAULT_DRILL_EVALUATION_URL = `${DEFAULT_DRILL_ORIGIN}/api/event/eventOrder/selEventMsg`;
const DEFAULT_DRILL_EVALUATION_DETAIL_URL = `${DEFAULT_DRILL_ORIGIN}/api/emergencydrill/exerciseEvaluation/selExerciseEvaluationTemplate`;
const DEFAULT_EVENT_LIST_URL = `${DEFAULT_EVENT_ORIGIN}/api/event/eventOrder/selEventMsg`;
const DEFAULT_INSPECT_LIST_URL = `${DEFAULT_INSPECT_ORIGIN}/api/inspect/inspection/job/list`;
const DEFAULT_CHANGE_FEISHU_APP_TOKEN = '';
const DEFAULT_CHANGE_FEISHU_TABLE_ID = '';
const DEFAULT_CHANGE_FEISHU_VIEW_ID = '';
const DEFAULT_DRILL_FEISHU_APP_TOKEN = '';
const DEFAULT_DRILL_FEISHU_TABLE_ID = '';
const DEFAULT_DRILL_FEISHU_VIEW_ID = '';
const DEFAULT_EVENT_FEISHU_APP_TOKEN = '';
const DEFAULT_EVENT_FEISHU_TABLE_ID = '';
const DEFAULT_EVENT_FEISHU_VIEW_ID = '';
const DEFAULT_INSPECT_FEISHU_APP_TOKEN = 'IrIibPkUOa6udGsMhu2cbOqhnWg';
const DEFAULT_INSPECT_FEISHU_TABLE_ID = 'tblTXHrDH4Mv0971';
const DEFAULT_INSPECT_FEISHU_VIEW_ID = 'vewgfEzEZl';
const DEFAULT_RISK_PATH = '/api/ab-bpm/biz/bizCustGrid/view/list_fxgl_xcydfxpcmxsjlb';
const DEFAULT_RECORD_LIST_PATH = '/api/ab-bpm/biz/bizCustGrid/view/fxgl_xcydfxpcjlsjlb';

loadDotEnv();

const SERVER_STARTED_AT = new Date();
const PORT = Number(process.env.SERVER_PORT || 3000);
const HOST = process.env.SERVER_HOST || 'localhost';
const CLIENT_DEV_PORT = Number(process.env.CLIENT_DEV_PORT || 8080);
const DEBUG_PORT = Number(process.env.RISK_BROWSER_DEBUG_PORT || 9222);
const INTRANET_ORIGIN = trimTrailingSlash(process.env.RISK_INTRANET_ORIGIN || DEFAULT_ORIGIN);
const CHANGE_INTRANET_ORIGIN = trimTrailingSlash(process.env.CHANGE_INTRANET_ORIGIN || DEFAULT_CHANGE_ORIGIN);
const DRILL_INTRANET_ORIGIN = normalizeLegacyDrillOrigin(process.env.DRILL_INTRANET_ORIGIN || DEFAULT_DRILL_ORIGIN);
const EVENT_INTRANET_ORIGIN = trimTrailingSlash(process.env.EVENT_INTRANET_ORIGIN || DEFAULT_EVENT_ORIGIN);
const INSPECT_INTRANET_ORIGIN = trimTrailingSlash(process.env.INSPECT_INTRANET_ORIGIN || DEFAULT_INSPECT_ORIGIN);
const RISK_API_PATH = process.env.RISK_API_PATH || DEFAULT_RISK_PATH;
const RISK_RECORD_LIST_API_PATH = process.env.RISK_RECORD_LIST_API_PATH || DEFAULT_RECORD_LIST_PATH;
const DRILL_LIST_URL = normalizeLegacyDrillUrl(process.env.DRILL_LIST_URL || DEFAULT_DRILL_LIST_URL);
const DRILL_EVALUATION_URL = normalizeLegacyDrillUrl(process.env.DRILL_EVALUATION_URL || DEFAULT_DRILL_EVALUATION_URL);
const DRILL_EVALUATION_DETAIL_URL = normalizeLegacyDrillUrl(process.env.DRILL_EVALUATION_DETAIL_URL || DEFAULT_DRILL_EVALUATION_DETAIL_URL);
const EVENT_LIST_URL = process.env.EVENT_LIST_URL || DEFAULT_EVENT_LIST_URL;
const INSPECT_LIST_URL = process.env.INSPECT_LIST_URL || DEFAULT_INSPECT_LIST_URL;
const DRILL_EVALUATION_CREATOR = process.env.DRILL_EVALUATION_CREATOR || '';
const BROWSER_PROFILE_DIR = process.env.RISK_BROWSER_PROFILE_DIR || path.join(ROOT, '.run', 'browser-profile');
const BROWSER_START_WAIT_MS = normalizeInterval(process.env.RISK_BROWSER_START_WAIT_MS, 10 * 1000);
const KEEPALIVE_ENABLED = parseBoolean(process.env.RISK_KEEPALIVE_ENABLED, true);
const KEEPALIVE_INTERVAL_MS = normalizeInterval(process.env.RISK_KEEPALIVE_INTERVAL_MS, 2 * 60 * 1000);
const KEEPALIVE_START_DELAY_MS = normalizeInterval(process.env.RISK_KEEPALIVE_START_DELAY_MS, 30 * 1000);
const KEEPALIVE_ORIGINS = parseOriginList(
  process.env.RISK_KEEPALIVE_ORIGINS,
  [INTRANET_ORIGIN, CHANGE_INTRANET_ORIGIN, DRILL_INTRANET_ORIGIN, EVENT_INTRANET_ORIGIN, INSPECT_INTRANET_ORIGIN],
);
const KEEPALIVE_SYNC_GUARD_MS = normalizePositiveInteger(process.env.RISK_KEEPALIVE_SYNC_GUARD_MS, 2 * 60 * 1000, 0, 30 * 60 * 1000);
const KEEPALIVE_SKIP_RETRY_MS = normalizePositiveInteger(process.env.RISK_KEEPALIVE_SKIP_RETRY_MS, 60 * 1000, 5 * 1000, 10 * 60 * 1000);
const KEEPALIVE_MAX_FAILURE_BACKOFF_MS = normalizePositiveInteger(process.env.RISK_KEEPALIVE_MAX_FAILURE_BACKOFF_MS, 60 * 1000, 60 * 1000, 60 * 60 * 1000);
const KEEPALIVE_REQUEST_TIMEOUT_MS = normalizePositiveInteger(process.env.RISK_KEEPALIVE_REQUEST_TIMEOUT_MS, 8 * 1000, 1000, 60 * 1000);
const KEEPALIVE_RECOVERY_ENABLED = parseBoolean(process.env.RISK_KEEPALIVE_RECOVERY_ENABLED, true);
const KEEPALIVE_RECOVERY_WAIT_MS = normalizePositiveInteger(process.env.RISK_KEEPALIVE_RECOVERY_WAIT_MS, 3000, 500, 30 * 1000);
const DEVTOOLS_HTTP_TIMEOUT_MS = normalizePositiveInteger(process.env.RISK_DEVTOOLS_HTTP_TIMEOUT_MS, 5 * 1000, 1000, 60 * 1000);
const INTRANET_TARGET_DISCOVERY_RETRIES = normalizePositiveInteger(process.env.RISK_TARGET_DISCOVERY_RETRIES, 4, 1, 10);
const INTRANET_TARGET_DISCOVERY_INTERVAL_MS = normalizePositiveInteger(process.env.RISK_TARGET_DISCOVERY_INTERVAL_MS, 1500, 200, 10000);
const WEATHER_API_KEY = process.env.WEATHER_API_KEY || process.env.QWEATHER_API_KEY || '';
const WEATHER_LOCATION = process.env.WEATHER_LOCATION || '120.959,31.937';
const WEATHER_CITY = process.env.WEATHER_CITY || '南通开发区';
const WEATHER_CACHE_TTL_MS = normalizeInterval(process.env.WEATHER_CACHE_TTL_MS, 5 * 60 * 1000);
const AUTO_SYNC_ENABLED = parseBoolean(process.env.RISK_AUTO_SYNC_ENABLED, true);
const LEGACY_RISK_AUTO_SYNC_HOUR = normalizeClockPart(process.env.RISK_AUTO_SYNC_HOUR, 8, 0, 23);
const LEGACY_RISK_AUTO_SYNC_MINUTE = normalizeClockPart(process.env.RISK_AUTO_SYNC_MINUTE, 33, 0, 59);
const DEFAULT_AUTO_SYNC_MESSAGE_TIME_LABELS = ['08:33'];
const DEFAULT_RISK_AUTO_SYNC_TIME_LABELS = ['08:33'];
const DEFAULT_CHANGE_AUTO_SYNC_TIME_LABELS = ['08:35', '13:05', '16:05'];
const DEFAULT_CHANGE_DAILY_NOTIFY_CHAT_ID = '';
const AUTO_SYNC_MESSAGE_ENABLED = parseBoolean(process.env.AUTO_SYNC_MESSAGE_ENABLED, true);
const AUTO_SYNC_MESSAGE_WEEKDAY = normalizePositiveInteger(process.env.AUTO_SYNC_MESSAGE_WEEKDAY, 4, 0, 6);
const AUTO_SYNC_MESSAGE_MONTH_END_AFTER_DAY = normalizePositiveInteger(process.env.AUTO_SYNC_MESSAGE_MONTH_END_AFTER_DAY, 25, 1, 30);
const AUTO_SYNC_MESSAGE_SCHEDULES = parseDailyScheduleList(
  process.env.AUTO_SYNC_MESSAGE_SCHEDULES,
  DEFAULT_AUTO_SYNC_MESSAGE_TIME_LABELS,
);
const AUTO_SYNC_SCHEDULES = parseDailyScheduleList(
  process.env.RISK_AUTO_SYNC_SCHEDULES,
  process.env.RISK_AUTO_SYNC_SCHEDULES === undefined && process.env.RISK_AUTO_SYNC_HOUR !== undefined
    ? [formatScheduleLabel(LEGACY_RISK_AUTO_SYNC_HOUR, LEGACY_RISK_AUTO_SYNC_MINUTE)]
    : DEFAULT_RISK_AUTO_SYNC_TIME_LABELS,
);
const CHANGE_AUTO_SYNC_ENABLED = parseBoolean(process.env.CHANGE_AUTO_SYNC_ENABLED, true);
const CHANGE_AUTO_SYNC_SCHEDULES = parseDailyScheduleList(
  process.env.CHANGE_AUTO_SYNC_SCHEDULES,
  DEFAULT_CHANGE_AUTO_SYNC_TIME_LABELS,
);
const CHANGE_AUTO_SYNC_NOTIFY_ENABLED = parseBoolean(process.env.CHANGE_AUTO_SYNC_NOTIFY_ENABLED, true);
const CHANGE_IMPORTANT_NOTIFY_ENABLED = parseBoolean(process.env.CHANGE_IMPORTANT_NOTIFY_ENABLED, true);
const CHANGE_IMPORTANT_NOTIFY_CHAT_ID = String(process.env.CHANGE_IMPORTANT_NOTIFY_CHAT_ID || process.env.CHANGE_DAILY_NOTIFY_CHAT_ID || DEFAULT_CHANGE_DAILY_NOTIFY_CHAT_ID).trim();
const CHANGE_IMPORTANT_NOTIFY_SCHEDULES = parseDailyScheduleList(
  process.env.CHANGE_IMPORTANT_NOTIFY_SCHEDULES,
  ['16:05'],
);
const EXTRA_ABNORMAL_NOTIFY_ENABLED = parseBoolean(process.env.EXTRA_ABNORMAL_NOTIFY_ENABLED, true);
const EXTRA_ABNORMAL_NOTIFY_CHAT_ID = String(
  process.env.EXTRA_ABNORMAL_NOTIFY_CHAT_ID
    || process.env.FEISHU_ABNORMAL_NOTIFY_CHAT_ID
    || 'oc_38825452b566a9c8d5859d54eb31a64c',
).trim();
const DEFAULT_DRILL_AUTO_SYNC_TIME_LABELS = ['08:33'];
const DEFAULT_EVENT_AUTO_SYNC_TIME_LABELS = ['08:37', '13:38', '16:08'];
const DEFAULT_INSPECT_AUTO_SYNC_TIME_LABELS = ['07:00', '11:00', '17:00', '23:30'];
const CHANGE_AUTO_SYNC_PAGE_SIZE = normalizePositiveInteger(process.env.CHANGE_AUTO_SYNC_PAGE_SIZE, 100, 10, 200);
const CHANGE_AUTO_SYNC_LIST_CONCURRENCY = normalizePositiveInteger(process.env.CHANGE_AUTO_SYNC_LIST_CONCURRENCY, 4, 1, 10);
const CHANGE_AUTO_SYNC_BASIC_DATA_CONCURRENCY = normalizePositiveInteger(process.env.CHANGE_AUTO_SYNC_BASIC_DATA_CONCURRENCY, 8, 1, 20);
const DRILL_AUTO_SYNC_ENABLED = parseBoolean(process.env.DRILL_AUTO_SYNC_ENABLED, CHANGE_AUTO_SYNC_ENABLED);
const DRILL_AUTO_SYNC_SCHEDULES = parseDailyScheduleList(
  process.env.DRILL_AUTO_SYNC_SCHEDULES,
  DEFAULT_DRILL_AUTO_SYNC_TIME_LABELS,
);
const DRILL_AUTO_SYNC_PAGE_SIZE = normalizePositiveInteger(process.env.DRILL_AUTO_SYNC_PAGE_SIZE, 100, 1, 500);
const DRILL_AUTO_SYNC_LIST_CONCURRENCY = normalizePositiveInteger(process.env.DRILL_AUTO_SYNC_LIST_CONCURRENCY, 6, 1, 12);
const DRILL_AUTO_SYNC_MAX_PAGES = normalizePositiveInteger(process.env.DRILL_AUTO_SYNC_MAX_PAGES, 1000, 1, 5000);
const DRILL_MONTH_BACKFILL_ENABLED = parseBoolean(process.env.DRILL_MONTH_BACKFILL_ENABLED, true);
const DRILL_EVALUATION_PAGE_SIZE = normalizePositiveInteger(process.env.DRILL_EVALUATION_PAGE_SIZE, 100, 1, 500);
const DRILL_EVALUATION_LIST_CONCURRENCY = normalizePositiveInteger(process.env.DRILL_EVALUATION_LIST_CONCURRENCY, 6, 1, 12);
const DRILL_EVALUATION_MAX_PAGES = normalizePositiveInteger(process.env.DRILL_EVALUATION_MAX_PAGES, 1000, 1, 5000);
const DRILL_EVALUATION_DETAIL_ENABLED = parseBoolean(process.env.DRILL_EVALUATION_DETAIL_ENABLED, true);
const DRILL_EVALUATION_DETAIL_CONCURRENCY = normalizePositiveInteger(process.env.DRILL_EVALUATION_DETAIL_CONCURRENCY, 4, 1, 12);
const EVENT_AUTO_SYNC_ENABLED = parseBoolean(process.env.EVENT_AUTO_SYNC_ENABLED, CHANGE_AUTO_SYNC_ENABLED);
const EVENT_AUTO_SYNC_SCHEDULES = parseDailyScheduleList(
  process.env.EVENT_AUTO_SYNC_SCHEDULES,
  DEFAULT_EVENT_AUTO_SYNC_TIME_LABELS,
);
const EVENT_AUTO_SYNC_NOTIFY_ENABLED = parseBoolean(process.env.EVENT_AUTO_SYNC_NOTIFY_ENABLED, true);
const EVENT_AUTO_SYNC_PAGE_SIZE = normalizePositiveInteger(process.env.EVENT_AUTO_SYNC_PAGE_SIZE, 300, 1, 500);
const EVENT_AUTO_SYNC_LIST_CONCURRENCY = normalizePositiveInteger(process.env.EVENT_AUTO_SYNC_LIST_CONCURRENCY, 10, 1, 20);
const EVENT_AUTO_SYNC_MAX_PAGES = normalizePositiveInteger(process.env.EVENT_AUTO_SYNC_MAX_PAGES, 1000, 1, 5000);
const EVENT_AUTO_SYNC_PAGE_RETRY_ATTEMPTS = normalizePositiveInteger(process.env.EVENT_AUTO_SYNC_PAGE_RETRY_ATTEMPTS, 3, 1, 5);
const EVENT_AUTO_SYNC_PAGE_RETRY_DELAY_MS = normalizePositiveInteger(process.env.EVENT_AUTO_SYNC_PAGE_RETRY_DELAY_MS, 1200, 0, 10000);
const EVENT_AUTO_SYNC_CREATOR = process.env.EVENT_AUTO_SYNC_CREATOR || '';
const EVENT_AUTO_SYNC_USER_ID = process.env.EVENT_AUTO_SYNC_USER_ID || '';
const DRILL_EVALUATION_DETAIL_JOB_NUMBER = String(process.env.DRILL_EVALUATION_DETAIL_JOB_NUMBER || EVENT_AUTO_SYNC_USER_ID || '').trim();
const DRILL_MONTH_BACKFILL_FILTERS = [
  { label: '本月全楼', monthScoped: true, overrides: {} },
  { label: '本月A楼', monthScoped: true, overrides: { dcCode: '5.1.2.3.1.1' } },
  { label: '本月B楼', monthScoped: true, overrides: { dcCode: '6.1.2.3.1.1' } },
  { label: '本月C楼', monthScoped: true, overrides: { dcCode: '7.1.2.3.1.1' } },
  { label: '本月D楼', monthScoped: true, overrides: { dcCode: '8.1.2.3.1.1' } },
  { label: '本月E楼', monthScoped: true, overrides: { dcCode: '9.1.2.3.1.1' } },
  { label: 'A楼全部', monthScoped: false, overrides: { dcCode: '5.1.2.3.1.1' } },
  { label: 'B楼全部', monthScoped: false, overrides: { dcCode: '6.1.2.3.1.1' } },
  { label: 'C楼全部', monthScoped: false, overrides: { dcCode: '7.1.2.3.1.1' } },
  { label: 'D楼全部', monthScoped: false, overrides: { dcCode: '8.1.2.3.1.1' } },
  { label: 'E楼全部', monthScoped: false, overrides: { dcCode: '9.1.2.3.1.1' } },
];
const EVENT_ALL_ORDER_STATUS = process.env.EVENT_ALL_ORDER_STATUS || '1,2,3,4,5,6';
const EVENT_INCREMENTAL_SYNC_ORDER_STATUS = process.env.EVENT_INCREMENTAL_SYNC_ORDER_STATUS || EVENT_ALL_ORDER_STATUS;
const EVENT_INCREMENTAL_SYNC_LOOKBACK_DAYS = normalizePositiveInteger(process.env.EVENT_INCREMENTAL_SYNC_LOOKBACK_DAYS, 30, 1, 366);
const EVENT_INCREMENTAL_SYNC_START_DATE_FIELD = process.env.EVENT_INCREMENTAL_SYNC_START_DATE_FIELD || 'startDate';
const EVENT_INCREMENTAL_SYNC_END_DATE_FIELD = process.env.EVENT_INCREMENTAL_SYNC_END_DATE_FIELD || 'endDate';
const EVENT_INCREMENTAL_CREATED_START_DATE_FIELD = process.env.EVENT_INCREMENTAL_CREATED_START_DATE_FIELD || EVENT_INCREMENTAL_SYNC_START_DATE_FIELD || 'startDate';
const EVENT_INCREMENTAL_CREATED_END_DATE_FIELD = process.env.EVENT_INCREMENTAL_CREATED_END_DATE_FIELD || EVENT_INCREMENTAL_SYNC_END_DATE_FIELD || 'endDate';
const EVENT_INCREMENTAL_HAPPEN_START_DATE_FIELD = process.env.EVENT_INCREMENTAL_HAPPEN_START_DATE_FIELD || 'startHappendDate';
const EVENT_INCREMENTAL_HAPPEN_END_DATE_FIELD = process.env.EVENT_INCREMENTAL_HAPPEN_END_DATE_FIELD || 'endHappendDate';
const EVENT_FEISHU_VIEW_SETUP_ENABLED = parseBoolean(process.env.EVENT_FEISHU_VIEW_SETUP_ENABLED, true);
const EVENT_FEISHU_INCOMPLETE_VIEW_NAME = process.env.EVENT_FEISHU_INCOMPLETE_VIEW_NAME || '近30天未完成事件';
const EVENT_FEISHU_FALSE_REAL_VIEW_NAME = process.env.EVENT_FEISHU_FALSE_REAL_VIEW_NAME || '近30天非真实事件';
const EVENT_COMPLETED_ORDER_STATUS = process.env.EVENT_COMPLETED_ORDER_STATUS || '5';
const EVENT_FULL_SYNC_ORDER_STATUS = process.env.EVENT_FULL_SYNC_ORDER_STATUS || EVENT_ALL_ORDER_STATUS;
const EVENT_FULL_SYNC_START_DATE = process.env.EVENT_FULL_SYNC_START_DATE === undefined ? '' : process.env.EVENT_FULL_SYNC_START_DATE;
const EVENT_FULL_SYNC_END_DATE = process.env.EVENT_FULL_SYNC_END_DATE === undefined ? '' : process.env.EVENT_FULL_SYNC_END_DATE;
const EVENT_FULL_SYNC_START_DATE_FIELD = process.env.EVENT_FULL_SYNC_START_DATE_FIELD || 'startDate';
const EVENT_FULL_SYNC_END_DATE_FIELD = process.env.EVENT_FULL_SYNC_END_DATE_FIELD || 'endDate';
const EVENT_SYNC_STATE_PATH = path.resolve(ROOT, process.env.EVENT_SYNC_STATE_PATH || path.join('.run', 'event-sync-state.json'));
const EVENT_SYNC_PREVIEW_LIMIT = normalizePositiveInteger(process.env.EVENT_SYNC_PREVIEW_LIMIT, 300, 0, 2000);
const INSPECT_DATACENTER_CODE = process.env.INSPECT_DATACENTER_CODE || '0.5.2.2.1.1';
const INSPECT_AUTO_SYNC_ENABLED = parseBoolean(process.env.INSPECT_AUTO_SYNC_ENABLED, true);
const INSPECT_AUTO_SYNC_SCHEDULES = parseDailyScheduleList(
  process.env.INSPECT_AUTO_SYNC_SCHEDULES,
  DEFAULT_INSPECT_AUTO_SYNC_TIME_LABELS,
);
const INSPECT_AUTO_SYNC_NOTIFY_ENABLED = parseBoolean(process.env.INSPECT_AUTO_SYNC_NOTIFY_ENABLED, true);
const INSPECT_AUTO_SYNC_PAGE_SIZE = normalizePositiveInteger(process.env.INSPECT_AUTO_SYNC_PAGE_SIZE, 15, 1, 500);
const INSPECT_AUTO_SYNC_LIST_CONCURRENCY = normalizePositiveInteger(process.env.INSPECT_AUTO_SYNC_LIST_CONCURRENCY, 6, 1, 20);
const INSPECT_AUTO_SYNC_MAX_PAGES = normalizePositiveInteger(process.env.INSPECT_AUTO_SYNC_MAX_PAGES, 1000, 1, 5000);
const INSPECT_SYNC_PREVIEW_LIMIT = normalizePositiveInteger(process.env.INSPECT_SYNC_PREVIEW_LIMIT, 300, 0, 2000);
const SYNC_LIGHTWEIGHT_CACHE_CLEANUP_ENABLED = parseBoolean(process.env.SYNC_LIGHTWEIGHT_CACHE_CLEANUP_ENABLED, true);
const SYNC_LIGHTWEIGHT_CACHE_DIRS = parseRuntimePathList(
  process.env.SYNC_LIGHTWEIGHT_CACHE_DIRS,
  [path.join('.run', 'sync-cache'), path.join('.run', 'temp'), path.join('.run', 'tmp')],
);
const AUTO_SYNC_STARTUP_CATCHUP_MS = normalizePositiveInteger(process.env.AUTO_SYNC_STARTUP_CATCHUP_MS, 30 * 60 * 1000, 0, 3 * 60 * 60 * 1000);
const feishuClient = new FeishuOpenApiClient();
const keepAliveState = {
  running: false,
  timer: null,
  status: 'idle',
  statusMessage: '',
  lastAttemptAt: '',
  lastSuccessAt: '',
  lastFailureAt: '',
  lastError: '',
  lastWarning: '',
  lastSkippedReason: '',
  lastTargetUrl: '',
  nextRunAt: '',
  consecutiveFailures: 0,
  origins: KEEPALIVE_ORIGINS,
  lastCheckedOrigins: [],
};
const autoSyncState = {
  running: false,
  queued: false,
  timer: null,
  statusMessage: '',
  lastAttemptAt: '',
  lastSuccessAt: '',
  lastError: '',
  lastInsertedCount: 0,
  nextRunAt: '',
  scheduleTimes: AUTO_SYNC_SCHEDULES.map((item) => item.label),
};
const changeAutoSyncState = {
  running: false,
  queued: false,
  timer: null,
  statusMessage: '',
  lastAttemptAt: '',
  lastSuccessAt: '',
  lastError: '',
  lastInsertedCount: 0,
  nextRunAt: '',
  scheduleTimes: CHANGE_AUTO_SYNC_SCHEDULES.map((item) => item.label),
};
const drillAutoSyncState = {
  running: false,
  queued: false,
  timer: null,
  statusMessage: '',
  lastAttemptAt: '',
  lastSuccessAt: '',
  lastError: '',
  lastInsertedCount: 0,
  nextRunAt: '',
  scheduleTimes: DRILL_AUTO_SYNC_SCHEDULES.map((item) => item.label),
};
const eventAutoSyncState = {
  running: false,
  queued: false,
  timer: null,
  statusMessage: '',
  lastAttemptAt: '',
  lastSuccessAt: '',
  lastError: '',
  lastInsertedCount: 0,
  nextRunAt: '',
  scheduleTimes: EVENT_AUTO_SYNC_SCHEDULES.map((item) => item.label),
};
const inspectAutoSyncState = {
  running: false,
  queued: false,
  timer: null,
  statusMessage: '',
  lastAttemptAt: '',
  lastSuccessAt: '',
  lastError: '',
  lastInsertedCount: 0,
  nextRunAt: '',
  scheduleTimes: INSPECT_AUTO_SYNC_SCHEDULES.map((item) => item.label),
};
const eventSyncProgressState = {
  running: false,
  runId: '',
  mode: '',
  phase: 'idle',
  message: '',
  startedAt: '',
  updatedAt: '',
  percent: 0,
  fetch: {
    completedPages: 0,
    totalPages: 0,
    records: 0,
    totalFromApi: 0,
  },
  feishu: {
    listedRecords: 0,
    deleteTotal: 0,
    deleteBatchesCompleted: 0,
    deleteBatchesTotal: 0,
    createTotal: 0,
    createBatchesCompleted: 0,
    createBatchesTotal: 0,
  },
  steps: [],
};
const browserDebugState = {
  launching: null,
  lastLaunchAt: '',
  lastLaunchError: '',
};
const scheduledSyncQueue = {
  tail: Promise.resolve(),
  activeTag: '',
};

function isFatalStartupError(error) {
  return error && ['EADDRINUSE', 'EACCES'].includes(error.code);
}

process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[process] uncaughtException:', error);
  if (isFatalStartupError(error)) {
    process.exit(1);
  }
});

process.on('exit', (code) => {
  console.log(`[process] risk-local-api exit code=${code}`);
});

function loadDotEnv() {
  if (!fs.existsSync(ENV_PATH)) return;

  const content = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] === undefined) {
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  }
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function normalizeLegacyDrillOrigin(value) {
  const origin = trimTrailingSlash(String(value || DEFAULT_DRILL_ORIGIN));
  return origin === LEGACY_DRILL_ORIGIN ? DEFAULT_DRILL_ORIGIN : origin;
}

function normalizeLegacyDrillUrl(value) {
  return String(value || '').replace(new RegExp(`^${LEGACY_DRILL_ORIGIN.replace(/\./g, '\\.')}(?=/|$)`), DEFAULT_DRILL_ORIGIN);
}

function parseOriginList(rawValue, fallbackValues = []) {
  const rawEntries = String(rawValue || '')
    .split(/[\s,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const entries = rawEntries.length > 0 ? rawEntries : fallbackValues;

  return entries
    .map((value) => {
      try {
        return normalizeLegacyDrillOrigin(new URL(String(value || '').trim()).origin);
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function parseRuntimePathList(rawValue, fallbackValues = []) {
  const rawEntries = String(rawValue || '')
    .split(/[;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const entries = rawEntries.length > 0 ? rawEntries : fallbackValues;

  return entries
    .map((value) => path.resolve(ROOT, value))
    .filter((value, index, list) => list.indexOf(value) === index);
}

function parseBoolean(rawValue, defaultValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return defaultValue;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function normalizeInterval(rawValue, defaultValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return Math.max(parsed, 30 * 1000);
}

function normalizeClockPart(rawValue, defaultValue, min, max) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return defaultValue;
  }

  return parsed;
}

function normalizePositiveInteger(rawValue, defaultValue, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return defaultValue;
  }

  return parsed;
}

function formatScheduleLabel(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseDailyScheduleToken(token) {
  const match = String(token || '').trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return {
    hour,
    minute,
    label: formatScheduleLabel(hour, minute),
  };
}

function parseDailyScheduleList(rawValue, fallbackValues = []) {
  const sourceTokens = String(rawValue || '')
    .split(/[\s,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const fallbackTokens = Array.isArray(fallbackValues) ? fallbackValues : [];
  const rawEntries = sourceTokens.length > 0 ? sourceTokens : fallbackTokens;
  const scheduleMap = new Map();

  rawEntries.forEach((entry) => {
    const parsedEntry = typeof entry === 'string'
      ? parseDailyScheduleToken(entry)
      : parseDailyScheduleToken(formatScheduleLabel(entry?.hour, entry?.minute));
    if (parsedEntry) {
      scheduleMap.set(parsedEntry.label, parsedEntry);
    }
  });

  return Array.from(scheduleMap.values()).sort((left, right) => {
    if (left.hour !== right.hour) {
      return left.hour - right.hour;
    }

    return left.minute - right.minute;
  });
}

function getRiskRecordListPathCandidates() {
  const candidates = [];

  const pushCandidate = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized || candidates.includes(normalized)) {
      return;
    }

    candidates.push(normalized);
  };

  pushCandidate(RISK_RECORD_LIST_API_PATH);
  pushCandidate(DEFAULT_RECORD_LIST_PATH);

  if (RISK_RECORD_LIST_API_PATH.includes('/view/') && !RISK_RECORD_LIST_API_PATH.includes('/view/list_')) {
    pushCandidate(RISK_RECORD_LIST_API_PATH.replace('/view/', '/view/list_'));
  }

  if (DEFAULT_RECORD_LIST_PATH.includes('/view/') && !DEFAULT_RECORD_LIST_PATH.includes('/view/list_')) {
    pushCandidate(DEFAULT_RECORD_LIST_PATH.replace('/view/', '/view/list_'));
  }

  pushCandidate('/api/ab-bpm/biz/bizCustGrid/view/list_fxgl_xcydfxpcjlsjlb');
  pushCandidate('/api/ab-bpm/biz/bizCustGrid/view/fxgl_xcydfxpcjlsjlb');

  return candidates;
}

function createChangeFeishuClient(table, overrides = {}) {
  const tableId = table === 'workOrders'
    ? process.env.CHANGE_FEISHU_WORKORDER_TABLE_ID || process.env.CHANGE_FEISHU_BASIC_DATA_TABLE_ID || DEFAULT_CHANGE_FEISHU_TABLE_ID
    : process.env.CHANGE_FEISHU_BASIC_DATA_TABLE_ID || DEFAULT_CHANGE_FEISHU_TABLE_ID;

  return new FeishuOpenApiClient({
    baseUrl: process.env.CHANGE_FEISHU_OPEN_BASE_URL || process.env.FEISHU_OPEN_BASE_URL,
    appId: process.env.CHANGE_FEISHU_APP_ID || process.env.FEISHU_APP_ID || '',
    appSecret: process.env.CHANGE_FEISHU_APP_SECRET || process.env.FEISHU_APP_SECRET || '',
    appToken: process.env.CHANGE_FEISHU_BITABLE_APP_TOKEN || DEFAULT_CHANGE_FEISHU_APP_TOKEN,
    tableId,
    viewId: process.env.CHANGE_FEISHU_BASIC_DATA_VIEW_ID || DEFAULT_CHANGE_FEISHU_VIEW_ID,
    notifyChatId: overrides.notifyChatId ?? (process.env.CHANGE_FEISHU_NOTIFY_CHAT_ID || process.env.FEISHU_NOTIFY_CHAT_ID || ''),
    notifyChatName: overrides.notifyChatName ?? (process.env.CHANGE_FEISHU_NOTIFY_CHAT_NAME || process.env.FEISHU_NOTIFY_CHAT_NAME || ''),
  });
}

function createDrillFeishuClient() {
  return new FeishuOpenApiClient({
    baseUrl: process.env.DRILL_FEISHU_OPEN_BASE_URL || process.env.FEISHU_OPEN_BASE_URL,
    appId: process.env.DRILL_FEISHU_APP_ID || process.env.FEISHU_APP_ID || '',
    appSecret: process.env.DRILL_FEISHU_APP_SECRET || process.env.FEISHU_APP_SECRET || '',
    appToken: process.env.DRILL_FEISHU_BITABLE_APP_TOKEN || DEFAULT_DRILL_FEISHU_APP_TOKEN,
    tableId: process.env.DRILL_FEISHU_TABLE_ID || DEFAULT_DRILL_FEISHU_TABLE_ID,
    viewId: process.env.DRILL_FEISHU_VIEW_ID || DEFAULT_DRILL_FEISHU_VIEW_ID,
    notifyChatId: process.env.DRILL_FEISHU_NOTIFY_CHAT_ID || process.env.FEISHU_NOTIFY_CHAT_ID || '',
    notifyChatName: process.env.DRILL_FEISHU_NOTIFY_CHAT_NAME || process.env.FEISHU_NOTIFY_CHAT_NAME || '',
  });
}

function createEventFeishuClient(overrides = {}) {
  return new FeishuOpenApiClient({
    baseUrl: process.env.EVENT_FEISHU_OPEN_BASE_URL || process.env.FEISHU_OPEN_BASE_URL,
    appId: process.env.EVENT_FEISHU_APP_ID || process.env.FEISHU_APP_ID || '',
    appSecret: process.env.EVENT_FEISHU_APP_SECRET || process.env.FEISHU_APP_SECRET || '',
    appToken: process.env.EVENT_FEISHU_BITABLE_APP_TOKEN || DEFAULT_EVENT_FEISHU_APP_TOKEN,
    tableId: process.env.EVENT_FEISHU_TABLE_ID || DEFAULT_EVENT_FEISHU_TABLE_ID,
    viewId: process.env.EVENT_FEISHU_VIEW_ID || DEFAULT_EVENT_FEISHU_VIEW_ID,
    notifyChatId: overrides.notifyChatId ?? (process.env.EVENT_FEISHU_NOTIFY_CHAT_ID || process.env.FEISHU_NOTIFY_CHAT_ID || ''),
    notifyChatName: overrides.notifyChatName ?? (process.env.EVENT_FEISHU_NOTIFY_CHAT_NAME || process.env.FEISHU_NOTIFY_CHAT_NAME || ''),
  });
}

function createInspectFeishuClient(overrides = {}) {
  return new FeishuOpenApiClient({
    baseUrl: process.env.INSPECT_FEISHU_OPEN_BASE_URL || process.env.FEISHU_OPEN_BASE_URL,
    appId: process.env.INSPECT_FEISHU_APP_ID || process.env.FEISHU_APP_ID || '',
    appSecret: process.env.INSPECT_FEISHU_APP_SECRET || process.env.FEISHU_APP_SECRET || '',
    appToken: process.env.INSPECT_FEISHU_BITABLE_APP_TOKEN || DEFAULT_INSPECT_FEISHU_APP_TOKEN,
    tableId: process.env.INSPECT_FEISHU_TABLE_ID || DEFAULT_INSPECT_FEISHU_TABLE_ID,
    viewId: process.env.INSPECT_FEISHU_VIEW_ID || DEFAULT_INSPECT_FEISHU_VIEW_ID,
    notifyChatId: overrides.notifyChatId ?? (process.env.INSPECT_FEISHU_NOTIFY_CHAT_ID || process.env.FEISHU_NOTIFY_CHAT_ID || ''),
    notifyChatName: overrides.notifyChatName ?? (process.env.INSPECT_FEISHU_NOTIFY_CHAT_NAME || process.env.FEISHU_NOTIFY_CHAT_NAME || ''),
  });
}

async function sendExtraAbnormalNotifyMessage({
  moduleName,
  summary,
  notifyMessage,
  createClient,
  primaryChatId = '',
  enabled = true,
}) {
  const label = moduleName || '异常提醒';
  if (!enabled || !EXTRA_ABNORMAL_NOTIFY_ENABLED || !EXTRA_ABNORMAL_NOTIFY_CHAT_ID) {
    return {
      attempted: false,
      success: false,
      message: '',
    };
  }
  if (!summary?.hasImportant) {
    return {
      attempted: false,
      success: false,
      message: '',
    };
  }
  if (String(primaryChatId || '').trim() === EXTRA_ABNORMAL_NOTIFY_CHAT_ID) {
    return {
      attempted: false,
      success: false,
      message: '',
    };
  }
  if (typeof createClient !== 'function') {
    return {
      attempted: false,
      success: false,
      message: '',
    };
  }

  try {
    const extraClient = createClient({
      notifyChatId: EXTRA_ABNORMAL_NOTIFY_CHAT_ID,
      notifyChatName: '',
    });
    await extraClient.sendMessageToChat(notifyMessage || summary.notifyMessage);
    return {
      attempted: true,
      success: true,
      message: `${label}额外会话通知已发送：${EXTRA_ABNORMAL_NOTIFY_CHAT_ID}`,
    };
  } catch (error) {
    return {
      attempted: true,
      success: false,
      message: `${label}额外会话通知发送失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function getEventBitableWebUrl(viewIdOverride) {
  const appToken = process.env.EVENT_FEISHU_BITABLE_APP_TOKEN || DEFAULT_EVENT_FEISHU_APP_TOKEN;
  const tableId = process.env.EVENT_FEISHU_TABLE_ID || DEFAULT_EVENT_FEISHU_TABLE_ID;
  const viewId = viewIdOverride === undefined
    ? process.env.EVENT_FEISHU_VIEW_ID || DEFAULT_EVENT_FEISHU_VIEW_ID
    : viewIdOverride;
  const origin = trimTrailingSlash(process.env.EVENT_FEISHU_BITABLE_WEB_ORIGIN || process.env.FEISHU_BITABLE_WEB_ORIGIN || 'https://www.feishu.cn');
  const url = new URL(`/base/${appToken}`, origin);
  url.searchParams.set('table', tableId);
  if (viewId) {
    url.searchParams.set('view', viewId);
  }
  return url.toString();
}

function getInspectBitableWebUrl() {
  const appToken = process.env.INSPECT_FEISHU_BITABLE_APP_TOKEN || DEFAULT_INSPECT_FEISHU_APP_TOKEN;
  const tableId = process.env.INSPECT_FEISHU_TABLE_ID || DEFAULT_INSPECT_FEISHU_TABLE_ID;
  const viewId = process.env.INSPECT_FEISHU_VIEW_ID || DEFAULT_INSPECT_FEISHU_VIEW_ID;
  const origin = trimTrailingSlash(process.env.INSPECT_FEISHU_BITABLE_WEB_ORIGIN || process.env.FEISHU_BITABLE_WEB_ORIGIN || 'https://vnet.feishu.cn');
  const url = new URL(`/base/${appToken}`, origin);
  url.searchParams.set('table', tableId);
  if (viewId) {
    url.searchParams.set('view', viewId);
  }
  return url.toString();
}

function getEventViewId(viewsResult, viewName) {
  const item = viewsResult?.views?.[viewName];
  return item?.viewId || '';
}

async function ensureEventFeishuViews(eventFeishuClient) {
  if (!EVENT_FEISHU_VIEW_SETUP_ENABLED) {
    return {
      success: true,
      createdCount: 0,
      views: {},
      message: '事件多维表视图初始化已关闭',
    };
  }

  if (!eventFeishuClient || typeof eventFeishuClient.ensureTableViews !== 'function') {
    return {
      success: false,
      createdCount: 0,
      views: {},
      message: '当前 feishu-open-api.js 不支持自动创建事件视图，请覆盖完整补丁包后重启',
    };
  }

  try {
    const result = await eventFeishuClient.ensureTableViews([
      EVENT_FEISHU_INCOMPLETE_VIEW_NAME,
      EVENT_FEISHU_FALSE_REAL_VIEW_NAME,
    ]);
    return {
      ...result,
      message: result.createdCount > 0
        ? `已创建 ${result.createdCount} 个事件视图`
        : '事件视图已存在',
    };
  } catch (error) {
    return {
      success: false,
      createdCount: 0,
      views: {},
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function cloneEventSyncProgress() {
  return JSON.parse(JSON.stringify(eventSyncProgressState));
}

function resetEventSyncProgress(mode, message) {
  eventSyncProgressState.running = true;
  eventSyncProgressState.runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  eventSyncProgressState.mode = mode;
  eventSyncProgressState.phase = 'start';
  eventSyncProgressState.message = message || '事件同步开始';
  eventSyncProgressState.startedAt = new Date().toISOString();
  eventSyncProgressState.updatedAt = eventSyncProgressState.startedAt;
  eventSyncProgressState.percent = 1;
  eventSyncProgressState.fetch = {
    completedPages: 0,
    totalPages: 0,
    records: 0,
    totalFromApi: 0,
  };
  eventSyncProgressState.feishu = {
    listedRecords: 0,
    deleteTotal: 0,
    deleteBatchesCompleted: 0,
    deleteBatchesTotal: 0,
    createTotal: 0,
    createBatchesCompleted: 0,
    createBatchesTotal: 0,
  };
  eventSyncProgressState.steps = [{
    time: eventSyncProgressState.startedAt,
    message: eventSyncProgressState.message,
  }];
}

function appendEventSyncProgressStep(message) {
  const text = String(message || '').trim();
  if (!text) return;
  eventSyncProgressState.steps.push({
    time: new Date().toISOString(),
    message: text,
  });
  eventSyncProgressState.steps = eventSyncProgressState.steps.slice(-80);
}

function updateEventSyncProgress(patch = {}, stepMessage = '') {
  if (patch.fetch) {
    eventSyncProgressState.fetch = {
      ...eventSyncProgressState.fetch,
      ...patch.fetch,
    };
  }
  if (patch.feishu) {
    eventSyncProgressState.feishu = {
      ...eventSyncProgressState.feishu,
      ...patch.feishu,
    };
  }
  Object.entries(patch).forEach(([key, value]) => {
    if (key !== 'fetch' && key !== 'feishu') {
      eventSyncProgressState[key] = value;
    }
  });
  eventSyncProgressState.updatedAt = new Date().toISOString();
  appendEventSyncProgressStep(stepMessage || patch.message);
}

function finishEventSyncProgress(success, message) {
  updateEventSyncProgress({
    running: false,
    phase: success ? 'done' : 'failed',
    percent: success ? 100 : eventSyncProgressState.percent,
    message: message || (success ? '事件同步完成' : '事件同步失败'),
  }, message);
}

function formatIso(date) {
  return date instanceof Date ? date.toISOString() : '';
}

function computeNextDailyRun(hour, minute, now = new Date()) {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function computeNextScheduledRun(scheduleEntries, now = new Date()) {
  if (!Array.isArray(scheduleEntries) || scheduleEntries.length === 0) {
    return null;
  }

  let earliest = null;
  scheduleEntries.forEach((entry) => {
    const candidate = new Date(now);
    candidate.setHours(entry.hour, entry.minute, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }

    if (!earliest || candidate.getTime() < earliest.getTime()) {
      earliest = candidate;
    }
  });

  return earliest;
}

function computePreviousScheduledRun(scheduleEntries, now = new Date()) {
  if (!Array.isArray(scheduleEntries) || scheduleEntries.length === 0) {
    return null;
  }

  let latest = null;
  scheduleEntries.forEach((entry) => {
    const candidate = new Date(now);
    candidate.setHours(entry.hour, entry.minute, 0, 0);
    if (candidate.getTime() > now.getTime()) {
      candidate.setDate(candidate.getDate() - 1);
    }

    if (!latest || candidate.getTime() > latest.getTime()) {
      latest = candidate;
    }
  });

  return latest;
}

function getScheduleLabelForRun(scheduleEntries, scheduledRun) {
  if (!(scheduledRun instanceof Date) || Number.isNaN(scheduledRun.getTime())) {
    return '';
  }

  const matchedEntry = (Array.isArray(scheduleEntries) ? scheduleEntries : [])
    .find((entry) => Number(entry?.hour) === scheduledRun.getHours() && Number(entry?.minute) === scheduledRun.getMinutes());
  return matchedEntry?.label || formatScheduleLabel(scheduledRun.getHours(), scheduledRun.getMinutes());
}

function getScheduledDateFromContext(runContext, fallback = new Date()) {
  if (runContext?.scheduledAt) {
    const scheduledDate = new Date(runContext.scheduledAt);
    if (!Number.isNaN(scheduledDate.getTime())) {
      return scheduledDate;
    }
  }

  return fallback;
}

function shouldSendAutoSyncMessage(runContext = {}, now = new Date()) {
  if (!AUTO_SYNC_MESSAGE_ENABLED || runContext?.catchUp) {
    return false;
  }

  const scheduledDate = getScheduledDateFromContext(runContext, now);
  return scheduledDate.getDay() === AUTO_SYNC_MESSAGE_WEEKDAY
    || scheduledDate.getDate() > AUTO_SYNC_MESSAGE_MONTH_END_AFTER_DAY;
}

function isAutoSyncMessageSchedule(runContext = {}) {
  const scheduleLabel = String(runContext?.scheduleLabel || '');
  return AUTO_SYNC_MESSAGE_SCHEDULES.some((entry) => entry.label === scheduleLabel);
}

function shouldSkipAutoSyncMessageRun(runContext = {}) {
  return false;
}

function shouldNotifyAutoSyncRun(runContext = {}) {
  return isAutoSyncMessageSchedule(runContext) && shouldSendAutoSyncMessage(runContext);
}

function shouldNotifyChangeAutoSyncRun(runContext = {}) {
  return CHANGE_AUTO_SYNC_NOTIFY_ENABLED && !runContext?.catchUp;
}

function shouldNotifyEventAutoSyncRun(runContext = {}) {
  return EVENT_AUTO_SYNC_NOTIFY_ENABLED && !runContext?.catchUp;
}

function shouldNotifyInspectAutoSyncRun() {
  return INSPECT_AUTO_SYNC_NOTIFY_ENABLED;
}

async function runConcurrentWorkers({ items, concurrency, worker }) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const results = new Array(items.length);
  const runnerCount = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: runnerCount }, () => runWorker()));
  return results;
}

function enqueueScheduledSyncTask({ tag, state, runTask }) {
  state.queued = true;
  state.statusMessage = scheduledSyncQueue.activeTag
    ? `等待 ${scheduledSyncQueue.activeTag} 完成`
    : '等待同步队列执行';
  const queuedAt = Date.now();

  const queuedTask = scheduledSyncQueue.tail.catch(() => {}).then(async () => {
    state.queued = false;
    scheduledSyncQueue.activeTag = tag;
    const waitedMs = Date.now() - queuedAt;
    if (waitedMs > 1000) {
      console.log(`[${tag}] queue wait ${Math.round(waitedMs / 1000)}s, starting now`);
    } else {
      console.log(`[${tag}] starting scheduled task`);
    }

    try {
      await runTask();
    } finally {
      if (scheduledSyncQueue.activeTag === tag) {
        scheduledSyncQueue.activeTag = '';
      }
    }
  });

  scheduledSyncQueue.tail = queuedTask.catch((error) => {
    console.warn(`[${tag}] queued task failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  return queuedTask;
}

function scheduleRecurringSyncTask({
  enabled,
  state,
  tag,
  scheduleEntries,
  runTask,
  disabledMessage,
  catchUpWindowMs = AUTO_SYNC_STARTUP_CATCHUP_MS,
}) {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  state.nextRunAt = '';
  if (!enabled) {
    console.log(`[${tag}] ${disabledMessage || 'disabled'}`);
    return;
  }

  const now = new Date();
  const previousRun = computePreviousScheduledRun(scheduleEntries, now);
  const shouldCatchUp = !state.catchUpChecked
    && catchUpWindowMs > 0
    && previousRun
    && SERVER_STARTED_AT.getTime() >= previousRun.getTime()
    && now.getTime() - previousRun.getTime() <= catchUpWindowMs;
  state.catchUpChecked = true;

  const nextRun = shouldCatchUp
    ? new Date(Date.now() + 1000)
    : computeNextScheduledRun(scheduleEntries, now);
  if (!nextRun) {
    console.log(`[${tag}] no schedule configured`);
    return;
  }

  const scheduledRun = shouldCatchUp ? previousRun : nextRun;
  const runContext = {
    scheduledAt: formatIso(scheduledRun),
    scheduleLabel: getScheduleLabelForRun(scheduleEntries, scheduledRun),
    catchUp: shouldCatchUp,
  };
  state.nextRunAt = formatIso(nextRun);
  const delayMs = Math.max(nextRun.getTime() - Date.now(), 1000);
  console.log(shouldCatchUp
    ? `[${tag}] startup catch-up scheduled at ${state.nextRunAt}, missed ${formatIso(previousRun)}`
    : `[${tag}] next run scheduled at ${state.nextRunAt}`);
  state.timer = setTimeout(async () => {
    try {
      await enqueueScheduledSyncTask({ tag, state, runTask: () => runTask(runContext) });
    } finally {
      scheduleRecurringSyncTask({
        enabled,
        state,
        tag,
        scheduleEntries,
        runTask,
        disabledMessage,
        catchUpWindowMs,
      });
    }
  }, delayMs);
}

const DEFAULT_BUILDING_OPTIONS = [
  { value: '2039149320796995584', label: 'A楼' },
  { value: '2039149403600945152', label: 'B楼' },
  { value: '2039149486492975104', label: 'C楼' },
  { value: '2039149571654123520', label: 'D楼' },
  { value: '2039150408220639232', label: 'E楼' },
];
const BUILDING_LABELS = DEFAULT_BUILDING_OPTIONS.map((item) => item.label);
const BUILDING_LDYH_MAP = {
  A楼: '5',
  B楼: '6',
  C楼: '7',
  D楼: '8',
  E楼: '9',
};
const RECORD_LIST_PAGE_SIZE = 50;
const RECORD_LIST_MAX_PAGES = 10;
const buildingOptionsState = {
  options: DEFAULT_BUILDING_OPTIONS.map((item) => ({ ...item })),
  yearMonth: '',
  updatedAt: '',
  sourcePath: getRiskRecordListPathCandidates()[0],
  scannedCount: 0,
  matchedCount: 0,
  missingLabels: [],
  lastError: '',
};
const AUTO_FETCH_PAGE_SIZE = 50;
const AUTO_FETCH_MAX_PAGES = 100;
const AUTO_FETCH_PAGE_CONCURRENCY = normalizePositiveInteger(process.env.RISK_AUTO_SYNC_PAGE_CONCURRENCY, 2, 1, 5);
const AUTO_SYNC_BUILDING_CONCURRENCY = normalizePositiveInteger(process.env.RISK_AUTO_SYNC_BUILDING_CONCURRENCY, 1, 1, 5);
const RISK_BUILDING_SUMMARY_ORDER = ['A\u697c', 'B\u697c', 'C\u697c', 'D\u697c', 'E\u697c'];
const RISK_FIELD_BUILDING = '\u697c\u680b';
const RISK_FIELD_LEVEL = '\u98ce\u9669\u7b49\u7ea7';
const RISK_FIELD_CHECK_STATUS = '\u6392\u67e5\u72b6\u6001';
const RISK_FIELD_CHECK_TIME = '\u6392\u67e5\u65f6\u95f4';
const RISK_FIELD_AUDIT_TIME = '\u5ba1\u6838\u65f6\u95f4';
const RISK_FIELD_CURRENT_STATUS = '\u5f53\u524d\u98ce\u9669\u72b6\u6001';
const RISK_LEVEL_MAP = {
  '1': '低',
  '2': '中',
  '3': '高',
  low: '低',
  l: '低',
  lo: '低',
  medium: '中',
  mid: '中',
  m: '中',
  high: '高',
  h: '高',
  in: '中',
  im: '中',
  ic: '一般',
  一般: '一般',
  低: '低',
  中: '中',
  高: '高',
};
const CHECK_PERIOD_MAP = {
  monthly: '月度',
  month: '月度',
  m: '月度',
  mo: '月度',
  quarter: '季度',
  quarterly: '季度',
  q: '季度',
  qtr: '季度',
  halfyear: '半年度',
  half: '半年度',
  yearly: '年度',
  year: '年度',
  annual: '年度',
  y: '年度',
  yr: '年度',
  weekly: '周度',
  week: '周度',
  w: '周度',
  daily: '日度',
  day: '日度',
  d: '日度',
  月度: '月度',
  季度: '季度',
  半年度: '半年度',
  年度: '年度',
  周度: '周度',
  日度: '日度',
};
const RISK_STATUS_MAP = {
  w: '无',
  无: '无',
  有: '有',
};

let weatherCache = {
  data: null,
  updatedAt: 0,
};

function getWeatherType(text) {
  const value = String(text || '');
  if (value.includes('雪')) return 'snowy';
  if (value.includes('雨')) return 'rainy';
  if (value.includes('阴')) return 'cloudy';
  if (value.includes('云')) return 'partlyCloudy';
  return 'sunny';
}

function requestJsonViaHttps(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      timeout: timeoutMs,
      headers: {
        'accept-encoding': 'gzip, deflate, br',
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      response.on('end', () => {
        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        try {
          const buffer = Buffer.concat(chunks);
          const encoding = String(response.headers['content-encoding'] || '').toLowerCase();
          let bodyBuffer = buffer;
          if (encoding.includes('gzip')) {
            bodyBuffer = zlib.gunzipSync(buffer);
          } else if (encoding.includes('br')) {
            bodyBuffer = zlib.brotliDecompressSync(buffer);
          } else if (encoding.includes('deflate')) {
            bodyBuffer = zlib.inflateSync(buffer);
          }
          resolve(JSON.parse(bodyBuffer.toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('天气接口请求超时'));
    });
    request.on('error', reject);
  });
}

async function fetchRealtimeWeather() {
  const now = Date.now();
  if (weatherCache.data && now - weatherCache.updatedAt < WEATHER_CACHE_TTL_MS) {
    return weatherCache.data;
  }

  try {
    const url = new URL('https://devapi.qweather.com/v7/weather/now');
    url.searchParams.set('location', WEATHER_LOCATION);
    url.searchParams.set('key', WEATHER_API_KEY);

    const payload = await requestJsonViaHttps(url);
    if (payload?.code !== '200' || !payload?.now) {
      throw new Error(`天气接口返回异常: ${payload?.code || 'unknown'}`);
    }

    const current = payload.now;
    const weather = {
      location: WEATHER_CITY,
      temperature: Math.round(Number(current.temp)),
      weather: current.text || '',
      weatherType: getWeatherType(current.text),
      humidity: Math.round(Number(current.humidity)),
      windSpeed: `${current.windDir || ''} ${current.windScale || ''}级`.trim(),
      updateTime: current.obsTime || new Date().toISOString(),
    };
    weatherCache = {
      data: weather,
      updatedAt: now,
    };
    return weather;
  } catch (error) {
    console.warn(`[weather] failed: ${error instanceof Error ? error.message : String(error)}`);
    if (weatherCache.data) {
      return weatherCache.data;
    }

    return {
      location: WEATHER_CITY,
      temperature: null,
      weather: '同步中',
      weatherType: 'sunny',
      humidity: null,
      windSpeed: '',
      updateTime: new Date().toISOString(),
    };
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(body);
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBrowserExecutable() {
  const candidates = [
    process.env.RISK_BROWSER_PATH,
    process.env.BROWSER_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Google\\Chrome\\Application\\chrome.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google\\Chrome\\Application\\chrome.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft\\Edge\\Application\\msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function getDebugBrowserTargets(origin = INTRANET_ORIGIN) {
  return [
    origin,
    INTRANET_ORIGIN,
    CHANGE_INTRANET_ORIGIN,
    DRILL_INTRANET_ORIGIN,
    EVENT_INTRANET_ORIGIN,
    INSPECT_INTRANET_ORIGIN,
    `http://localhost:${CLIENT_DEV_PORT}`,
  ]
    .filter(Boolean)
    .map((value) => trimTrailingSlash(value))
    .filter((value, index, list) => list.indexOf(value) === index);
}

async function waitForDevtoolsReady(timeoutMs = BROWSER_START_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      await fetchDevtoolsJson('/json/version');
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(500);
    }
  }

  throw new Error(lastError || `浏览器调试端口 ${DEBUG_PORT} 未在 ${Math.round(timeoutMs / 1000)} 秒内就绪`);
}

async function launchDebugBrowser(origin = INTRANET_ORIGIN) {
  if (browserDebugState.launching) {
    return browserDebugState.launching;
  }

  browserDebugState.launching = (async () => {
    const browserPath = getBrowserExecutable();
    if (!browserPath) {
      throw new Error('未找到 Chrome 或 Edge，请安装浏览器，或在 .env 中配置 RISK_BROWSER_PATH');
    }

    fs.mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });
    fs.mkdirSync(path.join(ROOT, '.run'), { recursive: true });

    const browserArgs = [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${BROWSER_PROFILE_DIR}`,
      '--no-first-run',
      '--new-window',
      ...getDebugBrowserTargets(origin),
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
    fs.writeFileSync(path.join(ROOT, '.run', 'browser.pid'), String(child.pid || ''), 'utf8');

    await waitForDevtoolsReady();
    browserDebugState.lastLaunchAt = new Date().toISOString();
    browserDebugState.lastLaunchError = '';
    console.log(`[browser] launched debug browser pid=${child.pid || ''} port=${DEBUG_PORT}`);
  })();

  try {
    await browserDebugState.launching;
  } catch (error) {
    browserDebugState.lastLaunchError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    browserDebugState.launching = null;
  }
}

async function fetchDevtoolsJson(route, init = {}, timeoutMs = DEVTOOLS_HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}${route}`, {
      ...init,
      signal: init.signal || controller.signal,
    });
    if (!response.ok) {
      throw new Error(`浏览器调试端口返回 HTTP ${response.status}`);
    }
    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`浏览器调试端口 ${DEBUG_PORT} 响应超时`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sendDevtoolsCommand(webSocketDebuggerUrl, method, params = {}, timeoutMs = 30000) {
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
      const message = JSON.parse(event.data);
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
      reject(new Error(`DevTools connection failed: ${method}`));
    });
  });
}

function isPathInside(parentPath, targetPath) {
  const parent = path.resolve(parentPath);
  const target = path.resolve(targetPath);
  return target === parent || target.startsWith(`${parent}${path.sep}`);
}

function isSafeLightweightCachePath(targetPath) {
  const resolved = path.resolve(targetPath);
  const runDir = path.join(ROOT, '.run');
  const protectedPaths = [
    ROOT,
    runDir,
    BROWSER_PROFILE_DIR,
    path.join(ROOT, '.run', 'headless-profile'),
  ].map((item) => path.resolve(item));

  if (!isPathInside(runDir, resolved)) {
    return false;
  }

  return !protectedPaths.some((protectedPath) => (
    resolved === protectedPath || isPathInside(protectedPath, resolved)
  ));
}

function getOriginFromMaybeUrl(value) {
  try {
    return trimTrailingSlash(new URL(String(value || '')).origin);
  } catch {
    return '';
  }
}

function getSyncCleanupOrigins(scope) {
  const originMap = {
    risk: [INTRANET_ORIGIN],
    change: [CHANGE_INTRANET_ORIGIN],
    drill: [DRILL_INTRANET_ORIGIN, getOriginFromMaybeUrl(DRILL_EVALUATION_URL), getOriginFromMaybeUrl(DRILL_EVALUATION_DETAIL_URL)],
    event: [EVENT_INTRANET_ORIGIN],
  };

  const origins = originMap[scope] || [
    INTRANET_ORIGIN,
    CHANGE_INTRANET_ORIGIN,
    DRILL_INTRANET_ORIGIN,
    EVENT_INTRANET_ORIGIN,
  ];

  return origins
    .map((origin) => trimTrailingSlash(String(origin || '')))
    .filter(Boolean)
    .filter((origin, index, list) => list.indexOf(origin) === index);
}

async function clearBrowserHttpCacheForOrigins(origins) {
  const originSet = new Set((Array.isArray(origins) ? origins : []).filter(Boolean));
  if (originSet.size === 0) {
    return {
      attempted: false,
      clearedTargets: 0,
      message: '没有需要清理的内网源',
    };
  }

  let targets;
  try {
    targets = await fetchDevtoolsJson('/json', {}, 3000);
  } catch (error) {
    return {
      attempted: false,
      clearedTargets: 0,
      message: `浏览器调试端口不可用，已跳过 HTTP cache 清理：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const pages = (Array.isArray(targets) ? targets : [])
    .filter((target) => target?.type === 'page' && target.webSocketDebuggerUrl)
    .filter((target) => originSet.has(getOriginFromMaybeUrl(target.url)));
  const uniquePages = [];
  const seenSockets = new Set();
  pages.forEach((target) => {
    if (!seenSockets.has(target.webSocketDebuggerUrl)) {
      seenSockets.add(target.webSocketDebuggerUrl);
      uniquePages.push(target);
    }
  });

  if (uniquePages.length === 0) {
    return {
      attempted: false,
      clearedTargets: 0,
      message: '未找到匹配内网源的浏览器页签，已跳过 HTTP cache 清理',
    };
  }

  let clearedTargets = 0;
  const errors = [];
  for (const target of uniquePages) {
    try {
      await sendDevtoolsCommand(target.webSocketDebuggerUrl, 'Network.clearBrowserCache', {}, 5000);
      clearedTargets += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    attempted: true,
    clearedTargets,
    message: errors.length > 0
      ? `HTTP cache 已清理 ${clearedTargets} 个页签，${errors.length} 个页签失败：${errors[0]}`
      : `HTTP cache 已清理 ${clearedTargets} 个页签`,
  };
}

async function cleanupLightweightSyncCache(scope, options = {}) {
  if (!SYNC_LIGHTWEIGHT_CACHE_CLEANUP_ENABLED || options.enabled === false) {
    return {
      enabled: false,
      scope,
      message: '同步后轻量缓存清理已关闭',
    };
  }

  const cleanedAt = new Date().toISOString();
  const removedPaths = [];
  const skippedPaths = [];
  const errors = [];

  weatherCache = {
    data: null,
    updatedAt: 0,
  };

  for (const cachePath of SYNC_LIGHTWEIGHT_CACHE_DIRS) {
    try {
      if (!isSafeLightweightCachePath(cachePath)) {
        skippedPaths.push(cachePath);
        continue;
      }

      if (fs.existsSync(cachePath)) {
        fs.rmSync(cachePath, { recursive: true, force: true });
        removedPaths.push(cachePath);
      }
    } catch (error) {
      errors.push(`${cachePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const browserCache = await clearBrowserHttpCacheForOrigins(getSyncCleanupOrigins(scope));
  const result = {
    enabled: true,
    scope,
    cleanedAt,
    memoryCaches: ['weatherCache'],
    removedPaths,
    skippedPaths,
    browserCache,
    success: errors.length === 0,
    message: [
      `轻量缓存清理完成：${scope}`,
      removedPaths.length > 0 ? `删除临时目录 ${removedPaths.length} 个` : '没有临时目录需要删除',
      browserCache.message,
      errors.length > 0 ? `错误 ${errors.length} 个：${errors[0]}` : '',
    ].filter(Boolean).join('；'),
  };

  console.log(`[sync-cache-cleanup] scope=${scope} success=${result.success} removed=${removedPaths.length} browserTargets=${browserCache.clearedTargets || 0} message=${result.message}`);
  return result;
}

async function attachLightweightSyncCleanup(result, scope) {
  const output = result && typeof result === 'object' ? result : {};
  output.cacheCleanup = await cleanupLightweightSyncCache(scope);
  return output;
}

async function openIntranetTarget(origin = INTRANET_ORIGIN) {
  const targetUrl = `${origin}/`;
  const route = `/json/new?${encodeURIComponent(targetUrl)}`;

  try {
    return await fetchDevtoolsJson(route, { method: 'PUT' });
  } catch {
    return fetchDevtoolsJson(route, { method: 'GET' });
  }
}

async function getTargetLocation(target) {
  try {
    return await evaluateInTarget(
      target.webSocketDebuggerUrl,
      '({ origin: window.location.origin, href: window.location.href, title: document.title })',
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

async function findUsableIntranetTarget(pages, origin = INTRANET_ORIGIN) {
  for (const target of pages) {
    const location = await getTargetLocation(target);
    if (location?.origin === origin) {
      target.currentLocation = location;
      return target;
    }
  }

  return null;
}

async function waitForUsableIntranetTarget(origin = INTRANET_ORIGIN, retries = INTRANET_TARGET_DISCOVERY_RETRIES, intervalMs = INTRANET_TARGET_DISCOVERY_INTERVAL_MS) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (attempt > 0) {
      await sleep(intervalMs);
    }

    const targets = await fetchDevtoolsJson('/json');
    const pages = targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    const target = await findUsableIntranetTarget(pages, origin);
    if (target) {
      return target;
    }
  }

  return null;
}

async function findIntranetTarget(origin = INTRANET_ORIGIN) {
  let targets;
  try {
    targets = await fetchDevtoolsJson('/json');
  } catch (error) {
    try {
      console.warn(`[browser] debug port ${DEBUG_PORT} is not reachable, launching browser automatically...`);
      await launchDebugBrowser(origin);
      targets = await fetchDevtoolsJson('/json');
    } catch (launchError) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const launchMessage = launchError instanceof Error ? launchError.message : String(launchError);
      throw new Error(
        `无法连接浏览器调试端口 ${DEBUG_PORT}，自动打开专用浏览器也失败。请重新运行 start-dev.bat，并在打开的浏览器里完成 VPN/内网登录。原始错误：${originalMessage}；自动打开错误：${launchMessage}`,
      );
    }
  }

  const pages = targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  const activeTarget = await findUsableIntranetTarget(pages, origin);
  if (activeTarget) return activeTarget;

  await openIntranetTarget(origin);
  const newTarget = await waitForUsableIntranetTarget(origin);

  if (!newTarget) {
    throw new Error(`调试浏览器已启动，但 ${origin} 页签尚未就绪。请在自动打开的浏览器中完成内网页面登录，系统会继续自动重试。`);
  }

  return newTarget;
}

function evaluateInTarget(webSocketDebuggerUrl, expression, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    const requestId = 1;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('浏览器内执行请求超时'));
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
      const message = JSON.parse(event.data);
      if (message.id !== requestId) return;

      clearTimeout(timer);
      ws.close();

      if (message.error) {
        reject(new Error(message.error.message || '浏览器执行失败'));
        return;
      }

      if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.text || message.result.exceptionDetails.exception?.description || '浏览器执行异常'));
        return;
      }

      resolve(message.result?.result?.value);
    });

    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('浏览器调试连接失败'));
    });
  });
}

async function assertTargetOrigin(webSocketDebuggerUrl, origin = INTRANET_ORIGIN) {
  const location = await evaluateInTarget(
    webSocketDebuggerUrl,
    '({ origin: window.location.origin, href: window.location.href })',
    5000,
  );

  if (location?.origin !== origin) {
    throw new Error(`当前内网页签还不在 ${origin}，请先在启动脚本打开的浏览器里完成 VPN/登录后再重试。当前页：${location?.href || '未知'}`);
  }
}

function buildBrowserFetchExpression(payload, requestPath, method = 'POST') {
  const normalizedMethod = String(method || 'POST').toUpperCase();
  const shouldSendBody = normalizedMethod !== 'GET' && payload !== undefined;
  return `
    (() => new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open(${JSON.stringify(normalizedMethod)}, ${JSON.stringify(requestPath)}, true);
        xhr.withCredentials = true;
        xhr.timeout = 30000;
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        xhr.onreadystatechange = () => {
          if (xhr.readyState !== 4) return;
          resolve({
            ok: xhr.status >= 200 && xhr.status < 300,
            status: xhr.status,
            statusText: xhr.statusText,
            url: xhr.responseURL,
            contentType: xhr.getResponseHeader('content-type') || '',
            text: xhr.responseText
          });
        };
        xhr.onerror = () => {
          resolve({ browserError: 'XMLHttpRequest network error', status: xhr.status || 0 });
        };
        xhr.ontimeout = () => {
          resolve({ browserError: 'XMLHttpRequest timeout', status: xhr.status || 0 });
        };
        xhr.send(${shouldSendBody ? `JSON.stringify(${JSON.stringify(payload)})` : ''});
      } catch (error) {
        resolve({
          browserError: error && error.message ? error.message : String(error)
        });
      }
    }))()
  `;
}

function parseRiskResponse(fetchResult) {
  if (!fetchResult) {
    throw new Error('浏览器没有返回接口结果');
  }

  if (fetchResult.browserError) {
    throw new Error(`浏览器内请求失败：${fetchResult.browserError}`);
  }

  if (!fetchResult.ok) {
    throw new Error(`内网接口返回 HTTP ${fetchResult.status}: ${fetchResult.statusText || ''}`);
  }

  const text = String(fetchResult.text || '').trim();
  if (!text) {
    throw new Error('内网接口返回空内容');
  }

  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(`内网接口未返回 JSON，可能登录态已失效。返回片段：${preview}`);
  }
}

async function fetchRiskPayloadInBrowser(payload, requestPath = RISK_API_PATH) {
  const target = await findIntranetTarget();
  await assertTargetOrigin(target.webSocketDebuggerUrl);

  const fetchResult = await evaluateInTarget(
    target.webSocketDebuggerUrl,
    buildBrowserFetchExpression(payload, requestPath),
  );

  const data = parseRiskResponse(fetchResult);
  return {
    data,
    target,
    fetchResult,
  };
}

async function fetchChangePayloadInBrowser({ url, method = 'POST', payload }) {
  if (!url) {
    throw new Error('缺少变更接口 URL');
  }

  const targetUrl = new URL(url);
  const origin = targetUrl.origin;
  const target = await findIntranetTarget(origin);
  await assertTargetOrigin(target.webSocketDebuggerUrl, origin);

  const requestPath = targetUrl.pathname + targetUrl.search;
  const fetchResult = await evaluateInTarget(
    target.webSocketDebuggerUrl,
    buildBrowserFetchExpression(payload, requestPath, method),
  );

  const data = parseRiskResponse(fetchResult);
  return {
    data,
    target,
    fetchResult,
    requestPath,
  };
}

async function fetchDrillPayloadInBrowser({ url, method = 'POST', payload }) {
  const targetUrl = String(url || DRILL_LIST_URL);
  if (!targetUrl.startsWith(DRILL_INTRANET_ORIGIN)) {
    const allowedOrigins = [
      DRILL_INTRANET_ORIGIN,
      getOriginFromMaybeUrl(DRILL_EVALUATION_URL),
      getOriginFromMaybeUrl(DRILL_EVALUATION_DETAIL_URL),
    ].filter(Boolean);
    if (!allowedOrigins.some((origin) => targetUrl.startsWith(origin))) {
      throw new Error(`Only drill system origins are allowed: ${allowedOrigins.join(', ')}`);
    }
  }

  return fetchChangePayloadInBrowser({
    url: targetUrl,
    method,
    payload,
  });
}

async function fetchEventPayloadInBrowser({ url, method = 'POST', payload }) {
  const targetUrl = String(url || EVENT_LIST_URL);
  if (!targetUrl.startsWith(EVENT_INTRANET_ORIGIN)) {
    throw new Error(`只允许请求事件系统域名：${EVENT_INTRANET_ORIGIN}`);
  }

  return fetchChangePayloadInBrowser({
    url: targetUrl,
    method,
    payload,
  });
}

async function fetchInspectPayloadInBrowser({ url, method = 'GET', payload }) {
  const targetUrl = String(url || '');
  if (!targetUrl) {
    throw new Error('缺少巡检接口 URL');
  }

  if (!targetUrl.startsWith(INSPECT_INTRANET_ORIGIN)) {
    throw new Error(`只允许请求巡检系统域名：${INSPECT_INTRANET_ORIGIN}`);
  }

  return fetchChangePayloadInBrowser({
    url: targetUrl,
    method,
    payload,
  });
}

async function fetchEventPayloadInBrowserWithRetry(request, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || EVENT_AUTO_SYNC_PAGE_RETRY_ATTEMPTS) || 1);
  const label = options.label || '事件接口请求';
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchEventPayloadInBrowser(request);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= attempts) {
        throw new Error(`${label}失败，已重试 ${attempts} 次：${message}`);
      }

      console.warn(`[event-auto-sync] ${label} attempt=${attempt} failed: ${message}; retrying`);
      await sleep(EVENT_AUTO_SYNC_PAGE_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError || new Error(`${label}失败`);
}

function getCurrentYearMonth(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function normalizeYearMonth(value) {
  if (!value) return getCurrentYearMonth();
  const text = String(value).trim();
  const match = text.match(/^(\d{4})[-/年.]?(\d{1,2})/);
  if (!match) return getCurrentYearMonth();

  const month = Number(match[2]);
  if (month < 1 || month > 12) return getCurrentYearMonth();

  return `${match[1]}-${String(month).padStart(2, '0')}`;
}

function collectPrimitiveValues(value, output, visited, depth = 0) {
  if (value === null || value === undefined) {
    return;
  }

  if (depth > 6) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectPrimitiveValues(item, output, visited, depth + 1));
    return;
  }

  if (value instanceof Date) {
    output.push(value.toISOString());
    return;
  }

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    const text = String(value).trim();
    if (text) {
      output.push(text);
    }
    return;
  }

  if (valueType !== 'object') {
    return;
  }

  if (visited.has(value)) {
    return;
  }

  visited.add(value);
  Object.values(value).forEach((item) => collectPrimitiveValues(item, output, visited, depth + 1));
}

function flattenRecordValues(record) {
  const output = [];
  collectPrimitiveValues(record, output, new WeakSet());
  return Array.from(new Set(output));
}

function getRecordSearchText(record) {
  return flattenRecordValues(record).join(' ');
}

function getRecordId(record) {
  const preferredKeys = [
    'id_',
    'id',
    'id_$rel',
    'ID_',
    'pcjlid_',
    'pcjlid_$rel',
  ];

  for (const key of preferredKeys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  const values = flattenRecordValues(record);
  const candidate = values.find((value) => /^\d{16,22}$/.test(value));
  return candidate || '';
}

function extractRecordDate(record) {
  const text = getRecordSearchText(record);
  const match = text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/);
  if (!match) return '';

  const parts = match[0].replace(/\//g, '-').split('-');
  return `${parts[0]}-${String(Number(parts[1])).padStart(2, '0')}-${String(Number(parts[2])).padStart(2, '0')}`;
}

function recordMatchesYearMonth(record, yearMonth) {
  const text = getRecordSearchText(record);
  const slashYearMonth = yearMonth.replace('-', '/');
  return text.includes(yearMonth) || text.includes(slashYearMonth);
}

function normalizeBuildingText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/\u00a0/g, '')
    .replace(/\u697c\u680b/g, '\u697c')
    .replace(/\u697c\u5ea7/g, '\u697c')
    .replace(/\u680b/g, '\u697c')
    .replace(/\u5e62/g, '\u697c')
    .replace(/\u5ea7/g, '\u697c')
    .replace(/[()（）[\]【】]/g, '')
    .toUpperCase();
}

function getBuildingCandidateTexts(record) {
  const preferredKeys = [
    'buildingName',
    'building_name',
    'building',
    'building_',
    'buildName',
    'build_name',
    'louDong',
    'louDong_',
    'louDongName',
    'louDongName_',
    'lcmc',
    'lcmc_',
    'lcmc_$rel',
    'mc',
    'mc_',
    'name',
    'name_',
    '\u697c\u680b\u540d\u79f0',
    '\u697c\u680b',
  ];
  const values = [];

  preferredKeys.forEach((key) => {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      values.push(value);
    }
  });

  values.push(...flattenRecordValues(record));

  return Array.from(new Set(values.map((value) => normalizeBuildingText(value)).filter(Boolean)));
}

function getRecordBuildingCode(record) {
  const preferredKeys = [
    'ldyh',
    'ldyh_',
    'ldyh_$rel',
    'ldyh$rel',
    'ldyhRel',
    '楼栋号',
    '楼栋号_',
  ];

  for (const key of preferredKeys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  return '';
}

function recordMatchesBuilding(record, label) {
  const normalizedLabel = normalizeBuildingText(label);
  const letter = normalizedLabel.replace(/\u697c/g, '');
  if (!letter) return false;

  const expectedBuildingCode = BUILDING_LDYH_MAP[normalizedLabel];
  const recordBuildingCode = getRecordBuildingCode(record);
  if (expectedBuildingCode && recordBuildingCode === expectedBuildingCode) {
    return true;
  }

  const exactPatterns = [
    `\u5357\u901a${letter}\u697c`,
    `${letter}\u697c`,
  ];
  const candidateTexts = getBuildingCandidateTexts(record);

  return candidateTexts.some((text) => exactPatterns.some((pattern) => text.includes(pattern)));
}

function scoreBuildingRecord(record, label, yearMonth, index) {
  const dateText = extractRecordDate(record);
  const dateScore = dateText ? Date.parse(`${dateText}T00:00:00`) / 100000000 : 0;
  let score = dateScore - index;

  if (recordMatchesYearMonth(record, yearMonth)) score += 100000;
  if (recordMatchesBuilding(record, label)) score += 10000;

  return score;
}

function discoverBuildingOptionsFromRecords(records, yearMonth) {
  const monthRecords = records.filter((item) => recordMatchesYearMonth(item.record, yearMonth));
  const searchRecords = monthRecords.length >= BUILDING_LABELS.length ? monthRecords : records;
  const options = [];
  const missingLabels = [];

  for (const label of BUILDING_LABELS) {
    const matches = searchRecords
      .filter((item) => recordMatchesBuilding(item.record, label))
      .sort((a, b) => scoreBuildingRecord(b.record, label, yearMonth, b.index) - scoreBuildingRecord(a.record, label, yearMonth, a.index));

    const best = matches[0];
    const value = best ? getRecordId(best.record) : '';
    if (!best || !value) {
      missingLabels.push(label);
      continue;
    }

    options.push({
      value,
      label,
      recordDate: extractRecordDate(best.record),
    });
  }

  if (missingLabels.length > 0) {
    const sampleRecords = searchRecords.slice(0, 5).map((item) => ({
      id: getRecordId(item.record),
      buildingCode: getRecordBuildingCode(item.record),
      date: extractRecordDate(item.record),
      text: getRecordSearchText(item.record).slice(0, 240),
      buildingCandidates: getBuildingCandidateTexts(item.record).slice(0, 8),
    }));
    console.log('[building-options] discovery-miss', JSON.stringify({
      yearMonth,
      totalRecords: records.length,
      monthRecords: monthRecords.length,
      missingLabels,
      sampleRecords,
    }, null, 2));
  }

  return {
    options,
    missingLabels,
  };
}

async function fetchRecordListInBrowser(yearMonth) {
  const records = [];
  let currentPage = 1;
  const pathCandidates = getRiskRecordListPathCandidates();
  let activeRecordListPath = pathCandidates[0];

  while (true) {
    if (currentPage > RECORD_LIST_MAX_PAGES) {
      throw new Error(`排查记录列表超过 ${RECORD_LIST_MAX_PAGES} 页仍未找全，已停止`);
    }

    const payload = {
      orderBy: '',
      pageSize: RECORD_LIST_PAGE_SIZE,
      currentPage,
      queryData: [],
    };

    let responsePayload = null;
    let lastError = null;

    for (const candidatePath of pathCandidates) {
      try {
        const result = await fetchRiskPayloadInBrowser(payload, candidatePath);
        responsePayload = {
          ...result,
          requestPath: candidatePath,
        };
        activeRecordListPath = candidatePath;
        break;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('HTTP 404')) {
          throw error;
        }
      }
    }

    if (!responsePayload) {
      throw lastError instanceof Error
        ? lastError
        : new Error(String(lastError || '鎺掓煡璁板綍鍒楄〃鎺ュ彛杩斿洖澶辫触'));
    }

    const { data, fetchResult, requestPath } = responsePayload;
    if (!data?.isOk) {
      throw new Error(data?.message || data?.msg || '排查记录列表接口返回失败');
    }

    const list = Array.isArray(data?.data?.list) ? data.data.list : [];
    const totalCount = Number(data?.data?.count || 0);
    console.log(`[building-options] path=${requestPath} page=${currentPage} status=${fetchResult.status} total=${totalCount} list=${list.length} yearMonth=${yearMonth}`);

    list.forEach((record, offset) => {
      records.push({
        record,
        index: (currentPage - 1) * RECORD_LIST_PAGE_SIZE + offset,
      });
    });

    const expectedPageCount = totalCount > 0 ? Math.ceil(totalCount / RECORD_LIST_PAGE_SIZE) : 0;
    const hasMore = expectedPageCount > 0
      ? currentPage < expectedPageCount
      : list.length === RECORD_LIST_PAGE_SIZE;

    if (!hasMore) break;
    currentPage += 1;
    pathCandidates.splice(0, pathCandidates.length, activeRecordListPath);
  }

  return {
    records,
    requestPath: activeRecordListPath,
  };
}

async function fetchBuildingDetailCount(building) {
  const payload = {
    orderBy: '',
    pageSize: 1,
    currentPage: 1,
    queryData: [
      {
        name: 'pcjlid_',
        con: 'like',
        val: building.value,
      },
    ],
  };

  const { data } = await fetchRiskPayloadInBrowser(payload);
  if (!data?.isOk) {
    throw new Error(data?.message || data?.msg || `${building.label} 明细接口返回失败`);
  }

  return Number(data?.data?.count || 0);
}

async function refreshBuildingOptionsFromIntranet(options = {}) {
  const yearMonth = normalizeYearMonth(options.yearMonth);
  const { records, requestPath } = await fetchRecordListInBrowser(yearMonth);
  const discovery = discoverBuildingOptionsFromRecords(records, yearMonth);

  if (discovery.missingLabels.length > 0) {
    const message = `未能找到 ${yearMonth} 的 ${discovery.missingLabels.join('、')} 编号，请确认排查记录列表已生成且当前浏览器已登录内网。`;
    buildingOptionsState.lastError = message;
    return {
      success: false,
      message,
      yearMonth,
      updatedAt: new Date().toISOString(),
      sourcePath: requestPath,
      scannedCount: records.length,
      matchedCount: discovery.options.length,
      options: discovery.options,
      missingLabels: discovery.missingLabels,
    };
  }

  const resolvedOptions = discovery.options;
  if (options.validateDetails) {
    for (const building of resolvedOptions) {
      building.detailCount = await fetchBuildingDetailCount(building);
      building.totalCountFromApi = building.detailCount;
    }
  }

  const updatedAt = new Date().toISOString();
  buildingOptionsState.options = resolvedOptions.map((item) => ({ ...item }));
  buildingOptionsState.yearMonth = yearMonth;
  buildingOptionsState.updatedAt = updatedAt;
  buildingOptionsState.sourcePath = requestPath;
  buildingOptionsState.scannedCount = records.length;
  buildingOptionsState.matchedCount = resolvedOptions.length;
  buildingOptionsState.missingLabels = [];
  buildingOptionsState.lastError = '';

  return {
    success: true,
    message: `已更新 ${yearMonth} 的 A-E 楼编号`,
    yearMonth,
    updatedAt,
    sourcePath: requestPath,
    scannedCount: records.length,
    matchedCount: resolvedOptions.length,
    options: resolvedOptions,
    missingLabels: [],
  };
}

async function getLatestBuildingOptions(options = {}) {
  try {
    const result = await refreshBuildingOptionsFromIntranet(options);
    if (result.success && Array.isArray(result.options) && result.options.length > 0) {
      return result.options.map((item) => ({ ...item }));
    }

    const fallbackOptions = (buildingOptionsState.options.length > 0
      ? buildingOptionsState.options
      : DEFAULT_BUILDING_OPTIONS).map((item) => ({ ...item }));

    if (fallbackOptions.length > 0) {
      const source = buildingOptionsState.updatedAt ? 'cached' : 'default';
      console.warn(`[building-options] refresh failed, using ${source} options: ${result.message || '楼栋编号更新失败'}`);
      return fallbackOptions;
    }

    throw new Error(result.message || '楼栋编号更新失败');
  } catch (error) {
    const fallbackOptions = (buildingOptionsState.options.length > 0
      ? buildingOptionsState.options
      : DEFAULT_BUILDING_OPTIONS).map((item) => ({ ...item }));

    if (fallbackOptions.length > 0) {
      const source = buildingOptionsState.updatedAt ? 'cached' : 'default';
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[building-options] refresh error, using ${source} options: ${message}`);
      return fallbackOptions;
    }

    throw error;
  }
}

// eslint-disable-next-line no-unused-vars
async function fetchBuildingRiskData(building) {
  const allRecords = [];
  let currentPage = 1;
  let totalCountFromApi = 0;

  while (true) {
    if (currentPage > AUTO_FETCH_MAX_PAGES) {
      throw new Error(`${building.label} 自动拉取超过 ${AUTO_FETCH_MAX_PAGES} 页，已停止`);
    }

    const payload = {
      orderBy: '',
      pageSize: AUTO_FETCH_PAGE_SIZE,
      currentPage,
      queryData: [
        {
          name: 'pcjlid_',
          con: 'like',
          val: building.value,
        },
      ],
    };

    const { data, fetchResult } = await fetchRiskPayloadInBrowser(payload);
    const list = Array.isArray(data?.data?.list) ? data.data.list : [];
    const totalCount = Number(data?.data?.count || 0);
    totalCountFromApi = totalCount;

    console.log(`[auto-sync-fetch] building=${building.label} page=${currentPage} status=${fetchResult.status} total=${totalCount} list=${list.length}`);

    if (list.length === 0) {
      break;
    }

    allRecords.push(...list.map((item) => ({ ...item, buildingName: building.label })));

    const expectedPageCount = totalCount > 0 ? Math.ceil(totalCount / AUTO_FETCH_PAGE_SIZE) : 0;
    const hasMore = expectedPageCount > 0
      ? currentPage < expectedPageCount
      : list.length === AUTO_FETCH_PAGE_SIZE;

    if (!hasMore) {
      break;
    }

    currentPage += 1;
  }

  return {
    building: building.label,
    count: allRecords.length,
    totalCountFromApi,
    records: allRecords,
  };
}

async function fetchRiskPageData(building, currentPage) {
  const payload = {
    orderBy: '',
    pageSize: AUTO_FETCH_PAGE_SIZE,
    currentPage,
    queryData: [
      {
        name: 'pcjlid_',
        con: 'like',
        val: building.value,
      },
    ],
  };

  const { data, fetchResult } = await fetchRiskPayloadInBrowser(payload);
  const list = Array.isArray(data?.data?.list) ? data.data.list : [];
  const totalCount = Number(data?.data?.count || 0);

  console.log(`[auto-sync-fetch] building=${building.label} page=${currentPage} status=${fetchResult.status} total=${totalCount} list=${list.length}`);

  return {
    currentPage,
    list,
    totalCount,
  };
}

async function fetchBuildingRiskDataConcurrent(building) {
  const firstPage = await fetchRiskPageData(building, 1);
  const allRecords = firstPage.list.map((item) => ({ ...item, buildingName: building.label }));
  const totalCountFromApi = firstPage.totalCount;
  const expectedPageCount = totalCountFromApi > 0 ? Math.ceil(totalCountFromApi / AUTO_FETCH_PAGE_SIZE) : 0;

  if (expectedPageCount > AUTO_FETCH_MAX_PAGES) {
    throw new Error(`${building.label} 自动拉取超过 ${AUTO_FETCH_MAX_PAGES} 页，已停止`);
  }

  if (expectedPageCount > 1) {
    const remainingPages = Array.from({ length: expectedPageCount - 1 }, (_, index) => index + 2);
    const pageResults = await runConcurrentWorkers({
      items: remainingPages,
      concurrency: AUTO_FETCH_PAGE_CONCURRENCY,
      worker: async (pageNo) => fetchRiskPageData(building, pageNo),
    });

    pageResults
      .sort((left, right) => left.currentPage - right.currentPage)
      .forEach((pageResult) => {
        allRecords.push(...pageResult.list.map((item) => ({ ...item, buildingName: building.label })));
      });
  } else if (firstPage.list.length === AUTO_FETCH_PAGE_SIZE) {
    let currentPage = 2;

    while (currentPage <= AUTO_FETCH_MAX_PAGES) {
      const pageResult = await fetchRiskPageData(building, currentPage);
      if (pageResult.list.length === 0) {
        break;
      }

      allRecords.push(...pageResult.list.map((item) => ({ ...item, buildingName: building.label })));

      if (pageResult.list.length < AUTO_FETCH_PAGE_SIZE) {
        break;
      }

      currentPage += 1;
    }

    if (currentPage > AUTO_FETCH_MAX_PAGES) {
      throw new Error(`${building.label} 自动拉取超过 ${AUTO_FETCH_MAX_PAGES} 页，已停止`);
    }
  }

  return {
    building: building.label,
    count: allRecords.length,
    totalCountFromApi,
    records: allRecords,
  };
}

function formatRecordsForFeishu(records) {
  return records.map((item) => ({
    fields: {
      楼栋: item.buildingName || '',
      风险编号: item.fxxbh_ || '',
      检查项目: item.jcxms_ || '',
      风险等级: getRiskLevelText(item.fxdj_) || '',
      排查周期: getCheckPeriodText(item.pczq_) || '',
      排查状态: item.pczt_ || '',
      检查地点: item.jcd_ || '',
      排查时间: item.pcsj_ || '',
      审核时间: item.pcwcsj_$rel || '',
      此前风险状态: getRiskStatusText(item.cqfxzt_) || '',
      当前风险状态: getRiskStatusText(item.dqfxzt_) || '',
      风险现场情况: item.fxxcqk_ || '',
    },
  }));
}

function getRiskLevelText(value) {
  return RISK_LEVEL_MAP[value] || value || '';
}

function getCheckPeriodText(value) {
  return CHECK_PERIOD_MAP[value] || value || '';
}

function getRiskStatusText(value) {
  if (!value) return '';
  return RISK_STATUS_MAP[value] || '有';
}

async function runAutoSyncOnce(runContext = {}) {
  if (!AUTO_SYNC_ENABLED || autoSyncState.running) {
    return;
  }
  if (shouldSkipAutoSyncMessageRun(runContext)) {
    console.log(`[auto-sync] skipped message schedule=${runContext.scheduleLabel || '--'} because message is not due`);
    return;
  }

  autoSyncState.running = true;
  autoSyncState.queued = false;
  autoSyncState.lastAttemptAt = new Date().toISOString();
  autoSyncState.lastError = '';
  autoSyncState.statusMessage = '正在拉取风险排查数据';

  try {
    const buildingOptions = await getLatestBuildingOptions({ validateDetails: false });
    const buildingResults = await runConcurrentWorkers({
      items: buildingOptions,
      concurrency: AUTO_SYNC_BUILDING_CONCURRENCY,
      worker: async (building) => fetchBuildingRiskDataConcurrent(building),
    });

    const allRecords = buildingResults.flatMap((result) => result.records);
    const feishuRecords = formatRecordsForFeishu(allRecords);
    const summary = buildRiskSyncSummary(feishuRecords);
    const shouldNotify = shouldNotifyAutoSyncRun(runContext);
    const syncResult = await feishuClient.replaceTableRecords(feishuRecords, {
      notify: shouldNotify,
      notifyMessage: summary.notifyMessage,
      successMessage: summary.successMessage,
    });

    if (!syncResult.success && syncResult.insertedCount === 0) {
      throw new Error(syncResult.message || '自动同步飞书失败');
    }

    autoSyncState.lastSuccessAt = new Date().toISOString();
    autoSyncState.lastInsertedCount = Number(syncResult.insertedCount || 0);
    autoSyncState.lastError = syncResult.success ? '' : (syncResult.message || '');
    autoSyncState.statusMessage = `完成，写入 ${autoSyncState.lastInsertedCount} 条`;
    const cleanupResult = await cleanupLightweightSyncCache('risk');

    console.log(`[auto-sync] completed notifyAllowed=${shouldNotify} inserted=${autoSyncState.lastInsertedCount} notified=${Boolean(syncResult.notified)} cacheCleanup=${cleanupResult.success !== false} message=${String(syncResult.message || '').replace(/\s+/g, ' ')} buildings=${buildingResults.map((item) => `${item.building}:${item.count}`).join(', ')}`);
  } catch (error) {
    autoSyncState.lastError = error instanceof Error ? error.message : String(error);
    autoSyncState.statusMessage = autoSyncState.lastError;
    console.warn(`[auto-sync] failed: ${autoSyncState.lastError}`);
  } finally {
    autoSyncState.running = false;
  }
}

function scheduleNextAutoSync() {
  scheduleRecurringSyncTask({
    enabled: AUTO_SYNC_ENABLED,
    state: autoSyncState,
    tag: 'auto-sync',
    scheduleEntries: AUTO_SYNC_SCHEDULES,
    runTask: runAutoSyncOnce,
    disabledMessage: 'disabled by RISK_AUTO_SYNC_ENABLED=false',
  });
}

async function handleRiskBrowserFetch(req, res) {
  try {
    const body = await readRequestJson(req);
    const payload = body.payload;
    if (!payload || typeof payload !== 'object') {
      sendJson(res, 400, { success: false, message: '缺少 payload' });
      return;
    }

    const requestPath = body.path || RISK_API_PATH;
    const { data, target, fetchResult } = await fetchRiskPayloadInBrowser(payload, requestPath);
    const pcjlid = payload?.queryData?.find?.((item) => item?.name === 'pcjlid_')?.val || '';
    console.log(`[risk-fetch] pcjlid=${pcjlid} page=${payload.currentPage || ''} pageSize=${payload.pageSize || ''} status=${fetchResult.status} count=${data?.data?.count ?? ''} list=${Array.isArray(data?.data?.list) ? data.data.list.length : ''}`);

    sendJson(res, 200, {
      success: true,
      data,
      meta: {
        browserUrl: target.url,
        requestPath,
        status: fetchResult.status,
      },
    });
  } catch (error) {
    sendJson(res, 502, {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleRefreshBuildingOptions(req, res) {
  try {
    const body = await readRequestJson(req);
    const result = await refreshBuildingOptionsFromIntranet({
      yearMonth: body.yearMonth,
      validateDetails: body.validateDetails !== false,
    });

    sendJson(res, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    buildingOptionsState.lastError = message;
    sendJson(res, 502, {
      success: false,
      message,
      yearMonth: getCurrentYearMonth(),
      updatedAt: new Date().toISOString(),
      sourcePath: getRiskRecordListPathCandidates()[0],
      scannedCount: 0,
      matchedCount: 0,
      options: [],
      missingLabels: BUILDING_LABELS,
    });
  }
}

async function handleFeishuSync(req, res) {
  try {
    const body = await readRequestJson(req);
    const records = Array.isArray(body.records) ? body.records : [];
    const summary = buildRiskSyncSummary(records);
    const result = await feishuClient.replaceTableRecords(records, {
      notifyMessage: summary.notifyMessage,
      successMessage: summary.successMessage,
    });
    const insertedCount = Number(result.insertedCount || 0);
    sendJson(res, 200, insertedCount > 0 ? await attachLightweightSyncCleanup(result, 'risk') : result);
  } catch (error) {
    sendJson(res, 502, {
      success: false,
      insertedCount: 0,
      deletedCount: 0,
      notified: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleFeishuConnectivity(req, res) {
  try {
    const body = await readRequestJson(req);
    const result = await feishuClient.testConnectivity({
      sendTestMessage: body.sendTestMessage !== false,
    });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 502, {
      success: false,
      checkedAt: new Date().toISOString(),
      tenantName: '',
      appName: '',
      chatId: process.env.FEISHU_NOTIFY_CHAT_ID || '',
      chatName: '',
      tableId: process.env.FEISHU_BITABLE_TABLE_ID || '',
      tableRecordCount: 0,
      tenant: { ok: false, message: '租户查询失败' },
      bitable: { ok: false, message: '多维表访问失败' },
      chat: { ok: false, message: '群会话访问失败' },
      messageStatus: {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      messageId: '',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleFeishuDeleteRecords(_req, res) {
  try {
    const result = await feishuClient.deleteAllRecords();
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 502, {
      success: false,
      deletedCount: 0,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function normalizeChangeStatus(value) {
  const mapping = {
    '0': '草稿',
    '1': '审批中',
    '2': '实施中',
    '3': '实施成功',
    '4': '实施失败',
    '5': '已关闭',
    '8': '终止',
    '13': '实施成功',
    '14': '逾期实施成功',
  };
  const key = String(value || '');
  return mapping[key] || key;
}

function isTerminatedChangeStatus(value) {
  const raw = String(value ?? '').trim();
  return raw === '8' || normalizeChangeStatus(raw) === '终止';
}

const CHANGE_NOTIFY_EXCLUDED_STATUS_KEYWORDS = ['终止', '实施成功', '关闭'];

function isChangeNotificationStatusVisible(value) {
  const normalizedStatus = normalizeChangeStatus(value);
  const searchableStatus = `${value ?? ''} ${normalizedStatus}`.trim();
  return !CHANGE_NOTIFY_EXCLUDED_STATUS_KEYWORDS.some((keyword) => searchableStatus.includes(keyword));
}

function isChangeBasicDataNotificationVisible(item) {
  return isChangeNotificationStatusVisible(item?.data?.status);
}

function isChangeWorkOrderNotificationVisible(item) {
  return isChangeNotificationStatusVisible(item?.status);
}

function normalizeChangeCategory(value) {
  const mapping = {
    '1': '故障解决',
    '2': '预防问题',
    '3': '升级部署',
    '4': '主动性改善',
    '5': '业务需求',
    '6': '预防维护',
    '7': '升级改善',
    '8': '外部需求',
  };
  const key = String(value || '');
  return mapping[key] || key;
}

function normalizeChangeLevel(data) {
  const leadTimeMatch = String(data?.leadTime || '').match(/(I[1-4]级)/);
  if (leadTimeMatch) return leadTimeMatch[1];

  const level = String(data?.level || data?.changeLevel || data?.change_level || '');
  const mapping = {
    '1': 'I1级',
    '2': 'I1级',
    '3': 'I1级',
    '4': 'I1级',
    '5': 'I2级',
    '6': 'I2级',
    '7': 'I2级',
    '8': 'I3级',
    '9': 'I3级',
    '10': 'I3级',
    '20': 'I2级',
    '30': 'I1级',
    '40': 'E级',
  };
  return mapping[level] || level;
}

function normalizeChangeCurrentNode(data) {
  const progressValue = String(data?.progress || '').trim();
  const statusValue = String(data?.status || '').trim();
  const explicitNode = firstFilledChangeValue(
    data?.currentNode,
    data?.current_node,
    data?.currentNodeName,
    data?.current_node_name,
    data?.nodeName,
    data?.node_name,
    data?.taskName,
    data?.task_name,
    data?.activityName,
    data?.activity_name,
  );
  const progressMap = {
    '10': '新建变更工单',
    '20': '设施经理审批',
    '30': '区域经理审批',
    '40': '技术中心专业工程师审批',
    '50': '技术中心经理审批',
    '60': '运营支撑部总经理审批',
    '61': '交付机房经理审批',
    '62': '交付高级经理审批',
    '63': '交付区域负责人审批',
    '70': '客服审核',
    '80': '撰写实施结果',
    '90': '实施后审批',
    '100': '区域经理关闭',
    '110': '流程抄送',
  };
  const closedStatusMap = {
    '3': '区域经理关闭',
    '5': '区域经理关闭',
    '8': '流程结束',
    '13': '区域经理关闭',
    '14': '区域经理关闭',
  };
  return progressMap[progressValue]
    || explicitNode
    || (!progressValue ? closedStatusMap[statusValue] : '')
    || progressValue
    || '';
}

function mapChangeBasicDataItem(item) {
  const data = item?.data || {};
  const changeTypeMap = {
    '1': '紧急变更',
    '2': '计划变更',
    '3': '计划变更',
    '4': '其他',
  };

  return {
    工单号: data.orderCode || data.order_code || String(item?.orderId || ''),
    标题: data.title || data.description || data.name || '',
    提交人: data.applicant || '',
    变更类型: changeTypeMap[data.type || data.changeType || data.change_type || ''] || data.type || '',
    变更等级: normalizeChangeLevel(data),
    变更类别: normalizeChangeCategory(data.category || data.changeCategory || data.change_category),
    当前节点: normalizeChangeCurrentNode(data),
    状态: normalizeChangeStatus(data.status),
    计划开始时间: data.planStartTime || data.plan_start_time || '',
    计划结束时间: data.planEndTime || data.plan_end_time || '',
    实际开始时间: data.implementStartTime || data.implement_start_time || data.actualStartTime || data.actual_start_time || '',
    实际结束时间: data.implementEndTime || data.implement_end_time || data.actualEndTime || data.actual_end_time || '',
    计划延时开始时间: data.planDelayStartTime || data.plan_delay_start_time || data.delayedStartTime || data.delayed_start_time || '',
    计划延时结束时间: data.planDelayEndTime || data.plan_delay_end_time || data.delayedEndTime || data.delayed_end_time || '',
  };
}

function mapChangeWorkOrder(workOrder) {
  return {
    工单号: String(workOrder?.orderCode || ''),
    标题: workOrder?.title || '',
    提交人: workOrder?.applicant || '',
    变更类型: workOrder?.changeType || '',
    变更等级: workOrder?.changeLevel || '',
    变更类别: normalizeChangeCategory(workOrder?.changeCategory),
    当前节点: workOrder?.currentNode || '',
    状态: normalizeChangeStatus(workOrder?.status),
    申请人: workOrder?.applicant || '',
    申请时间: workOrder?.applyTime || '',
    计划开始时间: workOrder?.planStartTime || '',
    计划结束时间: workOrder?.planEndTime || '',
    实际开始时间: workOrder?.actualStartTime || '',
    实际结束时间: workOrder?.actualEndTime || '',
    延迟开始时间: workOrder?.delayedStartTime || '',
    延迟结束时间: workOrder?.delayedEndTime || '',
    延迟原因: workOrder?.delayedReason || '',
  };
}

function formatChangeSyncTime(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

const CHANGE_NODE_WITHOUT_DETAILS = '区域经理关闭';

function isChangeNodeDetailVisible(node) {
  const normalizedNode = String(node || '').trim();
  return normalizedNode
    && normalizedNode !== CHANGE_NODE_WITHOUT_DETAILS
    && normalizedNode !== '流程结束'
    && normalizedNode !== '未知节点';
}

function isFilledChangeSummaryValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  const text = String(value).trim();
  return text !== '' && text !== 'null' && text !== 'undefined' && text !== '-';
}

function firstFilledChangeValue(...values) {
  return values.find((value) => isFilledChangeSummaryValue(value)) || '';
}

function formatChangeUserValue(value) {
  if (!isFilledChangeSummaryValue(value)) {
    return '';
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatChangeUserValue(item)).filter(Boolean).join('、');
  }

  if (typeof value === 'object') {
    return firstFilledChangeValue(
      value.name,
      value.userName,
      value.username,
      value.nickName,
      value.displayName,
      value.label,
      value.realName,
      value.jobNumber,
    );
  }

  const text = String(value).trim();
  return text === '[object Object]' ? '' : text;
}

function firstFilledChangeUserValue(...values) {
  for (const value of values) {
    const text = formatChangeUserValue(value);
    if (text) {
      return text;
    }
  }

  return '';
}

function getChangeOwnerText(source) {
  const data = source || {};
  return firstFilledChangeUserValue(
    data.changeOwnerName,
    data.change_owner_name,
    data.changeOwner,
    data.change_owner,
    data.changeResponsibleUserName,
    data.change_responsible_user_name,
    data.changeResponsibleUser,
    data.change_responsible_user,
    data.responsibleUserName,
    data.responsible_user_name,
    data.responsibleUser,
    data.responsible_user,
    data.responsibleName,
    data.responsible_name,
    data.responsible,
    data.ownerName,
    data.owner_name,
    data.owner,
    data.handlerName,
    data.handler_name,
    data.handler,
    data.executorName,
    data.executor_name,
    data.executor,
    data.implementerName,
    data.implementer_name,
    data.implementer,
    data.implementUserName,
    data.implement_user_name,
    data.implementUser,
    data.implement_user,
    data.applicantName,
    data.applicant_name,
    data.applicant,
    data.applyUserName,
    data.apply_user_name,
    data.applyUser,
    data.apply_user,
    data.creatorName,
    data.creator_name,
    data.creator,
    data.createBy,
    data.create_by,
    data.createdBy,
    data.created_by,
  );
}

function formatChangeDateOnly(value) {
  if (!isFilledChangeSummaryValue(value)) {
    return '--';
  }

  const text = String(value).trim();
  const match = text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/);
  if (!match) {
    return text.replace(/[T\s]\d{1,2}:\d{2}(:\d{2})?.*$/, '');
  }

  const [year, month, day] = match[0].replace(/\//g, '-').split('-');
  return `${year}-${String(Number(month)).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
}

function parseChangeDateOnly(value) {
  const dateText = formatChangeDateOnly(value);
  if (dateText === '--') {
    return null;
  }

  const timestamp = Date.parse(`${dateText}T00:00:00`);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function getChangeTodayStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function diffChangeDays(targetDate, baseDate = new Date()) {
  if (!(targetDate instanceof Date) || Number.isNaN(targetDate.getTime())) {
    return null;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round((targetDate.getTime() - getChangeTodayStart(baseDate).getTime()) / dayMs);
}

const CHANGE_ALERT_LEVEL_IMPORTANT = 'important';
const CHANGE_ALERT_LEVEL_TIP = 'tip';

function createChangeAlert(level, text) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) {
    return null;
  }

  return {
    level: level === CHANGE_ALERT_LEVEL_IMPORTANT ? CHANGE_ALERT_LEVEL_IMPORTANT : CHANGE_ALERT_LEVEL_TIP,
    text: normalizedText,
  };
}

function normalizeChangeAlert(alert) {
  if (alert && typeof alert === 'object') {
    return createChangeAlert(alert.level, alert.text || alert.message || alert.label);
  }

  const rawText = String(alert || '').trim();
  if (!rawText) {
    return null;
  }

  const important = rawText.includes('【紧急】') || rawText.includes('【重要】') || rawText.includes('客服审核');
  const text = rawText
    .replace(/^【紧急】/, '')
    .replace(/^【重要】/, '')
    .replace(/^【重点】/, '')
    .replace(/^【提示】/, '')
    .trim();
  return createChangeAlert(important ? CHANGE_ALERT_LEVEL_IMPORTANT : CHANGE_ALERT_LEVEL_TIP, text);
}

function hasImportantChangeAlert(alerts) {
  return (Array.isArray(alerts) ? alerts : [])
    .map(normalizeChangeAlert)
    .some((alert) => alert && alert.level === CHANGE_ALERT_LEVEL_IMPORTANT);
}

function escapeFeishuCardMarkdown(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '＜')
    .replace(/>/g, '＞');
}

function formatChangeAlertBadge(level, rich = false) {
  const important = level === CHANGE_ALERT_LEVEL_IMPORTANT;
  if (!rich) {
    return important ? '【重要】' : '【提示】';
  }

  return important
    ? '<font color="red">**重要**</font>'
    : '<font color="yellow">**提示**</font>';
}

function buildChangeTimingAlerts({
  delayedEnd,
  actualEnd,
  planEnd,
}, now = new Date()) {
  const alerts = [];
  if (isFilledChangeSummaryValue(actualEnd)) {
    return alerts;
  }

  const hasDelay = isFilledChangeSummaryValue(delayedEnd);
  const deadlineLabel = hasDelay ? '延迟结束' : '计划结束';
  const deadlineDate = parseChangeDateOnly(hasDelay ? delayedEnd : planEnd);
  const days = diffChangeDays(deadlineDate, now);

  if (days === null || days > 3) {
    return alerts;
  }

  if (days < 0) {
    alerts.push(createChangeAlert(CHANGE_ALERT_LEVEL_IMPORTANT, `${deadlineLabel}已超期 ${Math.abs(days)} 天，请立即关注`));
  } else if (days === 0) {
    alerts.push(createChangeAlert(CHANGE_ALERT_LEVEL_IMPORTANT, `${deadlineLabel}今天到期，请立即关注`));
  } else if (days <= 1) {
    alerts.push(createChangeAlert(CHANGE_ALERT_LEVEL_IMPORTANT, `${deadlineLabel}还剩 ${days} 天，请立即关注`));
  } else {
    alerts.push(createChangeAlert(CHANGE_ALERT_LEVEL_TIP, `${deadlineLabel}还剩 ${days} 天，请关注`));
  }

  return alerts;
}

function formatChangeOrderTimeText({
  delayedStart,
  delayedEnd,
  actualStart,
  actualEnd,
  planStart,
  planEnd,
}) {
  if (isFilledChangeSummaryValue(delayedStart) || isFilledChangeSummaryValue(delayedEnd)) {
    return `延迟 ${formatChangeDateOnly(delayedStart)} 至 ${formatChangeDateOnly(delayedEnd)}；实际 ${formatChangeDateOnly(actualStart)} 至 ${formatChangeDateOnly(actualEnd)}`;
  }

  return `计划 ${formatChangeDateOnly(planStart)} 至 ${formatChangeDateOnly(planEnd)}`;
}

function formatChangeNodeDetailSummary(items) {
  const grouped = new Map();

  items.forEach((item) => {
    const node = String(item.node || '').trim() || '未知节点';
    if (!isChangeNodeDetailVisible(node)) {
      return;
    }

    const existing = grouped.get(node) || [];
    existing.push(item);
    grouped.set(node, existing);
  });

  return Array.from(grouped.entries())
    .map(([node, details]) => [
      `${node} ${details.length}：`,
      ...details.map((detail, index) => `${index + 1}. ${detail.detail}`),
    ].join('\n'))
    .join('\n');
}

function formatChangeFocusSummary(items, options = {}) {
  const rich = Boolean(options.rich);
  const focusMap = new Map();

  items.forEach((item) => {
    const alerts = (Array.isArray(item.alerts) ? item.alerts : [])
      .map(normalizeChangeAlert)
      .filter(Boolean);
    if (alerts.length === 0) {
      return;
    }

    const title = item.title || '未命名工单';
    const owner = item.owner || '--';
    const key = `${title}__${owner}`;
    const existing = focusMap.get(key) || {
      title,
      owner,
      alerts: [],
    };

    alerts.forEach((alert) => {
      const exists = existing.alerts.some((it) => it.level === alert.level && it.text === alert.text);
      if (!exists) {
        existing.alerts.push(alert);
      }
    });
    focusMap.set(key, existing);
  });

  const focusItems = Array.from(focusMap.values());
  if (focusItems.length === 0) {
    return '';
  }

  return focusItems
    .map((item, index) => {
      const important = hasImportantChangeAlert(item.alerts);
      const level = important ? CHANGE_ALERT_LEVEL_IMPORTANT : CHANGE_ALERT_LEVEL_TIP;
      const title = rich ? `**${escapeFeishuCardMarkdown(item.title)}**` : item.title;
      const owner = rich ? escapeFeishuCardMarkdown(item.owner || '--') : (item.owner || '--');
      const alerts = item.alerts
        .sort((left, right) => {
          if (left.level === right.level) {
            return 0;
          }

          return left.level === CHANGE_ALERT_LEVEL_IMPORTANT ? -1 : 1;
        })
        .map((alert) => (rich ? escapeFeishuCardMarkdown(alert.text) : alert.text))
        .join('；');
      return `${index + 1}. ${formatChangeAlertBadge(level, rich)} ${title}（负责人：${owner}）：${alerts}`;
    })
    .join('\n');
}

function getChangeBasicDataNodeDetail(item) {
  const data = item?.data || {};
  const node = normalizeChangeCurrentNode(data) || '未知节点';
  const title = firstFilledChangeValue(data.title, data.description, data.name, '未命名工单');
  const owner = getChangeOwnerText(data);
  const delayedStart = firstFilledChangeValue(data.planDelayStartTime, data.plan_delay_start_time, data.delayedStartTime, data.delayed_start_time);
  const delayedEnd = firstFilledChangeValue(data.planDelayEndTime, data.plan_delay_end_time, data.delayedEndTime, data.delayed_end_time);
  const actualStart = firstFilledChangeValue(data.implementStartTime, data.implement_start_time, data.actualStartTime, data.actual_start_time);
  const actualEnd = firstFilledChangeValue(data.implementEndTime, data.implement_end_time, data.actualEndTime, data.actual_end_time);
  const planStart = firstFilledChangeValue(data.planStartTime, data.plan_start_time);
  const planEnd = firstFilledChangeValue(data.planEndTime, data.plan_end_time);
  const timeText = formatChangeOrderTimeText({
    delayedStart,
    delayedEnd,
    actualStart,
    actualEnd,
    planStart,
    planEnd,
  });
  const alerts = buildChangeTimingAlerts({
    delayedEnd,
    actualEnd,
    planEnd,
  });
  if (node.includes('客服审核')) {
    alerts.unshift(createChangeAlert(CHANGE_ALERT_LEVEL_IMPORTANT, '客服审核节点，请及时处理'));
  }

  return {
    node,
    title,
    owner,
    detail: `${title}：${timeText}`,
    alerts,
  };
}

function getChangeWorkOrderNodeDetail(item) {
  const node = String(item?.currentNode || '').trim() || '未知节点';
  const title = firstFilledChangeValue(item?.title, '未命名工单');
  const owner = getChangeOwnerText(item);
  const delayedStart = firstFilledChangeValue(item?.delayedStartTime);
  const delayedEnd = firstFilledChangeValue(item?.delayedEndTime);
  const actualStart = firstFilledChangeValue(item?.actualStartTime);
  const actualEnd = firstFilledChangeValue(item?.actualEndTime);
  const planStart = firstFilledChangeValue(item?.planStartTime);
  const planEnd = firstFilledChangeValue(item?.planEndTime);
  const timeText = formatChangeOrderTimeText({
    delayedStart,
    delayedEnd,
    actualStart,
    actualEnd,
    planStart,
    planEnd,
  });
  const alerts = buildChangeTimingAlerts({
    delayedEnd,
    actualEnd,
    planEnd,
  });
  if (node.includes('客服审核')) {
    alerts.unshift(createChangeAlert(CHANGE_ALERT_LEVEL_IMPORTANT, '客服审核节点，请及时处理'));
  }

  return {
    node,
    title,
    owner,
    detail: `${title}：${timeText}`,
    alerts,
  };
}

function incrementCounter(counter, key) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return;
  }

  counter.set(normalizedKey, (counter.get(normalizedKey) || 0) + 1);
}

function formatCounterSummary(counter, limit = 3) {
  const entries = Array.from(counter.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }

      return a[0].localeCompare(b[0], 'zh-CN');
    });
  const maxItems = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : entries.length;

  return entries.slice(0, maxItems).map(([label, count]) => `${label} ${count}`).join('、');
}

function formatRiskSyncTime(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function normalizeRiskBuildingLabel(rawValue) {
  const text = String(rawValue || '').trim().replace(/\s+/g, '');
  if (!text) {
    return '';
  }

  const normalized = text
    .replace(/^南通/i, '')
    .replace(/栋/g, '楼')
    .replace(/座/g, '楼');
  const match = normalized.match(/([A-E])/i);

  if (match) {
    return `${match[1].toUpperCase()}楼`;
  }

  return normalized;
}

function isFilledRiskSummaryValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  const text = String(value).trim();
  return text !== '' && text !== 'null' && text !== 'undefined' && text !== '-';
}

function formatCompletionRate(completed, total) {
  if (!Number.isFinite(total) || total <= 0) {
    return '0.0%';
  }

  return `${((completed / total) * 100).toFixed(1)}%`;
}

function getOrderedBuildingEntries(statsMap) {
  const sortOrder = new Map(RISK_BUILDING_SUMMARY_ORDER.map((label, index) => [label, index]));
  return Array.from(statsMap.entries())
    .sort((a, b) => {
      const leftOrder = sortOrder.has(a[0]) ? sortOrder.get(a[0]) : Number.MAX_SAFE_INTEGER;
      const rightOrder = sortOrder.has(b[0]) ? sortOrder.get(b[0]) : Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return a[0].localeCompare(b[0], 'zh-CN');
    });
}

function formatRiskBuildingProgressSummary(statsMap) {
  return getOrderedBuildingEntries(statsMap)
    .map(([label, stats]) => (
      `${label}：共计 ${stats.total} 条，排查完成率 ${formatCompletionRate(stats.checkCompleted, stats.total)}，审核完成率 ${formatCompletionRate(stats.auditCompleted, stats.total)}`
    ))
    .join('\n');
}

function isNoRiskStatusLabel(value) {
  const text = String(value || '').trim();
  return !text || ['无', '否', '无风险', '暂无', '正常', '0'].includes(text);
}

function getRiskActiveCount(currentStatusCounter) {
  return Array.from(currentStatusCounter.entries())
    .filter(([label]) => !isNoRiskStatusLabel(label))
    .reduce((sum, [, count]) => sum + Number(count || 0), 0);
}

function formatRiskNotificationTips(buildingStatsMap, rich = false) {
  const tips = [];

  getOrderedBuildingEntries(buildingStatsMap).forEach(([label, stats]) => {
    if (!stats || Number(stats.total || 0) <= 0) {
      return;
    }

    if (stats.checkCompleted >= stats.total && stats.auditCompleted >= stats.total) {
      return;
    }

    tips.push({
      level: CHANGE_ALERT_LEVEL_TIP,
      text: `${label}未完成：排查完成率 ${formatCompletionRate(stats.checkCompleted, stats.total)}，审核完成率 ${formatCompletionRate(stats.auditCompleted, stats.total)}`,
    });
  });

  return tips
    .map((tip, index) => {
      const text = rich ? escapeFeishuCardMarkdown(tip.text) : tip.text;
      return `${index + 1}. ${formatChangeAlertBadge(tip.level, rich)} ${text}`;
    })
    .join('\n');
}

function buildSyncCardMessage({
  title,
  template = 'blue',
  fallbackLines,
  overviewLines,
  sections,
}) {
  const elements = [
    {
      tag: 'markdown',
      content: (overviewLines || []).filter(Boolean).join('\n'),
    },
  ];

  (sections || []).forEach((section) => {
    if (!section?.content) {
      return;
    }

    elements.push(
      { tag: 'hr' },
      {
        tag: 'markdown',
        content: `**${section.title}**\n${section.content}`,
      },
    );
  });

  return {
    type: 'interactive',
    fallbackText: (fallbackLines || []).filter(Boolean).join('\n'),
    card: {
      config: {
        wide_screen_mode: true,
        enable_forward: true,
      },
      header: {
        template,
        title: {
          tag: 'plain_text',
          content: title,
        },
      },
      elements,
    },
  };
}

function buildRiskSyncSummary(records) {
  const items = (Array.isArray(records) ? records : [])
    .filter((record) => record && typeof record === 'object' && record.fields && typeof record.fields === 'object');
  const levelCounter = new Map();
  const checkStatusCounter = new Map();
  const currentStatusCounter = new Map();
  const buildingStatsMap = new Map();

  items.forEach((record) => {
    const fields = record.fields || {};
    const buildingLabel = normalizeRiskBuildingLabel(fields[RISK_FIELD_BUILDING]) || '未识别楼栋';
    incrementCounter(levelCounter, fields[RISK_FIELD_LEVEL]);
    incrementCounter(checkStatusCounter, fields[RISK_FIELD_CHECK_STATUS]);
    incrementCounter(currentStatusCounter, fields[RISK_FIELD_CURRENT_STATUS]);

    const stats = buildingStatsMap.get(buildingLabel) || {
      total: 0,
      checkCompleted: 0,
      auditCompleted: 0,
    };
    stats.total += 1;
    if (isFilledRiskSummaryValue(fields[RISK_FIELD_CHECK_TIME])) {
      stats.checkCompleted += 1;
    }
    if (isFilledRiskSummaryValue(fields[RISK_FIELD_AUDIT_TIME])) {
      stats.auditCompleted += 1;
    }
    buildingStatsMap.set(buildingLabel, stats);
  });

  const buildingProgressSummary = formatRiskBuildingProgressSummary(buildingStatsMap);
  const levelSummary = formatCounterSummary(levelCounter, 0);
  const checkStatusSummary = formatCounterSummary(checkStatusCounter, 0);
  const currentStatusSummary = formatCounterSummary(currentStatusCounter, 0);
  const riskTipsSummary = formatRiskNotificationTips(buildingStatsMap);
  const riskTipsCardSummary = formatRiskNotificationTips(buildingStatsMap, true);
  const syncTime = formatRiskSyncTime();
  const distributionLine = [
    levelSummary ? `风险等级 ${levelSummary}` : '',
    checkStatusSummary ? `排查状态 ${checkStatusSummary}` : '',
    currentStatusSummary ? `当前风险 ${currentStatusSummary}` : '',
  ].filter(Boolean).join('；');

  return {
    notifyMessage: buildSyncCardMessage({
      title: '风险排查同步',
      template: getRiskActiveCount(currentStatusCounter) > 0 ? 'red' : 'green',
      fallbackLines: [
        '【风险排查同步】',
        `同步时间：${syncTime}`,
        `覆盖记录：${items.length} 条`,
        distributionLine ? `分布概览：${distributionLine}` : '',
        riskTipsSummary ? `提示：\n${riskTipsSummary}` : '',
        buildingProgressSummary ? `楼栋进度：\n${buildingProgressSummary}` : '',
      ],
      overviewLines: [
        `**同步时间**：${escapeFeishuCardMarkdown(syncTime)}`,
        `**覆盖记录**：${items.length} 条`,
        distributionLine ? `**分布概览**：${escapeFeishuCardMarkdown(distributionLine)}` : '',
      ],
      sections: [
        { title: '提示', content: riskTipsCardSummary },
        { title: '楼栋进度', content: escapeFeishuCardMarkdown(buildingProgressSummary) },
      ],
    }),
    successMessage: ({ insertedCount }) => {
      const parts = [`已清空旧数据并覆盖同步 ${insertedCount} 条风险排查记录到飞书多维表`];
      if (buildingProgressSummary) parts.push(`楼栋进度：${buildingProgressSummary.replace(/\n/g, '；')}`);
      if (levelSummary) parts.push(`等级：${levelSummary}`);
      if (checkStatusSummary) parts.push(`排查：${checkStatusSummary}`);
      if (currentStatusSummary) parts.push(`当前风险：${currentStatusSummary}`);
      return parts.join('；');
    },
  };
}

function buildChangeNotificationMessage({
  title,
  syncTime,
  notifyCount,
  notifyCountLabel = '筛选记录',
  conditionText = '状态不包含 终止 / 实施成功 / 关闭',
  statusSummary,
  levelSummary,
  nodeLabel = '节点',
  nodeSummary,
  focusSummary,
  focusCardSummary,
  nodeDetailSummary,
  detailSections,
  hasImportant,
  linkText,
  linkUrl,
}) {
  const distributionLine = [
    statusSummary ? `状态 ${statusSummary}` : '',
    levelSummary ? `等级 ${levelSummary}` : '',
    nodeSummary ? `${nodeLabel} ${nodeSummary}` : '',
  ].filter(Boolean).join('；');
  const fallbackText = [
    `【${title}】`,
    `同步时间：${syncTime}`,
    `${notifyCountLabel}：${notifyCount} 条`,
    conditionText ? `筛选条件：${conditionText}` : '',
    linkUrl ? `${linkText || '链接'}：${linkUrl}` : '',
    distributionLine,
    focusSummary ? `提示：\n${focusSummary}` : '',
    nodeDetailSummary ? `明细：\n${nodeDetailSummary}` : '',
    ...(Array.isArray(detailSections)
      ? detailSections
        .filter((section) => section?.content)
        .map((section) => `${section.title}：\n${section.content}`)
      : []),
  ].filter(Boolean).join('\n');
  const overviewLines = [
    `**同步时间**：${escapeFeishuCardMarkdown(syncTime)}`,
    `**${escapeFeishuCardMarkdown(notifyCountLabel)}**：${notifyCount} 条`,
    conditionText ? `**筛选条件**：${escapeFeishuCardMarkdown(conditionText)}` : '',
    linkUrl ? `**${escapeFeishuCardMarkdown(linkText || '链接')}**：[打开](${linkUrl})` : '',
    distributionLine ? `**分布概览**：${escapeFeishuCardMarkdown(distributionLine)}` : '',
  ].filter(Boolean);
  const elements = [
    {
      tag: 'markdown',
      content: overviewLines.join('\n'),
    },
  ];

  if (focusCardSummary) {
    elements.push(
      { tag: 'hr' },
      {
        tag: 'markdown',
        content: `**提示**\n${focusCardSummary}`,
      },
    );
  }

  if (nodeDetailSummary) {
    elements.push(
      { tag: 'hr' },
      {
        tag: 'markdown',
        content: `**明细**\n${escapeFeishuCardMarkdown(nodeDetailSummary)}`,
      },
    );
  }

  (Array.isArray(detailSections) ? detailSections : []).forEach((section) => {
    if (!section?.content) {
      return;
    }
    elements.push(
      { tag: 'hr' },
      {
        tag: 'markdown',
        content: `**${escapeFeishuCardMarkdown(section.title || '明细')}**\n${escapeFeishuCardMarkdown(section.content)}`,
      },
    );
  });

  return {
    type: 'interactive',
    fallbackText,
    card: {
      config: {
        wide_screen_mode: true,
        enable_forward: true,
      },
      header: {
        template: hasImportant ? 'red' : (focusCardSummary ? 'yellow' : 'blue'),
        title: {
          tag: 'plain_text',
          content: title,
        },
      },
      elements,
    },
  };
}

function buildChangeBasicDataSyncSummary(basicDataList) {
  const syncableItems = (Array.isArray(basicDataList) ? basicDataList : []).filter((item) => item && item.data && typeof item.data === 'object' && !item.data.error);
  const notifyItems = syncableItems.filter(isChangeBasicDataNotificationVisible);
  const statusCounter = new Map();
  const levelCounter = new Map();
  const nodeCounter = new Map();
  const nodeDetails = [];

  notifyItems.forEach((item) => {
    const data = item.data || {};
    incrementCounter(statusCounter, normalizeChangeStatus(data.status) || '未知状态');
    incrementCounter(levelCounter, normalizeChangeLevel(data) || '未分级');
    const detail = getChangeBasicDataNodeDetail(item);
    incrementCounter(nodeCounter, detail.node || '未知节点');
    nodeDetails.push(detail);
  });

  const statusSummary = formatCounterSummary(statusCounter, 0);
  const levelSummary = formatCounterSummary(levelCounter, 0);
  const nodeSummary = formatCounterSummary(nodeCounter, 0);
  const syncTime = formatChangeSyncTime();
  const focusSummary = formatChangeFocusSummary(nodeDetails);
  const focusCardSummary = formatChangeFocusSummary(nodeDetails, { rich: true });
  const nodeDetailSummary = formatChangeNodeDetailSummary(nodeDetails);
  const hasImportant = nodeDetails.some((detail) => hasImportantChangeAlert(detail.alerts));

  return {
    total: syncableItems.length,
    hasImportant,
    notifyMessage: buildChangeNotificationMessage({
      title: '变更工单同步',
      syncTime,
      notifyCount: notifyItems.length,
      statusSummary,
      levelSummary,
      nodeSummary,
      focusSummary,
      focusCardSummary,
      nodeDetailSummary,
      hasImportant,
    }),
    successMessage: ({ insertedCount }) => {
      const parts = [`已清空旧数据并覆盖同步 ${insertedCount} 条变更工单到飞书多维表`];
      parts.push(`提醒筛选 ${notifyItems.length} 条`);
      if (statusSummary) parts.push(`筛选状态：${statusSummary}`);
      if (levelSummary) parts.push(`等级：${levelSummary}`);
      if (nodeSummary) parts.push(`节点：${nodeSummary}`);
      if (focusSummary) parts.push(`提示：${focusSummary.replace(/\n/g, '；')}`);
      if (nodeDetailSummary) parts.push(`节点明细：${nodeDetailSummary.replace(/\n/g, '；')}`);
      return parts.join('；');
    },
  };
}

function buildChangeWorkOrderSyncSummary(workOrders) {
  const items = Array.isArray(workOrders) ? workOrders : [];
  const notifyItems = items.filter(isChangeWorkOrderNotificationVisible);
  const statusCounter = new Map();
  const levelCounter = new Map();
  const nodeCounter = new Map();
  const nodeDetails = [];

  notifyItems.forEach((item) => {
    incrementCounter(statusCounter, normalizeChangeStatus(item?.status) || '未知状态');
    incrementCounter(levelCounter, item?.changeLevel || '未分级');
    const detail = getChangeWorkOrderNodeDetail(item);
    incrementCounter(nodeCounter, detail.node || '未知节点');
    nodeDetails.push(detail);
  });

  const statusSummary = formatCounterSummary(statusCounter, 0);
  const levelSummary = formatCounterSummary(levelCounter, 0);
  const nodeSummary = formatCounterSummary(nodeCounter, 0);
  const syncTime = formatChangeSyncTime();
  const focusSummary = formatChangeFocusSummary(nodeDetails);
  const focusCardSummary = formatChangeFocusSummary(nodeDetails, { rich: true });
  const nodeDetailSummary = formatChangeNodeDetailSummary(nodeDetails);
  const hasImportant = nodeDetails.some((detail) => hasImportantChangeAlert(detail.alerts));

  return {
    total: items.length,
    hasImportant,
    notifyMessage: buildChangeNotificationMessage({
      title: '变更工单列表同步',
      syncTime,
      notifyCount: notifyItems.length,
      statusSummary,
      levelSummary,
      nodeSummary,
      focusSummary,
      focusCardSummary,
      nodeDetailSummary,
      hasImportant,
    }),
    successMessage: ({ insertedCount }) => {
      const parts = [`已清空旧数据并覆盖同步 ${insertedCount} 条变更工单列表到飞书多维表`];
      parts.push(`提醒筛选 ${notifyItems.length} 条`);
      if (statusSummary) parts.push(`筛选状态：${statusSummary}`);
      if (levelSummary) parts.push(`等级：${levelSummary}`);
      if (nodeSummary) parts.push(`节点：${nodeSummary}`);
      if (focusSummary) parts.push(`提示：${focusSummary.replace(/\n/g, '；')}`);
      if (nodeDetailSummary) parts.push(`节点明细：${nodeDetailSummary.replace(/\n/g, '；')}`);
      return parts.join('；');
    },
  };
}

function normalizeDrillCategory(value) {
  const mapping = {
    plan: '计划演练',
    surpriseAttack: '突袭演练',
    surpriseAttackPlan: '突袭演练-计划性',
  };
  const key = String(value || '');
  return mapping[key] || key;
}

function normalizeDrillExerciseType(value) {
  const mapping = {
    run: '跑位演练',
  };
  const key = String(value || '').trim();
  return mapping[key] || key;
}

function normalizeDrillExerciseCycle(value) {
  const mapping = {
    annual: '年度',
    yearly: '年度',
    year: '年度',
    quarter: '季度',
    quarterly: '季度',
    month: '月度',
    monthly: '月度',
    halfYear: '半年度',
    halfYearly: '半年度',
    semiannual: '半年度',
    semiAnnual: '半年度',
  };
  const key = String(value || '').trim();
  return mapping[key] || key;
}

function normalizeDrillBuildingLetter(value) {
  const normalized = String(value || '').trim().toUpperCase();
  const fullWidthMap = {
    Ａ: 'A',
    Ｂ: 'B',
    Ｃ: 'C',
    Ｄ: 'D',
    Ｅ: 'E',
  };
  return fullWidthMap[normalized] || normalized;
}

const DRILL_DOMAIN_BUILDING_LABEL_MAP = {
  5: 'A楼',
  6: 'B楼',
  7: 'C楼',
  8: 'D楼',
  9: 'E楼',
};

function getDrillBuildingLabelFromDomainCode(value) {
  const match = String(value || '').trim().match(/^([5-9])(?:\.|$)/);
  return match ? (DRILL_DOMAIN_BUILDING_LABEL_MAP[match[1]] || '') : '';
}

function getDrillBuildingLabel(value) {
  const letter = normalizeDrillBuildingLetter(value);
  return /^[A-E]$/.test(letter) ? `${letter}楼` : '';
}

function collectDrillImplementationAreaLabels(values) {
  const labels = [];
  const seen = new Set();
  const patterns = [
    /数据中心[\s_/-]*([A-EＡ-Ｅ])(?:楼|栋)?/gi,
    /中心[\s_/-]*([A-EＡ-Ｅ])(?:楼|栋)?/gi,
    /([A-EＡ-Ｅ])(?:楼|栋)/gi,
    /(?:^|[_/\s-])([A-EＡ-Ｅ])(?:$|[^\w])/gi,
  ];

  const pushLabel = (label) => {
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  };

  const scan = (value) => {
    if (value == null || value === '') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(scan);
      return;
    }
    if (typeof value === 'object') {
      [
        value.datacenterName,
        value.datacenterCode,
        value.dcName,
        value.dcCode,
        value.buildingName,
        value.buildingCode,
        value.name,
        value.label,
        value.value,
      ].forEach(scan);
      return;
    }

    const text = String(value || '').trim();
    if (!text) {
      return;
    }
    const domainLabel = getDrillBuildingLabelFromDomainCode(text);
    if (domainLabel) {
      pushLabel(domainLabel);
      return;
    }

    const directLabel = getDrillBuildingLabel(text);
    if (directLabel) {
      pushLabel(directLabel);
      return;
    }

    text
      .split(/[、,，;；|]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        const label = getDrillBuildingLabel(part);
        if (label) {
          pushLabel(label);
        }
      });

    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        pushLabel(getDrillBuildingLabel(match[1]));
      }
    }
  };

  values.forEach(scan);
  return labels;
}

function normalizeDrillImplementationArea(item) {
  const source = item || {};
  const values = [source.implementationAreaStr, source.implementationArea, source.dcCode, source.domainCode];
  if (Array.isArray(source.exerciseObjectList)) {
    source.exerciseObjectList.forEach((exerciseObject) => {
      values.push(exerciseObject?.datacenterName, exerciseObject?.datacenterCode);
    });
  }

  const labels = collectDrillImplementationAreaLabels(values);
  if (labels.length > 0) {
    return labels.join('、');
  }

  const rawArea = Array.isArray(source.implementationArea) ? source.implementationArea.join('、') : '';
  return String(source.implementationAreaStr || rawArea || '');
}

function normalizeDrillExecuteStatus(value) {
  const mapping = {
    NOT_EXECUTED: '未执行',
    EXECUTING: '执行中',
    EXECUTED: '已执行',
    COMPLETED: '已完成',
  };
  const key = String(value || '');
  return mapping[key] || key;
}

function normalizeDrillApprovalStatus(value) {
  const mapping = {
    NOAPPROVAL: '未审批',
    APPROVING: '审批中',
    COMPLETED: '审批完成',
    REJECTED: '已驳回',
  };
  const key = String(value || '');
  return mapping[key] || key;
}

function normalizeDrillOrderStatus(value) {
  const mapping = {
    '5': '待评估',
    '11': '完成',
    '12': '评估待审批',
    '13': '终止',
  };
  const key = String(value ?? '').trim();
  return key ? (mapping[key] || key) : '待演练';
}

function formatDrillUsers(users) {
  if (!Array.isArray(users) || users.length === 0) {
    return '';
  }

  return users.map((user) => user?.name || user?.jobNumber).filter(Boolean).join('、');
}

function formatDrillRelatedEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return '';
  }

  return events
    .map((event) => [event?.eventNumber, event?.title, event?.orderStatus ? `状态${event.orderStatus}` : ''].filter(Boolean).join(' / '))
    .join('\n');
}

const DRILL_EVALUATION_SCORE_FIELDS = [
  'drillEvaluationScore',
  'evaluationScore',
  'evaluateScore',
  'assessmentScore',
  'eventScore',
  'score',
  'totalScore',
  'finalScore',
  'realScore',
  'actualScore',
  'scoreResult',
  'gradeScore',
  'fraction',
];

const DRILL_EVALUATION_DETAIL_SCORE_FIELDS = [
  'totalScore',
  'finalScore',
  'actualTotalScore',
  'evaluationTotalScore',
  'drillEvaluationScore',
  'evaluationScore',
  'score',
];

function normalizeScoreText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return '';
    }
    return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, '').replace(/\.$/, '');
  }

  const text = String(value).trim();
  return text === 'null' || text === 'undefined' ? '' : text;
}

function getFirstTextFromFields(source, fieldNames) {
  if (!source || typeof source !== 'object') {
    return '';
  }

  for (const fieldName of fieldNames) {
    const text = normalizeScoreText(source[fieldName]);
    if (text) {
      return text;
    }
  }

  return '';
}

function getDrillEvaluationDetailData(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (payload.data && typeof payload.data === 'object') {
    return payload.data;
  }

  return payload;
}

function sumDrillEvaluationActualScores(items) {
  let total = 0;
  let count = 0;

  const visit = (value) => {
    if (!value || typeof value !== 'object') {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'actualScore')) {
      const numericScore = Number(value.actualScore);
      if (Number.isFinite(numericScore)) {
        total += numericScore;
        count += 1;
      }
    }

    [
      'exerciseEvaluationDetailDtoList',
      'children',
      'childrenList',
      'detailList',
    ].forEach((fieldName) => {
      if (Array.isArray(value[fieldName])) {
        visit(value[fieldName]);
      }
    });
  };

  visit(items);
  return count > 0 ? total : null;
}

function getDrillEvaluationDetailScore(detailPayload) {
  const detailData = getDrillEvaluationDetailData(detailPayload);
  if (!detailData || typeof detailData !== 'object') {
    return '';
  }

  const directScore = getFirstTextFromFields(detailData, DRILL_EVALUATION_DETAIL_SCORE_FIELDS);
  if (directScore) {
    return directScore;
  }

  const contentList = Array.isArray(detailData.exerciseEvaluationContentDtoList)
    ? detailData.exerciseEvaluationContentDtoList
    : Array.isArray(detailData.evaluationContentList)
      ? detailData.evaluationContentList
      : [];
  const summedScore = sumDrillEvaluationActualScores(contentList);
  return summedScore === null ? '' : normalizeScoreText(summedScore);
}

function getDrillEvaluationEventScore(event) {
  return (
    getFirstTextFromFields(event, DRILL_EVALUATION_SCORE_FIELDS)
    || getDrillEvaluationDetailScore(event?.evaluationDetail)
    || getDrillEvaluationDetailScore(event?.evaluationDetailPayload)
  );
}

function getDrillEvaluationScore(record) {
  const score = getFirstTextFromFields(record, DRILL_EVALUATION_SCORE_FIELDS)
    || getDrillEvaluationDetailScore(record?.evaluationDetail);
  if (score) {
    return score;
  }

  const events = Array.isArray(record?.evaluationEventList) ? record.evaluationEventList : [];
  const eventWithScore = events.find((event) => getDrillEvaluationEventScore(event));
  return getDrillEvaluationEventScore(eventWithScore);
}

function getDrillEvaluationEventTime(event) {
  const rawTime = event?.updateTime || event?.creatTime || '';
  const timestamp = rawTime ? new Date(String(rawTime).replace(/-/g, '/')).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getPrimaryDrillEvaluationEvent(record) {
  const events = Array.isArray(record?.evaluationEventList) ? record.evaluationEventList : [];
  return events.find((event) => getDrillEvaluationEventScore(event)) || events[0] || null;
}

function formatDrillEvaluationEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return '';
  }

  return events
    .map((event) => [event?.eventNumber, event?.eventTitle || event?.highestLevelTitle].filter(Boolean).join(' / '))
    .filter(Boolean)
    .join('\n');
}

function getDrillEvaluationLevelText(event) {
  return String(event?.eventCurrentLevelName || event?.eventHighestLevelName || event?.eventFirstLevelName || '');
}

function buildDrillEvaluationEventMap(events) {
  const eventMap = new Map();

  const addEvent = (key, event) => {
    const normalizedKey = String(key ?? '').trim();
    if (!normalizedKey) return;
    const list = eventMap.get(normalizedKey) || [];
    list.push(event);
    eventMap.set(normalizedKey, list);
  };

  (Array.isArray(events) ? events : []).forEach((event) => {
    addEvent(event?.drillId, event);
    addEvent(event?.eventNumber, event);
  });

  return eventMap;
}

function getDrillPlanEvaluationKeys(record) {
  const keys = new Set();
  const id = String(record?.id ?? '').trim();
  if (id) {
    keys.add(`plan_id_${id}`);
  }

  (Array.isArray(record?.relatedEventList) ? record.relatedEventList : []).forEach((event) => {
    const eventNumber = String(event?.eventNumber ?? '').trim();
    if (eventNumber) {
      keys.add(eventNumber);
    }
  });

  return Array.from(keys);
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function getRelatedEventForDrillEvaluation(record, event) {
  const relatedEvents = Array.isArray(record?.relatedEventList) ? record.relatedEventList : [];
  const eventNumber = String(event?.eventNumber || '').trim();
  const eventId = String(event?.eventId || event?.id || '').trim();

  return relatedEvents.find((relatedEvent) => {
    const relatedNumber = String(relatedEvent?.eventNumber || '').trim();
    const relatedId = String(relatedEvent?.id || relatedEvent?.eventId || '').trim();
    return (eventNumber && relatedNumber === eventNumber) || (eventId && relatedId === eventId);
  }) || null;
}

function getDrillEvaluationDetailEndTime(record, event, relatedEvent) {
  return firstNonEmptyText(
    event?.endTime,
    event?.incidentRecoveryTime,
    event?.endIncidentRecoveryDate,
    event?.endResponseDate,
    event?.finishTime,
    event?.closeTime,
    event?.updateTime,
    relatedEvent?.endTime,
    relatedEvent?.incidentRecoveryTime,
    record?.evaluationCompleteTime,
    record?.actualExerciseTime,
    record?.triggerTime,
  );
}

function buildDrillEvaluationDetailUrl(record, event) {
  if (!DRILL_EVALUATION_DETAIL_ENABLED || !event) {
    return '';
  }

  const relatedEvent = getRelatedEventForDrillEvaluation(record, event);
  const recordId = String(record?.id ?? '').trim();
  const drillId = firstNonEmptyText(event?.drillId, recordId ? `plan_id_${recordId}` : '');
  const eventId = firstNonEmptyText(event?.eventId, relatedEvent?.eventId, relatedEvent?.id, event?.id);
  const endTime = getDrillEvaluationDetailEndTime(record, event, relatedEvent);
  const jobNumber = firstNonEmptyText(event?.jobNumber, event?.creatorJobNumber, DRILL_EVALUATION_DETAIL_JOB_NUMBER);

  if (!drillId || !eventId || !endTime || !jobNumber) {
    return '';
  }

  const detailUrl = new URL(DRILL_EVALUATION_DETAIL_URL);
  detailUrl.searchParams.set('drillId', drillId);
  detailUrl.searchParams.set('endTime', endTime);
  detailUrl.searchParams.set('eventId', eventId);
  detailUrl.searchParams.set('jobNumber', jobNumber);
  return detailUrl.toString();
}

function enrichDrillRecordsWithEvaluationEvents(records, events) {
  const eventMap = buildDrillEvaluationEventMap(events);
  let matchedCount = 0;

  const enrichedRecords = (Array.isArray(records) ? records : []).map((record) => {
    const seenEvents = new Set();
    const matchedEvents = getDrillPlanEvaluationKeys(record)
      .flatMap((key) => eventMap.get(key) || [])
      .filter((event, index) => {
        const key = String(event?.id || event?.eventNumber || `${event?.drillId || ''}-${index}`);
        if (seenEvents.has(key)) {
          return false;
        }
        seenEvents.add(key);
        return true;
      })
      .sort((left, right) => getDrillEvaluationEventTime(right) - getDrillEvaluationEventTime(left));

    if (matchedEvents.length > 0) {
      matchedCount += 1;
    }
    const primaryEvent = matchedEvents.find((event) => getDrillEvaluationEventScore(event)) || matchedEvents[0];
    return {
      ...record,
      evaluationEventList: matchedEvents,
      drillEvaluationScore: getDrillEvaluationEventScore(primaryEvent),
      drillEvaluationEventNumber: primaryEvent?.eventNumber || '',
      drillEvaluationEventTitle: primaryEvent?.eventTitle || primaryEvent?.highestLevelTitle || '',
    };
  });

  return {
    records: enrichedRecords,
    matchedCount,
  };
}

async function fetchDrillEvaluationDetail(detailUrl) {
  const result = await fetchDrillPayloadInBrowser({
    url: detailUrl,
    method: 'GET',
  });
  const payload = result.data;
  if (payload?.code && payload.code !== '200') {
    throw new Error(payload?.message || `drill evaluation detail returned code ${payload.code}`);
  }
  if (payload?.success === false) {
    throw new Error(payload?.message || 'drill evaluation detail returned success=false');
  }
  return getDrillEvaluationDetailData(payload);
}

async function enrichDrillRecordsWithEvaluationDetails(records) {
  const clonedRecords = (Array.isArray(records) ? records : []).map((record) => ({
    ...record,
    evaluationEventList: Array.isArray(record?.evaluationEventList)
      ? record.evaluationEventList.map((event) => ({ ...event }))
      : record?.evaluationEventList,
  }));

  if (!DRILL_EVALUATION_DETAIL_ENABLED) {
    return {
      records: clonedRecords,
      fetched: false,
      detailFetchedCount: 0,
      detailFailedCount: 0,
      scoreMatchedCount: clonedRecords.filter((record) => getDrillEvaluationScore(record)).length,
    };
  }

  const tasksByUrl = new Map();
  clonedRecords.forEach((record) => {
    const primaryEvent = getPrimaryDrillEvaluationEvent(record);
    if (!primaryEvent || getDrillEvaluationEventScore(primaryEvent)) {
      return;
    }

    const detailUrl = buildDrillEvaluationDetailUrl(record, primaryEvent);
    if (!detailUrl) {
      return;
    }

    const task = tasksByUrl.get(detailUrl) || {
      detailUrl,
      targets: [],
    };
    task.targets.push({ event: primaryEvent });
    tasksByUrl.set(detailUrl, task);
  });

  const tasks = Array.from(tasksByUrl.values());
  if (tasks.length === 0) {
    return {
      records: clonedRecords,
      fetched: false,
      detailFetchedCount: 0,
      detailFailedCount: 0,
      scoreMatchedCount: clonedRecords.filter((record) => getDrillEvaluationScore(record)).length,
    };
  }

  const results = await runConcurrentWorkers({
    items: tasks,
    concurrency: DRILL_EVALUATION_DETAIL_CONCURRENCY,
    worker: async (task) => {
      try {
        const detailData = await fetchDrillEvaluationDetail(task.detailUrl);
        return {
          task,
          success: true,
          detailData,
          score: getDrillEvaluationDetailScore(detailData),
        };
      } catch (error) {
        return {
          task,
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  let detailFetchedCount = 0;
  let detailFailedCount = 0;
  results.forEach((result) => {
    if (!result?.success) {
      detailFailedCount += 1;
      console.warn(`[drill-auto-sync] evaluation detail failed url=${result?.task?.detailUrl || '--'} message=${result?.message || '--'}`);
      return;
    }

    detailFetchedCount += 1;
    result.task.targets.forEach(({ event }) => {
      event.evaluationDetail = result.detailData;
      if (result.score) {
        event.drillEvaluationScore = result.score;
      }
    });
  });

  clonedRecords.forEach((record) => {
    const primaryEvent = getPrimaryDrillEvaluationEvent(record);
    const score = getDrillEvaluationEventScore(primaryEvent);
    if (score) {
      record.drillEvaluationScore = score;
    }
  });

  return {
    records: clonedRecords,
    fetched: true,
    detailFetchedCount,
    detailFailedCount,
    scoreMatchedCount: clonedRecords.filter((record) => getDrillEvaluationScore(record)).length,
  };
}

function hasDrillEvaluationFetchCompleted(records) {
  return (Array.isArray(records) ? records : []).every((record) => Array.isArray(record?.evaluationEventList));
}

async function ensureDrillRecordsWithEvaluationEvents(records) {
  if (hasDrillEvaluationFetchCompleted(records)) {
    return {
      records,
      matchedCount: records.filter((record) => Array.isArray(record?.evaluationEventList) && record.evaluationEventList.length > 0).length,
      fetched: false,
    };
  }

  const evaluationEvents = await fetchDrillEvaluationEventsForAutoSync();
  const enrichedResult = enrichDrillRecordsWithEvaluationEvents(records, evaluationEvents);
  return {
    ...enrichedResult,
    fetched: true,
  };
}

function parseDrillRecordDate(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const date = new Date(text.replace(/-/g, '/'));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDrillMonthIndex(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const numericMonth = Number(text);
  if (Number.isInteger(numericMonth) && numericMonth >= 1 && numericMonth <= 12) {
    return numericMonth - 1;
  }

  const monthMap = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };
  const lowerText = text.toLowerCase();
  if (monthMap[lowerText] !== undefined) {
    return monthMap[lowerText];
  }

  const chineseMatch = text.match(/(\d{1,2})\s*月/);
  if (chineseMatch) {
    const month = Number(chineseMatch[1]);
    return Number.isInteger(month) && month >= 1 && month <= 12 ? month - 1 : null;
  }

  return null;
}

function getDrillRecordYearMonth(record) {
  const year = Number(record?.exerciseYear);
  const monthIndex = normalizeDrillMonthIndex(record?.exerciseMonth);
  if (Number.isInteger(year) && year > 1900 && monthIndex !== null) {
    return { year, monthIndex };
  }

  const dateCandidates = [
    record?.plannedExerciseTime,
    record?.plannedExerciseEndTime,
    record?.actualExerciseTime,
    record?.triggerTime,
  ];
  for (const value of dateCandidates) {
    const date = parseDrillRecordDate(value);
    if (date) {
      return {
        year: date.getFullYear(),
        monthIndex: date.getMonth(),
      };
    }
  }

  const createdDate = parseDrillRecordDate(record?.createTime);
  if (createdDate) {
    return {
      year: createdDate.getFullYear(),
      monthIndex: createdDate.getMonth(),
    };
  }

  return null;
}

function isCurrentMonthDrillRecord(record, now = new Date()) {
  const yearMonth = getDrillRecordYearMonth(record);
  return Boolean(yearMonth && yearMonth.year === now.getFullYear() && yearMonth.monthIndex === now.getMonth());
}

function isCompletedDrillRecord(record) {
  const orderStatus = String(record?.orderStatus ?? '').trim();
  return orderStatus === '11' || normalizeDrillOrderStatus(orderStatus) === '完成';
}

function isTerminatedDrillRecord(record) {
  const orderStatus = String(record?.orderStatus ?? '').trim();
  return orderStatus === '13' || normalizeDrillOrderStatus(orderStatus) === '终止';
}

function compareDrillYearMonthToDate(yearMonth, date) {
  if (!yearMonth) return 0;
  const currentIndex = date.getFullYear() * 12 + date.getMonth();
  const recordIndex = yearMonth.year * 12 + yearMonth.monthIndex;
  return recordIndex - currentIndex;
}

function isBeforeCurrentMonthDrillRecord(record, now = new Date()) {
  return compareDrillYearMonthToDate(getDrillRecordYearMonth(record), now) < 0;
}

function isDrillProgressRecord(record, now = new Date()) {
  if (isTerminatedDrillRecord(record)) return false;
  if (isCurrentMonthDrillRecord(record, now)) return true;
  return isBeforeCurrentMonthDrillRecord(record, now) && !isCompletedDrillRecord(record);
}

function isOverdueDrillProgressRecord(record, now = new Date()) {
  if (isCompletedDrillRecord(record) || isTerminatedDrillRecord(record)) return false;
  return Boolean(record?.overdue) || isBeforeCurrentMonthDrillRecord(record, now);
}

function getDrillBuildingLabels(record) {
  const normalizedArea = normalizeDrillImplementationArea(record);
  const labels = normalizedArea
    .split(/[、,，;；\s]+/)
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);

  return labels.length > 0 ? labels : ['未识别楼栋'];
}

function createDrillBuildingStats() {
  return {
    total: 0,
    monthly: 0,
    completed: 0,
    overdue: 0,
  };
}

function getOrderedDrillBuildingLabels(statsMap) {
  const sortOrder = new Map(RISK_BUILDING_SUMMARY_ORDER.map((label, index) => [label, index]));
  return [
    ...RISK_BUILDING_SUMMARY_ORDER,
    ...Array.from(statsMap.keys()).filter((label) => !sortOrder.has(label)).sort((left, right) => left.localeCompare(right, 'zh-CN')),
  ];
}

function formatDrillBuildingProgressSummary(statsMap) {
  return getOrderedDrillBuildingLabels(statsMap)
    .map((label) => {
      const stats = statsMap.get(label) || createDrillBuildingStats();
      return `${label}：本月任务 ${stats.total}，完成 ${stats.completed}，完成率 ${formatCompletionRate(stats.completed, stats.total)}，逾期 ${stats.overdue}`;
    })
    .join('\n');
}

function getCounterCount(counter, labels) {
  return (Array.isArray(labels) ? labels : [labels])
    .reduce((sum, label) => sum + Number(counter.get(label) || 0), 0);
}

function formatDrillNotificationTips({
  overdueTotal,
  pendingEvaluationCount,
  waitingCount,
}, rich = false) {
  const tips = [];
  if (overdueTotal > 0) {
    tips.push({
      level: CHANGE_ALERT_LEVEL_IMPORTANT,
      text: `本月逾期 ${overdueTotal} 项，请优先推进销项`,
    });
  }
  if (pendingEvaluationCount > 0) {
    tips.push({
      level: CHANGE_ALERT_LEVEL_TIP,
      text: `待评估/评估待审批 ${pendingEvaluationCount} 项，请跟进评估闭环`,
    });
  }
  if (waitingCount > 0) {
    tips.push({
      level: CHANGE_ALERT_LEVEL_TIP,
      text: `待演练 ${waitingCount} 项，请关注计划执行`,
    });
  }

  return tips
    .map((tip, index) => {
      const text = rich ? escapeFeishuCardMarkdown(tip.text) : tip.text;
      return `${index + 1}. ${formatChangeAlertBadge(tip.level, rich)} ${text}`;
    })
    .join('\n');
}

function buildDrillSyncSummary(records, options = {}) {
  const items = Array.isArray(records) ? records : [];
  const now = new Date();
  const monthlyRecords = items.filter((record) => isCurrentMonthDrillRecord(record, now));
  const buildingStatsMap = new Map(RISK_BUILDING_SUMMARY_ORDER.map((label) => [label, createDrillBuildingStats()]));
  const monthlyStatusCounter = new Map();

  monthlyRecords.forEach((record) => {
    incrementCounter(monthlyStatusCounter, normalizeDrillOrderStatus(record?.orderStatus));
    getDrillBuildingLabels(record).forEach((buildingLabel) => {
      const stats = buildingStatsMap.get(buildingLabel) || createDrillBuildingStats();
      stats.total += 1;
      stats.monthly += 1;
      if (isCompletedDrillRecord(record)) {
        stats.completed += 1;
      }
      if (record?.overdue) {
        stats.overdue += 1;
      }
      buildingStatsMap.set(buildingLabel, stats);
    });
  });

  const buildingProgressSummary = formatDrillBuildingProgressSummary(buildingStatsMap);
  const statusSummary = formatCounterSummary(monthlyStatusCounter, 0);
  const evaluationMatchedCount = Number(options.evaluationMatchedCount || 0);
  const overdueTotal = monthlyRecords.filter((record) => record?.overdue && !isCompletedDrillRecord(record) && !isTerminatedDrillRecord(record)).length;
  const pendingEvaluationCount = getCounterCount(monthlyStatusCounter, ['待评估', '评估待审批']);
  const waitingCount = getCounterCount(monthlyStatusCounter, '待演练');
  const drillTipsSummary = formatDrillNotificationTips({
    overdueTotal,
    pendingEvaluationCount,
    waitingCount,
  });
  const drillTipsCardSummary = formatDrillNotificationTips({
    overdueTotal,
    pendingEvaluationCount,
    waitingCount,
  }, true);
  const syncTime = formatChangeSyncTime();
  const distributionLine = [
    statusSummary ? `本月状态 ${statusSummary}` : '',
    `二次拉取匹配评估事件 ${evaluationMatchedCount} 条`,
  ].filter(Boolean).join('；');

  return {
    notifyMessage: buildSyncCardMessage({
      title: '演练推进同步',
      template: overdueTotal > 0 ? 'red' : ((pendingEvaluationCount + waitingCount) > 0 ? 'yellow' : 'green'),
      fallbackLines: [
        '【演练推进同步】',
        `同步时间：${syncTime}`,
        `本月计划：${monthlyRecords.length} 条`,
        distributionLine ? `分布概览：${distributionLine}` : '',
        drillTipsSummary ? `提示：\n${drillTipsSummary}` : '',
        buildingProgressSummary ? `楼栋进展：\n${buildingProgressSummary}` : '',
      ],
      overviewLines: [
        `**同步时间**：${escapeFeishuCardMarkdown(syncTime)}`,
        `**本月计划**：${monthlyRecords.length} 条`,
        distributionLine ? `**分布概览**：${escapeFeishuCardMarkdown(distributionLine)}` : '',
      ],
      sections: [
        { title: '提示', content: drillTipsCardSummary },
        { title: '楼栋进展', content: escapeFeishuCardMarkdown(buildingProgressSummary) },
      ],
    }),
    monthlyCount: monthlyRecords.length,
    successMessage: ({ insertedCount }) => {
      const parts = [`已清空旧数据并覆盖同步 ${insertedCount} 条演练计划到飞书多维表`];
      parts.push(`本月楼栋进展：${buildingProgressSummary.replace(/\n/g, '；')}`);
      if (statusSummary) parts.push(`本月状态：${statusSummary}`);
      return parts.join('；');
    },
  };
}

function mapDrillRecordToFeishuFields(record) {
  const item = record || {};
  const primaryEvaluationEvent = getPrimaryDrillEvaluationEvent(item);
  return {
    计划ID: String(item.id || ''),
    计划编号: String(item.operationPlanNumber || ''),
    演练场景: String(item.exerciseScenarioName || ''),
    专业: String(item.exerciseMajor || ''),
    演练类别: normalizeDrillCategory(item.exerciseCategory),
    演练类型: normalizeDrillExerciseType(item.exerciseType),
    实施区域: normalizeDrillImplementationArea(item),
    演练周期: normalizeDrillExerciseCycle(item.exerciseCycle),
    演练月份: String(item.exerciseMonth || ''),
    演练年份: item.exerciseYear == null ? '' : String(item.exerciseYear),
    审批状态: normalizeDrillApprovalStatus(item.approvalStatus),
    执行状态: normalizeDrillExecuteStatus(item.executeStatus),
    演练状态: normalizeDrillOrderStatus(item.orderStatus),
    计划演练时间: String(item.plannedExerciseTime || ''),
    计划结束时间: String(item.plannedExerciseEndTime || ''),
    实际演练时间: String(item.actualExerciseTime || ''),
    触发时间: String(item.triggerTime || ''),
    触发人: String(item.triggerBy || ''),
    创建时间: String(item.createTime || ''),
    创建人: String(item.createBy || ''),
    班组: String(item.exerciseObjectStr || ''),
    值班人员: formatDrillUsers(item.dutyUserList),
    负责人: formatDrillUsers(item.responsibleUserList),
    评估人: formatDrillUsers(item.evaluationUserList),
    EOP流程: String(item.eopFlowStr || ''),
    关联事件: formatDrillRelatedEvents(item.relatedEventList),
    演练评分: getDrillEvaluationScore(item),
    评估事件: formatDrillEvaluationEvents(item.evaluationEventList),
    评估事件状态: primaryEvaluationEvent?.orderStatus == null ? '' : normalizeDrillOrderStatus(primaryEvaluationEvent.orderStatus),
    评估事件等级: getDrillEvaluationLevelText(primaryEvaluationEvent),
    响应耗时: String(primaryEvaluationEvent?.responseTimeCost || ''),
    确认耗时: String(primaryEvaluationEvent?.ackTimeCost || ''),
    恢复时间: String(primaryEvaluationEvent?.incidentRecoveryTime || ''),
    是否逾期: item.overdue ? '是' : '否',
    是否展示EOP: item.showEop ? '是' : '否',
  };
}

function firstFilledEventValue(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function normalizeEventOrderStatus(value) {
  const mapping = {
    '1': '待响应',
    '2': '待确认',
    '3': '待解决',
    '4': '待关闭',
    '5': '完成',
    '6': '处理中',
    '8': '已终止',
  };
  const key = String(value ?? '').trim();
  return mapping[key] || key;
}

function normalizeEventStatus(value) {
  const mapping = {
    '1': '待响应',
    '2': '待确认',
    '3': '处理中',
    '4': '待解决',
    '5': '待关闭',
    '6': '完成',
    '8': '处理中',
  };
  const key = String(value ?? '').trim();
  return mapping[key] || key;
}

function normalizeEventAlarmStatus(value) {
  const key = String(value ?? '').trim();
  if (key === '1') return '未恢复';
  if (key === '0') return '已恢复';
  return key;
}

function formatEventBoolean(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (value === true || text === 'true' || text === '1' || text === 'yes') return '是';
  if (value === false || text === 'false' || text === '0' || text === 'no') return '否';
  return String(value ?? '');
}

function getEventLevelText(record) {
  return firstFilledEventValue(
    record?.eventHighestLevelName,
    record?.eventCurrentLevelName,
    record?.eventFirstLevelName,
    record?.previousLevelName,
    record?.eventHighestLevel,
    record?.eventCurrentLevel,
    record?.eventFirstLevel,
  );
}

function getEventStatusForNotification(record) {
  return firstFilledEventValue(
    normalizeEventOrderStatus(record?.orderStatus),
    normalizeEventStatus(record?.eventStatus),
    '未知状态',
  );
}

function isCompletedEventStatusText(value) {
  const text = String(value || '').trim();
  return text === '完成';
}

function isEventNotificationVisible(record) {
  const orderStatusText = String(normalizeEventOrderStatus(record?.orderStatus) || '').trim();
  if (orderStatusText && orderStatusText !== '未知状态') {
    return !isCompletedEventStatusText(orderStatusText);
  }

  const flowStatusText = String(normalizeEventStatus(record?.eventStatus) || '').trim();
  return Boolean(flowStatusText && flowStatusText !== '未知状态' && !isCompletedEventStatusText(flowStatusText));
}

function parseEventDate(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const normalized = text.replace(' ', 'T');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function getEventHappenDate(record) {
  return parseEventDate(firstFilledEventValue(
    record?.happenTime,
  ));
}

function getEventProduceDate(record) {
  return parseEventDate(firstFilledEventValue(
    record?.creatTime,
    record?.createTime,
    record?.notificationTime,
  ));
}

function getEventPrimaryDate(record) {
  return getEventHappenDate(record) || getEventProduceDate(record);
}

function getRecentEventDateBounds(now = new Date(), lookbackDays = EVENT_INCREMENTAL_SYNC_LOOKBACK_DAYS) {
  const normalizedDays = Math.max(1, Number(lookbackDays) || 30);
  const start = new Date(now);
  start.setDate(start.getDate() - normalizedDays + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function isDateInRecentEventRange(date, now = new Date()) {
  if (!date) {
    return false;
  }

  const { start, end } = getRecentEventDateBounds(now);
  return date >= start && date <= end;
}

function isRecentEventRecord(record, now = new Date()) {
  return isDateInRecentEventRange(getEventHappenDate(record), now)
    || isDateInRecentEventRange(getEventProduceDate(record), now);
}

function isFalseRealEvent(record) {
  const value = record?.realEvent;
  const text = String(value ?? '').trim().toLowerCase();
  return value === false || ['false', '0', 'no', 'n', '否'].includes(text);
}

function isRecentFalseRealEvent(record, now = new Date()) {
  return isRecentEventRecord(record, now) && isFalseRealEvent(record);
}

function isRecentIncompleteEvent(record, now = new Date()) {
  return isRecentEventRecord(record, now) && isEventNotificationVisible(record);
}

function getEventFocusTypes(record, now = new Date()) {
  const types = [];
  if (isRecentIncompleteEvent(record, now)) {
    types.push('未完成');
  }
  if (isRecentFalseRealEvent(record, now)) {
    types.push('非真实');
  }
  return types;
}

function getEventNotificationReason(record, now = new Date()) {
  const reasons = [];
  if (isRecentIncompleteEvent(record, now)) {
    reasons.push('近30天未完成');
  }
  if (isRecentFalseRealEvent(record, now)) {
    reasons.push('近30天真实事件=否');
  }
  return reasons.join('/');
}

function getUniqueEventNotificationItems(records, now = new Date()) {
  const items = [];
  const seenKeys = new Set();
  (Array.isArray(records) ? records : []).forEach((record, index) => {
    const reason = getEventNotificationReason(record, now);
    if (!reason) {
      return;
    }

    const key = getEventStableKey(record) || `${record?.eventNumber || ''}-${record?.happenTime || index}`;
    if (seenKeys.has(key)) {
      return;
    }

    seenKeys.add(key);
    items.push({
      ...record,
      eventNotificationReason: reason,
    });
  });

  return items;
}

function isEventRecoveredForNotification(record) {
  const alarmStatus = String(record?.eventAlarmStatus ?? '').trim();
  if (alarmStatus === '0') {
    return true;
  }
  if (alarmStatus === '1') {
    return false;
  }

  const alarmText = normalizeEventAlarmStatus(record?.eventAlarmStatus);
  if (alarmText === '已恢复') {
    return true;
  }
  if (alarmText === '未恢复') {
    return false;
  }

  return false;
}

function sortEventRecordsByHappenTimeDesc(records) {
  return [...(Array.isArray(records) ? records : [])].sort((left, right) => {
    const leftTime = getEventPrimaryDate(left)?.getTime() || 0;
    const rightTime = getEventPrimaryDate(right)?.getTime() || 0;
    return rightTime - leftTime;
  });
}

function getEventShortNumber(record) {
  const rawNumber = firstFilledEventValue(record?.eventNumber, record?.id);
  const numberText = String(rawNumber || '').trim();
  if (!numberText) return '';
  const match = numberText.match(/(\d{5})$/);
  return match ? match[1] : numberText.slice(-5);
}

function formatEventNoticeTime(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const parsed = parseEventDate(text);
  if (parsed) {
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const hours = String(parsed.getHours()).padStart(2, '0');
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
  }

  return text.replace(/:\d{2}$/, '');
}

function getEventBuildingLabel(record) {
  const text = [
    record?.location,
    record?.highestLevelTitle,
    record?.dcName,
  ].filter(Boolean).join(' ').toUpperCase();

  if (!text) return '';

  const patterns = [
    /数据中心\s*([A-E])(?:[楼栋\\/\-\s]|$)/,
    /([A-E])\s*[楼栋]/,
    /(?:^|[\\/\s])([A-E])(?:[\\/\-\s]|$)/,
    /(?:^|[\\/\s])([A-E])-\d{2,}/,
    /(?:^|[\\/\s])([A-E])-F\d+/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return `${match[1]}楼`;
    }
  }

  return '';
}

function mapEventRecordToFeishuFields(record) {
  const item = record || {};
  const focusTypes = getEventFocusTypes(item);
  return {
    事件ID: String(item.id || ''),
    事件编号: String(item.eventNumber || ''),
    事件标题: String(item.eventTitle || ''),
    最高告警: String(item.highestLevelTitle || ''),
    当前等级: String(item.eventCurrentLevelName || ''),
    最高等级: String(item.eventHighestLevelName || ''),
    首次等级: String(item.eventFirstLevelName || ''),
    事件类型: String(item.eventType || ''),
    事件来源: String(item.eventSource ?? ''),
    告警状态: normalizeEventAlarmStatus(item.eventAlarmStatus),
    告警状态编码: String(item.eventAlarmStatus ?? ''),
    事件状态: normalizeEventOrderStatus(item.orderStatus),
    事件状态编码: String(item.orderStatus ?? ''),
    处理状态: normalizeEventOrderStatus(item.orderStatus),
    处理状态编码: String(item.orderStatus ?? ''),
    流程状态: normalizeEventStatus(item.eventStatus),
    流程状态编码: String(item.eventStatus ?? ''),
    数据中心编码: String(item.dcCode || ''),
    数据中心: String(item.dcName || ''),
    专业域编码: String(item.domainCode || ''),
    位置: String(item.location || ''),
    事件描述: String(item.eventDescription || ''),
    真实事件: formatEventBoolean(item.realEvent),
    创建人: String(item.creator || ''),
    创建时间: String(item.creatTime || ''),
    发生时间: String(item.happenTime || ''),
    通知时间: String(item.notificationTime || ''),
    响应时间: String(item.responseTime || ''),
    确认时间: String(item.ackTime || ''),
    恢复时间: String(item.incidentRecoveryTime || ''),
    解决时间: String(item.solveTime || ''),
    关闭时间: String(item.closeTime || ''),
    响应耗时: String(item.responseTimeCost || ''),
    确认耗时: String(item.ackTimeCost || ''),
    更新人: String(item.updater || ''),
    更新时间: String(item.updateTime || ''),
    事件目录ID: String(item.eventCatalogueId || ''),
    战情室ID: String(item.warRoomId ?? ''),
    房间类型: String(item.roomType || ''),
    同步关注类型: focusTypes.join('、'),
    近30天同步范围: isRecentEventRecord(item) ? '是' : '否',
  };
}

function getEventNotificationDetail(record) {
  const title = firstFilledEventValue(record?.eventTitle, record?.highestLevelTitle, record?.eventNumber, '未命名事件');
  const number = getEventShortNumber(record);
  const level = getEventLevelText(record) || '未分级';
  const status = getEventStatusForNotification(record);
  const alarm = normalizeEventAlarmStatus(record?.eventAlarmStatus);
  const eventType = firstFilledEventValue(record?.eventType, '未分类');
  const location = getEventBuildingLabel(record);
  const happenTime = formatEventNoticeTime(firstFilledEventValue(record?.happenTime, record?.notificationTime, record?.creatTime));
  const reason = firstFilledEventValue(record?.eventNotificationReason);
  return {
    reason,
    title,
    number,
    level,
    status,
    alarm,
    eventType,
    location,
    happenTime,
  };
}

function formatEventNotificationTips({
  incompleteCount,
  incompleteRecoveredCount,
  incompleteUnrecoveredCount,
  falseRealCount,
  overlapCount,
  incompleteViewUrl,
  falseRealViewUrl,
}, rich = false) {
  const tips = [];
  if (incompleteCount > 0) {
    const linkText = incompleteCount > 5 && incompleteViewUrl
      ? `，超过5条请打开未完成视图：${incompleteViewUrl}`
      : '';
    tips.push({
      level: CHANGE_ALERT_LEVEL_IMPORTANT,
      text: `近30天未完成事件 ${incompleteCount} 条（已恢复 ${incompleteRecoveredCount} / 未恢复 ${incompleteUnrecoveredCount}），请关注确认和关闭闭环${linkText}`,
    });
  }
  if (falseRealCount > 0) {
    const linkText = falseRealCount > 5 && falseRealViewUrl
      ? `，超过5条请打开非真实视图：${falseRealViewUrl}`
      : '';
    tips.push({
      level: CHANGE_ALERT_LEVEL_TIP,
      text: `近30天真实事件=否 ${falseRealCount} 条，请确认是否误报、测试或演练并补齐说明${linkText}`,
    });
  }
  if (overlapCount > 0) {
    tips.push({
      level: CHANGE_ALERT_LEVEL_TIP,
      text: `其中 ${overlapCount} 条同时未完成且真实事件=否，建议优先复核`,
    });
  }

  return tips
    .map((tip, index) => {
      const text = rich ? escapeFeishuCardMarkdown(tip.text) : tip.text;
      return `${index + 1}. ${formatChangeAlertBadge(tip.level, rich)} ${text}`;
    })
    .join('\n');
}

function formatEventDetailSummary(details, options = {}) {
  const items = Array.isArray(details) ? details : [];
  const limit = Math.max(1, Number(options.limit || 10));
  const visibleItems = items.slice(0, limit);
  const lines = visibleItems.map((detail, index) => {
    const parts = [
      options.includeReason ? detail.reason : '',
      detail.number,
      detail.title,
      detail.level,
      detail.alarm,
      detail.status,
      detail.eventType,
      detail.location,
      detail.happenTime,
    ].filter(Boolean);
    return `${index + 1}. ${parts.join('｜')}`;
  });

  if (items.length > visibleItems.length) {
    const suffix = options.moreUrl ? `，打开视图：${options.moreUrl}` : '';
    lines.push(`... 还有 ${items.length - visibleItems.length} 条未展开${suffix}`);
  }

  return lines.join('\n');
}

function buildEventSyncSummary(records, options = {}) {
  const items = Array.isArray(records) ? records : [];
  const now = new Date();
  const notifyItems = getUniqueEventNotificationItems(items, now);
  const incompleteItems = items.filter((item) => isRecentIncompleteEvent(item, now));
  const falseRealItems = items.filter((item) => isRecentFalseRealEvent(item, now));
  const statusCounter = new Map();
  const levelCounter = new Map();
  const typeCounter = new Map();

  notifyItems.forEach((item) => {
    incrementCounter(statusCounter, getEventStatusForNotification(item));
    incrementCounter(levelCounter, getEventLevelText(item) || '未分级');
    incrementCounter(typeCounter, item?.eventType || '未分类');
  });

  const statusSummary = formatCounterSummary(statusCounter, 0);
  const levelSummary = formatCounterSummary(levelCounter, 0);
  const typeSummary = formatCounterSummary(typeCounter, 0);
  const alarmingCount = items.filter((item) => String(item?.eventAlarmStatus ?? '') === '1').length;
  const incompleteCount = incompleteItems.length;
  const sortedIncompleteItems = sortEventRecordsByHappenTimeDesc(incompleteItems);
  const incompleteRecoveredItems = sortedIncompleteItems.filter(isEventRecoveredForNotification);
  const incompleteRecoveredCount = incompleteRecoveredItems.length;
  const incompleteUnrecoveredCount = sortedIncompleteItems.filter((item) => !isEventRecoveredForNotification(item)).length;
  const falseRealCount = falseRealItems.length;
  const sortedFalseRealItems = sortEventRecordsByHappenTimeDesc(falseRealItems);
  const overlapCount = items.filter((item) => isRecentIncompleteEvent(item, now) && isRecentFalseRealEvent(item, now)).length;
  const completedCount = items.filter((item) => String(item?.orderStatus ?? '') === EVENT_COMPLETED_ORDER_STATUS).length;
  const realCount = items.filter((item) => item?.realEvent === true || String(item?.realEvent).toLowerCase() === 'true').length;
  const recoveredCount = items.filter((item) => Boolean(item?.incidentRecoveryTime)).length;
  const incompleteViewUrl = options.incompleteViewUrl || getEventBitableWebUrl(options.incompleteViewId);
  const falseRealViewUrl = options.falseRealViewUrl || getEventBitableWebUrl(options.falseRealViewId);
  const focusSummary = formatEventNotificationTips({
    incompleteCount,
    incompleteRecoveredCount,
    incompleteUnrecoveredCount,
    falseRealCount,
    overlapCount,
    incompleteViewUrl,
    falseRealViewUrl,
  });
  const focusCardSummary = formatEventNotificationTips({
    incompleteCount,
    incompleteRecoveredCount,
    incompleteUnrecoveredCount,
    falseRealCount,
    overlapCount,
    incompleteViewUrl,
    falseRealViewUrl,
  }, true);
  const incompleteDetailSummary = formatEventDetailSummary(
    sortedIncompleteItems.map((item) => getEventNotificationDetail({
      ...item,
      eventNotificationReason: isEventRecoveredForNotification(item) ? '未完成已恢复' : '未完成未恢复',
    })),
    { limit: 5, moreUrl: incompleteViewUrl },
  );
  const falseRealDetailSummary = formatEventDetailSummary(
    sortedFalseRealItems.map((item) => getEventNotificationDetail({
      ...item,
      eventNotificationReason: '非真实',
    })),
    { limit: 5, moreUrl: falseRealViewUrl },
  );
  const syncTime = formatChangeSyncTime();
  const hasImportant = incompleteCount > 0;
  const eventBitableUrl = getEventBitableWebUrl();

  return {
    total: items.length,
    hasImportant,
    notifyMessage: buildChangeNotificationMessage({
      title: '事件追踪同步',
      syncTime,
      notifyCount: notifyItems.length,
      notifyCountLabel: '提醒记录',
      conditionText: '',
      linkText: '事件多维表',
      linkUrl: eventBitableUrl,
      statusSummary,
      levelSummary,
      nodeLabel: '类型',
      nodeSummary: typeSummary,
      focusSummary,
      focusCardSummary,
      detailSections: [
        { title: `未完成事件（近30天：已恢复 ${incompleteRecoveredCount} / 未恢复 ${incompleteUnrecoveredCount}，展示最近5条）`, content: incompleteDetailSummary },
        { title: `非真实事件（近30天，展示最近5条 / 共 ${falseRealCount} 条）`, content: falseRealDetailSummary },
      ],
      hasImportant,
    }),
    successMessage: ({ insertedCount }) => {
      const parts = [`已清空旧数据并覆盖同步 ${insertedCount} 条事件数据到飞书多维表`];
      parts.push(`提醒筛选 ${notifyItems.length} 条`);
      parts.push(`近30天未完成 ${incompleteCount} 条`);
      parts.push(`近30天真实事件=否 ${falseRealCount} 条`);
      parts.push(`真实事件 ${realCount} 条`);
      parts.push(`未恢复 ${alarmingCount} 条`);
      parts.push(`完成事件 ${completedCount} 条`);
      parts.push(`已恢复 ${recoveredCount} 条`);
      if (statusSummary) parts.push(`事件状态：${statusSummary}`);
      if (levelSummary) parts.push(`等级：${levelSummary}`);
      if (typeSummary) parts.push(`事件类型：${typeSummary}`);
      return parts.join('；');
    },
  };
}

function getChangeListApiUrl() {
  return `${CHANGE_INTRANET_ORIGIN}/api/change/change/order/listPage`;
}

function getChangeBasicDataApiUrl() {
  return `${CHANGE_INTRANET_ORIGIN}/api/change/changeDetails/getBasicInformation`;
}

function createChangeListSyncPayload(pageNo = 1, pageSize = CHANGE_AUTO_SYNC_PAGE_SIZE) {
  return {
    pageNo,
    pageSize,
    userId: '',
    operType: '4',
    customParam: '',
    dc: '',
    applyEndTime: '',
    applyStartTime: '',
    buildingCode: '',
    category: '',
    implementEndTime: '',
    implementEndTimeEnd: '',
    implementEndTimeStart: '',
    implementStartTime: '',
    level: '',
    planEndTime: '',
    planEndTimeEnd: '',
    planEndTimeStart: '',
    planStartTime: '',
    actualStartTime: '',
    actualStartTimeStart: '',
    actualStartTimeEnd: '',
    actualEndTime: '',
    actualEndTimeStart: '',
    actualEndTimeEnd: '',
    delayedStartTime: '',
    delayedStartTimeStart: '',
    delayedStartTimeEnd: '',
    delayedEndTime: '',
    delayedEndTimeStart: '',
    delayedEndTimeEnd: '',
    delayedReason: '',
    progress: '',
    status: '',
    type: '',
  };
}

function createChangeBasicDataSyncPayload(orderId) {
  return {
    orderId: String(orderId),
    userId: '',
  };
}

function extractChangeOrderIds(items) {
  const idSet = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const rawId = item?.id ?? item?.orderId ?? item?.order_id;
    const numericId = typeof rawId === 'number' ? rawId : Number(rawId);
    if (Number.isFinite(numericId) && numericId > 0) {
      idSet.add(numericId);
    }
  });

  return Array.from(idSet);
}

function getSyncableChangeBasicDataItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => Boolean(item?.orderId)
    && Boolean(item?.data)
    && typeof item.data === 'object'
    && !Array.isArray(item.data)
    && !item.data.error);
}

function parseChangeWorkOrderPage(payload, pageNo) {
  if (payload?.code !== '200' || payload?.success !== true) {
    throw new Error(payload?.message || `变更工单列表第 ${pageNo} 页返回失败`);
  }

  const records = Array.isArray(payload?.data?.records) ? payload.data.records : [];
  const total = Number(payload?.data?.total || payload?.data?.totalCount || payload?.data?.totalRecords || 0);
  const totalPages = total > 0 ? Math.max(1, Math.ceil(total / CHANGE_AUTO_SYNC_PAGE_SIZE)) : 1;
  return {
    records,
    total,
    totalPages,
  };
}

async function fetchChangeWorkOrdersForAutoSync() {
  const firstResult = await fetchChangePayloadInBrowser({
    url: getChangeListApiUrl(),
    method: 'POST',
    payload: createChangeListSyncPayload(1),
  });
  const firstPage = parseChangeWorkOrderPage(firstResult.data, 1);
  console.log(`[change-auto-sync] list page=1 totalPages=${firstPage.totalPages} total=${firstPage.total} records=${firstPage.records.length}`);

  const allRecords = [...firstPage.records];
  if (firstPage.totalPages <= 1) {
    return allRecords;
  }

  const remainingPages = Array.from({ length: firstPage.totalPages - 1 }, (_, index) => index + 2);
  const pageResults = await runConcurrentWorkers({
    items: remainingPages,
    concurrency: CHANGE_AUTO_SYNC_LIST_CONCURRENCY,
    worker: async (pageNo) => {
      const pageResult = await fetchChangePayloadInBrowser({
        url: getChangeListApiUrl(),
        method: 'POST',
        payload: createChangeListSyncPayload(pageNo),
      });
      const pageData = parseChangeWorkOrderPage(pageResult.data, pageNo);
      console.log(`[change-auto-sync] list page=${pageNo} totalPages=${pageData.totalPages} records=${pageData.records.length}`);
      return {
        pageNo,
        pageData,
      };
    },
  });

  pageResults
    .sort((left, right) => left.pageNo - right.pageNo)
    .forEach(({ pageData }) => {
      allRecords.push(...pageData.records);
    });

  return allRecords;
}

async function fetchChangeBasicDataForAutoSync(orderIds) {
  const results = await runConcurrentWorkers({
    items: orderIds,
    concurrency: CHANGE_AUTO_SYNC_BASIC_DATA_CONCURRENCY,
    worker: async (orderId) => {
      try {
        const response = await fetchChangePayloadInBrowser({
          url: getChangeBasicDataApiUrl(),
          method: 'POST',
          payload: createChangeBasicDataSyncPayload(orderId),
        });
        const payload = response.data;
        if (payload?.code !== '200' || payload?.success !== true || !payload?.data) {
          return {
            orderId,
            data: {
              error: payload?.message || '接口返回失败',
            },
          };
        }

        return {
          orderId,
          data: payload.data,
        };
      } catch (error) {
        return {
          orderId,
          data: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  });

  const successItems = getSyncableChangeBasicDataItems(results);
  return {
    items: results,
    successItems,
    failedCount: results.length - successItems.length,
  };
}

function shouldSendChangeImportantNotify(runContext) {
  if (!CHANGE_IMPORTANT_NOTIFY_ENABLED || !CHANGE_IMPORTANT_NOTIFY_CHAT_ID) {
    return false;
  }
  if (!runContext || runContext.catchUp) {
    return false;
  }

  const scheduleLabels = CHANGE_IMPORTANT_NOTIFY_SCHEDULES.map((entry) => entry.label);
  return scheduleLabels.includes(String(runContext.scheduleLabel || ''));
}

async function sendChangeImportantNotifyMessage(summary, runContext) {
  if (!shouldSendChangeImportantNotify(runContext)) {
    return {
      attempted: false,
      success: false,
      message: '',
    };
  }
  if (!summary?.hasImportant) {
    return {
      attempted: false,
      success: false,
      message: '16点05重要提示群无重要提醒，已跳过发送',
    };
  }

  const primaryChatId = String(process.env.CHANGE_FEISHU_NOTIFY_CHAT_ID || process.env.FEISHU_NOTIFY_CHAT_ID || '').trim();
  if (primaryChatId && primaryChatId === CHANGE_IMPORTANT_NOTIFY_CHAT_ID) {
    return {
      attempted: false,
      success: false,
      message: '16点05重要提示群与主通知群相同，已跳过重复发送',
    };
  }

  try {
    const extraClient = createChangeFeishuClient('basicData', {
      notifyChatId: CHANGE_IMPORTANT_NOTIFY_CHAT_ID,
      notifyChatName: '',
    });
    await extraClient.sendMessageToChat(summary.notifyMessage);
    return {
      attempted: true,
      success: true,
      message: `16点05重要提示群通知已发送：${CHANGE_IMPORTANT_NOTIFY_CHAT_ID}`,
    };
  } catch (error) {
    return {
      attempted: true,
      success: false,
      message: `16点05重要提示群通知发送失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function runChangeAutoSyncOnce(runContext = {}) {
  if (!CHANGE_AUTO_SYNC_ENABLED || changeAutoSyncState.running) {
    return;
  }
  if (shouldSkipAutoSyncMessageRun(runContext)) {
    console.log(`[change-auto-sync] skipped message schedule=${runContext.scheduleLabel || '--'} because message is not due`);
    return;
  }

  changeAutoSyncState.running = true;
  changeAutoSyncState.queued = false;
  changeAutoSyncState.lastAttemptAt = new Date().toISOString();
  changeAutoSyncState.lastError = '';
  changeAutoSyncState.statusMessage = '正在拉取变更工单与基础信息';

  try {
    const workOrders = await fetchChangeWorkOrdersForAutoSync();
    const orderIds = extractChangeOrderIds(workOrders);
    if (orderIds.length === 0) {
      throw new Error('变更工单列表已获取，但未识别到可同步的工单 ID');
    }

    const batchResult = await fetchChangeBasicDataForAutoSync(orderIds);
    if (batchResult.successItems.length === 0) {
      throw new Error('变更工单基础信息全部拉取失败，未同步飞书');
    }

    const changeBasicDataFeishuClient = createChangeFeishuClient('basicData');
    const summary = buildChangeBasicDataSyncSummary(batchResult.successItems);
    const shouldNotify = shouldNotifyChangeAutoSyncRun(runContext);
    const syncResult = await changeBasicDataFeishuClient.replaceTableRecords(
      batchResult.successItems.map((item) => ({ fields: mapChangeBasicDataItem(item) })),
      {
        notify: shouldNotify,
        notifyMessage: summary.notifyMessage,
        successMessage: summary.successMessage,
      },
    );

    if (!syncResult.success && Number(syncResult.insertedCount || 0) === 0) {
      throw new Error(syncResult.message || '变更工单自动同步飞书失败');
    }

    const importantNotifyResult = await sendChangeImportantNotifyMessage(summary, runContext);
    const extraAbnormalNotifyResult = await sendExtraAbnormalNotifyMessage({
      moduleName: '变更异常',
      summary,
      createClient: (overrides) => createChangeFeishuClient('basicData', overrides),
      primaryChatId: process.env.CHANGE_FEISHU_NOTIFY_CHAT_ID || process.env.FEISHU_NOTIFY_CHAT_ID || '',
      enabled: shouldNotify,
    });

    changeAutoSyncState.lastSuccessAt = new Date().toISOString();
    changeAutoSyncState.lastInsertedCount = Number(syncResult.insertedCount || 0);
    const notifyWarnings = [
      importantNotifyResult.attempted && !importantNotifyResult.success ? importantNotifyResult.message : '',
      extraAbnormalNotifyResult.attempted && !extraAbnormalNotifyResult.success ? extraAbnormalNotifyResult.message : '',
    ].filter(Boolean).join('；');
    const notifyMessages = [importantNotifyResult.message, extraAbnormalNotifyResult.message].filter(Boolean).join('；');
    changeAutoSyncState.lastError = syncResult.success
      ? notifyWarnings
      : (syncResult.message || '');
    changeAutoSyncState.statusMessage = `完成，写入 ${changeAutoSyncState.lastInsertedCount} 条${notifyMessages ? `，${notifyMessages}` : ''}`;
    const cleanupResult = await cleanupLightweightSyncCache('change');

    console.log(
      `[change-auto-sync] completed schedule=${runContext.scheduleLabel || '--'} notifyAllowed=${shouldNotify} orders=${workOrders.length} successBasicData=${batchResult.successItems.length} failedBasicData=${batchResult.failedCount} inserted=${changeAutoSyncState.lastInsertedCount} notified=${Boolean(syncResult.notified)} importantNotify=${importantNotifyResult.attempted ? importantNotifyResult.success : 'skipped'} extraAbnormalNotify=${extraAbnormalNotifyResult.attempted ? extraAbnormalNotifyResult.success : 'skipped'} cacheCleanup=${cleanupResult.success !== false} message=${String([syncResult.message, notifyMessages].filter(Boolean).join('；')).replace(/\s+/g, ' ')}`,
    );
  } catch (error) {
    changeAutoSyncState.lastError = error instanceof Error ? error.message : String(error);
    changeAutoSyncState.statusMessage = changeAutoSyncState.lastError;
    console.warn(`[change-auto-sync] failed: ${changeAutoSyncState.lastError}`);
  } finally {
    changeAutoSyncState.running = false;
  }
}

function scheduleNextChangeAutoSync() {
  scheduleRecurringSyncTask({
    enabled: CHANGE_AUTO_SYNC_ENABLED,
    state: changeAutoSyncState,
    tag: 'change-auto-sync',
    scheduleEntries: CHANGE_AUTO_SYNC_SCHEDULES,
    runTask: runChangeAutoSyncOnce,
    disabledMessage: 'disabled by CHANGE_AUTO_SYNC_ENABLED=false',
  });
}

function createDrillListSyncPayload(pageNo = 1, pageSize = DRILL_AUTO_SYNC_PAGE_SIZE, overrides = {}) {
  return {
    actualExerciseEndTime: '',
    actualExerciseStartTime: '',
    dcCode: '',
    dutyGroupId: null,
    evaluationCompleteEndTime: '',
    evaluationCompleteStartTime: '',
    executeStatus: null,
    exerciseCategory: '',
    exerciseMonth: '',
    exerciseScenarioName: '',
    hasEop: null,
    overdue: '',
    planApprovalStatusMulti: '',
    plannedExerciseEndTime: '',
    plannedExerciseStartTime: '',
    ...overrides,
    pageNo,
    pageSize,
  };
}

function parseDrillExercisePlanPage(payload, pageNo) {
  if (payload?.code && payload.code !== '200') {
    throw new Error(payload?.message || `演练计划列表第 ${pageNo} 页返回失败`);
  }
  if (payload?.success === false) {
    throw new Error(payload?.message || `演练计划列表第 ${pageNo} 页返回失败`);
  }

  const records = Array.isArray(payload?.data?.records) ? payload.data.records : [];
  const total = Number(payload?.data?.total || payload?.data?.totalCount || payload?.data?.totalRecords || 0);
  const rawPages = Number(payload?.data?.pages || payload?.data?.totalPages || 0);
  const totalPages = Number.isFinite(rawPages) && rawPages > 0
    ? Math.max(1, Math.ceil(rawPages))
    : total > 0
      ? Math.max(1, Math.ceil(total / DRILL_AUTO_SYNC_PAGE_SIZE))
      : 1;

  return {
    records,
    total,
    totalPages,
  };
}

function getCurrentDrillExerciseMonthToken(now = new Date()) {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][now.getMonth()];
}

function getDrillRecordStableKey(record, index = 0) {
  return String(
    record?.id
      || [
        record?.operationPlanNumber,
        record?.exerciseScenarioId,
        record?.exerciseObjectStr,
        record?.dcCode,
        record?.createTime,
        index,
      ].filter(Boolean).join('|'),
  );
}

function mergeDrillExercisePlanRecords(baseRecords, extraRecords) {
  const merged = [];
  const indexMap = new Map();

  [...(Array.isArray(baseRecords) ? baseRecords : []), ...(Array.isArray(extraRecords) ? extraRecords : [])].forEach((record, index) => {
    const key = getDrillRecordStableKey(record, index);
    if (!key) return;
    if (indexMap.has(key)) {
      const existingIndex = indexMap.get(key);
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...record,
      };
      return;
    }
    indexMap.set(key, merged.length);
    merged.push(record);
  });

  return merged;
}

async function fetchDrillExercisePlanPages(payloadFactory, logLabel) {
  const firstResult = await fetchDrillPayloadInBrowser({
    url: DRILL_LIST_URL,
    method: 'POST',
    payload: payloadFactory(1),
  });
  const firstPage = parseDrillExercisePlanPage(firstResult.data, 1);
  console.log(`[drill-auto-sync] ${logLabel} page=1 totalPages=${firstPage.totalPages} total=${firstPage.total} records=${firstPage.records.length}`);
  if (firstPage.totalPages > DRILL_AUTO_SYNC_MAX_PAGES) {
    throw new Error(`演练计划接口总页数 ${firstPage.totalPages} 超过安全上限 ${DRILL_AUTO_SYNC_MAX_PAGES}，已停止拉取`);
  }

  const allRecords = [...firstPage.records];
  if (firstPage.totalPages <= 1) {
    return allRecords;
  }

  const remainingPages = Array.from({ length: firstPage.totalPages - 1 }, (_, index) => index + 2);
  const pageResults = await runConcurrentWorkers({
    items: remainingPages,
    concurrency: DRILL_AUTO_SYNC_LIST_CONCURRENCY,
    worker: async (pageNo) => {
      const pageResult = await fetchDrillPayloadInBrowser({
        url: DRILL_LIST_URL,
        method: 'POST',
        payload: payloadFactory(pageNo),
      });
      const pageData = parseDrillExercisePlanPage(pageResult.data, pageNo);
      console.log(`[drill-auto-sync] ${logLabel} page=${pageNo} totalPages=${pageData.totalPages} records=${pageData.records.length}`);
      return {
        pageNo,
        pageData,
      };
    },
  });

  pageResults
    .sort((left, right) => left.pageNo - right.pageNo)
    .forEach(({ pageData }) => {
      allRecords.push(...pageData.records);
    });

  return allRecords;
}

function createDrillEvaluationSyncPayload(pageNumber = 1, pageSize = DRILL_EVALUATION_PAGE_SIZE) {
  return {
    creator: DRILL_EVALUATION_CREATOR,
    deviceName: '',
    domainCodeList: ['5', '6', '7', '8', '9'],
    drill: true,
    endAskDate: '',
    endHappendDate: '',
    endIncidentRecoveryDate: '',
    endResponseDate: '',
    eventCurrentLevel: '',
    eventFirstLevel: '',
    eventHighestLevel: '',
    eventTitle: '',
    eventType: '',
    orderStatus: '',
    pageBean: {
      pageNumber,
      pageSize,
    },
    startAskDate: '',
    startHappendDate: '',
    startIncidentRecoveryDate: '',
    startResponseDate: '',
  };
}

function parseDrillEvaluationPage(payload, pageNumber) {
  if (payload?.code && payload.code !== '200') {
    throw new Error(payload?.message || `演练评估事件第 ${pageNumber} 页返回失败`);
  }
  if (payload?.success === false) {
    throw new Error(payload?.message || `演练评估事件第 ${pageNumber} 页返回失败`);
  }

  const records = Array.isArray(payload?.data?.dataList)
    ? payload.data.dataList
    : Array.isArray(payload?.data?.records)
      ? payload.data.records
      : [];
  const total = Number(payload?.data?.total || payload?.data?.count || 0);
  const rawPages = Number(payload?.data?.pages || payload?.data?.totalPages || 0);
  const totalPages = Number.isFinite(rawPages) && rawPages > 0
    ? Math.max(1, Math.ceil(rawPages))
    : total > 0
      ? Math.max(1, Math.ceil(total / DRILL_EVALUATION_PAGE_SIZE))
      : 1;

  return {
    records,
    total,
    totalPages,
  };
}

async function fetchDrillExercisePlansForAutoSync() {
  const allRecords = await fetchDrillExercisePlanPages(
    (pageNo) => createDrillListSyncPayload(pageNo),
    'list',
  );

  if (!DRILL_MONTH_BACKFILL_ENABLED) {
    return allRecords;
  }

  const monthToken = getCurrentDrillExerciseMonthToken();
  const monthlyRecords = [];
  for (const filter of DRILL_MONTH_BACKFILL_FILTERS) {
    const filterRecords = await fetchDrillExercisePlanPages(
      (pageNo) => createDrillListSyncPayload(pageNo, DRILL_AUTO_SYNC_PAGE_SIZE, {
        ...filter.overrides,
        ...(filter.monthScoped ? { exerciseMonth: monthToken } : {}),
      }),
      `month-backfill ${monthToken} ${filter.label}`,
    );
    monthlyRecords.push(...filterRecords);
  }

  const mergedRecords = mergeDrillExercisePlanRecords(allRecords, monthlyRecords);
  console.log(`[drill-auto-sync] month-backfill ${monthToken} fetched=${monthlyRecords.length} merged=${mergedRecords.length} added=${Math.max(mergedRecords.length - allRecords.length, 0)} filters=${DRILL_MONTH_BACKFILL_FILTERS.length}`);
  return mergedRecords;
}

const INSPECT_FEISHU_FIELD_NAMES = [
  '序号',
  '工单名称',
  '数据中心',
  '楼栋',
  '位置信息',
  '巡检人',
  '巡检类型',
  '计划区间',
  '提交时间',
  '接单时间',
  '巡检结果',
  '工单状态',
  '逾期原因',
  '异常标',
];

function formatInspectDateTime(date, endOfDay = false) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day} ${endOfDay ? '23:59:59' : '00:00:00'}`;
}

function getInspectCurrentMonthRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: formatInspectDateTime(start),
    end: formatInspectDateTime(end, true),
  };
}

function createInspectListSyncPayload(pageNum = 1, pageSize = INSPECT_AUTO_SYNC_PAGE_SIZE, overrides = {}) {
  const monthRange = getInspectCurrentMonthRange();
  return {
    pageNum,
    pageSize,
    jobInfo: '',
    jobExecuteStatus: '',
    datacenterCode: INSPECT_DATACENTER_CODE,
    buildingCode: '',
    withinDay: '',
    userName: '',
    executeCycle: '',
    startDateTime: '',
    endDateTime: '',
    planStartDatetime: monthRange.start,
    planEndDatetime: monthRange.end,
    startSubmitTime: '',
    endSubmitTime: '',
    ...overrides,
  };
}

function buildInspectListUrl(pageNum = 1, payload = createInspectListSyncPayload(pageNum)) {
  const url = new URL(INSPECT_LIST_URL);
  Object.entries(payload || {}).forEach(([key, value]) => {
    url.searchParams.set(key, String(value ?? ''));
  });
  return url.toString();
}

function normalizeInspectRows(payload) {
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data?.records)) return payload.data.records;
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  return [];
}

function parseInspectJobPage(payload, pageNum, pageSize = INSPECT_AUTO_SYNC_PAGE_SIZE) {
  const codeText = String(payload?.code ?? '').trim();
  if (codeText && codeText !== '200' && codeText !== '0') {
    throw new Error(payload?.message || payload?.msg || `巡检任务列表第 ${pageNum} 页返回失败：${codeText}`);
  }
  if (payload?.success === false) {
    throw new Error(payload?.message || payload?.msg || `巡检任务列表第 ${pageNum} 页返回失败`);
  }

  const records = normalizeInspectRows(payload);
  const total = Number(
    payload?.total
      ?? payload?.data?.total
      ?? payload?.data?.totalCount
      ?? payload?.data?.totalRecords
      ?? payload?.data?.count
      ?? records.length,
  );
  const rawPages = Number(payload?.data?.pages ?? payload?.data?.totalPages ?? 0);
  const totalPages = Number.isFinite(rawPages) && rawPages > 0
    ? Math.max(1, Math.ceil(rawPages))
    : Number.isFinite(total) && total > 0
      ? Math.max(1, Math.ceil(total / pageSize))
      : 1;

  return {
    records,
    total: Number.isFinite(total) && total > 0 ? total : records.length,
    totalPages,
  };
}

async function fetchInspectJobsForCurrentMonth() {
  const range = getInspectCurrentMonthRange();
  const firstPayload = createInspectListSyncPayload(1, INSPECT_AUTO_SYNC_PAGE_SIZE, {
    planStartDatetime: range.start,
    planEndDatetime: range.end,
  });
  const firstResult = await fetchInspectPayloadInBrowser({
    url: buildInspectListUrl(1, firstPayload),
    method: 'GET',
    payload: firstPayload,
  });
  const firstPage = parseInspectJobPage(firstResult.data, 1, INSPECT_AUTO_SYNC_PAGE_SIZE);
  console.log(`[inspect-sync] page=1 totalPages=${firstPage.totalPages} total=${firstPage.total} records=${firstPage.records.length} range=${range.start}~${range.end}`);
  if (firstPage.totalPages > INSPECT_AUTO_SYNC_MAX_PAGES) {
    throw new Error(`巡检任务接口总页数 ${firstPage.totalPages} 超过安全上限 ${INSPECT_AUTO_SYNC_MAX_PAGES}，已停止拉取`);
  }

  const allRecords = [...firstPage.records];
  if (firstPage.totalPages > 1) {
    const remainingPages = Array.from({ length: firstPage.totalPages - 1 }, (_, index) => index + 2);
    const pageResults = await runConcurrentWorkers({
      items: remainingPages,
      concurrency: INSPECT_AUTO_SYNC_LIST_CONCURRENCY,
      worker: async (pageNum) => {
        const payload = createInspectListSyncPayload(pageNum, INSPECT_AUTO_SYNC_PAGE_SIZE, {
          planStartDatetime: range.start,
          planEndDatetime: range.end,
        });
        const pageResult = await fetchInspectPayloadInBrowser({
          url: buildInspectListUrl(pageNum, payload),
          method: 'GET',
          payload,
        });
        const pageData = parseInspectJobPage(pageResult.data, pageNum, INSPECT_AUTO_SYNC_PAGE_SIZE);
        console.log(`[inspect-sync] page=${pageNum} totalPages=${pageData.totalPages} records=${pageData.records.length}`);
        return {
          pageNum,
          pageData,
        };
      },
    });

    pageResults
      .sort((left, right) => left.pageNum - right.pageNum)
      .forEach(({ pageData }) => {
        allRecords.push(...pageData.records);
      });
  }

  return {
    records: allRecords,
    total: firstPage.total,
    totalPages: firstPage.totalPages,
    rangeStart: range.start,
    rangeEnd: range.end,
  };
}

function getInspectStatMap(record) {
  return record?.params?.statMap || {};
}

function toInspectNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getInspectStatValue(record, key) {
  return toInspectNumber(getInspectStatMap(record)[key]);
}

function getInspectCycleText(value) {
  const mapping = {
    day: '日常巡检',
    week: '周巡检',
    month: '月度巡检',
    quarter: '季度巡检',
    year: '年度巡检',
  };
  const key = String(value || '').trim();
  return mapping[key] || key;
}

function formatInspectPlanTime(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2})/);
  if (!match) return text;
  const [, year, month, day, hour, minute] = match;
  return `${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

function formatInspectPlanRange(record) {
  const start = formatInspectPlanTime(record?.planStartDatetime);
  const end = formatInspectPlanTime(record?.planEndDatetime);
  if (start && end) return `${start}-${end}`;
  return start || end || '';
}

function formatInspectResult(record) {
  const total = getInspectStatValue(record, 'total');
  const normal = getInspectStatValue(record, 'zc');
  const abnormal = getInspectStatValue(record, 'yc');
  if (total <= 0 && normal <= 0 && abnormal <= 0) {
    return '';
  }

  return `总:${total} 正常:${normal} 异常:${abnormal}`;
}

function getInspectStatusText(record) {
  return String(record?.jobExecuteStatusName || record?.jobExecuteStatus || '').trim();
}

function parseInspectDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const normalized = text.replace(' ', 'T').replace(/\//g, '-');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function formatInspectNoticeDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '--';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function getInspectNextShiftDueDate(planStartDate) {
  if (!(planStartDate instanceof Date) || Number.isNaN(planStartDate.getTime())) {
    return null;
  }

  const minutes = planStartDate.getHours() * 60 + planStartDate.getMinutes();
  const dueDate = new Date(planStartDate);
  dueDate.setSeconds(0, 0);

  const setDueTime = (dayOffset, hour, minute) => {
    dueDate.setDate(planStartDate.getDate() + dayOffset);
    dueDate.setHours(hour, minute, 0, 0);
    return dueDate;
  };

  if (minutes < 9 * 60) {
    return setDueTime(0, 9, 0);
  }
  if (minutes < 15 * 60) {
    return setDueTime(0, 15, 0);
  }
  if (minutes < 20 * 60) {
    return setDueTime(0, 20, 0);
  }
  return setDueTime(1, 2, 30);
}

function getInspectMissedUnsubmittedDetail(record, now = new Date()) {
  if (String(record?.submitTime || '').trim()) {
    return null;
  }

  const planStartDate = parseInspectDate(record?.planStartDatetime);
  if (!planStartDate) {
    return null;
  }

  const dueDate = getInspectNextShiftDueDate(planStartDate);
  if (!dueDate || now < dueDate) {
    return null;
  }

  return {
    record,
    dueDate,
    planStartDate,
    dueText: formatInspectNoticeDateTime(dueDate),
  };
}

function isMissedUnsubmittedInspectRecord(record, now = new Date()) {
  return Boolean(getInspectMissedUnsubmittedDetail(record, now));
}

function hasInspectSubmitTime(record) {
  return Boolean(String(record?.submitTime || '').trim());
}

function getInspectPlanStartDate(record) {
  return parseInspectDate(record?.planStartDatetime);
}

function getInspectPlanEndDate(record) {
  return parseInspectDate(record?.planEndDatetime) || getInspectPlanStartDate(record);
}

function getInspectDayBounds(date) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);
  return { dayStart, dayEnd };
}

function isInspectPlanOverlappingDate(record, date) {
  const start = parseInspectDate(record?.planStartDatetime);
  const end = parseInspectDate(record?.planEndDatetime) || start;
  if (!start && !end) return false;

  const { dayStart, dayEnd } = getInspectDayBounds(date);
  const rangeStart = start || end;
  const rangeEnd = end || start;
  return rangeStart <= dayEnd && rangeEnd >= dayStart;
}

function isInspectPlanOverlappingDay(record, now = new Date()) {
  return isInspectPlanOverlappingDate(record, now);
}

function getInspectBuildingLabel(record) {
  return normalizeRiskBuildingLabel(record?.buildingName)
    || String(record?.buildingName || '').trim()
    || '未识别楼栋';
}

function isCompletedInspectRecord(record) {
  const status = getInspectStatusText(record);
  return hasInspectSubmitTime(record) || status.includes('完成') || status.includes('已');
}

function isPendingInspectRecord(record) {
  const status = getInspectStatusText(record);
  const code = String(record?.jobExecuteStatus || '').toLowerCase();
  return status.includes('待') || code.includes('unplayed');
}

function isOverdueInspectRecord(record) {
  const status = getInspectStatusText(record);
  const code = String(record?.jobExecuteStatus || '').toLowerCase();
  return status.includes('逾期')
    || code.includes('overdue')
    || Boolean(String(record?.overdueReason || '').trim());
}

function isInspectRunningRecord(record) {
  const status = getInspectStatusText(record);
  const code = String(record?.jobExecuteStatus || '').toLowerCase();
  return status.includes('巡检中')
    || status.includes('进行中')
    || code.includes('playing')
    || code.includes('execut')
    || code.includes('running');
}

function getInspectAbnormalCount(record, now = new Date()) {
  const hasAbnormalWorkOrder = isOverdueInspectRecord(record) || isMissedUnsubmittedInspectRecord(record, now);
  return getInspectStatValue(record, 'yc') + (hasAbnormalWorkOrder ? 1 : 0);
}

function getInspectAbnormalFlag(record, now = new Date()) {
  return getInspectAbnormalCount(record, now) > 0 ? '异常' : '';
}

function isTodayUnsubmittedInspectRecord(record, now = new Date()) {
  return !hasInspectSubmitTime(record) && isInspectPlanOverlappingDay(record, now);
}

function getInspectNoticePlanRange(record) {
  const start = getInspectPlanStartDate(record);
  const end = getInspectPlanEndDate(record);
  const startText = start ? formatInspectNoticeDateTime(start) : String(record?.planStartDatetime || '').trim() || '--';
  const endText = end ? formatInspectNoticeDateTime(end) : String(record?.planEndDatetime || '').trim();
  return endText && endText !== startText ? `${startText}-${endText}` : startText;
}

function getInspectAbnormalReasonText(record, now = new Date()) {
  const reasons = [];
  const status = getInspectStatusText(record);
  const abnormalPoints = getInspectStatValue(record, 'yc');
  const overdueReason = String(record?.overdueReason || '').trim();

  if (abnormalPoints > 0) {
    reasons.push(`异常点 ${abnormalPoints}`);
  }
  if (isOverdueInspectRecord(record)) {
    reasons.push(hasInspectSubmitTime(record) ? '逾期完成' : '逾期未提交');
  }
  if (isMissedUnsubmittedInspectRecord(record, now)) {
    reasons.push('逾班未提交');
  }
  if (overdueReason) {
    reasons.push(overdueReason);
  }

  return Array.from(new Set(reasons)).join('，') || status || '异常';
}

function formatInspectRecordSummaryLine(record, index, options = {}) {
  const building = getInspectBuildingLabel(record);
  const user = String(record?.userName || '').trim() || '未分配';
  const status = getInspectStatusText(record) || '无状态';
  const planRange = getInspectNoticePlanRange(record);
  const reason = options.includeReason ? getInspectAbnormalReasonText(record, options.now || new Date()) : '';
  const suffix = reason ? `｜${reason}` : '';
  return `${index + 1}. ${building}｜${user}｜${planRange}｜${status}${suffix}`;
}

function formatInspectRecordListSummary(records, limit = 20, options = {}) {
  const items = Array.isArray(records) ? records : [];
  const maxItems = Math.max(1, Number(limit) || 20);
  const lines = items
    .slice(0, maxItems)
    .map((record, index) => formatInspectRecordSummaryLine(record, index, options));
  if (items.length > maxItems) {
    lines.push(`另有 ${items.length - maxItems} 单未展开`);
  }

  return lines.join('\n');
}

const INSPECT_TODAY_UNSUBMITTED_GROUPS = [
  { key: 'endedUnsubmitted', title: '已到巡检结束还未提交（重点）' },
  { key: 'pastStartNotStarted', title: '已过巡检开始还未开始' },
  { key: 'inspecting', title: '巡检中' },
  { key: 'notStarted', title: '未开始' },
  { key: 'other', title: '其他未提交' },
];

const INSPECT_TODAY_UNSUBMITTED_COUNT_ORDER = [
  { key: 'inspecting', title: '巡检中' },
  { key: 'notStarted', title: '未开始' },
  { key: 'pastStartNotStarted', title: '已过开始未开始' },
  { key: 'endedUnsubmitted', title: '已到结束未提交' },
  { key: 'other', title: '其他' },
];

function classifyInspectTodayUnsubmittedRecord(record, now = new Date()) {
  if (!isTodayUnsubmittedInspectRecord(record, now)) {
    return '';
  }

  const start = getInspectPlanStartDate(record);
  const end = getInspectPlanEndDate(record);
  if (end && now >= end) {
    return 'endedUnsubmitted';
  }
  if (isInspectRunningRecord(record)) {
    return 'inspecting';
  }
  if (start && now < start) {
    return 'notStarted';
  }
  if (start && now >= start) {
    return 'pastStartNotStarted';
  }
  return 'other';
}

function groupInspectTodayUnsubmittedRecords(records, now = new Date()) {
  const groups = Object.fromEntries(INSPECT_TODAY_UNSUBMITTED_GROUPS.map((group) => [group.key, []]));
  (Array.isArray(records) ? records : []).forEach((record) => {
    const groupKey = classifyInspectTodayUnsubmittedRecord(record, now);
    if (!groupKey) return;
    groups[groupKey].push(record);
  });

  Object.values(groups).forEach((items) => {
    items.sort((left, right) => String(left?.planStartDatetime || '').localeCompare(String(right?.planStartDatetime || ''), 'zh-CN'));
  });
  return groups;
}

function countInspectTodayUnsubmittedGroups(groups) {
  return Object.values(groups || {}).reduce((total, items) => total + (Array.isArray(items) ? items.length : 0), 0);
}

function formatInspectTodayGroupCountSummary(groups) {
  return INSPECT_TODAY_UNSUBMITTED_COUNT_ORDER
    .map((group) => {
      const count = Array.isArray(groups?.[group.key]) ? groups[group.key].length : 0;
      return `${group.title} ${count}`;
    })
    .join('、');
}

function formatInspectTodayUnsubmittedGroupedSummary(groups, limitPerGroup = 12) {
  return INSPECT_TODAY_UNSUBMITTED_GROUPS
    .map((group) => {
      const items = Array.isArray(groups?.[group.key]) ? groups[group.key] : [];
      if (items.length === 0) return '';
      return `【${group.title}】${items.length} 单\n${formatInspectRecordListSummary(items, limitPerGroup)}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function formatInspectMissedUnsubmittedSummary(records, now = new Date(), limit = 20) {
  return formatInspectRecordListSummary(records, limit, { includeReason: true, now });
}

function getYesterdayInspectAbnormalRecords(records, now = new Date()) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return (Array.isArray(records) ? records : [])
    .filter((record) => isInspectPlanOverlappingDate(record, yesterday))
    .filter((record) => getInspectAbnormalCount(record, now) > 0)
    .sort((left, right) => String(left?.planStartDatetime || '').localeCompare(String(right?.planStartDatetime || ''), 'zh-CN'));
}

function formatInspectYesterdayAbnormalSummary(records, now = new Date(), limit = 20) {
  return formatInspectRecordListSummary(records, limit, { includeReason: true, now });
}

function createEmptyInspectFeishuFields() {
  return Object.fromEntries(INSPECT_FEISHU_FIELD_NAMES.map((fieldName) => [fieldName, '']));
}

function mapInspectJobToFeishuFields(record, index = 0, now = new Date()) {
  const item = record || {};
  const fields = {
    序号: String(index + 1),
    工单名称: String(item.planName || ''),
    数据中心: String(item.datacenterName || ''),
    楼栋: getInspectBuildingLabel(item),
    位置信息: String(item.locations || ''),
    巡检人: String(item.userName || ''),
    巡检类型: getInspectCycleText(item.executeCycle),
    计划区间: formatInspectPlanRange(item),
    提交时间: String(item.submitTime || ''),
    接单时间: String(item.orderReceiveTime || item.execStartTime || ''),
    巡检结果: formatInspectResult(item),
    工单状态: getInspectStatusText(item),
    逾期原因: String(item.overdueReason || ''),
  };
  const abnormalFlag = getInspectAbnormalFlag(item, now);
  if (abnormalFlag) {
    fields.异常标 = abnormalFlag;
  }
  return fields;
}

function formatInspectBuildingSummary(statsMap) {
  return getOrderedDrillBuildingLabels(statsMap)
    .map((label) => {
      const stats = statsMap.get(label) || { total: 0, completed: 0, pending: 0, abnormal: 0 };
      return `${label}：工单 ${stats.total}，完成 ${stats.completed}，待巡检 ${stats.pending}，异常点 ${stats.abnormal}`;
    })
    .join('\n');
}

function buildInspectSyncSummary(records, options = {}) {
  const items = Array.isArray(records) ? records : [];
  const now = options.now instanceof Date ? options.now : new Date();
  const statusCounter = new Map();
  const buildingStatsMap = new Map(RISK_BUILDING_SUMMARY_ORDER.map((label) => [label, {
    total: 0,
    completed: 0,
    pending: 0,
    abnormal: 0,
  }]));

  let pointTotal = 0;
  let abnormalTotal = 0;
  items.forEach((record) => {
    const statusText = getInspectStatusText(record) || '未知状态';
    const buildingLabel = getInspectBuildingLabel(record);
    const stats = buildingStatsMap.get(buildingLabel) || {
      total: 0,
      completed: 0,
      pending: 0,
      abnormal: 0,
    };
    const abnormal = getInspectAbnormalCount(record, now);

    incrementCounter(statusCounter, statusText);
    pointTotal += getInspectStatValue(record, 'total');
    abnormalTotal += abnormal;
    stats.total += 1;
    stats.abnormal += abnormal;
    if (isCompletedInspectRecord(record)) stats.completed += 1;
    if (isPendingInspectRecord(record)) stats.pending += 1;
    buildingStatsMap.set(buildingLabel, stats);
  });

  const pendingCount = items.filter(isPendingInspectRecord).length;
  const completedCount = items.filter(isCompletedInspectRecord).length;
  const todayUnsubmittedRecords = items
    .filter((record) => isTodayUnsubmittedInspectRecord(record, now))
    .sort((left, right) => String(left?.planStartDatetime || '').localeCompare(String(right?.planStartDatetime || ''), 'zh-CN'));
  const todayUnsubmittedGroups = groupInspectTodayUnsubmittedRecords(todayUnsubmittedRecords, now);
  const todayUnsubmittedCount = countInspectTodayUnsubmittedGroups(todayUnsubmittedGroups);
  const todayUnsubmittedGroupSummary = todayUnsubmittedCount > 0
    ? formatInspectTodayGroupCountSummary(todayUnsubmittedGroups)
    : '';
  const todayEndedUnsubmittedCount = todayUnsubmittedGroups.endedUnsubmitted.length;
  const todayUnsubmittedSummary = formatInspectTodayUnsubmittedGroupedSummary(todayUnsubmittedGroups);
  const yesterdayAbnormalRecords = getYesterdayInspectAbnormalRecords(items, now);
  const yesterdayAbnormalSummary = formatInspectYesterdayAbnormalSummary(yesterdayAbnormalRecords, now);
  const missedUnsubmittedRecords = items
    .filter((record) => isMissedUnsubmittedInspectRecord(record, now))
    .sort((left, right) => String(left?.planStartDatetime || '').localeCompare(String(right?.planStartDatetime || ''), 'zh-CN'));
  const missedUnsubmittedSummary = formatInspectMissedUnsubmittedSummary(missedUnsubmittedRecords, now);
  const statusSummary = formatCounterSummary(statusCounter, 0);
  const buildingSummary = formatInspectBuildingSummary(buildingStatsMap);
  const syncTime = formatChangeSyncTime();
  const rangeText = `${options.rangeStart || ''} - ${options.rangeEnd || ''}`.trim();
  const linkUrl = getInspectBitableWebUrl();
  const tips = [
    yesterdayAbnormalRecords.length > 0 ? `昨日异常项 ${yesterdayAbnormalRecords.length} 单，请复盘闭环` : '',
    todayEndedUnsubmittedCount > 0 ? `今日已到巡检结束还未提交 ${todayEndedUnsubmittedCount} 单，请立即跟进` : '',
    missedUnsubmittedRecords.length > 0 ? `逾班未提交 ${missedUnsubmittedRecords.length} 单，已计入异常项，请优先处理` : '',
    todayUnsubmittedCount > 0 ? `今日未提交 ${todayUnsubmittedCount} 单：${todayUnsubmittedGroupSummary}` : '',
    pendingCount > 0 ? `本月待巡检 ${pendingCount} 单，请关注计划执行` : '',
    abnormalTotal > 0 ? `本月异常点 ${abnormalTotal} 个（含逾期/逾班未提交工单），请关注巡检结果` : '',
  ].filter(Boolean).join('\n');
  const distributionLine = [
    statusSummary ? `工单状态 ${statusSummary}` : '',
    `点位总数 ${pointTotal}`,
    `异常点 ${abnormalTotal}（含逾期/逾班未提交）`,
  ].filter(Boolean).join('；');

  return {
    hasImportant: abnormalTotal > 0 || yesterdayAbnormalRecords.length > 0 || todayEndedUnsubmittedCount > 0,
    abnormalTotal,
    missedUnsubmittedCount: missedUnsubmittedRecords.length,
    notifyMessage: buildSyncCardMessage({
      title: '巡检拉取同步',
      template: (abnormalTotal + missedUnsubmittedRecords.length + yesterdayAbnormalRecords.length + todayEndedUnsubmittedCount) > 0 ? 'red' : ((todayUnsubmittedCount + pendingCount) > 0 ? 'yellow' : 'green'),
      fallbackLines: [
        '【巡检拉取同步】',
        `同步时间：${syncTime}`,
        rangeText ? `本月范围：${rangeText}` : '',
        `覆盖工单：${items.length} 条`,
        distributionLine ? `分布概览：${distributionLine}` : '',
        todayUnsubmittedGroupSummary ? `今日未提交分组：${todayUnsubmittedGroupSummary}` : '',
        yesterdayAbnormalSummary ? `昨日异常项：\n${yesterdayAbnormalSummary}` : '',
        missedUnsubmittedSummary ? `异常未提交：\n${missedUnsubmittedSummary}` : '',
        todayUnsubmittedSummary ? `今日未提交：\n${todayUnsubmittedSummary}` : '',
        tips ? `提示：\n${tips}` : '',
        buildingSummary ? `楼栋进展：\n${buildingSummary}` : '',
        `多维表：${linkUrl}`,
      ],
      overviewLines: [
        `**同步时间**：${escapeFeishuCardMarkdown(syncTime)}`,
        rangeText ? `**本月范围**：${escapeFeishuCardMarkdown(rangeText)}` : '',
        `**覆盖工单**：${items.length} 条`,
        distributionLine ? `**分布概览**：${escapeFeishuCardMarkdown(distributionLine)}` : '',
        yesterdayAbnormalRecords.length > 0 ? `**昨日异常项**：${yesterdayAbnormalRecords.length} 单` : '',
        missedUnsubmittedRecords.length > 0 ? `**异常未提交**：${missedUnsubmittedRecords.length} 单` : '',
        todayUnsubmittedCount > 0 ? `**今日未提交**：${todayUnsubmittedCount} 单（${escapeFeishuCardMarkdown(todayUnsubmittedGroupSummary)}）` : '',
        `**多维表**：[打开](${linkUrl})`,
      ],
      sections: [
        { title: '昨日异常项（重点）', content: escapeFeishuCardMarkdown(yesterdayAbnormalSummary) },
        { title: '今日未提交分组', content: escapeFeishuCardMarkdown(todayUnsubmittedSummary) },
        { title: '逾班未提交', content: escapeFeishuCardMarkdown(missedUnsubmittedSummary) },
        { title: '提示', content: escapeFeishuCardMarkdown(tips) },
        { title: '楼栋进展', content: escapeFeishuCardMarkdown(buildingSummary) },
      ],
    }),
    successMessage: ({ insertedCount, deletedCount }) => (
      `巡检本月同步完成：删除旧记录 ${deletedCount} 条，覆盖写入 ${insertedCount} 条，本月完成 ${completedCount} 条，待巡检 ${pendingCount} 条，今日未提交 ${todayUnsubmittedCount} 条（${todayUnsubmittedGroupSummary || '无'}），昨日异常 ${yesterdayAbnormalRecords.length} 条，逾班未提交 ${missedUnsubmittedRecords.length} 条，异常点 ${abnormalTotal}（含逾期/逾班未提交）`
    ),
  };
}

async function executeInspectSyncPipeline(options = {}) {
  const startedAt = Date.now();
  const fetchResult = await fetchInspectJobsForCurrentMonth();
  const inspectFeishuClient = createInspectFeishuClient();
  const syncNow = new Date();
  const summary = buildInspectSyncSummary(fetchResult.records, {
    rangeStart: fetchResult.rangeStart,
    rangeEnd: fetchResult.rangeEnd,
    now: syncNow,
  });

  let syncResult;
  if (fetchResult.records.length === 0) {
    await inspectFeishuClient.ensureFields([{ fields: createEmptyInspectFeishuFields() }]);
    const deleteResult = await inspectFeishuClient.deleteAllRecords();
    let notified = false;
    let message = `巡检本月接口已拉取，但没有可同步记录，已确认字段并清空旧数据 ${Number(deleteResult.deletedCount || 0)} 条`;
    if (options.notify !== false) {
      try {
        await inspectFeishuClient.sendMessageToChat(summary.notifyMessage, options.chatName);
        notified = true;
        message = `${message}，群通知已发送`;
      } catch (error) {
        message = `${message}，但群通知发送失败：${inspectFeishuClient.explainChatError(error)}`;
      }
    }
    syncResult = {
      success: Boolean(deleteResult.success),
      insertedCount: 0,
      deletedCount: Number(deleteResult.deletedCount || 0),
      notified,
      message,
    };
  } else {
    syncResult = await inspectFeishuClient.replaceTableRecords(
      fetchResult.records.map((record, index) => ({ fields: mapInspectJobToFeishuFields(record, index, syncNow) })),
      {
        notify: options.notify,
        notifyMessage: summary.notifyMessage,
        successMessage: summary.successMessage,
      },
    );
  }

  const extraAbnormalNotifyResult = await sendExtraAbnormalNotifyMessage({
    moduleName: '巡检异常',
    summary,
    createClient: createInspectFeishuClient,
    primaryChatId: process.env.INSPECT_FEISHU_NOTIFY_CHAT_ID || process.env.FEISHU_NOTIFY_CHAT_ID || '',
    enabled: options.notify !== false,
  });
  if (extraAbnormalNotifyResult.message) {
    syncResult.message = [syncResult.message, extraAbnormalNotifyResult.message].filter(Boolean).join('；');
  }

  const insertedCount = Number(syncResult.insertedCount || 0);
  const dataSuccess = fetchResult.records.length === 0
    ? Boolean(syncResult.success)
    : insertedCount === fetchResult.records.length;
  const cacheCleanup = dataSuccess ? await cleanupLightweightSyncCache('inspect') : null;

  return {
    success: dataSuccess,
    mode: 'monthly',
    fetchedCount: fetchResult.records.length,
    total: fetchResult.records.length,
    insertedCount,
    deletedCount: Number(syncResult.deletedCount || 0),
    failedCount: Math.max(fetchResult.records.length - insertedCount, 0),
    notified: Boolean(syncResult.notified),
    totalFromApi: Number(fetchResult.total || 0),
    totalPages: Number(fetchResult.totalPages || 0),
    rangeStart: fetchResult.rangeStart,
    rangeEnd: fetchResult.rangeEnd,
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    records: fetchResult.records.slice(0, INSPECT_SYNC_PREVIEW_LIMIT),
    previewLimit: INSPECT_SYNC_PREVIEW_LIMIT,
    cacheCleanup,
    bitableUrl: getInspectBitableWebUrl(),
    message: syncResult.message || '',
  };
}

async function runInspectAutoSyncOnce(runContext = {}) {
  if (!INSPECT_AUTO_SYNC_ENABLED || inspectAutoSyncState.running) {
    return;
  }

  inspectAutoSyncState.running = true;
  inspectAutoSyncState.queued = false;
  inspectAutoSyncState.lastAttemptAt = new Date().toISOString();
  inspectAutoSyncState.lastError = '';
  inspectAutoSyncState.statusMessage = '正在拉取巡检本月数据并覆盖飞书';

  try {
    const shouldNotify = shouldNotifyInspectAutoSyncRun(runContext);
    const syncResult = await executeInspectSyncPipeline({ notify: shouldNotify });
    if (!syncResult.success) {
      throw new Error(syncResult.message || '巡检本月同步飞书失败');
    }

    inspectAutoSyncState.lastSuccessAt = new Date().toISOString();
    inspectAutoSyncState.lastInsertedCount = Number(syncResult.insertedCount || 0);
    inspectAutoSyncState.lastError = '';
    inspectAutoSyncState.statusMessage = `完成，拉取 ${syncResult.fetchedCount || 0} 条，写入 ${inspectAutoSyncState.lastInsertedCount} 条`;

    console.log(`[inspect-auto-sync] completed schedule=${runContext.scheduleLabel || '--'} notifyAllowed=${shouldNotify} fetched=${syncResult.fetchedCount || 0} deleted=${syncResult.deletedCount || 0} inserted=${inspectAutoSyncState.lastInsertedCount} notified=${Boolean(syncResult.notified)} cacheCleanup=${syncResult.cacheCleanup?.success !== false} message=${String(syncResult.message || '').replace(/\s+/g, ' ')}`);
  } catch (error) {
    inspectAutoSyncState.lastError = error instanceof Error ? error.message : String(error);
    inspectAutoSyncState.statusMessage = inspectAutoSyncState.lastError;
    console.warn(`[inspect-auto-sync] failed: ${inspectAutoSyncState.lastError}`);
  } finally {
    inspectAutoSyncState.running = false;
  }
}

function scheduleNextInspectAutoSync() {
  scheduleRecurringSyncTask({
    enabled: INSPECT_AUTO_SYNC_ENABLED,
    state: inspectAutoSyncState,
    tag: 'inspect-auto-sync',
    scheduleEntries: INSPECT_AUTO_SYNC_SCHEDULES,
    runTask: runInspectAutoSyncOnce,
    disabledMessage: 'disabled by INSPECT_AUTO_SYNC_ENABLED=false',
  });
}

async function fetchDrillEvaluationEventsForAutoSync() {
  const firstResult = await fetchDrillPayloadInBrowser({
    url: DRILL_EVALUATION_URL,
    method: 'POST',
    payload: createDrillEvaluationSyncPayload(1),
  });
  const firstPage = parseDrillEvaluationPage(firstResult.data, 1);
  console.log(`[drill-auto-sync] evaluation page=1 totalPages=${firstPage.totalPages} total=${firstPage.total} records=${firstPage.records.length}`);
  if (firstPage.totalPages > DRILL_EVALUATION_MAX_PAGES) {
    throw new Error(`演练评估事件接口总页数 ${firstPage.totalPages} 超过安全上限 ${DRILL_EVALUATION_MAX_PAGES}，已停止拉取`);
  }

  const allRecords = [...firstPage.records];
  if (firstPage.totalPages <= 1) {
    return allRecords;
  }

  const remainingPages = Array.from({ length: firstPage.totalPages - 1 }, (_, index) => index + 2);
  const pageResults = await runConcurrentWorkers({
    items: remainingPages,
    concurrency: DRILL_EVALUATION_LIST_CONCURRENCY,
    worker: async (pageNumber) => {
      const pageResult = await fetchDrillPayloadInBrowser({
        url: DRILL_EVALUATION_URL,
        method: 'POST',
        payload: createDrillEvaluationSyncPayload(pageNumber),
      });
      const pageData = parseDrillEvaluationPage(pageResult.data, pageNumber);
      console.log(`[drill-auto-sync] evaluation page=${pageNumber} totalPages=${pageData.totalPages} records=${pageData.records.length}`);
      return {
        pageNumber,
        pageData,
      };
    },
  });

  pageResults
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .forEach(({ pageData }) => {
      allRecords.push(...pageData.records);
    });

  return allRecords;
}

async function executeDrillSyncPipeline({ notify = true } = {}) {
  const startedAt = Date.now();
  const records = await fetchDrillExercisePlansForAutoSync();
  if (records.length === 0) {
    throw new Error('演练计划列表已获取，但没有可同步记录');
  }

  const evaluationEvents = await fetchDrillEvaluationEventsForAutoSync();
  const enrichedResult = enrichDrillRecordsWithEvaluationEvents(records, evaluationEvents);
  const detailResult = await enrichDrillRecordsWithEvaluationDetails(enrichedResult.records);
  const recordsReadyForSync = detailResult.records;
  const summary = buildDrillSyncSummary(recordsReadyForSync, {
    evaluationMatchedCount: enrichedResult.matchedCount,
  });
  const monthlyCount = Number(summary.monthlyCount || 0);

  const drillFeishuClient = createDrillFeishuClient();
  const syncResult = await drillFeishuClient.replaceTableRecords(
    recordsReadyForSync.map((record) => ({ fields: mapDrillRecordToFeishuFields(record) })),
    {
      notify,
      notifyMessage: summary.notifyMessage,
      successMessage: summary.successMessage,
    },
  );

  if (!syncResult.success && Number(syncResult.insertedCount || 0) === 0) {
    throw new Error(syncResult.message || '演练计划同步飞书失败');
  }

  const insertedCount = Number(syncResult.insertedCount || 0);
  const cleanupResult = insertedCount > 0 ? await cleanupLightweightSyncCache('drill') : null;

  return {
    success: insertedCount,
    failed: syncResult.success ? 0 : Math.max(recordsReadyForSync.length - insertedCount, 0),
    total: recordsReadyForSync.length,
    fetchedCount: records.length,
    monthlyCount,
    insertedCount,
    notified: Boolean(syncResult.notified),
    message: syncResult.message || '',
    evaluationEventCount: evaluationEvents.length,
    evaluationMatchedCount: enrichedResult.matchedCount,
    evaluationDetailFetchedCount: detailResult.detailFetchedCount,
    evaluationDetailFailedCount: detailResult.detailFailedCount,
    evaluationScoreMatchedCount: detailResult.scoreMatchedCount,
    notExecutedCount: recordsReadyForSync.filter((record) => record?.executeStatus === 'NOT_EXECUTED').length,
    eventLinkedCount: recordsReadyForSync.filter((record) => Array.isArray(record?.relatedEventList) && record.relatedEventList.length > 0).length,
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    cacheCleanup: cleanupResult,
  };
}

async function runDrillAutoSyncOnce(runContext = {}) {
  if (!DRILL_AUTO_SYNC_ENABLED || drillAutoSyncState.running) {
    return;
  }
  if (shouldSkipAutoSyncMessageRun(runContext)) {
    console.log(`[drill-auto-sync] skipped message schedule=${runContext.scheduleLabel || '--'} because message is not due`);
    return;
  }

  drillAutoSyncState.running = true;
  drillAutoSyncState.queued = false;
  drillAutoSyncState.lastAttemptAt = new Date().toISOString();
  drillAutoSyncState.lastError = '';
  drillAutoSyncState.statusMessage = '正在拉取演练计划与评估事件';

  try {
    const shouldNotify = shouldNotifyAutoSyncRun(runContext);
    const syncResult = await executeDrillSyncPipeline({ notify: shouldNotify });

    drillAutoSyncState.lastSuccessAt = new Date().toISOString();
    drillAutoSyncState.lastInsertedCount = Number(syncResult.insertedCount || 0);
    drillAutoSyncState.lastError = Number(syncResult.failed || 0) > 0 ? (syncResult.message || '') : '';
    drillAutoSyncState.statusMessage = `完成，写入 ${drillAutoSyncState.lastInsertedCount} 条`;

    console.log(`[drill-auto-sync] completed notifyAllowed=${shouldNotify} records=${syncResult.total} inserted=${drillAutoSyncState.lastInsertedCount} notified=${Boolean(syncResult.notified)} cacheCleanup=${syncResult.cacheCleanup?.success !== false} message=${String(syncResult.message || '').replace(/\s+/g, ' ')}`);
    console.log(`[drill-auto-sync] evaluation events=${syncResult.evaluationEventCount} matched=${syncResult.evaluationMatchedCount}`);
    console.log(`[drill-auto-sync] evaluation details fetched=${syncResult.evaluationDetailFetchedCount} failed=${syncResult.evaluationDetailFailedCount} scored=${syncResult.evaluationScoreMatchedCount}`);
  } catch (error) {
    drillAutoSyncState.lastError = error instanceof Error ? error.message : String(error);
    drillAutoSyncState.statusMessage = drillAutoSyncState.lastError;
    console.warn(`[drill-auto-sync] failed: ${drillAutoSyncState.lastError}`);
  } finally {
    drillAutoSyncState.running = false;
  }
}

function scheduleNextDrillAutoSync() {
  scheduleRecurringSyncTask({
    enabled: DRILL_AUTO_SYNC_ENABLED,
    state: drillAutoSyncState,
    tag: 'drill-auto-sync',
    scheduleEntries: DRILL_AUTO_SYNC_SCHEDULES,
    runTask: runDrillAutoSyncOnce,
    disabledMessage: 'disabled by DRILL_AUTO_SYNC_ENABLED=false',
  });
}

function createEventSyncPayload(pageNumber = 1, pageSize = EVENT_AUTO_SYNC_PAGE_SIZE, overrides = {}) {
  const basePayload = {
    creator: EVENT_AUTO_SYNC_CREATOR,
    deviceName: '',
    domainCodeList: ['5', '6', '7', '8', '9'],
    endAskDate: '',
    endDate: '',
    endHappendDate: '',
    endIncidentRecoveryDate: '',
    endResponseDate: '',
    eventAlarmStatus: '',
    eventCurrentLevel: '',
    eventFirstLevel: '',
    eventHighestLevel: '',
    eventSourceList: [],
    eventTitle: '',
    eventType: '',
    orderStatus: '1,2,3,4,6',
    pageBean: {
      pageNumber,
      pageSize,
    },
    realEvent: '',
    startAskDate: '',
    startDate: '',
    startHappendDate: '',
    startIncidentRecoveryDate: '',
    startResponseDate: '',
    userId: EVENT_AUTO_SYNC_USER_ID,
  };

  return {
    ...basePayload,
    ...overrides,
    pageBean: {
      ...basePayload.pageBean,
      ...(overrides.pageBean || {}),
      pageNumber,
      pageSize,
    },
  };
}

function formatEventDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function getRecentEventDateRange(now = new Date(), lookbackDays = EVENT_INCREMENTAL_SYNC_LOOKBACK_DAYS) {
  const normalizedDays = Math.max(1, Number(lookbackDays) || 30);
  const start = new Date(now);
  start.setDate(start.getDate() - normalizedDays + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 0);
  return {
    startDate: formatEventDateTime(start),
    endDate: formatEventDateTime(end),
  };
}

function createIncrementalEventSyncPayload(
  pageNumber = 1,
  pageSize = EVENT_AUTO_SYNC_PAGE_SIZE,
  now = new Date(),
  dateFields = {},
) {
  const dateRange = getRecentEventDateRange(now);
  const overrides = {
    orderStatus: EVENT_INCREMENTAL_SYNC_ORDER_STATUS,
  };
  const startField = dateFields.startField || EVENT_INCREMENTAL_SYNC_START_DATE_FIELD;
  const endField = dateFields.endField || EVENT_INCREMENTAL_SYNC_END_DATE_FIELD;
  if (startField) {
    overrides[startField] = dateRange.startDate;
  }
  if (endField) {
    overrides[endField] = dateRange.endDate;
  }

  return createEventSyncPayload(pageNumber, pageSize, overrides);
}

function getIncrementalEventSyncScopes() {
  const scopes = [
    {
      name: 'incremental-created',
      label: '产生时间',
      startField: EVENT_INCREMENTAL_CREATED_START_DATE_FIELD,
      endField: EVENT_INCREMENTAL_CREATED_END_DATE_FIELD,
    },
    {
      name: 'incremental-happen',
      label: '发生时间',
      startField: EVENT_INCREMENTAL_HAPPEN_START_DATE_FIELD,
      endField: EVENT_INCREMENTAL_HAPPEN_END_DATE_FIELD,
    },
  ];
  const seenKeys = new Set();
  return scopes.filter((scope) => {
    if (!scope.startField && !scope.endField) {
      return false;
    }
    const key = `${scope.startField || ''}|${scope.endField || ''}`;
    if (seenKeys.has(key)) {
      return false;
    }
    seenKeys.add(key);
    return true;
  });
}

function createFullEventSyncPayload(pageNumber = 1, pageSize = EVENT_AUTO_SYNC_PAGE_SIZE) {
  const overrides = {
    orderStatus: EVENT_FULL_SYNC_ORDER_STATUS,
  };
  if (EVENT_FULL_SYNC_START_DATE_FIELD && EVENT_FULL_SYNC_START_DATE) {
    overrides[EVENT_FULL_SYNC_START_DATE_FIELD] = EVENT_FULL_SYNC_START_DATE;
  }
  if (EVENT_FULL_SYNC_END_DATE_FIELD && EVENT_FULL_SYNC_END_DATE) {
    overrides[EVENT_FULL_SYNC_END_DATE_FIELD] = EVENT_FULL_SYNC_END_DATE;
  }

  return createEventSyncPayload(pageNumber, pageSize, overrides);
}

function parseEventPage(payload, pageNumber) {
  if (payload?.code && payload.code !== '200') {
    throw new Error(payload?.message || `事件列表第 ${pageNumber} 页返回失败`);
  }
  if (payload?.success === false) {
    throw new Error(payload?.message || `事件列表第 ${pageNumber} 页返回失败`);
  }

  const records = Array.isArray(payload?.data?.dataList)
    ? payload.data.dataList
    : Array.isArray(payload?.data?.records)
      ? payload.data.records
      : Array.isArray(payload?.data?.list)
        ? payload.data.list
        : [];
  const total = Number(
    payload?.data?.total
      || payload?.data?.count
      || payload?.data?.totalCount
      || payload?.data?.totalRecords
      || payload?.data?.pageBean?.total
      || payload?.data?.pageBean?.totalCount
      || 0,
  );
  const rawPages = Number(
    payload?.data?.pages
      || payload?.data?.totalPages
      || payload?.data?.pageCount
      || payload?.data?.pageBean?.pages
      || payload?.data?.pageBean?.totalPages
      || 0,
  );
  const totalPages = Number.isFinite(rawPages) && rawPages > 0
    ? Math.max(1, Math.ceil(rawPages))
    : total > 0
      ? Math.max(1, Math.ceil(total / EVENT_AUTO_SYNC_PAGE_SIZE))
      : 1;

  return {
    records,
    total: Number.isFinite(total) && total > 0 ? total : 0,
    totalPages,
  };
}

function getEventStableKey(record) {
  const key = String(record?.id || record?.eventNumber || '').trim();
  return key || '';
}

function mergeEventRecordSets(primaryRecords, secondaryRecords) {
  const mergedRecords = [...(Array.isArray(primaryRecords) ? primaryRecords : [])];
  const seenKeys = new Set(
    mergedRecords
      .map((record) => getEventStableKey(record))
      .filter(Boolean),
  );
  let addedSecondaryCount = 0;

  (Array.isArray(secondaryRecords) ? secondaryRecords : []).forEach((record) => {
    const key = getEventStableKey(record);
    if (key && seenKeys.has(key)) {
      return;
    }
    mergedRecords.push(record);
    addedSecondaryCount += 1;
    if (key) {
      seenKeys.add(key);
    }
  });

  return {
    records: mergedRecords,
    addedSecondaryCount,
  };
}

async function fetchEventRecordsForScope(scopeName, payloadFactory, options = {}) {
  const firstResult = await fetchEventPayloadInBrowserWithRetry({
    url: EVENT_LIST_URL,
    method: 'POST',
    payload: payloadFactory(1),
  }, {
    label: `事件${scopeName}第 1 页`,
  });
  const firstPage = parseEventPage(firstResult.data, 1);
  console.log(`[event-auto-sync] ${scopeName} page=1 totalPages=${firstPage.totalPages} total=${firstPage.total} records=${firstPage.records.length}`);
  options.onProgress?.({
    scopeName,
    completedPages: 1,
    totalPages: firstPage.totalPages,
    records: firstPage.records.length,
    totalFromApi: firstPage.total,
  });
  if (firstPage.totalPages > EVENT_AUTO_SYNC_MAX_PAGES) {
    throw new Error(`事件${scopeName}接口总页数 ${firstPage.totalPages} 超过安全上限 ${EVENT_AUTO_SYNC_MAX_PAGES}，已停止拉取`);
  }

  const allRecords = [...firstPage.records];
  let completedPages = 1;
  let fetchedRecords = firstPage.records.length;
  if (firstPage.totalPages <= 1) {
    return {
      records: allRecords,
      total: firstPage.total,
      totalPages: firstPage.totalPages,
    };
  }

  const remainingPages = Array.from({ length: firstPage.totalPages - 1 }, (_, index) => index + 2);
  const pageResults = await runConcurrentWorkers({
    items: remainingPages,
    concurrency: EVENT_AUTO_SYNC_LIST_CONCURRENCY,
    worker: async (pageNumber) => {
      const pageResult = await fetchEventPayloadInBrowserWithRetry({
        url: EVENT_LIST_URL,
        method: 'POST',
        payload: payloadFactory(pageNumber),
      }, {
        label: `事件${scopeName}第 ${pageNumber} 页`,
      });
      const pageData = parseEventPage(pageResult.data, pageNumber);
      console.log(`[event-auto-sync] ${scopeName} page=${pageNumber} totalPages=${pageData.totalPages} records=${pageData.records.length}`);
      completedPages += 1;
      fetchedRecords += pageData.records.length;
      options.onProgress?.({
        scopeName,
        completedPages,
        totalPages: firstPage.totalPages,
        records: fetchedRecords,
        totalFromApi: firstPage.total,
      });
      return {
        pageNumber,
        pageData,
      };
    },
  });

  pageResults
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .forEach(({ pageData }) => {
      allRecords.push(...pageData.records);
    });

  return {
    records: allRecords,
    total: firstPage.total,
    totalPages: firstPage.totalPages,
  };
}

async function fetchEventRecordsForIncrementalSync(options = {}) {
  const now = new Date();
  const dateRange = getRecentEventDateRange(now);
  const scopeResults = [];
  for (const scope of getIncrementalEventSyncScopes()) {
    const scopeResult = await fetchEventRecordsForScope(
      scope.name,
      (pageNumber) => createIncrementalEventSyncPayload(pageNumber, EVENT_AUTO_SYNC_PAGE_SIZE, now, scope),
      {
        ...options,
        onProgress: (state) => options.onProgress?.({
          ...state,
          scopeName: scope.name,
          scopeLabel: scope.label,
        }),
      },
    );
    scopeResults.push({
      ...scopeResult,
      scope,
    });
  }

  const mergedResult = scopeResults.reduce(
    (current, scopeResult) => mergeEventRecordSets(current.records, scopeResult.records),
    { records: [], addedSecondaryCount: 0 },
  );
  const records = (Array.isArray(mergedResult.records) ? mergedResult.records : [])
    .filter((record) => isRecentEventRecord(record, now));
  return {
    records,
    total: records.length,
    totalPages: scopeResults.reduce((sum, item) => sum + Number(item.totalPages || 0), 0),
    scopeTotals: scopeResults.map((item) => ({
      name: item.scope?.name || '',
      label: item.scope?.label || '',
      total: Number(item.total || 0),
      records: Array.isArray(item.records) ? item.records.length : 0,
      totalPages: Number(item.totalPages || 0),
    })),
    activeCount: records.filter((record) => !isCompletedEventRecord(record)).length,
    completedCount: records.filter(isCompletedEventRecord).length,
    completedAddedCount: mergedResult.addedSecondaryCount,
    rangeStartDate: dateRange.startDate,
    rangeEndDate: dateRange.endDate,
  };
}

async function fetchEventRecordsForFullSync(options = {}) {
  const fullResult = await fetchEventRecordsForScope('full', (pageNumber) => createFullEventSyncPayload(pageNumber), options);
  const records = Array.isArray(fullResult.records) ? fullResult.records : [];
  return {
    records,
    total: fullResult.total,
    totalPages: fullResult.totalPages,
    activeCount: records.filter((record) => !isCompletedEventRecord(record)).length,
    completedCount: records.filter(isCompletedEventRecord).length,
    completedAddedCount: 0,
  };
}

function isCompletedEventSnapshot(snapshot) {
  const orderStatus = String(snapshot?.orderStatus ?? '').trim();
  const orderStatusText = String(snapshot?.orderStatusText || normalizeEventOrderStatus(orderStatus)).trim();
  return orderStatus === EVENT_COMPLETED_ORDER_STATUS || orderStatusText === '完成';
}

function isCompletedEventRecord(record) {
  return isCompletedEventSnapshot({
    orderStatus: record?.orderStatus,
    orderStatusText: normalizeEventOrderStatus(record?.orderStatus),
  });
}

function getEventRecordSnapshot(record) {
  const key = getEventStableKey(record);
  const orderStatus = String(record?.orderStatus ?? '').trim();
  const eventStatus = String(record?.eventStatus ?? '').trim();
  const eventAlarmStatus = String(record?.eventAlarmStatus ?? '').trim();
  return {
    key,
    id: String(record?.id || ''),
    eventNumber: String(record?.eventNumber || ''),
    eventTitle: String(record?.eventTitle || ''),
    orderStatus,
    orderStatusText: normalizeEventOrderStatus(orderStatus),
    eventStatus,
    eventStatusText: normalizeEventStatus(eventStatus),
    eventAlarmStatus,
    eventAlarmStatusText: normalizeEventAlarmStatus(eventAlarmStatus),
    updateTime: String(record?.updateTime || ''),
    happenTime: String(record?.happenTime || ''),
    incidentRecoveryTime: String(record?.incidentRecoveryTime || ''),
    closeTime: String(record?.closeTime || ''),
  };
}

function loadEventSyncState() {
  try {
    if (!fs.existsSync(EVENT_SYNC_STATE_PATH)) {
      return {
        version: 1,
        updatedAt: '',
        records: {},
      };
    }

    const payload = JSON.parse(fs.readFileSync(EVENT_SYNC_STATE_PATH, 'utf8'));
    if (!payload || typeof payload !== 'object' || !payload.records || typeof payload.records !== 'object') {
      return {
        version: 1,
        updatedAt: '',
        records: {},
      };
    }

    return {
      version: Number(payload.version || 1),
      updatedAt: String(payload.updatedAt || ''),
      records: payload.records,
    };
  } catch (error) {
    console.warn(`[event-sync-state] read failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      version: 1,
      updatedAt: '',
      records: {},
    };
  }
}

function saveEventSyncState(records, meta = {}) {
  const snapshots = {};
  (Array.isArray(records) ? records : []).forEach((record) => {
    const snapshot = getEventRecordSnapshot(record);
    if (snapshot.key) {
      snapshots[snapshot.key] = snapshot;
    }
  });

  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    mode: meta.mode || '',
    fetchedCount: Number(meta.fetchedCount || records.length || 0),
    records: snapshots,
  };

  fs.mkdirSync(path.dirname(EVENT_SYNC_STATE_PATH), { recursive: true });
  fs.writeFileSync(EVENT_SYNC_STATE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function mergeEventSyncState(records, meta = {}) {
  const currentState = loadEventSyncState();
  const snapshots = {
    ...(currentState.records || {}),
  };
  (Array.isArray(records) ? records : []).forEach((record) => {
    const snapshot = getEventRecordSnapshot(record);
    if (snapshot.key) {
      snapshots[snapshot.key] = snapshot;
    }
  });

  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    mode: meta.mode || currentState.mode || '',
    fetchedCount: Number(meta.fetchedCount || records.length || 0),
    records: snapshots,
  };

  fs.mkdirSync(path.dirname(EVENT_SYNC_STATE_PATH), { recursive: true });
  fs.writeFileSync(EVENT_SYNC_STATE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function getEventDiffReason(record, previousSnapshot) {
  const currentSnapshot = getEventRecordSnapshot(record);
  if (!currentSnapshot.key) {
    return '';
  }
  if (!previousSnapshot) {
    return '新增';
  }
  if (!isCompletedEventSnapshot(previousSnapshot)) {
    return '上次未完成';
  }
  if (String(previousSnapshot.eventAlarmStatus ?? '').trim() !== currentSnapshot.eventAlarmStatus) {
    return '告警状态变化';
  }
  if (String(previousSnapshot.eventAlarmStatusText || '').trim() !== currentSnapshot.eventAlarmStatusText) {
    return '告警状态变化';
  }
  if (String(previousSnapshot.orderStatus ?? '').trim() !== currentSnapshot.orderStatus) {
    return '处理状态变化';
  }
  if (String(previousSnapshot.orderStatusText || '').trim() !== currentSnapshot.orderStatusText) {
    return '处理状态变化';
  }
  if (String(previousSnapshot.eventStatus ?? '').trim() !== currentSnapshot.eventStatus) {
    return '流程状态变化';
  }
  if (String(previousSnapshot.eventStatusText || '').trim() !== currentSnapshot.eventStatusText) {
    return '流程状态变化';
  }

  return '';
}

function buildEventIncrementalPlan(records, state) {
  const previousRecords = state?.records && typeof state.records === 'object' ? state.records : {};
  const reasonCounter = new Map();
  const diffRecords = [];

  (Array.isArray(records) ? records : []).forEach((record) => {
    const key = getEventStableKey(record);
    if (!key) {
      return;
    }

    const reason = getEventDiffReason(record, previousRecords[key]);
    if (!reason) {
      return;
    }

    diffRecords.push({
      ...record,
      eventSyncDiffReason: reason,
    });
    incrementCounter(reasonCounter, reason);
  });

  return {
    records: diffRecords,
    reasonSummary: formatCounterSummary(reasonCounter, 0),
    reasonCounts: Object.fromEntries(reasonCounter.entries()),
    previousStateAt: String(state?.updatedAt || ''),
  };
}

function stringifyFeishuFieldValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyFeishuFieldValue(item)).join('');
  }
  if (typeof value === 'object') {
    if (value.text !== undefined) return stringifyFeishuFieldValue(value.text);
    if (value.value !== undefined) return stringifyFeishuFieldValue(value.value);
    if (value.name !== undefined) return stringifyFeishuFieldValue(value.name);
  }
  return String(value);
}

const EVENT_FEISHU_TIME_FIELD_NAMES = new Set([
  '创建时间',
  '发生时间',
  '通知时间',
  '响应时间',
  '确认时间',
  '恢复时间',
  '解决时间',
  '关闭时间',
  '更新时间',
]);

function stringifyFeishuEventDateValue(value) {
  const text = stringifyFeishuFieldValue(value).trim();
  if (!text) return '';

  if (/^\d+$/.test(text)) {
    const numericValue = Number(text);
    if (Number.isFinite(numericValue) && numericValue > 1000000000) {
      const timestampMs = numericValue < 100000000000 ? numericValue * 1000 : numericValue;
      const date = new Date(timestampMs);
      if (!Number.isNaN(date.getTime())) {
        return formatEventDateTime(date);
      }
    }
  }

  const parsed = parseEventDate(text);
  return parsed ? formatEventDateTime(parsed) : text;
}

function getExistingEventFeishuRecordKey(record) {
  const fields = record?.fields || {};
  const id = stringifyFeishuFieldValue(fields.事件ID).trim();
  const eventNumber = stringifyFeishuFieldValue(fields.事件编号).trim();
  return id || eventNumber;
}

function buildExistingEventFeishuRecordMap(records) {
  const recordMap = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const key = getExistingEventFeishuRecordKey(record);
    const recordId = String(record?.record_id || record?.id || '').trim();
    if (key && recordId && !recordMap.has(key)) {
      recordMap.set(key, {
        record_id: recordId,
        fields: record.fields || {},
      });
    }
  });
  return recordMap;
}

function getFeishuFieldText(fields, names) {
  for (const name of names) {
    const rawValue = fields?.[name];
    const value = EVENT_FEISHU_TIME_FIELD_NAMES.has(name)
      ? stringifyFeishuEventDateValue(rawValue).trim()
      : stringifyFeishuFieldValue(rawValue).trim();
    if (value) {
      return value;
    }
  }

  return '';
}

function getFeishuRecordId(record) {
  return String(record?.record_id || record?.id || '').trim();
}

function getEventFeishuTimeTexts(fields) {
  return [
    getFeishuFieldText(fields, ['发生时间']),
    getFeishuFieldText(fields, ['创建时间']),
    getFeishuFieldText(fields, ['通知时间']),
  ].filter(Boolean);
}

function isEventFeishuRecordInDateRange(record, startDate, endDate) {
  const timeTexts = getEventFeishuTimeTexts(record?.fields || {});
  if (timeTexts.length === 0) {
    return false;
  }

  return timeTexts.some((timeText) => {
    if (startDate && timeText < startDate) {
      return false;
    }
    if (endDate && timeText > endDate) {
      return false;
    }
    return true;
  });
}

function getEventScopedReplaceRecordIds(existingRecords, syncRecords, shouldDeleteExistingRecord, options = {}) {
  const deleteSameEvent = options.deleteSameEvent !== false;
  const syncKeys = new Set(
    (Array.isArray(syncRecords) ? syncRecords : [])
      .map((record) => getEventStableKey(record))
      .filter(Boolean),
  );
  const recordIds = [];

  (Array.isArray(existingRecords) ? existingRecords : []).forEach((record) => {
    const recordId = getFeishuRecordId(record);
    if (!recordId) {
      return;
    }

    const existingKey = getExistingEventFeishuRecordKey(record);
    const isSameEvent = deleteSameEvent && existingKey && syncKeys.has(existingKey);
    const isSameScope = typeof shouldDeleteExistingRecord === 'function'
      ? shouldDeleteExistingRecord(record)
      : false;
    if (isSameEvent || isSameScope) {
      recordIds.push(recordId);
    }
  });

  return Array.from(new Set(recordIds));
}

function buildEventStateFromFeishuRecords(records) {
  const snapshots = {};
  (Array.isArray(records) ? records : []).forEach((record) => {
    const fields = record?.fields || {};
    const id = getFeishuFieldText(fields, ['事件ID']);
    const eventNumber = getFeishuFieldText(fields, ['事件编号']);
    const key = id || eventNumber;
    if (!key) {
      return;
    }

    const orderStatus = getFeishuFieldText(fields, ['处理状态编码', '事件状态编码']);
    const orderStatusText = getFeishuFieldText(fields, ['处理状态', '事件状态']) || normalizeEventOrderStatus(orderStatus);
    const eventStatus = getFeishuFieldText(fields, ['流程状态编码']);
    const eventStatusText = getFeishuFieldText(fields, ['流程状态']) || normalizeEventStatus(eventStatus);
    const eventAlarmStatus = getFeishuFieldText(fields, ['告警状态编码']);
    const eventAlarmStatusText = getFeishuFieldText(fields, ['告警状态']) || normalizeEventAlarmStatus(eventAlarmStatus);

    snapshots[key] = {
      key,
      id,
      eventNumber,
      eventTitle: getFeishuFieldText(fields, ['事件标题']),
      orderStatus,
      orderStatusText,
      eventStatus,
      eventStatusText,
      eventAlarmStatus,
      eventAlarmStatusText,
      updateTime: getFeishuFieldText(fields, ['更新时间']),
      happenTime: getFeishuFieldText(fields, ['发生时间']),
      incidentRecoveryTime: getFeishuFieldText(fields, ['恢复时间']),
      closeTime: getFeishuFieldText(fields, ['关闭时间']),
    };
  });

  return {
    version: 1,
    updatedAt: 'feishu',
    records: snapshots,
  };
}

async function syncEventRecordsIncrementally(records, options = {}) {
  const eventFeishuClient = options.client || createEventFeishuClient();
  const syncRecords = Array.isArray(records) ? records : [];
  if (syncRecords.length === 0) {
    return {
      success: true,
      insertedCount: 0,
      updatedCount: 0,
      syncedCount: 0,
      failedCount: 0,
      notified: false,
      message: '没有事件差异需要同步',
    };
  }

  const existingRecords = Array.isArray(options.existingRecords)
    ? options.existingRecords
    : await eventFeishuClient.listAllRecords();
  const existingRecordMap = buildExistingEventFeishuRecordMap(existingRecords);
  const createRecords = [];
  const updateRecords = [];

  syncRecords.forEach((record) => {
    const fields = mapEventRecordToFeishuFields(record);
    const key = getEventStableKey(record) || String(fields.事件ID || fields.事件编号 || '').trim();
    const existingRecord = key ? existingRecordMap.get(key) : null;
    if (existingRecord) {
      updateRecords.push({
        record_id: existingRecord.record_id,
        fields,
      });
    } else {
      createRecords.push({
        fields,
      });
    }
  });

  const createResult = await eventFeishuClient.createRecords(createRecords);
  const updateResult = await eventFeishuClient.updateRecords(updateRecords);
  const insertedCount = Number(createResult.insertedCount || 0);
  const updatedCount = Number(updateResult.updatedCount || 0);
  const failedCount = Math.max(createRecords.length - insertedCount, 0) + Math.max(updateRecords.length - updatedCount, 0);
  const dataSuccess = Boolean(createResult.success) && Boolean(updateResult.success) && failedCount === 0;
  const messageContext = {
    insertedCount,
    updatedCount,
    syncedCount: insertedCount + updatedCount,
    diffCount: syncRecords.length,
    fetchedCount: Number(options.fetchedCount || syncRecords.length),
  };
  const successMessage = options.successMessage
    ? eventFeishuClient.resolveMessageOption(options.successMessage, messageContext, '')
    : `事件增量同步完成：拉取 ${messageContext.fetchedCount} 条，差异 ${syncRecords.length} 条，新增 ${insertedCount} 条，更新 ${updatedCount} 条`;

  if (!dataSuccess) {
    const messages = [createResult.message, updateResult.message].filter(Boolean).join('；');
    return {
      success: false,
      insertedCount,
      updatedCount,
      syncedCount: insertedCount + updatedCount,
      failedCount,
      notified: false,
      message: messages || '事件增量同步到飞书失败',
    };
  }

  if (options.notify === false) {
    return {
      success: true,
      insertedCount,
      updatedCount,
      syncedCount: insertedCount + updatedCount,
      failedCount: 0,
      notified: false,
      message: successMessage,
    };
  }

  try {
    const notifyMessage = eventFeishuClient.resolveMessageOption(
      options.notifyMessage,
      messageContext,
      successMessage,
    );
    await eventFeishuClient.sendMessageToChat(notifyMessage, options.chatName);
    return {
      success: true,
      insertedCount,
      updatedCount,
      syncedCount: insertedCount + updatedCount,
      failedCount: 0,
      notified: true,
      message: `${successMessage}，群通知已发送`,
    };
  } catch (error) {
    return {
      success: true,
      insertedCount,
      updatedCount,
      syncedCount: insertedCount + updatedCount,
      failedCount: 0,
      notified: false,
      message: `${successMessage}，但群通知发送失败：${eventFeishuClient.explainChatError(error)}`,
    };
  }
}

async function replaceEventRecordsInFeishuScope(records, options = {}) {
  const eventFeishuClient = options.client || createEventFeishuClient();
  const syncRecords = Array.isArray(records) ? records : [];
  const existingRecords = Array.isArray(options.existingRecords)
    ? options.existingRecords
    : await eventFeishuClient.listAllRecords();
  const deleteRecordIds = getEventScopedReplaceRecordIds(
    existingRecords,
    syncRecords,
    options.shouldDeleteExistingRecord,
    { deleteSameEvent: options.deleteSameEvent },
  );
  options.onProgress?.({
    phase: 'delete-plan',
    deleteTotal: deleteRecordIds.length,
    createTotal: syncRecords.length,
  });

  const deleteResult = await eventFeishuClient.deleteRecords(deleteRecordIds, {
    targetLabel: options.targetLabel || '飞书事件表同类记录',
    actionLabel: options.actionLabel || '删除飞书事件表同类记录',
    onProgress: (state) => options.onProgress?.({
      phase: 'delete',
      deleteTotal: deleteRecordIds.length,
      deleteBatchesCompleted: state.completedBatches,
      deleteBatchesTotal: state.totalBatches,
    }),
  });
  if (!deleteResult.success) {
    return {
      success: false,
      deletedCount: Number(deleteResult.deletedCount || 0),
      insertedCount: 0,
      updatedCount: 0,
      syncedCount: 0,
      failedCount: syncRecords.length,
      notified: false,
      message: deleteResult.message || '事件同类记录覆盖前删除旧数据失败',
    };
  }

  const createResult = await eventFeishuClient.createRecords(
    syncRecords.map((record) => ({ fields: mapEventRecordToFeishuFields(record) })),
    {
      onProgress: (state) => options.onProgress?.({
        phase: 'create',
        createTotal: syncRecords.length,
        createBatchesCompleted: state.completedBatches,
        createBatchesTotal: state.totalBatches,
      }),
    },
  );
  const deletedCount = Number(deleteResult.deletedCount || 0);
  const insertedCount = Number(createResult.insertedCount || 0);
  const failedCount = Math.max(syncRecords.length - insertedCount, 0);
  const dataSuccess = Boolean(createResult.success) && failedCount === 0;
  const messageContext = {
    deletedCount,
    insertedCount,
    updatedCount: 0,
    syncedCount: insertedCount,
    diffCount: syncRecords.length,
    fetchedCount: Number(options.fetchedCount || syncRecords.length),
  };
  const successMessage = options.successMessage
    ? eventFeishuClient.resolveMessageOption(options.successMessage, messageContext, '')
    : `事件覆盖同步完成：拉取 ${messageContext.fetchedCount} 条，删除旧记录 ${deletedCount} 条，写入 ${insertedCount} 条`;

  if (!dataSuccess) {
    return {
      success: false,
      deletedCount,
      insertedCount,
      updatedCount: 0,
      syncedCount: insertedCount,
      failedCount,
      notified: false,
      message: createResult.message || '事件覆盖同步写入飞书失败',
    };
  }

  if (options.notify === false) {
    return {
      success: true,
      deletedCount,
      insertedCount,
      updatedCount: 0,
      syncedCount: insertedCount,
      failedCount: 0,
      notified: false,
      message: successMessage,
    };
  }

  try {
    const notifyMessage = eventFeishuClient.resolveMessageOption(
      options.notifyMessage,
      messageContext,
      successMessage,
    );
    await eventFeishuClient.sendMessageToChat(notifyMessage, options.chatName);
    return {
      success: true,
      deletedCount,
      insertedCount,
      updatedCount: 0,
      syncedCount: insertedCount,
      failedCount: 0,
      notified: true,
      message: `${successMessage}，群通知已发送`,
    };
  } catch (error) {
    return {
      success: true,
      deletedCount,
      insertedCount,
      updatedCount: 0,
      syncedCount: insertedCount,
      failedCount: 0,
      notified: false,
      message: `${successMessage}，但群通知发送失败：${eventFeishuClient.explainChatError(error)}`,
    };
  }
}

function buildEventSyncRunResponse({
  mode,
  fetchResult,
  syncRecords,
  syncResult,
  startedAt,
  state,
  message,
  success,
  deletedCount = 0,
  insertedCount = 0,
  updatedCount = 0,
  reasonSummary = '',
  reasonCounts = {},
  cacheCleanup = null,
  progress = null,
  views = null,
  viewSetup = null,
}) {
  const records = Array.isArray(syncRecords) ? syncRecords : [];
  const sourceRecords = Array.isArray(fetchResult?.records) ? fetchResult.records : [];
  return {
    success: Boolean(success),
    mode,
    fetchedCount: sourceRecords.length,
    total: records.length,
    syncedCount: Number(insertedCount || 0) + Number(updatedCount || 0),
    diffCount: records.length,
    insertedCount: Number(insertedCount || 0),
    updatedCount: Number(updatedCount || 0),
    deletedCount: Number(deletedCount || 0),
    failedCount: Math.max(records.length - Number(insertedCount || 0) - Number(updatedCount || 0), 0),
    notified: Boolean(syncResult?.notified),
    totalFromApi: Number(fetchResult?.total || 0),
    totalPages: Number(fetchResult?.totalPages || 0),
    activeRecordCount: Number(fetchResult?.activeCount || 0),
    completedRecordCount: Number(fetchResult?.completedCount || 0),
    completedAddedCount: Number(fetchResult?.completedAddedCount || 0),
    durationMs: Date.now() - startedAt,
    fetchedAt: new Date().toISOString(),
    previousStateAt: String(state?.updatedAt || ''),
    statePath: EVENT_SYNC_STATE_PATH,
    reasonSummary,
    reasonCounts,
    progress: progress || cloneEventSyncProgress(),
    views,
    viewSetup,
    records: records.slice(0, EVENT_SYNC_PREVIEW_LIMIT),
    previewLimit: EVENT_SYNC_PREVIEW_LIMIT,
    cacheCleanup,
    message: message || syncResult?.message || '',
  };
}

async function executeEventFullSync(options = {}) {
  const startedAt = Date.now();
  const fetchResult = await fetchEventRecordsForFullSync();
  if (fetchResult.records.length === 0) {
    return buildEventSyncRunResponse({
      mode: 'full',
      fetchResult,
      syncRecords: [],
      syncResult: { notified: false },
      startedAt,
      state: loadEventSyncState(),
      success: true,
      message: '事件全量接口已拉取，但没有可同步记录',
    });
  }

  const eventFeishuClient = createEventFeishuClient();
  const summary = buildEventSyncSummary(fetchResult.records);
  const syncResult = await eventFeishuClient.replaceTableRecords(
    fetchResult.records.map((record) => ({ fields: mapEventRecordToFeishuFields(record) })),
    {
      notify: options.notify,
      notifyMessage: summary.notifyMessage,
      successMessage: ({ insertedCount }) => `事件全量同步完成：覆盖 ${insertedCount} 条事件数据到飞书多维表`,
    },
  );
  const extraAbnormalNotifyResult = await sendExtraAbnormalNotifyMessage({
    moduleName: '事件异常',
    summary,
    createClient: createEventFeishuClient,
    primaryChatId: process.env.EVENT_FEISHU_NOTIFY_CHAT_ID || process.env.FEISHU_NOTIFY_CHAT_ID || '',
    enabled: options.notify !== false,
  });
  if (extraAbnormalNotifyResult.message) {
    syncResult.message = [syncResult.message, extraAbnormalNotifyResult.message].filter(Boolean).join('；');
  }
  const insertedCount = Number(syncResult.insertedCount || 0);
  const dataSuccess = insertedCount === fetchResult.records.length;
  const nextState = dataSuccess
    ? saveEventSyncState(fetchResult.records, { mode: 'full', fetchedCount: fetchResult.records.length })
    : loadEventSyncState();
  const cacheCleanup = dataSuccess ? await cleanupLightweightSyncCache('event') : null;

  return buildEventSyncRunResponse({
    mode: 'full',
    fetchResult,
    syncRecords: fetchResult.records,
    syncResult,
    startedAt,
    state: nextState,
    success: dataSuccess,
    deletedCount: Number(syncResult.deletedCount || 0),
    insertedCount,
    updatedCount: 0,
    cacheCleanup,
    message: dataSuccess ? syncResult.message : (syncResult.message || '事件全量同步到飞书失败'),
  });
}

async function executeEventIncrementalSync(options = {}) {
  const startedAt = Date.now();
  resetEventSyncProgress('incremental', '事件增量同步开始：准备按产生/发生时间拉取近30天事件');

  try {
    const fetchResult = await fetchEventRecordsForIncrementalSync({
      onProgress: (state) => {
        const totalPages = Number(state.totalPages || 0);
        const completedPages = Number(state.completedPages || 0);
        const percent = totalPages > 0 ? Math.min(35, Math.round((completedPages / totalPages) * 35)) : 10;
        const scopeLabel = state.scopeLabel ? `（${state.scopeLabel}）` : '';
        updateEventSyncProgress({
          phase: 'fetch',
          percent,
          message: `拉取事件${scopeLabel}：${completedPages}/${totalPages || '?'} 页，已取 ${state.records || 0} 条`,
          fetch: {
            completedPages,
            totalPages,
            records: Number(state.records || 0),
            totalFromApi: Number(state.totalFromApi || 0),
          },
        });
      },
    });
    updateEventSyncProgress({
      phase: 'fetch-done',
      percent: 38,
      message: `事件拉取完成：${fetchResult.records.length} 条，准备扫描飞书旧记录并删除近30天记录`,
      fetch: {
        records: fetchResult.records.length,
        totalFromApi: Number(fetchResult.total || 0),
        totalPages: Number(fetchResult.totalPages || 0),
      },
    }, `事件拉取完成：${fetchResult.records.length} 条`);

    const state = loadEventSyncState();
    const eventFeishuClient = createEventFeishuClient();
    const existingRecords = await eventFeishuClient.listAllRecords({
      onProgress: (progress) => {
        updateEventSyncProgress({
          phase: 'feishu-list',
          percent: 45,
          message: `扫描飞书旧记录：已扫描 ${progress.records || 0} 条`,
          feishu: {
            listedRecords: Number(progress.records || 0),
          },
        });
      },
    });
    updateEventSyncProgress({
      phase: 'view-setup',
      percent: 48,
      message: '检查事件多维表视图',
      feishu: {
        listedRecords: existingRecords.length,
      },
    });
    const viewSetup = await ensureEventFeishuViews(eventFeishuClient);
    if (viewSetup.success) {
      updateEventSyncProgress({ phase: 'view-ready', percent: 50, message: viewSetup.message }, viewSetup.message);
    } else {
      updateEventSyncProgress({ phase: 'view-warning', percent: 50, message: `视图初始化失败：${viewSetup.message}` }, `视图初始化失败：${viewSetup.message}`);
    }

    const incompleteViewId = getEventViewId(viewSetup, EVENT_FEISHU_INCOMPLETE_VIEW_NAME);
    const falseRealViewId = getEventViewId(viewSetup, EVENT_FEISHU_FALSE_REAL_VIEW_NAME);
    const views = {
      incomplete: {
        name: EVENT_FEISHU_INCOMPLETE_VIEW_NAME,
        viewId: incompleteViewId,
        url: getEventBitableWebUrl(incompleteViewId || undefined),
      },
      falseReal: {
        name: EVENT_FEISHU_FALSE_REAL_VIEW_NAME,
        viewId: falseRealViewId,
        url: getEventBitableWebUrl(falseRealViewId || undefined),
      },
    };
    const syncRecords = fetchResult.records.map((record) => ({
      ...record,
      eventSyncDiffReason: getEventNotificationReason(record) || '增量同步',
    }));
    const summary = buildEventSyncSummary(syncRecords, {
      incompleteViewId,
      falseRealViewId,
      incompleteViewUrl: views.incomplete.url,
      falseRealViewUrl: views.falseReal.url,
    });
    const syncResult = await replaceEventRecordsInFeishuScope(syncRecords, {
      client: eventFeishuClient,
      existingRecords,
      shouldDeleteExistingRecord: (record) => isEventFeishuRecordInDateRange(record, fetchResult.rangeStartDate, fetchResult.rangeEndDate),
      deleteSameEvent: false,
      targetLabel: '飞书事件表近30天记录',
      actionLabel: '删除飞书事件表近30天旧记录',
      notify: options.notify,
      notifyMessage: summary.notifyMessage,
      fetchedCount: fetchResult.records.length,
      onProgress: (progress) => {
        if (progress.phase === 'delete-plan') {
          updateEventSyncProgress({
            phase: 'delete-plan',
            percent: 55,
            message: `准备覆盖飞书：需删除 ${progress.deleteTotal || 0} 条，写入 ${progress.createTotal || 0} 条`,
            feishu: {
              deleteTotal: Number(progress.deleteTotal || 0),
              createTotal: Number(progress.createTotal || 0),
            },
          }, `飞书覆盖计划：删除 ${progress.deleteTotal || 0} 条，写入 ${progress.createTotal || 0} 条`);
          return;
        }
        if (progress.phase === 'delete') {
          const total = Number(progress.deleteBatchesTotal || 0);
          const completed = Number(progress.deleteBatchesCompleted || 0);
          updateEventSyncProgress({
            phase: 'delete',
            percent: total > 0 ? 55 + Math.round((completed / total) * 15) : 65,
            message: `删除飞书旧记录批次：${completed}/${total || '?'}`,
            feishu: {
              deleteBatchesCompleted: completed,
              deleteBatchesTotal: total,
            },
          });
          return;
        }
        if (progress.phase === 'create') {
          const total = Number(progress.createBatchesTotal || 0);
          const completed = Number(progress.createBatchesCompleted || 0);
          updateEventSyncProgress({
            phase: 'create',
            percent: total > 0 ? 70 + Math.round((completed / total) * 20) : 85,
            message: `写入飞书记录批次：${completed}/${total || '?'}`,
            feishu: {
              createBatchesCompleted: completed,
              createBatchesTotal: total,
            },
          });
        }
      },
      successMessage: ({ insertedCount, deletedCount, fetchedCount }) => (
        `事件增量同步完成：按产生/发生时间拉取近30天 ${fetchedCount} 条，删除飞书近30天旧记录 ${deletedCount} 条，写入 ${insertedCount} 条`
      ),
    });
    const extraAbnormalNotifyResult = await sendExtraAbnormalNotifyMessage({
      moduleName: '事件异常',
      summary,
      createClient: createEventFeishuClient,
      primaryChatId: process.env.EVENT_FEISHU_NOTIFY_CHAT_ID || process.env.FEISHU_NOTIFY_CHAT_ID || '',
      enabled: options.notify !== false,
    });
    if (extraAbnormalNotifyResult.message) {
      syncResult.message = [syncResult.message, extraAbnormalNotifyResult.message].filter(Boolean).join('；');
    }
    const dataSuccess = Boolean(syncResult.success) && Number(syncResult.failedCount || 0) === 0;
    const nextState = dataSuccess
      ? mergeEventSyncState(fetchResult.records, {
        mode: 'incremental',
        fetchedCount: fetchResult.records.length,
        rangeStartDate: fetchResult.rangeStartDate,
        rangeEndDate: fetchResult.rangeEndDate,
      })
      : state;
    const cacheCleanup = dataSuccess ? await cleanupLightweightSyncCache('event') : null;
    finishEventSyncProgress(dataSuccess, dataSuccess ? syncResult.message : (syncResult.message || '事件增量同步失败'));

    return buildEventSyncRunResponse({
      mode: 'incremental',
      fetchResult,
      syncRecords,
      syncResult,
      startedAt,
      state: nextState,
      success: dataSuccess,
      deletedCount: Number(syncResult.deletedCount || 0),
      insertedCount: Number(syncResult.insertedCount || 0),
      updatedCount: 0,
      reasonSummary: '增量同步',
      reasonCounts: { 增量同步: syncRecords.length },
      cacheCleanup,
      progress: cloneEventSyncProgress(),
      views,
      viewSetup,
      message: syncResult.message,
    });
  } catch (error) {
    finishEventSyncProgress(false, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function runEventAutoSyncOnce(runContext = {}) {
  if (!EVENT_AUTO_SYNC_ENABLED || eventAutoSyncState.running) {
    return;
  }
  if (shouldSkipAutoSyncMessageRun(runContext)) {
    console.log(`[event-auto-sync] skipped message schedule=${runContext.scheduleLabel || '--'} because message is not due`);
    return;
  }

  eventAutoSyncState.running = true;
  eventAutoSyncState.queued = false;
  eventAutoSyncState.lastAttemptAt = new Date().toISOString();
  eventAutoSyncState.lastError = '';
  eventAutoSyncState.statusMessage = '正在执行事件增量同步';

  try {
    const shouldNotify = shouldNotifyEventAutoSyncRun(runContext);
    const syncResult = await executeEventIncrementalSync({ notify: shouldNotify });

    if (!syncResult.success) {
      throw new Error(syncResult.message || '事件增量同步飞书失败');
    }

    eventAutoSyncState.lastSuccessAt = new Date().toISOString();
    eventAutoSyncState.lastInsertedCount = Number(syncResult.syncedCount || 0);
    eventAutoSyncState.lastError = '';
    eventAutoSyncState.statusMessage = `完成，增量拉取 ${syncResult.fetchedCount || 0} 条，删除 ${syncResult.deletedCount || 0} 条，写入 ${syncResult.insertedCount || 0} 条`;
    console.log(`[event-auto-sync] completed schedule=${runContext.scheduleLabel || '--'} notifyAllowed=${shouldNotify} fetched=${syncResult.fetchedCount || 0} diff=${syncResult.diffCount || 0} deleted=${syncResult.deletedCount || 0} inserted=${syncResult.insertedCount || 0} notified=${Boolean(syncResult.notified)} cacheCleanup=${syncResult.cacheCleanup?.success !== false} message=${String(syncResult.message || '').replace(/\s+/g, ' ')}`);
  } catch (error) {
    eventAutoSyncState.lastError = error instanceof Error ? error.message : String(error);
    eventAutoSyncState.statusMessage = eventAutoSyncState.lastError;
    console.warn(`[event-auto-sync] failed: ${eventAutoSyncState.lastError}`);
  } finally {
    eventAutoSyncState.running = false;
  }
}

function scheduleNextEventAutoSync() {
  scheduleRecurringSyncTask({
    enabled: EVENT_AUTO_SYNC_ENABLED,
    state: eventAutoSyncState,
    tag: 'event-auto-sync',
    scheduleEntries: EVENT_AUTO_SYNC_SCHEDULES,
    runTask: runEventAutoSyncOnce,
    disabledMessage: 'disabled by EVENT_AUTO_SYNC_ENABLED=false',
  });
}

async function handleChangeBrowserFetch(req, res) {
  try {
    const body = await readRequestJson(req);
    const { data, target, fetchResult, requestPath } = await fetchChangePayloadInBrowser({
      url: body.url,
      method: body.method || 'POST',
      payload: body.payload,
    });

    console.log(`[change-fetch] method=${body.method || 'POST'} path=${requestPath} status=${fetchResult.status}`);
    sendJson(res, 200, {
      success: true,
      data,
      meta: {
        browserUrl: target.url,
        requestPath,
        status: fetchResult.status,
      },
    });
  } catch (error) {
    sendJson(res, 502, {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleDrillBrowserFetch(req, res) {
  try {
    const body = await readRequestJson(req);
    const { data, target, fetchResult, requestPath } = await fetchDrillPayloadInBrowser({
      url: body.url || DRILL_LIST_URL,
      method: body.method || 'POST',
      payload: body.payload,
    });

    console.log(`[drill-fetch] method=${body.method || 'POST'} path=${requestPath} status=${fetchResult.status}`);
    sendJson(res, 200, {
      success: true,
      data,
      meta: {
        browserUrl: target.url,
        requestPath,
        requestUrl: fetchResult.url,
        status: fetchResult.status,
      },
    });
  } catch (error) {
    sendJson(res, 502, {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleEventBrowserFetch(req, res) {
  try {
    const body = await readRequestJson(req);
    const { data, target, fetchResult, requestPath } = await fetchEventPayloadInBrowser({
      url: body.url || EVENT_LIST_URL,
      method: body.method || 'POST',
      payload: body.payload,
    });

    console.log(`[event-fetch] method=${body.method || 'POST'} path=${requestPath} status=${fetchResult.status}`);
    sendJson(res, 200, {
      success: true,
      data,
      meta: {
        browserUrl: target.url,
        requestPath,
        requestUrl: fetchResult.url,
        status: fetchResult.status,
      },
    });
  } catch (error) {
    sendJson(res, 502, {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleInspectBrowserFetch(req, res) {
  try {
    const body = await readRequestJson(req);
    const { data, target, fetchResult, requestPath } = await fetchInspectPayloadInBrowser({
      url: body.url,
      method: body.method || 'GET',
      payload: body.payload,
    });

    console.log(`[inspect-fetch] method=${body.method || 'GET'} path=${requestPath} status=${fetchResult.status}`);
    sendJson(res, 200, {
      success: true,
      data,
      meta: {
        browserUrl: target.url,
        requestPath,
        requestUrl: fetchResult.url,
        status: fetchResult.status,
      },
    });
  } catch (error) {
    sendJson(res, 502, {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleInspectRunSync(_req, res) {
  try {
    const result = await executeInspectSyncPipeline({ notify: true });
    sendJson(res, result.success ? 200 : 502, result);
  } catch (error) {
    sendJson(res, 502, {
      success: false,
      mode: 'monthly',
      fetchedCount: 0,
      total: 0,
      insertedCount: 0,
      deletedCount: 0,
      failedCount: 0,
      notified: false,
      totalFromApi: 0,
      totalPages: 0,
      durationMs: 0,
      records: [],
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleDrillFeishuSync(req, res) {
  try {
    const body = await readRequestJson(req);
    const records = Array.isArray(body.records) ? body.records : [];
    if (records.length === 0) {
      sendJson(res, 200, {
        success: 0,
        failed: 0,
        total: 0,
        insertedCount: 0,
        deletedCount: 0,
        notified: false,
        message: '没有可同步的演练数据',
      });
      return;
    }

    const evaluationResult = await ensureDrillRecordsWithEvaluationEvents(records);
    const detailResult = await enrichDrillRecordsWithEvaluationDetails(evaluationResult.records);
    const recordsReadyForSync = detailResult.records;
    const summary = buildDrillSyncSummary(recordsReadyForSync, {
      evaluationMatchedCount: evaluationResult.matchedCount,
    });

    const drillFeishuClient = createDrillFeishuClient();
    const syncResult = await drillFeishuClient.replaceTableRecords(
      recordsReadyForSync.map((record) => ({ fields: mapDrillRecordToFeishuFields(record) })),
      {
        notifyMessage: summary.notifyMessage,
        successMessage: summary.successMessage,
      },
    );
    const insertedCount = Number(syncResult.insertedCount || 0);
    const cacheCleanup = insertedCount > 0 ? await cleanupLightweightSyncCache('drill') : null;

    sendJson(res, 200, {
      success: insertedCount,
      failed: syncResult.success ? 0 : Math.max(recordsReadyForSync.length - insertedCount, 0),
      total: recordsReadyForSync.length,
      insertedCount,
      deletedCount: Number(syncResult.deletedCount || 0),
      notified: Boolean(syncResult.notified),
      message: syncResult.message,
      evaluationFetched: evaluationResult.fetched,
      evaluationMatchedCount: evaluationResult.matchedCount,
      evaluationDetailFetched: detailResult.fetched,
      evaluationDetailFetchedCount: detailResult.detailFetchedCount,
      evaluationDetailFailedCount: detailResult.detailFailedCount,
      evaluationScoreMatchedCount: detailResult.scoreMatchedCount,
      cacheCleanup,
    });
  } catch (error) {
    sendJson(res, 502, {
      success: 0,
      failed: 0,
      total: 0,
      insertedCount: 0,
      deletedCount: 0,
      notified: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleDrillRunSync(req, res) {
  try {
    const result = await executeDrillSyncPipeline({ notify: true });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 502, {
      success: 0,
      failed: 0,
      total: 0,
      fetchedCount: 0,
      insertedCount: 0,
      notified: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleEventFeishuSync(req, res) {
  try {
    const body = await readRequestJson(req);
    const records = Array.isArray(body.records) ? body.records : [];
    if (records.length === 0) {
      sendJson(res, 200, {
        success: 0,
        failed: 0,
        total: 0,
        insertedCount: 0,
        deletedCount: 0,
        notified: false,
        message: '没有可同步的事件数据',
      });
      return;
    }

    const summary = buildEventSyncSummary(records);
    const eventFeishuClient = createEventFeishuClient();
    const syncResult = await eventFeishuClient.replaceTableRecords(
      records.map((record) => ({ fields: mapEventRecordToFeishuFields(record) })),
      {
        notifyMessage: summary.notifyMessage,
        successMessage: summary.successMessage,
      },
    );
    const insertedCount = Number(syncResult.insertedCount || 0);
    const cacheCleanup = insertedCount > 0 ? await cleanupLightweightSyncCache('event') : null;

    sendJson(res, 200, {
      success: insertedCount,
      failed: syncResult.success ? 0 : Math.max(records.length - insertedCount, 0),
      total: records.length,
      insertedCount,
      deletedCount: Number(syncResult.deletedCount || 0),
      notified: Boolean(syncResult.notified),
      cacheCleanup,
      message: syncResult.message,
    });
  } catch (error) {
    sendJson(res, 502, {
      success: 0,
      failed: 0,
      total: 0,
      insertedCount: 0,
      deletedCount: 0,
      notified: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleEventFullSync(_req, res) {
  try {
    const result = await executeEventFullSync({ notify: true });
    sendJson(res, result.success ? 200 : 502, result);
  } catch (error) {
    sendJson(res, 502, {
      success: false,
      mode: 'full',
      fetchedCount: 0,
      total: 0,
      syncedCount: 0,
      diffCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      failedCount: 0,
      notified: false,
      durationMs: 0,
      progress: cloneEventSyncProgress(),
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleEventIncrementalSync(_req, res) {
  try {
    const result = await executeEventIncrementalSync({ notify: true });
    sendJson(res, result.success ? 200 : 502, result);
  } catch (error) {
    sendJson(res, 502, {
      success: false,
      mode: 'incremental',
      fetchedCount: 0,
      total: 0,
      syncedCount: 0,
      diffCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      failedCount: 0,
      notified: false,
      durationMs: 0,
      progress: cloneEventSyncProgress(),
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleChangeClearBasicData(_req, res) {
  try {
    const changeBasicDataFeishuClient = createChangeFeishuClient('basicData');
    const result = await changeBasicDataFeishuClient.deleteAllRecords();
    sendJson(res, 200, {
      deletedCount: Number(result.deletedCount || 0),
    });
  } catch (error) {
    sendJson(res, 502, {
      deletedCount: 0,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleChangeSyncBasicData(req, res) {
  try {
    const changeBasicDataFeishuClient = createChangeFeishuClient('basicData');
    const body = await readRequestJson(req);
    const basicDataList = Array.isArray(body.basicDataList) ? body.basicDataList : [];
    const summary = buildChangeBasicDataSyncSummary(basicDataList);
    const result = await changeBasicDataFeishuClient.replaceTableRecords(
      basicDataList.map((item) => ({ fields: mapChangeBasicDataItem(item) })),
      {
        notifyMessage: summary.notifyMessage,
        successMessage: summary.successMessage,
      },
    );
    const insertedCount = Number(result.insertedCount || 0);
    const cacheCleanup = insertedCount > 0 ? await cleanupLightweightSyncCache('change') : null;
    sendJson(res, 200, {
      success: insertedCount,
      failed: result.success ? 0 : Math.max(basicDataList.length - insertedCount, 0),
      insertedCount,
      deletedCount: Number(result.deletedCount || 0),
      notified: Boolean(result.notified),
      cacheCleanup,
      message: result.message,
    });
  } catch (error) {
    sendJson(res, 502, {
      success: 0,
      failed: 0,
      insertedCount: 0,
      deletedCount: 0,
      notified: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleChangeClearWorkOrders(_req, res) {
  try {
    const changeWorkOrderFeishuClient = createChangeFeishuClient('workOrders');
    const result = await changeWorkOrderFeishuClient.deleteAllRecords();
    sendJson(res, 200, {
      deletedCount: Number(result.deletedCount || 0),
    });
  } catch (error) {
    sendJson(res, 502, {
      deletedCount: 0,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleChangeSyncWorkOrders(req, res) {
  try {
    const changeWorkOrderFeishuClient = createChangeFeishuClient('workOrders');
    const body = await readRequestJson(req);
    const workOrders = Array.isArray(body.workOrders) ? body.workOrders : [];
    const summary = buildChangeWorkOrderSyncSummary(workOrders);
    const result = await changeWorkOrderFeishuClient.replaceTableRecords(
      workOrders.map((item) => ({ fields: mapChangeWorkOrder(item) })),
      {
        notifyMessage: summary.notifyMessage,
        successMessage: summary.successMessage,
      },
    );
    const insertedCount = Number(result.insertedCount || 0);
    const cacheCleanup = insertedCount > 0 ? await cleanupLightweightSyncCache('change') : null;
    sendJson(res, 200, {
      success: insertedCount,
      failed: result.success ? 0 : Math.max(workOrders.length - insertedCount, 0),
      insertedCount,
      deletedCount: Number(result.deletedCount || 0),
      notified: Boolean(result.notified),
      total: workOrders.length,
      cacheCleanup,
      message: result.message,
    });
  } catch (error) {
    sendJson(res, 502, {
      success: 0,
      failed: 0,
      insertedCount: 0,
      deletedCount: 0,
      notified: false,
      total: 0,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function getAutoSyncRunningLabel() {
  if (autoSyncState.running) return '风险定时同步正在执行';
  if (changeAutoSyncState.running) return '变更定时同步正在执行';
  if (drillAutoSyncState.running) return '演练定时同步正在执行';
  if (eventAutoSyncState.running) return '事件定时同步正在执行';
  if (inspectAutoSyncState.running) return '巡检定时同步正在执行';
  return '';
}

function getUpcomingAutoSyncLabel(now = Date.now()) {
  const candidates = [
    ['风险定时同步', autoSyncState.nextRunAt],
    ['变更定时同步', changeAutoSyncState.nextRunAt],
    ['演练定时同步', drillAutoSyncState.nextRunAt],
    ['事件定时同步', eventAutoSyncState.nextRunAt],
    ['巡检定时同步', inspectAutoSyncState.nextRunAt],
  ]
    .map(([label, value]) => {
      const runAt = value ? new Date(value).getTime() : Number.NaN;
      return {
        label,
        delayMs: Number.isFinite(runAt) ? runAt - now : Number.POSITIVE_INFINITY,
      };
    })
    .filter((item) => item.delayMs >= 0 && item.delayMs <= KEEPALIVE_SYNC_GUARD_MS)
    .sort((left, right) => left.delayMs - right.delayMs);

  return candidates[0]?.label || '';
}

function getKeepAliveSkipReason() {
  const runningLabel = getAutoSyncRunningLabel();
  if (runningLabel) {
    return `${runningLabel}，保活本轮暂停`;
  }

  const upcomingLabel = getUpcomingAutoSyncLabel();
  if (upcomingLabel) {
    return `${upcomingLabel}即将执行，保活本轮让路`;
  }

  return '';
}

function getNextKeepAliveDelayMs() {
  if (keepAliveState.consecutiveFailures <= 0) {
    return KEEPALIVE_INTERVAL_MS;
  }

  return KEEPALIVE_MAX_FAILURE_BACKOFF_MS;
}

function buildKeepAlivePingExpression(timeoutMs) {
  return `
    (() => new Promise((resolve) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ${Number(timeoutMs)});
      try {
        window.localStorage && window.localStorage.setItem('__zhihang_keepalive_at', String(Date.now()));
      } catch (error) {}
      fetch(window.location.origin + '/', {
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

async function pingIntranetTarget(target) {
  const result = await evaluateInTarget(
    target.webSocketDebuggerUrl,
    buildKeepAlivePingExpression(KEEPALIVE_REQUEST_TIMEOUT_MS),
    KEEPALIVE_REQUEST_TIMEOUT_MS + 3000,
  );

  if (result?.browserError) {
    throw new Error(result.browserError);
  }

  const status = Number(result?.status || 0);
  if (status === 401 || status === 403) {
    throw new Error(`登录态可能已失效，HTTP ${status}`);
  }
  if (status >= 500) {
    throw new Error(`内网页面返回 HTTP ${status}`);
  }

  return result;
}

async function recoverIntranetTarget(origin, target) {
  if (!KEEPALIVE_RECOVERY_ENABLED) {
    return target;
  }

  const activeTarget = target || await findIntranetTarget(origin);
  try {
    await sendDevtoolsCommand(activeTarget.webSocketDebuggerUrl, 'Page.enable', {}, 5000);
  } catch (error) {
    // Page may already be enabled; navigation/reload below is the actual recovery step.
  }

  try {
    await sendDevtoolsCommand(activeTarget.webSocketDebuggerUrl, 'Page.reload', { ignoreCache: true }, 10000);
  } catch (reloadError) {
    await sendDevtoolsCommand(activeTarget.webSocketDebuggerUrl, 'Page.navigate', { url: `${origin}/` }, 10000);
  }

  await sleep(KEEPALIVE_RECOVERY_WAIT_MS);
  return await waitForUsableIntranetTarget(
    origin,
    Math.max(1, INTRANET_TARGET_DISCOVERY_RETRIES),
    INTRANET_TARGET_DISCOVERY_INTERVAL_MS,
  ) || activeTarget;
}

async function pingIntranetTargetWithRecovery(origin, target) {
  try {
    return await pingIntranetTarget(target);
  } catch (error) {
    if (!KEEPALIVE_RECOVERY_ENABLED) {
      throw error;
    }

    const firstMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[keepalive] recovery reload origin=${origin} reason=${firstMessage}`);
    let recoveredTarget;
    try {
      recoveredTarget = await recoverIntranetTarget(origin, target);
    } catch (recoveryError) {
      const recoveryMessage = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
      throw new Error(`${firstMessage}; recovery reload failed: ${recoveryMessage}`);
    }

    try {
      const retryResult = await pingIntranetTarget(recoveredTarget);
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

function formatKeepAliveErrors(errors) {
  return errors
    .map((item) => `${item.origin}: ${item.message}`)
    .join('；');
}

function isRecoverableKeepAliveIssueMessage(message) {
  const text = String(message || '');
  return text.includes('页签尚未就绪')
    || text.includes('系统会继续自动重试')
    || text.includes('浏览器调试端口')
    || text.includes('浏览器调试连接失败')
    || text.includes('登录态可能已失效');
}

async function runKeepAliveOnce() {
  if (!KEEPALIVE_ENABLED) {
    return { skipped: true };
  }
  if (keepAliveState.running) {
    return { skipped: true };
  }

  const skipReason = getKeepAliveSkipReason();
  if (skipReason) {
    keepAliveState.status = 'paused';
    keepAliveState.statusMessage = skipReason;
    keepAliveState.lastSkippedReason = skipReason;
    keepAliveState.lastError = '';
    keepAliveState.lastWarning = '';
    return { skipped: true };
  }

  keepAliveState.running = true;
  keepAliveState.status = 'checking';
  keepAliveState.statusMessage = '正在执行浏览器心跳';
  keepAliveState.lastAttemptAt = new Date().toISOString();
  keepAliveState.lastSkippedReason = '';

  const results = [];
  const errors = [];

  try {
    for (const origin of KEEPALIVE_ORIGINS) {
      try {
        const target = await findIntranetTarget(origin);
        await assertTargetOrigin(target.webSocketDebuggerUrl, origin);
        const pingResult = await pingIntranetTargetWithRecovery(origin, target);
        const location = await getTargetLocation(target);
        results.push({
          origin,
          status: pingResult?.status || 0,
          href: location?.href || pingResult?.href || target.url || '',
          recovered: Boolean(pingResult?.recovered),
        });
      } catch (error) {
        errors.push({
          origin,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (results.length === 0) {
      throw new Error(formatKeepAliveErrors(errors) || '所有内网页签心跳失败');
    }

    keepAliveState.lastSuccessAt = new Date().toISOString();
    keepAliveState.lastFailureAt = '';
    keepAliveState.lastError = '';
    keepAliveState.lastWarning = errors.length > 0 ? `部分保活失败：${formatKeepAliveErrors(errors)}` : '';
    keepAliveState.lastTargetUrl = results
      .map((item) => `${item.origin}(${item.status || '--'}${item.recovered ? '/刷新恢复' : ''})`)
      .join('；');
    keepAliveState.lastCheckedOrigins = results.map((item) => item.origin);
    keepAliveState.consecutiveFailures = 0;
    keepAliveState.status = errors.length > 0 ? 'partial' : 'healthy';
    const recoveredCount = results.filter((item) => item.recovered).length;
    keepAliveState.statusMessage = errors.length > 0
      ? `部分保活成功：${results.length}/${KEEPALIVE_ORIGINS.length}`
      : recoveredCount > 0
        ? `保活正常，已刷新恢复 ${recoveredCount} 个内网页签`
        : '保活正常，定时同步可独立执行';
    console.log(`[keepalive] heartbeat ok origins=${results.map((item) => `${item.origin}:${item.status}`).join(', ')}`);
    if (errors.length > 0) {
      console.warn(`[keepalive] partial failure: ${formatKeepAliveErrors(errors)}`);
    }
    return { skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    keepAliveState.lastFailureAt = new Date().toISOString();
    keepAliveState.lastCheckedOrigins = [];

    if (isRecoverableKeepAliveIssueMessage(message)) {
      keepAliveState.consecutiveFailures = 0;
      keepAliveState.lastError = '';
      keepAliveState.lastWarning = message;
      keepAliveState.status = 'waiting';
      keepAliveState.statusMessage = '浏览器或登录态尚在准备中，保活会继续短周期重试；定时同步仍会按计划触发';
      console.warn(`[keepalive] waiting: ${message}`);
      return { skipped: true };
    }

    keepAliveState.consecutiveFailures += 1;
    keepAliveState.lastError = message;
    keepAliveState.lastWarning = '';
    keepAliveState.status = 'degraded';
    keepAliveState.statusMessage = '保活失败，正在短间隔重试；若 VPN 客户端已断开需先恢复 VPN';
    console.warn(`[keepalive] failed: ${keepAliveState.lastError}`);
    return { skipped: false };
  } finally {
    keepAliveState.running = false;
  }
}

function startKeepAliveLoop() {
  if (!KEEPALIVE_ENABLED) {
    console.log('[keepalive] disabled by RISK_KEEPALIVE_ENABLED=false');
    return;
  }

  console.log(`[keepalive] enabled, heartbeat origins=${KEEPALIVE_ORIGINS.join(', ')} interval=${Math.round(KEEPALIVE_INTERVAL_MS / 1000)}s`);
  const scheduleKeepAlive = (delayMs) => {
    keepAliveState.nextRunAt = formatIso(new Date(Date.now() + delayMs));
    keepAliveState.timer = setTimeout(async () => {
      let result;
      try {
        result = await runKeepAliveOnce();
      } finally {
        scheduleKeepAlive(result?.skipped ? KEEPALIVE_SKIP_RETRY_MS : getNextKeepAliveDelayMs());
      }
    }, delayMs);
  };

  scheduleKeepAlive(KEEPALIVE_START_DELAY_MS);
}

const server = http.createServer(async (req, res) => {
  try {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      mode: 'risk-local-api',
      intranetOrigin: INTRANET_ORIGIN,
      changeIntranetOrigin: CHANGE_INTRANET_ORIGIN,
      drillIntranetOrigin: DRILL_INTRANET_ORIGIN,
      eventIntranetOrigin: EVENT_INTRANET_ORIGIN,
      inspectIntranetOrigin: INSPECT_INTRANET_ORIGIN,
      browserDebugPort: DEBUG_PORT,
      browserDebug: {
        port: DEBUG_PORT,
        profileDir: BROWSER_PROFILE_DIR,
        lastLaunchAt: browserDebugState.lastLaunchAt,
        lastLaunchError: browserDebugState.lastLaunchError,
      },
      keepAlive: {
        enabled: KEEPALIVE_ENABLED,
        intervalMs: KEEPALIVE_INTERVAL_MS,
        startDelayMs: KEEPALIVE_START_DELAY_MS,
        failureRetryMs: KEEPALIVE_MAX_FAILURE_BACKOFF_MS,
        recoveryEnabled: KEEPALIVE_RECOVERY_ENABLED,
        recoveryWaitMs: KEEPALIVE_RECOVERY_WAIT_MS,
        running: keepAliveState.running,
        status: keepAliveState.status,
        statusMessage: keepAliveState.statusMessage,
        lastAttemptAt: keepAliveState.lastAttemptAt,
        lastSuccessAt: keepAliveState.lastSuccessAt,
        lastFailureAt: keepAliveState.lastFailureAt,
        lastError: keepAliveState.lastError,
        lastWarning: keepAliveState.lastWarning,
        lastSkippedReason: keepAliveState.lastSkippedReason,
        lastTargetUrl: keepAliveState.lastTargetUrl,
        nextRunAt: keepAliveState.nextRunAt,
        consecutiveFailures: keepAliveState.consecutiveFailures,
        origins: keepAliveState.origins,
        lastCheckedOrigins: keepAliveState.lastCheckedOrigins,
      },
      autoSync: {
        enabled: AUTO_SYNC_ENABLED,
        hour: AUTO_SYNC_SCHEDULES[0]?.hour ?? 0,
        minute: AUTO_SYNC_SCHEDULES[0]?.minute ?? 0,
        scheduleTimes: autoSyncState.scheduleTimes,
        running: autoSyncState.running,
        queued: autoSyncState.queued,
        statusMessage: autoSyncState.statusMessage,
        lastAttemptAt: autoSyncState.lastAttemptAt,
        lastSuccessAt: autoSyncState.lastSuccessAt,
        lastError: autoSyncState.lastError,
        lastInsertedCount: autoSyncState.lastInsertedCount,
        nextRunAt: autoSyncState.nextRunAt,
      },
      changeAutoSync: {
        enabled: CHANGE_AUTO_SYNC_ENABLED,
        hour: CHANGE_AUTO_SYNC_SCHEDULES[0]?.hour ?? 0,
        minute: CHANGE_AUTO_SYNC_SCHEDULES[0]?.minute ?? 0,
        scheduleTimes: changeAutoSyncState.scheduleTimes,
        running: changeAutoSyncState.running,
        queued: changeAutoSyncState.queued,
        statusMessage: changeAutoSyncState.statusMessage,
        lastAttemptAt: changeAutoSyncState.lastAttemptAt,
        lastSuccessAt: changeAutoSyncState.lastSuccessAt,
        lastError: changeAutoSyncState.lastError,
        lastInsertedCount: changeAutoSyncState.lastInsertedCount,
        nextRunAt: changeAutoSyncState.nextRunAt,
      },
      drillAutoSync: {
        enabled: DRILL_AUTO_SYNC_ENABLED,
        hour: DRILL_AUTO_SYNC_SCHEDULES[0]?.hour ?? 0,
        minute: DRILL_AUTO_SYNC_SCHEDULES[0]?.minute ?? 0,
        scheduleTimes: drillAutoSyncState.scheduleTimes,
        running: drillAutoSyncState.running,
        queued: drillAutoSyncState.queued,
        statusMessage: drillAutoSyncState.statusMessage,
        lastAttemptAt: drillAutoSyncState.lastAttemptAt,
        lastSuccessAt: drillAutoSyncState.lastSuccessAt,
        lastError: drillAutoSyncState.lastError,
        lastInsertedCount: drillAutoSyncState.lastInsertedCount,
        nextRunAt: drillAutoSyncState.nextRunAt,
      },
      eventAutoSync: {
        enabled: EVENT_AUTO_SYNC_ENABLED,
        hour: EVENT_AUTO_SYNC_SCHEDULES[0]?.hour ?? 0,
        minute: EVENT_AUTO_SYNC_SCHEDULES[0]?.minute ?? 0,
        scheduleTimes: eventAutoSyncState.scheduleTimes,
        running: eventAutoSyncState.running,
        queued: eventAutoSyncState.queued,
        statusMessage: eventAutoSyncState.statusMessage,
        lastAttemptAt: eventAutoSyncState.lastAttemptAt,
        lastSuccessAt: eventAutoSyncState.lastSuccessAt,
        lastError: eventAutoSyncState.lastError,
        lastInsertedCount: eventAutoSyncState.lastInsertedCount,
        nextRunAt: eventAutoSyncState.nextRunAt,
      },
      inspectAutoSync: {
        enabled: INSPECT_AUTO_SYNC_ENABLED,
        hour: INSPECT_AUTO_SYNC_SCHEDULES[0]?.hour ?? 0,
        minute: INSPECT_AUTO_SYNC_SCHEDULES[0]?.minute ?? 0,
        scheduleTimes: inspectAutoSyncState.scheduleTimes,
        running: inspectAutoSyncState.running,
        queued: inspectAutoSyncState.queued,
        statusMessage: inspectAutoSyncState.statusMessage,
        lastAttemptAt: inspectAutoSyncState.lastAttemptAt,
        lastSuccessAt: inspectAutoSyncState.lastSuccessAt,
        lastError: inspectAutoSyncState.lastError,
        lastInsertedCount: inspectAutoSyncState.lastInsertedCount,
        nextRunAt: inspectAutoSyncState.nextRunAt,
      },
      eventSyncProgress: cloneEventSyncProgress(),
      buildingOptions: {
        options: buildingOptionsState.options,
        yearMonth: buildingOptionsState.yearMonth,
        updatedAt: buildingOptionsState.updatedAt,
        sourcePath: buildingOptionsState.sourcePath,
        scannedCount: buildingOptionsState.scannedCount,
        matchedCount: buildingOptionsState.matchedCount,
        missingLabels: buildingOptionsState.missingLabels,
        lastError: buildingOptionsState.lastError,
      },
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/weather') {
    const weather = await fetchRealtimeWeather();
    sendJson(res, 200, weather);
    return;
  }

  if (req.method === 'GET' && req.url === '/api/event/sync/progress') {
    sendJson(res, 200, cloneEventSyncProgress());
    return;
  }

  if (req.method === 'POST' && req.url === '/api/risk/browser-fetch') {
    await handleRiskBrowserFetch(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/change/browser-fetch') {
    await handleChangeBrowserFetch(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/drill/browser-fetch') {
    await handleDrillBrowserFetch(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/event/browser-fetch') {
    await handleEventBrowserFetch(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/inspect/browser-fetch') {
    await handleInspectBrowserFetch(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/inspect/sync/run') {
    await handleInspectRunSync(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/risk/building-options/refresh') {
    await handleRefreshBuildingOptions(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/feishu/sync') {
    await handleFeishuSync(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/feishu/connectivity') {
    await handleFeishuConnectivity(req, res);
    return;
  }

  if (req.method === 'DELETE' && req.url === '/api/feishu/records') {
    await handleFeishuDeleteRecords(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/change/feishu/clear-basic-data') {
    await handleChangeClearBasicData(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/change/feishu/sync-basic-data') {
    await handleChangeSyncBasicData(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/change/feishu/clear-table') {
    await handleChangeClearWorkOrders(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/change/feishu/sync-workorders') {
    await handleChangeSyncWorkOrders(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/drill/feishu/sync') {
    await handleDrillFeishuSync(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/drill/sync/run') {
    await handleDrillRunSync(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/event/feishu/sync') {
    await handleEventFeishuSync(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/event/sync/full') {
    await handleEventFullSync(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/event/sync/incremental') {
    await handleEventIncrementalSync(req, res);
    return;
  }

  sendJson(res, 404, {
    success: false,
    message: 'Not Found',
  });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[http] ${req.method || ''} ${req.url || ''} failed: ${message}`);
    if (!res.headersSent && !res.writableEnded) {
      sendJson(res, 500, {
        success: false,
        message,
      });
      return;
    }

    if (!res.writableEnded) {
      res.end();
    }
  }
});

server.requestTimeout = 0;
server.timeout = 0;

server.on('clientError', (_error, socket) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  }
});

server.on('error', (error) => {
  console.error('[http] server error:', error);
  if (isFatalStartupError(error)) {
    process.exit(1);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`risk-local-api listening on http://${HOST}:${PORT}`);
  console.log(`browser debug: http://127.0.0.1:${DEBUG_PORT}`);
  console.log(`intranet origin: ${INTRANET_ORIGIN}`);
  console.log(`change origin: ${CHANGE_INTRANET_ORIGIN}`);
  console.log(`drill origin: ${DRILL_INTRANET_ORIGIN}`);
  console.log(`event origin: ${EVENT_INTRANET_ORIGIN}`);
  startKeepAliveLoop();
  scheduleNextAutoSync();
  scheduleNextChangeAutoSync();
  scheduleNextDrillAutoSync();
  scheduleNextEventAutoSync();
  scheduleNextInspectAutoSync();
});

