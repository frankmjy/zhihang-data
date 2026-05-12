import { useMemo, useState } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { Table } from '@lark-apaas/client-toolkit/antd-table';
import type { ColumnsType } from 'antd/es/table';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Database,
  Download,
  Loader2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { EventSyncProgressDTO, EventSyncRunResp } from '@shared/api.interface';

import { browserFetchEvent, getEventSyncProgress, syncEventFull, syncEventIncremental } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const EVENT_LIST_URL = 'https://event.example.internal/api/event/eventOrder/selEventMsg';
const EVENT_API_PAGE_SIZE = 100;
const EVENT_TABLE_PAGE_SIZE = 15;
const EVENT_PAGE_CONCURRENCY = 6;
const EVENT_MAX_PAGES = 1000;
const EVENT_COMPLETED_START_DATE = '2026-01-01 00:00:00';
const EVENT_COMPLETED_ORDER_STATUS = '5';
const EVENT_COMPLETED_START_DATE_FIELD = 'startDate';

const DEFAULT_EVENT_PAYLOAD = {
  creator: '',
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
    pageNumber: 1,
    pageSize: EVENT_API_PAGE_SIZE,
  },
  realEvent: '',
  startAskDate: '',
  startDate: '',
  startHappendDate: '',
  startIncidentRecoveryDate: '',
  startResponseDate: '',
  userId: '',
};

const EVENT_FETCH_SCOPES = [
  {
    key: 'active',
    label: '当前事件',
    payloadOverrides: {},
  },
  {
    key: 'completed',
    label: '完成事件',
    payloadOverrides: {
      orderStatus: EVENT_COMPLETED_ORDER_STATUS,
      [EVENT_COMPLETED_START_DATE_FIELD]: EVENT_COMPLETED_START_DATE,
    },
  },
];

interface EventRecord {
  id?: string;
  eventNumber?: string;
  eventTitle?: string;
  eventStatus?: string | number | null;
  eventCurrentLevelName?: string;
  eventHighestLevelName?: string;
  eventFirstLevelName?: string;
  creator?: string;
  creatTime?: string;
  updater?: string | null;
  updateTime?: string;
  happenTime?: string;
  notificationTime?: string;
  orderStatus?: string | number | null;
  dcName?: string;
  eventType?: string;
  eventSource?: string | number | null;
  location?: string;
  eventDescription?: string;
  responseTime?: string;
  ackTime?: string;
  incidentRecoveryTime?: string | null;
  solveTime?: string | null;
  closeTime?: string | null;
  highestLevelTitle?: string;
  realEvent?: boolean | string | null;
  eventAlarmStatus?: string | number | null;
  ackTimeCost?: string;
  responseTimeCost?: string;
  [key: string]: unknown;
}

