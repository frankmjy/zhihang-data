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

import { browserFetchInspect, runInspectSync } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const INSPECT_LIST_BASE_URL = 'https://inspect2.meta42.indc.vnet.com/api/inspect/inspection/job/list';
const INSPECT_API_PAGE_SIZE = 15;
const INSPECT_TABLE_PAGE_SIZE = 15;
const INSPECT_PAGE_CONCURRENCY = 6;
const INSPECT_MAX_PAGES = 1000;
const INSPECT_DATACENTER_CODE = '0.5.2.2.1.1';

const DEFAULT_INSPECT_QUERY_BASE: Record<string, string | number> = {
  pageNum: 1,
  pageSize: INSPECT_API_PAGE_SIZE,
  jobInfo: '',
  jobExecuteStatus: '',
  datacenterCode: INSPECT_DATACENTER_CODE,
  buildingCode: '',
  withinDay: '',
  userName: '',
  executeCycle: '',
  startDateTime: '',
  endDateTime: '',
  planStartDatetime: '',
  planEndDatetime: '',
  startSubmitTime: '',
  endSubmitTime: '',
};

interface InspectStatMap {
  total?: number | string;
  job_id?: number | string;
  zc?: number | string;
  yc?: number | string;
  [key: string]: unknown;
}

interface InspectRecord {
  params?: {
    statMap?: InspectStatMap;
    [key: string]: unknown;
  };
  id?: string;
  executeCycle?: string;
  planName?: string;
  planId?: number | string;
  planStartDatetime?: string;
  planEndDatetime?: string;
  execStartTime?: string | null;
  execEndTime?: string | null;
  submitTime?: string | null;
  orderReceiveTime?: string | null;
  jobExecuteStatus?: string | null;
  jobExecuteStatusName?: string | null;
  userName?: string | null;
  datacenterName?: string;
  locations?: string | null;
  buildingCode?: string;
  buildingName?: string;
  overdueReason?: string | null;
  [key: string]: unknown;
}

interface InspectApiResponse {
  code?: string | number;
  msg?: string;
  message?: string;
  success?: boolean;
  total?: number | string;
  rows?: InspectRecord[];
  data?: {
    rows?: InspectRecord[];
    records?: InspectRecord[];
    list?: InspectRecord[];
    total?: number | string;
    count?: number | string;
    totalCount?: number | string;
    totalRecords?: number | string;
    pages?: number | string;
    totalPages?: number | string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface InspectPageResult {
  pageNum: number;
  records: InspectRecord[];
  total: number;
  totalPages: number;
  raw: InspectApiResponse;
}

interface InspectFetchResult {
  records: InspectRecord[];
  rawPages: InspectApiResponse[];
  totalFromApi: number;
  totalPages: number;
  fetchedAt: string;
  durationMs: number;
  rangeStart?: string;
  rangeEnd?: string;
  sync?: {
    insertedCount: number;
    deletedCount: number;
    failedCount: number;
    notified: boolean;
    bitableUrl?: string;
    message?: string;
  };
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

type InspectTableRecord = InspectRecord & { _index?: number; _rowKey?: string };
type StatusTone = 'slate' | 'green' | 'blue' | 'amber' | 'red';

const executeCycleMap: Record<string, string> = {
  day: '日常巡检',
  week: '周巡检',
  month: '月度巡检',
  quarter: '季度巡检',
  year: '年度巡检',
};

function formatDateTime(date: Date, endOfDay = false) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day} ${endOfDay ? '23:59:59' : '00:00:00'}`;
}

function getCurrentMonthRange(now = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: formatDateTime(monthStart),
    end: formatDateTime(monthEnd, true),
  };
}

function getInspectQuery(pageNum: number) {
  const range = getCurrentMonthRange();
  return {
    ...DEFAULT_INSPECT_QUERY_BASE,
    pageNum,
    pageSize: INSPECT_API_PAGE_SIZE,
    planStartDatetime: range.start,
    planEndDatetime: range.end,
  };
}

function buildInspectUrl(pageNum: number) {
  const url = new URL(INSPECT_LIST_BASE_URL);
  Object.entries(getInspectQuery(pageNum)).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function getText(value: unknown, fallback = '--') {
  const text = String(value ?? '').trim();
  return text ? text : fallback;
}

function toNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeRows(response: InspectApiResponse) {
  if (Array.isArray(response.rows)) return response.rows;
  if (Array.isArray(response.data?.rows)) return response.data.rows;
  if (Array.isArray(response.data?.records)) return response.data.records;
  if (Array.isArray(response.data?.list)) return response.data.list;
  return [];
}

function normalizeTotal(response: InspectApiResponse, fallbackCount: number) {
  const rawTotal = response.total
    ?? response.data?.total
    ?? response.data?.totalCount
    ?? response.data?.totalRecords
    ?? response.data?.count
    ?? fallbackCount;
  const total = Number(rawTotal);
  return Number.isFinite(total) && total > 0 ? total : fallbackCount;
}

function normalizeTotalPages(response: InspectApiResponse, total: number) {
  const rawPages = response.data?.pages ?? response.data?.totalPages;
  const pages = Number(rawPages);
  if (Number.isFinite(pages) && pages > 0) {
    return Math.ceil(pages);
  }

  return total > 0 ? Math.max(1, Math.ceil(total / INSPECT_API_PAGE_SIZE)) : 1;
}

function formatDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '--';
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function getStatMap(record: InspectRecord) {
  return record.params?.statMap || {};
}

function getStatValue(record: InspectRecord, key: keyof InspectStatMap) {
  return toNumber(getStatMap(record)[key]);
}

function getRecordKey(record: InspectRecord, index: number) {
  const statMap = getStatMap(record);
  return String(
    record.id
      || statMap.job_id
      || `${record.planName || 'inspect'}-${record.planStartDatetime || index}`,
  );
}

function getExecuteCycleText(value?: string) {
  const key = String(value || '').trim();
  return key ? (executeCycleMap[key] || key) : '--';
}

function formatInspectPlanTime(value?: string | null) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2})/);
  if (!match) return getText(text);
  const [, year, month, day, hour, minute] = match;
  return `${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

function formatInspectPlanRange(record: InspectRecord) {
  const start = formatInspectPlanTime(record.planStartDatetime);
  const end = formatInspectPlanTime(record.planEndDatetime);
  if (start !== '--' && end !== '--') return `${start}-${end}`;
  return start !== '--' ? start : end;
}

function formatInspectResult(record: InspectRecord) {
  const total = getStatValue(record, 'total');
  const normal = getStatValue(record, 'zc');
  const abnormal = getStatValue(record, 'yc');
  if (total <= 0 && normal <= 0 && abnormal <= 0) {
    return '--';
  }

  return `总:${total} 正常:${normal} 异常:${abnormal}`;
}

function getJobStatusText(record: InspectRecord) {
  return getText(record.jobExecuteStatusName || record.jobExecuteStatus);
}

function getJobStatusTone(record: InspectRecord): StatusTone {
  const code = String(record.jobExecuteStatus || '').toLowerCase();
  const text = String(record.jobExecuteStatusName || '').trim();
  if (code.includes('unplayed') || text.includes('待')) return 'amber';
  if (text.includes('逾期') || text.includes('异常') || text.includes('取消')) return 'red';
  if (text.includes('进行') || text.includes('执行') || code.includes('playing')) return 'blue';
  if (text.includes('完成') || text.includes('已') || code.includes('finish') || code.includes('played')) return 'green';
  return 'slate';
}

function StatusBadge({
  value,
  tone = 'slate',
}: {
  value: string;
  tone?: StatusTone;
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

export default function InspectPage() {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<InspectFetchResult | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [showRawData, setShowRawData] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const requestPage = async (pageNum: number): Promise<InspectPageResult> => {
    const requestUrl = buildInspectUrl(pageNum);
    logger.info(`开始拉取巡检第 ${pageNum} 页`);
    const bridgeResult = await browserFetchInspect<InspectApiResponse>({
      url: requestUrl,
      method: 'GET',
      payload: getInspectQuery(pageNum),
    });

    if (!bridgeResult.success || !bridgeResult.data) {
      throw new Error(bridgeResult.message || `第 ${pageNum} 页拉取失败`);
    }

    const apiResult = bridgeResult.data;
    if (!apiResult || typeof apiResult !== 'object' || Array.isArray(apiResult)) {
      throw new Error('巡检接口未返回 JSON 对象，请确认本地服务可访问内网巡检系统');
    }

    const codeText = String(apiResult.code ?? '').trim();
    if (codeText && codeText !== '200' && codeText !== '0') {
      throw new Error(apiResult.message || apiResult.msg || `巡检接口返回异常：${codeText}`);
    }

    if (apiResult.success === false) {
      throw new Error(apiResult.message || apiResult.msg || '巡检接口返回失败');
    }

    const records = normalizeRows(apiResult);
    const total = normalizeTotal(apiResult, records.length);
    const totalPages = normalizeTotalPages(apiResult, total);
    logger.info(`巡检第 ${pageNum} 页完成，records=${records.length} total=${total} totalPages=${totalPages}`);

    return {
      pageNum,
      records,
      total,
      totalPages,
      raw: apiResult,
    };
  };

  const fetchAllPages = async (): Promise<InspectFetchResult> => {
    const startedAt = Date.now();
    setProgress('正在请求巡检第 1 页');
    const firstPage = await requestPage(1);
    const rawPages = [firstPage.raw];
    const allRecords = [...firstPage.records];
    const totalFromApi = firstPage.total;
    const totalPages = firstPage.totalPages;

    if (totalPages > INSPECT_MAX_PAGES) {
      throw new Error(`接口总页数 ${totalPages} 超过安全上限 ${INSPECT_MAX_PAGES}，已停止拉取`);
    }

    if (totalPages > 1) {
      const remainingPages = Array.from({ length: totalPages - 1 }, (_, index) => index + 2);
      setProgress(`正在并发拉取剩余 ${remainingPages.length} 页`);

      const pageResults = await runConcurrentTasks<number, InspectPageResult>({
        items: remainingPages,
        concurrency: INSPECT_PAGE_CONCURRENCY,
        worker: (pageNum) => requestPage(pageNum),
        onProgress: ({ completed, total }) => {
          setProgress(`正在拉取巡检分页：${completed} / ${total}`);
        },
      });

      pageResults
        .sort((left, right) => left.pageNum - right.pageNum)
        .forEach((page) => {
          allRecords.push(...page.records);
          rawPages.push(page.raw);
        });
    } else if (firstPage.records.length === INSPECT_API_PAGE_SIZE && totalFromApi === firstPage.records.length) {
      let nextPage = 2;
      while (nextPage <= INSPECT_MAX_PAGES) {
        setProgress(`巡检接口未返回完整总数，正在探测第 ${nextPage} 页`);
        const page = await requestPage(nextPage);
        rawPages.push(page.raw);
        if (page.records.length === 0) {
          break;
        }

        allRecords.push(...page.records);
        if (page.records.length < INSPECT_API_PAGE_SIZE) {
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
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    };
  };

  const handleFetchData = async () => {
    setLoading(true);
    setError('');
    setProgress('准备拉取巡检数据');

    try {
      const nextResult = await fetchAllPages();
      setResult(nextResult);
      const message = `拉取完成：共 ${nextResult.records.length} 条，接口总数 ${nextResult.totalFromApi} 条，耗时 ${formatDuration(nextResult.durationMs)}`;
      const historyItem: HistoryItem = {
        id: String(Date.now()),
        time: nextResult.fetchedAt,
        status: 'success',
        recordCount: nextResult.records.length,
        pageCount: nextResult.totalPages,
        durationMs: nextResult.durationMs,
        message,
      };
      setProgress(message);
      setHistory((items) => [historyItem, ...items].slice(0, 20));
      toast.success(message);
    } catch (fetchError: any) {
      const message = fetchError?.response?.data?.message || fetchError?.message || '巡检数据拉取失败';
      const historyItem: HistoryItem = {
        id: String(Date.now()),
        time: new Date().toISOString(),
        status: 'failed',
        recordCount: 0,
        pageCount: 0,
        durationMs: 0,
        message,
      };
      setError(message);
      setProgress('');
      setHistory((items) => [historyItem, ...items].slice(0, 20));
      toast.error(message);
      logger.error(`巡检数据拉取失败 - ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncData = async () => {
    setSyncing(true);
    setError('');
    setProgress('准备拉取本月巡检并同步飞书');

    try {
      const syncResult = await runInspectSync();
      const records = syncResult.records || [];
      const nextResult: InspectFetchResult = {
        records,
        rawPages: [],
        totalFromApi: syncResult.totalFromApi || syncResult.fetchedCount || records.length,
        totalPages: syncResult.totalPages || 1,
        fetchedAt: syncResult.fetchedAt || new Date().toISOString(),
        durationMs: syncResult.durationMs || 0,
        rangeStart: syncResult.rangeStart,
        rangeEnd: syncResult.rangeEnd,
        sync: {
          insertedCount: syncResult.insertedCount || 0,
          deletedCount: syncResult.deletedCount || 0,
          failedCount: syncResult.failedCount || 0,
          notified: Boolean(syncResult.notified),
          bitableUrl: syncResult.bitableUrl,
          message: syncResult.message,
        },
      };
      setResult(nextResult);
      const message = syncResult.message || `同步完成：拉取 ${syncResult.fetchedCount || records.length} 条，写入 ${syncResult.insertedCount || 0} 条`;
      const historyItem: HistoryItem = {
        id: String(Date.now()),
        time: nextResult.fetchedAt,
        status: syncResult.success ? 'success' : 'failed',
        recordCount: records.length,
        pageCount: nextResult.totalPages,
        durationMs: nextResult.durationMs,
        message,
      };
      if (!syncResult.success) {
        setError(message);
        toast.error(message);
      } else {
        toast.success(message);
      }
      setProgress(message);
      setHistory((items) => [historyItem, ...items].slice(0, 20));
    } catch (syncError: any) {
      const message = syncError?.response?.data?.message || syncError?.message || '巡检拉取同步失败';
      const historyItem: HistoryItem = {
        id: String(Date.now()),
        time: new Date().toISOString(),
        status: 'failed',
        recordCount: 0,
        pageCount: 0,
        durationMs: 0,
        message,
      };
      setError(message);
      setProgress('');
      setHistory((items) => [historyItem, ...items].slice(0, 20));
      toast.error(message);
      logger.error(`巡检拉取同步失败 - ${message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleCopyData = async () => {
    if (!result) {
      toast.error('没有可复制的数据');
      return;
    }

    await navigator.clipboard.writeText(JSON.stringify(result.records, null, 2));
    toast.success('已复制巡检记录 JSON');
  };

  const handleReset = () => {
    setResult(null);
    setError('');
    setProgress('');
    setShowRawData(false);
  };

  const summaryCards = useMemo(() => {
    const records = result?.records || [];
    const pendingCount = records.filter((record) => getJobStatusTone(record) === 'amber').length;
    const completedCount = records.filter((record) => record.submitTime || getJobStatusTone(record) === 'green').length;
    const abnormalCount = records.reduce((sum, record) => sum + getStatValue(record, 'yc'), 0);
    const pointCount = records.reduce((sum, record) => sum + getStatValue(record, 'total'), 0);
    const buildings = Array.from(new Set(records.map((record) => getText(record.buildingName, '')).filter(Boolean)));
    const buildingHint = buildings.length > 0 ? buildings.slice(0, 3).join(' / ') : '等待楼栋数据';
    const monthRange = getCurrentMonthRange();

    return [
      {
        label: '本月任务',
        value: result?.totalFromApi || records.length,
        hint: result ? `本月 ${records.length} 条` : `${monthRange.start.slice(5, 10)} - ${monthRange.end.slice(5, 10)}`,
      },
      { label: '待巡检', value: pendingCount, hint: 'jobExecuteStatus' },
      { label: '已提交', value: completedCount, hint: 'submitTime' },
      { label: '点位总数', value: pointCount, hint: 'statMap.total' },
      { label: '异常点', value: abnormalCount, hint: 'statMap.yc' },
      {
        label: '飞书写入',
        value: result?.sync?.insertedCount || 0,
        hint: result?.sync ? `删除旧记录 ${result.sync.deletedCount}` : buildingHint,
      },
    ];
  }, [result]);

  const columns: ColumnsType<InspectTableRecord> = [
    {
      title: '序号',
      dataIndex: '_index',
      width: 72,
      fixed: 'left',
    },
    {
      title: '工单名称',
      dataIndex: 'planName',
      width: 220,
      ellipsis: true,
      render: (value: string) => getText(value),
    },
    {
      title: '数据中心',
      dataIndex: 'datacenterName',
      width: 230,
      ellipsis: true,
      render: (value: string) => getText(value),
    },
    {
      title: '楼栋',
      dataIndex: 'buildingName',
      width: 150,
      ellipsis: true,
      render: (value: string) => getText(value),
    },
    {
      title: '位置信息',
      dataIndex: 'locations',
      width: 360,
      ellipsis: true,
      render: (value: string | null) => getText(value),
    },
    {
      title: '巡检人',
      dataIndex: 'userName',
      width: 120,
      ellipsis: true,
      render: (value: string | null) => getText(value),
    },
    {
      title: '巡检类型',
      dataIndex: 'executeCycle',
      width: 120,
      render: (value: string) => getExecuteCycleText(value),
    },
    {
      title: '计划区间',
      dataIndex: 'planStartDatetime',
      width: 310,
      render: (_value: string, record) => formatInspectPlanRange(record),
    },
    {
      title: '提交时间',
      dataIndex: 'submitTime',
      width: 170,
      render: (value: string | null) => getText(value),
    },
    {
      title: '接单时间',
      dataIndex: 'orderReceiveTime',
      width: 170,
      render: (_value: string | null, record) => getText(record.orderReceiveTime || record.execStartTime),
    },
    {
      title: '巡检结果',
      dataIndex: 'params',
      width: 180,
      render: (_value: InspectRecord['params'], record) => (
        <span className="text-sm tabular-nums text-slate-700">
          {formatInspectResult(record)}
        </span>
      ),
    },
    {
      title: '工单状态',
      dataIndex: 'jobExecuteStatusName',
      width: 130,
      render: (_value: string, record) => (
        <StatusBadge value={getJobStatusText(record)} tone={getJobStatusTone(record)} />
      ),
    },
    {
      title: '逾期原因',
      dataIndex: 'overdueReason',
      width: 160,
      ellipsis: true,
      render: (value: string | null) => getText(value),
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

  const dataSource: InspectTableRecord[] = (result?.records || []).map((item, index) => ({
    ...item,
    _index: index + 1,
    _rowKey: `${getRecordKey(item, index)}-${index}`,
  }));

  const busy = loading || syncing;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div className="space-y-2">
        <h1 className="text-lg font-medium leading-normal text-slate-900">智航巡检数据拉取</h1>
        <p className="text-sm leading-6 text-slate-500">
          固定读取巡检任务列表接口，只拉取本月计划数据，并按截图字段覆盖同步到飞书多维表。
        </p>
      </div>

      <Card className="rounded-lg">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1.5">
              <CardTitle className="text-base font-medium leading-normal tracking-normal">接口拉取</CardTitle>
              <CardDescription className="text-sm">
                数据中心固定为江苏南通保税区数据中心，只拉取本月计划开始时间范围内的数据。
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
              <Button variant="outline" className="gap-2" onClick={handleFetchData} disabled={busy}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {loading ? '拉取中' : '仅拉取'}
              </Button>
              <Button className="gap-2" onClick={handleSyncData} disabled={busy}>
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                {syncing ? '同步中' : '拉取并同步'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
            <div className="text-xs text-slate-500">目标接口</div>
            <div className="mt-1 break-all font-mono text-xs leading-5 text-slate-700">{buildInspectUrl(1)}</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                <div className="text-xs text-slate-500">datacenterCode</div>
                <div className="mt-1 font-mono text-xs text-slate-700">{INSPECT_DATACENTER_CODE}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                <div className="text-xs text-slate-500">pageSize</div>
                <div className="mt-1 font-mono text-xs text-slate-700">{INSPECT_API_PAGE_SIZE}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                <div className="text-xs text-slate-500">并发页数</div>
                <div className="mt-1 font-mono text-xs text-slate-700">{INSPECT_PAGE_CONCURRENCY}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2 sm:col-span-3">
                <div className="text-xs text-slate-500">本月范围</div>
                <div className="mt-1 font-mono text-xs text-slate-700">
                  {result?.rangeStart || getCurrentMonthRange().start} - {result?.rangeEnd || getCurrentMonthRange().end}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2 sm:col-span-3">
                <div className="text-xs text-slate-500">目标多维表</div>
                <div className="mt-1 break-all font-mono text-xs text-slate-700">
                  {result?.sync?.bitableUrl || 'https://vnet.feishu.cn/base/IrIibPkUOa6udGsMhu2cbOqhnWg?table=tblTXHrDH4Mv0971&view=vewgfEzEZl'}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {summaryCards.map((card) => (
              <div key={card.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs text-slate-500">{card.label}</div>
                <div className="mt-1 text-lg font-medium tabular-nums text-slate-900">
                  {Number(card.value).toLocaleString('zh-CN')}
                </div>
                <div className="mt-1 truncate text-xs text-slate-500">{card.hint}</div>
              </div>
            ))}
          </div>

          {progress && (
            <div className="flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-700">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              <span>{progress}</span>
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
              <CardTitle className="text-base font-medium leading-normal tracking-normal">巡检任务列表</CardTitle>
              <CardDescription className="text-sm">
                本次拉取 {result.records.length} 条，接口总数 {result.totalFromApi} 条，耗时 {formatDuration(result.durationMs)}
                {result.sync ? `，飞书写入 ${result.sync.insertedCount} 条` : ''}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="gap-2 text-xs" onClick={result.sync ? handleSyncData : handleFetchData} disabled={busy}>
              <RotateCcw className="h-3.5 w-3.5" />
              {result.sync ? '重新同步' : '重新拉取'}
            </Button>
          </CardHeader>
          <CardContent>
            {showRawData ? (
              <div className="max-h-[520px] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
                <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-slate-700">
                  {JSON.stringify(result.rawPages.length > 0 ? result.rawPages : result.records, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="rounded-md border border-slate-200">
                <Table
                  columns={columns}
                  dataSource={dataSource}
                  rowKey={(record, index) => record._rowKey || `${getRecordKey(record, index || 0)}-${index || 0}`}
                  scroll={{ x: 2520, y: 520 }}
                  pagination={{ pageSize: INSPECT_TABLE_PAGE_SIZE, showSizeChanger: false }}
                  locale={{ emptyText: '暂无巡检任务' }}
                  size="middle"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="rounded-lg">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium leading-normal tracking-normal">拉取历史</CardTitle>
          <CardDescription className="text-sm">当前页面保留最近 20 次操作结果。</CardDescription>
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