interface EventApiResponse {
  code?: string;
  message?: string;
  success?: boolean;
  data?: {
    dataList?: EventRecord[];
    records?: EventRecord[];
    list?: EventRecord[];
    total?: number;
    count?: number;
    totalCount?: number;
    totalRecords?: number;
    pages?: number;
    totalPages?: number;
    pageCount?: number;
    pageBean?: {
      total?: number;
      totalCount?: number;
      pages?: number;
      totalPages?: number;
      pageNumber?: number;
      pageSize?: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

interface EventPageResult {
  scopeKey: string;
  scopeLabel: string;
  pageNumber: number;
  records: EventRecord[];
  total: number;
  totalPages: number;
  raw: EventApiResponse;
}

interface EventFetchResult {
  mode?: 'full' | 'incremental';
  records: EventRecord[];
  rawPages: EventApiResponse[];
  syncRun?: EventSyncRunResp;
  totalFromApi: number;
  totalPages: number;
  activeRecordCount: number;
  completedRecordCount: number;
  completedAddedCount: number;
  fetchedCount?: number;
  diffCount?: number;
  syncedCount?: number;
  insertedCount?: number;
  updatedCount?: number;
  deletedCount?: number;
  failedCount?: number;
  notified?: boolean;
  message?: string;
  reasonSummary?: string;
  previewLimit?: number;
  progress?: EventSyncProgressDTO;
  views?: EventSyncRunResp['views'];
  fetchedAt: string;
  durationMs: number;
}

interface HistoryItem {
  id: string;
  time: string;
  status: 'success' | 'failed';
  recordCount: number;
  pageCount: number;
  durationMs: number;
  message: string;
}

type EventTableRecord = EventRecord & { _index?: number; _rowKey?: string };

const orderStatusMap: Record<string, string> = {
  '1': '待响应',
  '2': '待确认',
  '3': '待解决',
  '4': '待关闭',
  '5': '完成',
  '6': '处理中',
  '8': '已终止',
};

const eventStatusMap: Record<string, string> = {
  '1': '待响应',
  '2': '待确认',
  '3': '处理中',
  '4': '待解决',
  '5': '待关闭',
  '6': '完成',
  '8': '处理中',
};

function getText(value: unknown, fallback = '--') {
  const text = String(value ?? '').trim();
  return text ? text : fallback;
}

function normalizeEventOrderStatus(value: unknown) {
  const key = String(value ?? '').trim();
  return orderStatusMap[key] || key;
}

function normalizeEventStatus(value: unknown) {
  const key = String(value ?? '').trim();
  return eventStatusMap[key] || key;
}

function isCompletedStatusText(value: unknown) {
  return String(value ?? '').trim() === '完成';
}

function isIncompleteEventRecord(record: EventRecord) {
  const orderStatusText = String(normalizeEventOrderStatus(record.orderStatus) || '').trim();
  if (orderStatusText) {
    return !isCompletedStatusText(orderStatusText);
  }

  const flowStatusText = String(normalizeEventStatus(record.eventStatus) || '').trim();
  return Boolean(flowStatusText && !isCompletedStatusText(flowStatusText));
}

function isFalseRealEventRecord(record: EventRecord) {
  const value = record.realEvent;
  const text = String(value ?? '').trim().toLowerCase();
  return value === false || ['false', '0', 'no', 'n', '否'].includes(text);
}

function normalizeTotal(data: EventApiResponse['data']) {
  const rawTotal = data?.total
    ?? data?.count
    ?? data?.totalCount
    ?? data?.totalRecords
    ?? data?.pageBean?.total
    ?? data?.pageBean?.totalCount
    ?? 0;
  const total = Number(rawTotal);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

function normalizeTotalPages(data: EventApiResponse['data'], total: number) {
  const rawPages = data?.pages
    ?? data?.totalPages
    ?? data?.pageCount
    ?? data?.pageBean?.pages
    ?? data?.pageBean?.totalPages;
  const pages = Number(rawPages);
  if (Number.isFinite(pages) && pages > 0) {
    return Math.ceil(pages);
  }

  return total > 0 ? Math.max(1, Math.ceil(total / EVENT_API_PAGE_SIZE)) : 1;
}

function formatDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '--';
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function formatSyncProgressText(progress?: EventSyncProgressDTO | null) {
  if (!progress) return '';
  const percent = Number(progress.percent || 0);
  const message = progress.message || '正在同步事件';
  return percent > 0 ? `${message}（${Math.min(100, Math.max(0, Math.round(percent)))}%）` : message;
}

function getProgressRows(progress?: EventSyncProgressDTO | null) {
  if (!progress) return [];
  return [
    {
      label: '接口拉取',
      value: `${progress.fetch?.completedPages || 0}/${progress.fetch?.totalPages || 0} 页，${progress.fetch?.records || 0} 条`,
    },
    {
      label: '飞书扫描',
      value: `${progress.feishu?.listedRecords || 0} 条旧记录`,
    },
    {
      label: '删除旧记录',
      value: `${progress.feishu?.deleteBatchesCompleted || 0}/${progress.feishu?.deleteBatchesTotal || 0} 批，计划 ${progress.feishu?.deleteTotal || 0} 条`,
    },
    {
      label: '写入记录',
      value: `${progress.feishu?.createBatchesCompleted || 0}/${progress.feishu?.createBatchesTotal || 0} 批，计划 ${progress.feishu?.createTotal || 0} 条`,
    },
  ];
}

function getRecordKey(record: EventRecord, index: number) {
  return String(
    record.id
      || record.eventNumber
      || `${record.eventTitle || 'unknown'}-${record.happenTime || record.creatTime || index}`,
  );
}

function getStableEventKey(record: EventRecord) {
  return String(record.id || record.eventNumber || '').trim();
}

function mergeEventRecordSets(primaryRecords: EventRecord[], secondaryRecords: EventRecord[]) {
  const records = [...primaryRecords];
  const seenKeys = new Set(records.map((record) => getStableEventKey(record)).filter(Boolean));
  let addedSecondaryCount = 0;

  secondaryRecords.forEach((record) => {
    const key = getStableEventKey(record);
    if (key && seenKeys.has(key)) {
      return;
    }
    records.push(record);
    addedSecondaryCount += 1;
    if (key) {
      seenKeys.add(key);
    }
  });

  return {
    records,
    addedSecondaryCount,
  };
}

function getOrderStatusText(value?: string | number | null) {
  const key = String(value ?? '').trim();
  return key ? (orderStatusMap[key] || getText(key)) : '--';
}

function getOrderStatusTone(value?: string | number | null): 'slate' | 'green' | 'blue' | 'amber' | 'red' {
  const key = String(value ?? '').trim();
  if (key === '5') return 'green';
  if (key === '3') return 'green';
  if (key === '6' || key === '2') return 'blue';
  if (key === '1') return 'amber';
  return 'slate';
}

function getLevelTone(value?: string): 'slate' | 'green' | 'blue' | 'amber' | 'red' {
  const text = String(value || '').toUpperCase();
  if (text.includes('I1')) return 'red';
  if (text.includes('I2')) return 'amber';
  if (text.includes('I3')) return 'blue';
  return 'slate';
}

function getAlarmStatusText(value?: string | number | null) {
  const key = String(value ?? '').trim();
  if (key === '1') return '未恢复';
  if (key === '0') return '已恢复';
  return key ? getText(key) : '--';
}

function getAlarmStatusTone(value?: string | number | null): 'slate' | 'green' | 'blue' | 'amber' | 'red' {
  const key = String(value ?? '').trim();
  if (key === '1') return 'red';
  if (key === '0') return 'green';
  return 'slate';
}

function isRealEvent(value: unknown) {
  return value === true || String(value).toLowerCase() === 'true';
}

function StatusBadge({
  value,
  tone = 'slate',
}: {
  value: string;
  tone?: 'slate' | 'green' | 'blue' | 'amber' | 'red';
}) {
  const toneClass = {
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    green: 'border-green-200 bg-green-50 text-green-700',
    blue: 'border-sky-200 bg-sky-50 text-sky-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-red-200 bg-red-50 text-red-700',
  }[tone];

  return (
    <Badge variant="outline" className={`font-normal ${toneClass}`}>
      {value}
    </Badge>
  );
}

async function runConcurrentTasks<T, R>({
  items,
  concurrency,
  worker,
  onProgress,
}: {
  items: T[];
  concurrency: number;
  worker: (item: T, index: number) => Promise<R>;
  onProgress?: (state: { completed: number; total: number }) => void;
}) {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  const runnerCount = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;
  let completed = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
      completed += 1;
      onProgress?.({ completed, total: items.length });
    }
  };

  await Promise.all(Array.from({ length: runnerCount }, () => runWorker()));
  return results;
}

export default function EventPage() {
  const [loading, setLoading] = useState(false);
  const [fullSyncing, setFullSyncing] = useState(false);
  const [result, setResult] = useState<EventFetchResult | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [syncProgress, setSyncProgress] = useState<EventSyncProgressDTO | null>(null);
  const [showRawData, setShowRawData] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const requestPage = async (
    pageNumber: number,
    scope: (typeof EVENT_FETCH_SCOPES)[number],
  ): Promise<EventPageResult> => {
    const payload = {
      ...DEFAULT_EVENT_PAYLOAD,
      ...scope.payloadOverrides,
      pageBean: {
        ...DEFAULT_EVENT_PAYLOAD.pageBean,
        pageNumber,
        pageSize: EVENT_API_PAGE_SIZE,
      },
    };

    logger.info(`开始拉取${scope.label}第 ${pageNumber} 页`);
    const bridgeResult = await browserFetchEvent<EventApiResponse>({
      url: EVENT_LIST_URL,
      method: 'POST',
      payload,
    });

    if (!bridgeResult.success || !bridgeResult.data) {
      throw new Error(bridgeResult.message || `第 ${pageNumber} 页拉取失败`);
    }

    const apiResult = bridgeResult.data;
    if (!apiResult || typeof apiResult !== 'object' || Array.isArray(apiResult)) {
      throw new Error('事件接口未返回 JSON 对象，请确认浏览器页签已登录事件系统');
    }

    if (apiResult.code && apiResult.code !== '200') {
      throw new Error(apiResult.message || `事件接口返回异常：${apiResult.code}`);
    }

    if (apiResult.success === false) {
      throw new Error(apiResult.message || '事件接口返回失败');
    }

    const records = Array.isArray(apiResult.data?.dataList)
      ? apiResult.data.dataList
      : Array.isArray(apiResult.data?.records)
        ? apiResult.data.records
        : Array.isArray(apiResult.data?.list)
          ? apiResult.data.list
          : [];
    const total = normalizeTotal(apiResult.data);
    const totalPages = normalizeTotalPages(apiResult.data, total);

    logger.info(`${scope.label}第 ${pageNumber} 页完成，records=${records.length} total=${total} totalPages=${totalPages}`);
    return {
      scopeKey: scope.key,
      scopeLabel: scope.label,
      pageNumber,
      records,
      total,
      totalPages,
      raw: apiResult,
    };
  };

  const fetchScopePages = async (scope: (typeof EVENT_FETCH_SCOPES)[number]) => {
    setProgress(`正在请求${scope.label}第 1 页`);
    const firstPage = await requestPage(1, scope);
    const rawPages = [firstPage.raw];
    const allRecords = [...firstPage.records];
    const totalFromApi = firstPage.total;
    const totalPages = firstPage.totalPages;

    if (totalPages > EVENT_MAX_PAGES) {
      throw new Error(`接口总页数 ${totalPages} 超过安全上限 ${EVENT_MAX_PAGES}，已停止拉取`);
    }

    if (totalPages > 1) {
      const remainingPages = Array.from({ length: totalPages - 1 }, (_, index) => index + 2);
      setProgress(`正在并发拉取${scope.label}剩余 ${remainingPages.length} 页`);

      const pageResults = await runConcurrentTasks<number, EventPageResult>({
        items: remainingPages,
        concurrency: EVENT_PAGE_CONCURRENCY,
        worker: (pageNumber) => requestPage(pageNumber, scope),
        onProgress: ({ completed, total }) => {
          setProgress(`正在拉取${scope.label}剩余页：${completed} / ${total}`);
        },
      });

      pageResults
        .sort((left, right) => left.pageNumber - right.pageNumber)
        .forEach((page) => {
          allRecords.push(...page.records);
          rawPages.push(page.raw);
        });
    } else if (firstPage.records.length === EVENT_API_PAGE_SIZE && totalFromApi === 0) {
      let nextPage = 2;
      while (nextPage <= EVENT_MAX_PAGES) {
        setProgress(`${scope.label}接口未返回总数，正在探测第 ${nextPage} 页`);
        const page = await requestPage(nextPage, scope);
        rawPages.push(page.raw);
        if (page.records.length === 0) {
          break;
        }

        allRecords.push(...page.records);
        if (page.records.length < EVENT_API_PAGE_SIZE) {
          break;
        }

        nextPage += 1;
      }
    }

    return {
      records: allRecords,
      rawPages,
      totalFromApi,
      totalPages: Math.max(totalPages, rawPages.length),
    };
  };

  const fetchAllPages = async (): Promise<EventFetchResult> => {
    const startedAt = Date.now();
    const activeResult = await fetchScopePages(EVENT_FETCH_SCOPES[0]);
    const completedResult = await fetchScopePages(EVENT_FETCH_SCOPES[1]);
    const mergedResult = mergeEventRecordSets(activeResult.records, completedResult.records);

    return {
      records: mergedResult.records,
      rawPages: [...activeResult.rawPages, ...completedResult.rawPages],
      totalFromApi: activeResult.totalFromApi + completedResult.totalFromApi,
      totalPages: activeResult.totalPages + completedResult.totalPages,
      activeRecordCount: activeResult.records.length,
      completedRecordCount: completedResult.records.length,
      completedAddedCount: mergedResult.addedSecondaryCount,
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    };
  };

  const buildResultFromSyncRun = (syncResult: EventSyncRunResp): EventFetchResult => ({
    mode: syncResult.mode,
    records: (syncResult.records || []) as EventRecord[],
    rawPages: [],
    syncRun: syncResult,
    totalFromApi: Number(syncResult.totalFromApi || syncResult.fetchedCount || 0),
    totalPages: Number(syncResult.totalPages || 0),
    activeRecordCount: Number(syncResult.activeRecordCount || 0),
    completedRecordCount: Number(syncResult.completedRecordCount || 0),
    completedAddedCount: Number(syncResult.completedAddedCount || 0),
    fetchedCount: Number(syncResult.fetchedCount || 0),
    diffCount: Number(syncResult.diffCount || 0),
    syncedCount: Number(syncResult.syncedCount || 0),
    insertedCount: Number(syncResult.insertedCount || 0),
    updatedCount: Number(syncResult.updatedCount || 0),
    deletedCount: Number(syncResult.deletedCount || 0),
    failedCount: Number(syncResult.failedCount || 0),
    notified: Boolean(syncResult.notified),
    message: syncResult.message || '',
    reasonSummary: syncResult.reasonSummary || '',
    previewLimit: Number(syncResult.previewLimit || 0),
    progress: syncResult.progress,
    views: syncResult.views,
    fetchedAt: syncResult.fetchedAt || new Date().toISOString(),
    durationMs: Number(syncResult.durationMs || 0),
  });

  const getSyncRunMessage = (syncResult: EventSyncRunResp) => {
    if (syncResult.mode === 'full') {
      return '\u5168\u91cf\u5b8c\u6210\uff1a\u62c9\u53d6 ' + syncResult.fetchedCount + ' \u6761\uff0c\u8986\u76d6\u5199\u5165 ' + syncResult.insertedCount + ' \u6761\uff0c\u6e05\u7406\u65e7\u6570\u636e ' + syncResult.deletedCount + ' \u6761';
    }
    if (syncResult.mode === 'incremental') {
      return '\u589e\u91cf\u540c\u6b65\u5b8c\u6210\uff1a\u62c9\u53d6\u6700\u8fd130\u5929 ' + syncResult.fetchedCount + ' \u6761\uff0c\u5220\u9664\u6700\u8fd130\u5929\u53ca\u540c\u4e8b\u4ef6\u65e7\u8bb0\u5f55 ' + syncResult.deletedCount + ' \u6761\uff0c\u5199\u5165 ' + syncResult.insertedCount + ' \u6761';
    }

    const reasonText = syncResult.reasonSummary ? '\uff0c\u539f\u56e0 ' + syncResult.reasonSummary : '';
    return '\u589e\u91cf\u5b8c\u6210\uff1a\u62c9\u53d6 ' + syncResult.fetchedCount + ' \u6761\uff0c\u5dee\u5f02 ' + syncResult.diffCount + ' \u6761\uff0c\u65b0\u589e ' + syncResult.insertedCount + ' \u6761\uff0c\u66f4\u65b0 ' + syncResult.updatedCount + ' \u6761' + reasonText;
  };

  const runEventSync = async (mode: 'incremental' | 'full') => {
    const isFull = mode === 'full';
    if (isFull) {
      setFullSyncing(true);
    } else {
      setLoading(true);
    }
    setError('');
    setSyncProgress(null);
    setProgress(
      isFull
        ? '\u6b63\u5728\u62c9\u53d6\u5168\u91cf\u4e8b\u4ef6\u5e76\u8986\u76d6\u98de\u4e66'
        : '\u6b63\u5728\u62c9\u53d6\u6700\u8fd130\u5929\u4e8b\u4ef6\u5e76\u6267\u884c\u589e\u91cf\u540c\u6b65',
    );

    let progressTimer: number | undefined;
    if (!isFull) {
      progressTimer = window.setInterval(() => {
        void getEventSyncProgress()
          .then((nextProgress) => {
            if (!nextProgress) return;
            setSyncProgress(nextProgress);
            const text = formatSyncProgressText(nextProgress);
            if (text) setProgress(text);
          })
          .catch(() => undefined);
      }, 1500);
    }

    try {
      const syncResult = isFull
        ? await syncEventFull()
        : await syncEventIncremental();
      const nextResult = buildResultFromSyncRun(syncResult);
      const message = syncResult.message || getSyncRunMessage(syncResult);
      if (syncResult.progress) {
        setSyncProgress(syncResult.progress);
      }
      setResult(nextResult);
      setProgress(message);
      const historyItem: HistoryItem = {
        id: String(Date.now()),
        time: nextResult.fetchedAt,
        status: syncResult.success ? 'success' : 'failed',
        recordCount: syncResult.fetchedCount,
        pageCount: Number(syncResult.totalPages || 0),
        durationMs: nextResult.durationMs,
        message,
      };
      setHistory((items) => [historyItem, ...items].slice(0, 20));

      if (syncResult.success && syncResult.syncedCount > 0 && !syncResult.notified) {
        toast.warning(message);
      } else if (syncResult.success) {
        toast.success(message);
      } else {
        throw new Error(message || '\u4e8b\u4ef6\u540c\u6b65\u5931\u8d25');
      }
    } catch (fetchError: any) {
      const message = fetchError?.response?.data?.message || fetchError?.message || '\u4e8b\u4ef6\u540c\u6b65\u5931\u8d25';
      setError(message);
      setProgress('');
      const historyItem: HistoryItem = {
        id: String(Date.now()),
        time: new Date().toISOString(),
        status: 'failed',
        recordCount: 0,
        pageCount: 0,
        durationMs: 0,
        message,
      };
      setHistory((items) => [historyItem, ...items].slice(0, 20));
      toast.error(message);
      logger.error('\u4e8b\u4ef6\u540c\u6b65\u5931\u8d25 - ' + message);
    } finally {
      if (progressTimer !== undefined) {
        window.clearInterval(progressTimer);
      }
      if (isFull) {
        setFullSyncing(false);
      } else {
        setLoading(false);
      }
    }
  };

  const handleFetchData = async () => {
    await runEventSync('incremental');
  };

  const handleFullSync = async () => {
    await runEventSync('full');
  };

  const handleCopyData = async () => {
    if (!result) {
      toast.error('\u6ca1\u6709\u53ef\u590d\u5236\u7684\u6570\u636e');
      return;
    }

    await navigator.clipboard.writeText(JSON.stringify(result.syncRun || result.records, null, 2));
    toast.success('\u5df2\u590d\u5236\u4e8b\u4ef6\u540c\u6b65\u7ed3\u679c JSON');
  };
  const handleReset = () => {
    setResult(null);
    setError('');
    setProgress('');
    setSyncProgress(null);
    setShowRawData(false);
  };

  const summaryCards = useMemo(() => {
    const records = result?.records || [];
    const fetchedCount = result?.fetchedCount ?? records.length;
    const completedCount = result?.completedRecordCount ?? records.filter((item) => String(item.orderStatus ?? '') === EVENT_COMPLETED_ORDER_STATUS).length;
    const incompleteRecords = records.filter(isIncompleteEventRecord);
    const handling = incompleteRecords.length;
    const incompleteRecovered = incompleteRecords.filter((item) => String(item.eventAlarmStatus ?? '') === '0').length;
    const incompleteUnrecovered = incompleteRecords.filter((item) => String(item.eventAlarmStatus ?? '') === '1').length;
    const falseReal = records.filter(isFalseRealEventRecord).length;
    const syncedCount = result?.syncedCount ?? 0;
    const modeText = result?.mode === 'full'
      ? '\u5168\u91cf\u540c\u6b65'
      : '\u8fd1\u0033\u0030\u5929\u589e\u91cf';

    return [
      {
        label: '\u4e8b\u4ef6\u8bb0\u5f55',
        value: fetchedCount,
        hint: result ? modeText : '\u7b49\u5f85\u540c\u6b65',
      },
      { label: '\u5199\u5165\u8303\u56f4', value: result?.diffCount ?? records.length, hint: result?.reasonSummary || '\u672c\u6b21\u9700\u5199\u5165\u98de\u4e66' },
      { label: '\u98de\u4e66\u8986\u76d6', value: syncedCount, hint: '\u5220\u9664 ' + (result?.deletedCount || 0) + ' / \u5199\u5165 ' + (result?.insertedCount || 0) },
      { label: '\u5b8c\u6210\u4e8b\u4ef6', value: completedCount, hint: '\u540c\u6b65\u8303\u56f4\u5185' },
      { label: '\u672a\u5b8c\u6210\u4e8b\u4ef6', value: handling, hint: '\u5df2\u6062\u590d ' + incompleteRecovered + ' / \u672a\u6062\u590d ' + incompleteUnrecovered },
      { label: '\u975e\u771f\u5b9e\u4e8b\u4ef6', value: falseReal, hint: '\u771f\u5b9e\u4e8b\u4ef6=\u5426' },
    ];
  }, [result]);
  const columns: ColumnsType<EventTableRecord> = [
    {
      title: '序号',
      dataIndex: '_index',
      width: 72,
      fixed: 'left',
    },
    {
      title: '事件编号',
      dataIndex: 'eventNumber',
      width: 260,
      ellipsis: true,
      render: (value: string) => getText(value),
    },
    {
      title: '事件标题',
      dataIndex: 'eventTitle',
      width: 220,
      ellipsis: true,
      render: (value: string) => getText(value),
    },
    {
      title: '最高告警',
      dataIndex: 'highestLevelTitle',
      width: 260,
      ellipsis: true,
      render: (value: string) => getText(value),
    },
    {
      title: '当前等级',
      dataIndex: 'eventCurrentLevelName',
      width: 100,
      render: (value: string) => <StatusBadge value={getText(value)} tone={getLevelTone(value)} />,
    },
    {
      title: '最高等级',
      dataIndex: 'eventHighestLevelName',
      width: 100,
      render: (value: string) => <StatusBadge value={getText(value)} tone={getLevelTone(value)} />,
    },
    {
      title: '事件类型',
      dataIndex: 'eventType',
      width: 100,
      render: (value: string) => getText(value),
    },
    {
      title: '告警状态',
      dataIndex: 'eventAlarmStatus',
      width: 110,
      render: (value: string | number | null) => (
        <StatusBadge value={getAlarmStatusText(value)} tone={getAlarmStatusTone(value)} />
      ),
    },
    {
      title: '事件状态',
      dataIndex: 'orderStatus',
      width: 110,
      render: (value: string | number | null) => (
        <StatusBadge value={getOrderStatusText(value)} tone={getOrderStatusTone(value)} />
      ),
    },
    {
      title: '数据中心',
      dataIndex: 'dcName',
      width: 190,
      ellipsis: true,
      render: (value: string) => getText(value),
    },
    {
      title: '位置',
      dataIndex: 'location',
      width: 240,
      ellipsis: true,
      render: (value: string) => getText(value),
    },
    {
      title: '发生时间',
      dataIndex: 'happenTime',
      width: 170,
      render: (value: string) => getText(value),
    },
    {
      title: '通知时间',
      dataIndex: 'notificationTime',
      width: 170,
      render: (value: string) => getText(value),
    },
    {
      title: '响应耗时',
      dataIndex: 'responseTimeCost',
      width: 110,
      render: (value: string) => getText(value),
    },
    {
      title: '确认耗时',
      dataIndex: 'ackTimeCost',
      width: 110,
      render: (value: string) => getText(value),
    },
    {
      title: '恢复时间',
      dataIndex: 'incidentRecoveryTime',
      width: 170,
      render: (value: string) => getText(value),
    },
    {
      title: '创建人',
      dataIndex: 'creator',
      width: 100,
      render: (value: string) => getText(value),
    },
    {
      title: '更新人',
      dataIndex: 'updater',
      width: 120,
      render: (value: string) => getText(value),
    },
    {
      title: '事件描述',
      dataIndex: 'eventDescription',
      width: 280,
      ellipsis: true,
      render: (value: string) => getText(value),
    },
  ];

  const historyColumns: ColumnsType<HistoryItem> = [
    {
      title: '时间',
      dataIndex: 'time',
      width: 180,
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: HistoryItem['status']) => (
        value === 'success'
          ? <StatusBadge value="成功" tone="green" />
          : <StatusBadge value="失败" tone="red" />
      ),
    },
    {
      title: '记录数',
      dataIndex: 'recordCount',
      width: 100,
    },
    {
      title: '页数',
      dataIndex: 'pageCount',
      width: 90,
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 100,
      render: (value: number) => formatDuration(value),
    },
    {
      title: '说明',
      dataIndex: 'message',
      ellipsis: true,
    },
  ];

  const toTableRecords = (records: EventRecord[]): EventTableRecord[] => records.map((item, index) => ({
    ...item,
    _index: index + 1,
    _rowKey: `${getRecordKey(item, index)}-${index}`,
  }));
  const incompleteDataSource = toTableRecords((result?.records || []).filter(isIncompleteEventRecord));
  const falseRealDataSource = toTableRecords((result?.records || []).filter(isFalseRealEventRecord));
  const progressRows = getProgressRows(syncProgress || result?.progress);
  const busy = loading || fullSyncing;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div className="space-y-2">
        <h1 className="text-lg font-medium leading-normal text-slate-900">智航事件数据拉取</h1>
        <p className="text-sm leading-6 text-slate-500">
          增量同步按最近30天时间范围拉取 orderStatus=1/2/3/4/5/6，覆盖飞书最近30天旧记录；群消息展示近30天未完成和真实事件为否的条目。
        </p>
      </div>

      <Card className="rounded-lg">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1.5">
              <CardTitle className="text-base font-medium leading-normal tracking-normal">接口拉取</CardTitle>
              <CardDescription className="text-sm">
                使用已登录浏览器页签请求事件系统，适配内网登录态、固定载荷、分页响应与飞书覆盖写入。
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {result && (
                <>
                  <Button variant="outline" className="gap-2" onClick={() => setShowRawData((value) => !value)}>
                    <Database className="h-4 w-4" />
                    {showRawData ? '显示表格' : '原始 JSON'}
                  </Button>
                  <Button variant="outline" className="gap-2" onClick={handleCopyData}>
                    <Copy className="h-4 w-4" />
                    复制
                  </Button>
                  <Button variant="ghost" className="gap-2" onClick={handleReset}>
                    <Trash2 className="h-4 w-4" />
                    清空
                  </Button>
                </>
              )}
              <Button className="gap-2" onClick={handleFetchData} disabled={busy}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {loading ? '\u589e\u91cf\u540c\u6b65\u4e2d' : '\u589e\u91cf\u540c\u6b65'}
              </Button>
              <Button variant="outline" className="gap-2" onClick={handleFullSync} disabled={busy}>
                {fullSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                {fullSyncing ? '\u5168\u91cf\u62c9\u53d6\u4e2d' : '\u62c9\u53d6\u5168\u91cf\u4e8b\u4ef6'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
            <div className="text-xs text-slate-500">目标接口</div>
            <div className="mt-1 break-all font-mono text-xs leading-5 text-slate-700">{EVENT_LIST_URL}</div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {summaryCards.map((card) => (
              <div key={card.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs text-slate-500">{card.label}</div>
                <div className="mt-1 text-lg font-medium tabular-nums text-slate-900">{card.value}</div>
                <div className="mt-1 text-xs text-slate-500">{card.hint}</div>
              </div>
            ))}
          </div>

          {progress && (
            <div className="rounded-lg border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-700">
              <div className="flex items-center gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                <span>{progress}</span>
              </div>
              {progressRows.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {progressRows.map((row) => (
                    <div key={row.label} className="rounded-md border border-sky-100 bg-white/70 px-3 py-2">
                      <div className="text-xs text-sky-500">{row.label}</div>
                      <div className="mt-1 text-sm text-sky-800">{row.value}</div>
                    </div>
                  ))}
                </div>
              )}
              {(syncProgress || result?.progress)?.steps?.length ? (
                <div className="mt-3 space-y-1 border-t border-sky-100 pt-3">
                  {((syncProgress || result?.progress)?.steps || []).slice(-4).map((step, index) => (
                    <div key={`${step.time || ''}-${index}`} className="text-xs leading-5 text-sky-700">
                      {step.message}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {result && !error && (
        <Card className="rounded-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base font-medium leading-normal tracking-normal">事件列表</CardTitle>
              <CardDescription className="text-sm">
                {'\u672c\u6b21\u9884\u89c8'} {result.records.length} {'\u6761\uff0c\u62c9\u53d6'} {result.fetchedCount || result.records.length} {'\u6761\uff0c\u8017\u65f6'} {formatDuration(result.durationMs)}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="gap-2 text-xs" onClick={handleFetchData} disabled={busy}>
              <RotateCcw className="h-3.5 w-3.5" />
              {'\u91cd\u65b0\u589e\u91cf\u540c\u6b65'}
            </Button>
          </CardHeader>
          <CardContent>
            {showRawData ? (
              <div className="max-h-[520px] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
                <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-slate-700">
                  {JSON.stringify(result.syncRun || result.rawPages, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="space-y-2">
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-base font-medium leading-normal text-slate-900">未完成事件</div>
                      <div className="text-sm text-slate-500">处理状态不是“完成”的近30天条目，共 {incompleteDataSource.length} 条</div>
                    </div>
                    {result.views?.incomplete?.url && (
                      <a className="text-sm text-sky-700 hover:text-sky-800" href={result.views.incomplete.url} target="_blank" rel="noreferrer">
                        打开多维表视图
                      </a>
                    )}
                  </div>
                  <div className="rounded-md border border-slate-200">
                    <Table
                      columns={columns}
                      dataSource={incompleteDataSource}
                      rowKey={(record, index) => record._rowKey || `${getRecordKey(record, index || 0)}-${index || 0}`}
                      scroll={{ x: 3300, y: 360 }}
                      pagination={{ pageSize: EVENT_TABLE_PAGE_SIZE, showSizeChanger: false }}
                      locale={{ emptyText: '暂无未完成事件' }}
                      size="middle"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-base font-medium leading-normal text-slate-900">非真实事件</div>
                      <div className="text-sm text-slate-500">真实事件为“否”的近30天条目，共 {falseRealDataSource.length} 条</div>
                    </div>
                    {result.views?.falseReal?.url && (
                      <a className="text-sm text-sky-700 hover:text-sky-800" href={result.views.falseReal.url} target="_blank" rel="noreferrer">
                        打开多维表视图
                      </a>
                    )}
                  </div>
                  <div className="rounded-md border border-slate-200">
                    <Table
                      columns={columns}
                      dataSource={falseRealDataSource}
                      rowKey={(record, index) => record._rowKey || `${getRecordKey(record, index || 0)}-${index || 0}`}
                      scroll={{ x: 3300, y: 360 }}
                      pagination={{ pageSize: EVENT_TABLE_PAGE_SIZE, showSizeChanger: false }}
                      locale={{ emptyText: '暂无非真实事件' }}
                      size="middle"
                    />
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="rounded-lg">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium leading-normal tracking-normal">拉取历史</CardTitle>
          <CardDescription className="text-sm">当前页面会保留最近 20 次操作结果。</CardDescription>
        </CardHeader>
        <CardContent>
          <Table
            columns={historyColumns}
            dataSource={history}
            rowKey="id"
            pagination={false}
            scroll={{ x: 760, y: 300 }}
            locale={{ emptyText: '暂无拉取历史' }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
