import { useState, useMemo } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Copy, Globe, CheckCircle2, XCircle, RefreshCw, BarChart3, CloudUpload, Trash2, AlertTriangle, KeyRound } from 'lucide-react';
import { Table } from '@lark-apaas/client-toolkit/antd-table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import type { ColumnsType } from 'antd/es/table';
import type { FeishuConnectivityResponseDTO, RefreshRiskBuildingOptionsResponseDTO, RiskBuildingOptionDTO } from '@shared/api.interface';
import { browserFetchRisk, deleteFeishuRecords, refreshRiskBuildingOptions, syncToFeishu, testFeishuConnectivity } from '@/api';

const FIXED_URL = 'https://risk.example.internal/api/ab-bpm/biz/bizCustGrid/view/list_fxgl_xcydfxpcmxsjlb';
const RISK_API_PATH = '/api/ab-bpm/biz/bizCustGrid/view/list_fxgl_xcydfxpcmxsjlb';
const RISK_PAGE_SIZE = 50;
const RISK_MAX_PAGES = 100;
const RISK_PAGE_CONCURRENCY = 2;
const RISK_BUILDING_CONCURRENCY = 1;
const RISK_REQUEST_TIMEOUT_MS = 90000;
const DEFAULT_PCJLID_OPTIONS: RiskBuildingOptionDTO[] = [
  { value: '2039149320796995584', label: 'A楼' },
  { value: '2039149403600945152', label: 'B楼' },
  { value: '2039149486492975104', label: 'C楼' },
  { value: '2039149571654123520', label: 'D楼' },
  { value: '2039150408220639232', label: 'E楼' },
];

const isFilledValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  return text !== '' && text !== 'null' && text !== 'undefined';
};

const getStableRowKey = (record: any, index?: number): string => {
  return String(
    record.id_
      || record.id
      || record.fxxbh_
      || `${record.buildingName || 'unknown'}-${record.jcxms_ || ''}-${record.pcsj_ || ''}-${index ?? 0}`,
  );
};

const getRiskRecordKey = (record: any, index: number): string => {
  return String(
    record.id_
      || record.id
      || record.fxxbh_
      || `${record.pcjlid_ || ''}-${record.xcpcczbzid_ || ''}-${record.jcxms_ || ''}-${index}`,
  );
};

const uniqueRiskRecords = (records: any[]): any[] => {
  const seen = new Set<string>();
  return records.filter((record, index) => {
    const key = getRiskRecordKey(record, index);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const runConcurrentTasks = async <T, R>({
  items,
  concurrency,
  worker,
}: {
  items: T[];
  concurrency: number;
  worker: (item: T, index: number) => Promise<R>;
}): Promise<R[]> => {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
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
};

const formatConnectivityTime = (value?: string): string => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const getConnectivityStatusClass = (ok: boolean): string => (
  ok
    ? 'border-green-200 bg-green-50 text-green-700'
    : 'border-red-200 bg-red-50 text-red-700'
);

export default function DataExtractionPage() {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testingFeishu, setTestingFeishu] = useState(false);
  const [refreshingBuildingOptions, setRefreshingBuildingOptions] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchProgress, setFetchProgress] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ timestamp: string; status: string; recordCount?: number; errorMessage?: string }>>([]);
  const [showRawData, setShowRawData] = useState(false);
  const [feishuConnectivity, setFeishuConnectivity] = useState<FeishuConnectivityResponseDTO | null>(null);
  const [buildingOptions, setBuildingOptions] = useState<RiskBuildingOptionDTO[]>(DEFAULT_PCJLID_OPTIONS);
  const [buildingOptionsResult, setBuildingOptionsResult] = useState<RefreshRiskBuildingOptionsResponseDTO | null>(null);

  const riskLevelMap: Record<string, string> = {
    '1': '低',
    '2': '中',
    '3': '高',
    'low': '低',
    'l': '低',
    'lo': '低',
    'medium': '中',
    'mid': '中',
    'm': '中',
    'high': '高',
    'h': '高',
    'in': '中',
    'im': '中',
    'ic': '一般',
    '一般': '一般',
    '低': '低',
    '中': '中',
    '高': '高',
  };

  const checkPeriodMap: Record<string, string> = {
    '1': '月度',
    '2': '季度',
    '3': '年度',
    'monthly': '月度',
    'month': '月度',
    'm': '月度',
    'mo': '月度',
    'quarterly': '季度',
    'quarter': '季度',
    'q': '季度',
    'qtr': '季度',
    'halfyear': '半年度',
    'half': '半年度',
    'yearly': '年度',
    'year': '年度',
    'annual': '年度',
    'y': '年度',
    'yr': '年度',
    'weekly': '周度',
    'week': '周度',
    'w': '周度',
    'daily': '日度',
    'day': '日度',
    'd': '日度',
    '月度': '月度',
    '季度': '季度',
    '半年度': '半年度',
    '年度': '年度',
    '周度': '周度',
    '日度': '日度',
  };

  const getRiskLevelText = (value: string): string => {
    return riskLevelMap[value] || value;
  };

  const getCheckPeriodText = (value: string): string => {
    return checkPeriodMap[value] || value;
  };

  // 风险状态映射：只有两种值（无/有），w对应无
  // 风险状态映射：w映射为无，空值不显示，其他值默认为有
  const riskStatusMap: Record<string, string> = {
    'w': '无',
    '无': '无',
    '有': '有',
  };

  // 风险状态转换函数：w映射为无，空值不显示，其他值默认为有
  const getRiskStatusText = (value: string): string => {
    // 空值（包括空字符串、undefined、null）返回空字符串
    if (!value) return '';
    // 按映射表转换，无映射的值默认为'有'
    return riskStatusMap[value] || '有';
  };

  const buildFeishuRecords = (records: any[]) => {
    return records.map((item: any) => ({
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
  };

  const syncFeishuRecords = async (
    records: any[],
    options: {
      trigger: 'manual' | 'auto';
    },
  ) => {
    if (!Array.isArray(records) || records.length === 0) {
      if (options.trigger === 'manual') {
        toast.error('没有可同步的数据');
      }
      return;
    }

    setSyncing(true);

    try {
      const allRecords = buildFeishuRecords(records);
      logger.info(`${options.trigger === 'auto' ? '获取成功后自动开始' : '开始'}同步飞书，总计 ${allRecords.length} 条记录`);

      const result = await syncToFeishu({ records: allRecords });
      const insertedCount = result.insertedCount ?? 0;

      if (result.success) {
        toast.success(result.message || `成功同步 ${insertedCount} 条记录到飞书多维表`);
        logger.info(`同步飞书完成 - ${result.message || `总计 ${insertedCount} 条记录成功`}`);
      } else if (insertedCount > 0) {
        toast.warning(result.message || `已同步 ${insertedCount} 条记录，但后续步骤存在失败`);
        logger.warn(`同步飞书部分完成 - ${result.message || `已同步 ${insertedCount} 条记录`}`);
      } else {
        toast.error(result.message || '同步失败');
        logger.error(`同步飞书失败 - ${result.message || '未知错误'}`);
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message || '同步失败';
      toast.error(errorMsg);
      logger.error(`同步飞书失败 - ${errorMsg}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncToFeishu = async () => {
    await syncFeishuRecords(data?.list || [], { trigger: 'manual' });
  };

  const handleTestFeishuConnectivity = async () => {
    setTestingFeishu(true);

    try {
      const result = await testFeishuConnectivity(true);
      setFeishuConnectivity(result);

      if (result.success) {
        toast.success('飞书连通性测试成功');
      } else {
        toast.warning('飞书连通性测试完成，存在需要关注的项');
      }

      logger.info(`飞书连通性测试完成 - success=${result.success} tenant=${result.tenantName || ''} app=${result.appName || ''}`);
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message || '飞书连通性测试失败';
      toast.error(errorMsg);
      logger.error(`飞书连通性测试失败 - ${errorMsg}`);
    } finally {
      setTestingFeishu(false);
    }
  };

  const updateBuildingOptions = async (validateDetails = true) => {
    const result = await refreshRiskBuildingOptions(validateDetails);
    setBuildingOptionsResult(result);

    if (!result.success) {
      throw new Error(result.message || '楼栋编号更新失败');
    }

    setBuildingOptions(result.options);
    return result.options;
  };

  const handleRefreshBuildingOptions = async () => {
    setRefreshingBuildingOptions(true);

    try {
      const options = await updateBuildingOptions(true);
      toast.success(`楼栋编号更新成功，共 ${options.length} 栋`);
      logger.info(`楼栋编号更新成功 - ${options.map((item) => `${item.label}:${item.value}`).join(', ')}`);
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message || '楼栋编号更新失败';
      toast.error(errorMsg);
      logger.error(`楼栋编号更新失败 - ${errorMsg}`);
    } finally {
      setRefreshingBuildingOptions(false);
    }
  };

  const handleDeleteFeishuData = async () => {
    setShowDeleteDialog(false);
    setDeleting(true);

    try {
      logger.info('开始删除飞书多维表所有数据');

      const result = await deleteFeishuRecords();

      if (result.success) {
        toast.success(`成功删除${result.deletedCount}条记录`);
        logger.info(`删除飞书数据完成 - 总计${result.deletedCount}条`);
      } else {
        toast.error(result.message || '删除失败');
        logger.error(`删除飞书数据失败 - ${result.message}`);
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message || '删除失败';
      toast.error(errorMsg);
      logger.error(`删除飞书数据失败 - ${errorMsg}`);
    } finally {
      setDeleting(false);
    }
  };

  const { auditStats, checkStats } = useMemo(() => {
    if (!Array.isArray(data?.list) || data.list.length === 0) {
      return { auditStats: [], checkStats: [] };
    }

    const initialStats = buildingOptions.map((building) => ({
      name: building.label,
      total: 0,
      auditCompleted: 0,
      checkCompleted: 0,
    }));
    const statMap = new Map(initialStats.map((item) => [item.name, item]));

    data.list.forEach((item: any) => {
      const stat = statMap.get(item.buildingName);
      if (!stat) return;

      stat.total += 1;
      if (isFilledValue(item.pcwcsj_$rel)) {
        stat.auditCompleted += 1;
      }
      if (isFilledValue(item.pcsj_)) {
        stat.checkCompleted += 1;
      }
    });

    const toChartStats = (completedKey: 'auditCompleted' | 'checkCompleted') => (
      initialStats.map((item) => {
        const completed = item[completedKey];
        const completionRate = item.total > 0 ? Number(((completed / item.total) * 100).toFixed(1)) : 0;

        return {
          name: item.name,
          total: item.total,
          completed,
          incomplete: item.total - completed,
          completionRate,
        };
      })
    );

    return {
      auditStats: toChartStats('auditCompleted'),
      checkStats: toChartStats('checkCompleted'),
    };
  }, [buildingOptions, data]);

  const riskRecords = useMemo(() => {
    if (!data?.list || data.list.length === 0) return [];

    return data.list.filter((item: any) => (
      getRiskStatusText(item.dqfxzt_) === '有'
      || getRiskStatusText(item.cqfxzt_) === '有'
    ));
  }, [data]);

  const fetchRiskPage = async (
    building: RiskBuildingOptionDTO,
    currentPage: number,
    pageSize: number,
  ) => {
    const payload = {
      orderBy: '',
      pageSize,
      currentPage,
      queryData: [
        {
          name: 'pcjlid_',
          con: 'like',
          val: building.value,
        },
      ],
    };

    logger.info(`${building.label} 请求第 ${currentPage} 页 - PCJLID: ${building.value}, PageSize: ${pageSize}`);
    setFetchProgress(`${building.label} 第 ${currentPage} 页请求中`);

    const browserFetchResult = await browserFetchRisk<any>(
      {
        path: RISK_API_PATH,
        payload,
      },
      RISK_REQUEST_TIMEOUT_MS,
    );
    if (!browserFetchResult?.success) {
      throw new Error(browserFetchResult?.message || '本机浏览器代理返回失败');
    }

    const result = browserFetchResult.data;
    const isOk = result?.isOk;

    if (!isOk) {
      throw new Error(result.message || result.msg || '内网接口返回失败');
    }

    const dataList = result.data?.list || [];
    const pageCount = Number(result.data?.count || 0);

    logger.info(`${building.label} 响应第 ${currentPage} 页 - isOk: ${isOk}, 总数: ${pageCount}, 当前页记录数: ${dataList.length}`);

    return {
      currentPage,
      dataList,
      pageCount,
    };
  };

  const fetchBuildingRiskRecords = async (building: RiskBuildingOptionDTO) => {
    const firstPage = await fetchRiskPage(building, 1, RISK_PAGE_SIZE);
    const allBuildingData: any[] = firstPage.dataList.map((item: any) => ({
      ...item,
      buildingName: building.label,
    }));
    const totalCountFromApi = firstPage.pageCount;
    const expectedPageCount = totalCountFromApi > 0 ? Math.ceil(totalCountFromApi / RISK_PAGE_SIZE) : 0;

    if (expectedPageCount > RISK_MAX_PAGES) {
      throw new Error(`${building.label} 翻页超过 ${RISK_MAX_PAGES} 页，已停止，避免无限请求`);
    }

    if (expectedPageCount > 0) {
      setFetchProgress(`${building.label} 第 1/${expectedPageCount} 页，已取 ${Math.min(allBuildingData.length, totalCountFromApi)} 条`);
    } else {
      setFetchProgress(`${building.label} 第 1 页，已取 ${allBuildingData.length} 条`);
    }

    if (expectedPageCount > 1) {
      const remainingPages = Array.from({ length: expectedPageCount - 1 }, (_, index) => index + 2);
      setFetchProgress(`${building.label} 剩余 ${remainingPages.length} 页并发获取中`);

      const pageResults = await runConcurrentTasks({
        items: remainingPages,
        concurrency: RISK_PAGE_CONCURRENCY,
        worker: async (pageNo) => fetchRiskPage(building, pageNo, RISK_PAGE_SIZE),
      });

      pageResults
        .sort((left, right) => left.currentPage - right.currentPage)
        .forEach((pageResult) => {
          allBuildingData.push(
            ...pageResult.dataList.map((item: any) => ({
              ...item,
              buildingName: building.label,
            })),
          );
        });
    } else if (firstPage.dataList.length === RISK_PAGE_SIZE) {
      let currentPage = 2;

      while (currentPage <= RISK_MAX_PAGES) {
        const pageResult = await fetchRiskPage(building, currentPage, RISK_PAGE_SIZE);
        if (pageResult.dataList.length === 0) {
          break;
        }

        allBuildingData.push(
          ...pageResult.dataList.map((item: any) => ({
            ...item,
            buildingName: building.label,
          })),
        );

        if (pageResult.dataList.length < RISK_PAGE_SIZE) {
          break;
        }

        currentPage += 1;
      }

      if (currentPage > RISK_MAX_PAGES) {
        throw new Error(`${building.label} 翻页超过 ${RISK_MAX_PAGES} 页，已停止，避免无限请求`);
      }
    }

    const uniqueData = uniqueRiskRecords(allBuildingData);
    setFetchProgress(`${building.label} 获取完成，累计 ${uniqueData.length} 条`);

    return {
      building: building.label,
      pcjlid: building.value,
      data: uniqueData,
      count: uniqueData.length,
      totalCountFromApi,
    };
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    setFetchProgress('准备请求内网数据');

    try {
      const startTime = Date.now();
      setFetchProgress('正在更新当月楼栋编号');
      let activeBuildingOptions: RiskBuildingOptionDTO[] = [];

      try {
        activeBuildingOptions = await updateBuildingOptions(false);
      } catch (refreshError: any) {
        const refreshMessage = refreshError?.response?.data?.message || refreshError?.message || '楼栋编号自动刷新失败';
        const fallbackOptions = (buildingOptions.length > 0 ? buildingOptions : DEFAULT_PCJLID_OPTIONS)
          .map((item) => ({ ...item }));

        if (fallbackOptions.length === 0) {
          throw refreshError;
        }

        activeBuildingOptions = fallbackOptions;
        setFetchProgress('楼栋编号刷新失败，正在使用已有编号继续获取数据');
        toast.warning(`${refreshMessage}，已改用当前楼栋编号继续获取数据`);
        logger.warn(`楼栋编号自动刷新失败，使用已有楼栋编号继续获取数据 - ${refreshMessage}`);
      }
      
      const buildingResults = await runConcurrentTasks({
        items: activeBuildingOptions,
        concurrency: RISK_BUILDING_CONCURRENCY,
        worker: async (building) => fetchBuildingRiskRecords(building),
      });

      const allData: any[] = [];
      let totalCount = 0;
      const successCounts: Record<string, number> = {};

      buildingResults.forEach((result) => {
        const dataList = result.data.map((item: any) => ({
          ...item,
          buildingName: result.building,
        }));
        allData.push(...dataList);
        totalCount += result.count;
        successCounts[result.building] = dataList.length;
        logger.info(`${result.building}获取成功 - PCJLID: ${result.pcjlid}, 记录数: ${dataList.length}`);
      });

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      setData({ list: allData, count: totalCount });
      
      const historyItem = {
        timestamp: new Date().toISOString(),
        status: 'success',
        recordCount: allData.length,
      };
      setHistory(prev => [historyItem, ...prev].slice(0, 20));
      
      const successSummary = Object.entries(successCounts)
        .map(([building, count]) => `${building}: ${count}条`)
        .join(', ');
      
      toast.success(`成功获取 ${allData.length} 条数据（${successSummary}），耗时 ${duration}秒`);
      logger.info(`获取数据完成 - 总记录数: ${allData.length}, 耗时: ${duration}s, 详情: ${successSummary}`);

      if (allData.length > 0) {
        setFetchProgress('数据获取完成，正在同步飞书');
        await syncFeishuRecords(allData, { trigger: 'auto' });
      }
       
    } catch (err: any) {
      setError(err.message || '获取数据失败');
      
      const historyItem = {
        timestamp: new Date().toISOString(),
        status: 'failed',
        errorMessage: err.message,
      };
      setHistory(prev => [historyItem, ...prev].slice(0, 20));
      
      toast.error(`获取数据失败: ${err.message}`);
      logger.error('获取数据失败', err);
    } finally {
      setLoading(false);
      setFetchProgress(null);
    }
  };

  const handleCopyContent = async () => {
    if (!data) return;

    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      toast.success('数据已复制到剪贴板');
    } catch (error) {
      toast.error('复制失败，请检查浏览器剪贴板权限');
      logger.error('复制数据失败', error);
    }
  };

  const formatDateTime = (dateTime: string) => {
    const date = new Date(dateTime);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const historyColumns: ColumnsType<any> = [
    {
      title: '时间',
      dataIndex: 'timestamp',
      width: 180,
      render: (text: string) => formatDateTime(text),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: string) => {
        if (status === 'success') {
          return (
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="text-badge-emerald-foreground">成功</span>
            </div>
          );
        } else {
          return (
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <XCircle className="h-3.5 w-3.5" />
              <span className="text-badge-rose-foreground">失败</span>
            </div>
          );
        }
      },
    },
    {
      title: '记录数',
      dataIndex: 'recordCount',
      width: 100,
      render: (count: number) => count ?? '-',
    },
    {
      title: '错误信息',
      dataIndex: 'errorMessage',
      ellipsis: true,
      render: (msg: string) => msg || '-',
    },
  ];

  const fixedSourceHost = (() => {
    try {
      return new URL(FIXED_URL).hostname;
    } catch {
      return FIXED_URL;
    }
  })();

  const fetchedRecordCount = Array.isArray(data?.list) ? data.list.length : 0;
  const totalRecordCount = Number(data?.count || fetchedRecordCount || 0);
  const feishuStatusText = feishuConnectivity
    ? (feishuConnectivity.bitable.ok && feishuConnectivity.chat.ok && feishuConnectivity.messageStatus.ok
      ? '正常'
      : '待检查')
    : '未测试';
  const overviewCards = [
    {
      label: '楼栋编号',
      value: buildingOptionsResult?.matchedCount ?? buildingOptions.length,
      hint: buildingOptionsResult?.yearMonth ? `${buildingOptionsResult.yearMonth} 已校验` : '沿用当前配置',
    },
    {
      label: '本次记录',
      value: fetchedRecordCount,
      hint: data ? `总计 ${totalRecordCount} 条` : '等待获取',
    },
    {
      label: '异常风险',
      value: riskRecords.length,
      hint: riskRecords.length > 0 ? '已生成明细' : '暂无异常',
    },
    {
      label: '飞书状态',
      value: feishuStatusText,
      hint: feishuConnectivity ? formatConnectivityTime(feishuConnectivity.checkedAt) : '尚未检测',
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-lg font-medium">智航风险排查任务进度一览</h1>
        <p className="text-sm text-muted-foreground">
          通过本地浏览器访问已登录的内网页签，自动提取风险排查数据并同步飞书。
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-1.5">
              <CardTitle className="text-base font-medium">任务获取与同步</CardTitle>
              <div className="text-sm text-muted-foreground">
                固定来源已内置，支持获取数据、刷新楼栋编号和检测飞书连通性。
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {overviewCards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3"
                >
                  <div className="text-xs text-slate-500">{card.label}</div>
                  <div className="mt-1 text-lg font-medium tabular-nums text-slate-900">
                    {card.value}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{card.hint}</div>
                </div>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <div className="text-sm font-medium text-slate-900">固定数据源</div>
                <div className="text-xs leading-5 text-slate-500">
                  当前使用南通风险排查内网接口，来源主机为 {fixedSourceHost}。
                </div>
              </div>
              <div className="text-xs text-slate-500">
                获取完成后将自动覆盖同步飞书多维表并推送群消息。
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Button
              onClick={fetchData}
              disabled={loading || refreshingBuildingOptions}
              className="h-10 gap-2"
            >
              {loading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Globe className="h-4 w-4" />
              )}
              {loading ? (fetchProgress || '正在获取数据...') : '获取数据'}
            </Button>
            <Button
              variant="outline"
              onClick={handleRefreshBuildingOptions}
              disabled={loading || refreshingBuildingOptions}
              className="h-10 gap-2"
            >
              {refreshingBuildingOptions ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              {refreshingBuildingOptions ? '正在更新楼栋编号...' : '更新楼栋编号'}
            </Button>
            <Button
              variant="outline"
              onClick={handleTestFeishuConnectivity}
              disabled={testingFeishu}
              className="h-10 gap-2"
            >
              {testingFeishu ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {testingFeishu ? '正在检测飞书连通性...' : '检测飞书连通性'}
            </Button>
          </div>
          {buildingOptionsResult && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex flex-col gap-1 text-sm text-slate-700 md:flex-row md:items-center md:justify-between">
                <div className="font-medium text-slate-900">
                  楼栋编号：{buildingOptionsResult.success ? '更新成功' : '更新未完成'}
                </div>
                <div className="text-xs text-slate-500">
                  {buildingOptionsResult.yearMonth || '--'}，扫描 {buildingOptionsResult.scannedCount} 条，匹配 {buildingOptionsResult.matchedCount} 栋，{formatConnectivityTime(buildingOptionsResult.updatedAt)}
                </div>
                {buildingOptionsResult.missingLabels.length > 0 && (
                  <div className="text-xs text-red-600">
                    未找到：{buildingOptionsResult.missingLabels.join('、')}
                  </div>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-5">
                {(buildingOptionsResult.options.length > 0 ? buildingOptionsResult.options : buildingOptions).map((building) => (
                  <div key={building.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-xs font-medium text-slate-600">{building.label}</div>
                    <div className="mt-1 break-all text-sm leading-6 text-slate-900">{building.value}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {building.detailCount !== undefined ? `明细 ${building.detailCount} 条` : building.recordDate || '待验证'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {feishuConnectivity && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex flex-col gap-1 text-sm text-slate-700 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-medium text-slate-900">飞书连接已检测</div>
                  <div className="mt-1 text-xs text-slate-500">
                    当前应用 {feishuConnectivity.appName || '--'}，租户 {feishuConnectivity.tenantName || '--'}。
                  </div>
                </div>
                <div className="text-xs text-slate-500">
                  上次检测 {formatConnectivityTime(feishuConnectivity.checkedAt)}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className={`rounded-md border px-3 py-3 ${getConnectivityStatusClass(feishuConnectivity.bitable.ok)}`}>
                  <div className="text-xs font-medium">多维表</div>
                  <div className="mt-1 text-sm leading-6">{feishuConnectivity.bitable.message}</div>
                </div>
                <div className={`rounded-md border px-3 py-3 ${getConnectivityStatusClass(feishuConnectivity.chat.ok)}`}>
                  <div className="text-xs font-medium">群会话</div>
                  <div className="mt-1 text-sm leading-6">{feishuConnectivity.chat.message}</div>
                </div>
                <div className={`rounded-md border px-3 py-3 ${getConnectivityStatusClass(feishuConnectivity.messageStatus.ok)}`}>
                  <div className="text-xs font-medium">群消息</div>
                  <div className="mt-1 text-sm leading-6">{feishuConnectivity.messageStatus.message}</div>
                </div>
              </div>
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3">
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <XCircle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            </div>
          )}
          {data && !error && (
            <div className="rounded-lg border border-green-100 bg-green-50 px-4 py-3">
              <div className="flex items-center gap-2 text-green-700 text-sm">
                <CheckCircle2 className="h-4 w-4" />
                <span>数据获取成功，本次获取 {fetchedRecordCount} 条记录，总计 {totalRecordCount} 条。</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {data && !error && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base font-medium">
              南通机房月度排查情况一览
            </CardTitle>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowRawData(!showRawData)}
                className="h-8 gap-2 text-xs"
              >
                {showRawData ? '显示表格' : '显示原始数据'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyContent}
                className="h-8 gap-2 text-xs"
              >
                <Copy className="h-3.5 w-3.5" />
                复制数据
              </Button>
              <Button
                variant="ghost"
                size="sm"
                  onClick={handleSyncToFeishu}
                disabled={syncing}
                className="h-8 gap-2 text-xs"
              >
                {syncing ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="h-3.5 w-3.5" />
                )}
                {syncing ? '同步中...' : '同步飞书'}
              </Button>
              <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleting || syncing}
                    className="h-8 gap-2 text-xs text-destructive hover:text-destructive"
                  >
                    {deleting ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    {deleting ? '删除中...' : '清空数据'}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                      确认清空飞书多维表数据
                    </DialogTitle>
                    <DialogDescription>
                      此操作将删除飞书多维表中的所有数据，删除后无法恢复。请确认是否继续？
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setShowDeleteDialog(false)}
                      disabled={deleting}
                    >
                      取消
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteFeishuData}
                      disabled={deleting}
                    >
                      {deleting ? '删除中...' : '确认清空'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {(auditStats.length > 0 || checkStats.length > 0) && (
              <div className="space-y-8">
                {/* 审核率统计 */}
                {auditStats.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <BarChart3 className="h-4 w-4 text-gray-500" />
                      <h3 className="text-sm font-medium">楼栋审核率统计（根据审核时间）</h3>
                    </div>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={auditStats} margin={{ top: 30, right: 10, left: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="name" stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} />
                        <YAxis stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length > 0) {
                              const data = payload[0].payload;
                              return (
                                <div style={{
                                  backgroundColor: 'var(--background)',
                                  border: '1px solid var(--border)',
                                  borderRadius: '6px',
                                  padding: '12px',
                                  fontSize: '12px',
                                }}>
                                  <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>{data.name}</div>
                                  <div style={{ color: '#666' }}>完成率：{data.completionRate.toFixed(1)}%</div>
                                  <div style={{ color: '#666' }}>已完成：{data.completed}条</div>
                                  <div style={{ color: '#666' }}>总数量：{data.total}条</div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Bar
                          dataKey="completionRate"
                          name="完成率"
                          barSize={40}
                          radius={[4, 4, 0, 0]}
                        >
                          {auditStats.map((entry, index) => {
                            const rate = entry.completionRate;
                            let fillColor = '#1890ff';
                            if (rate >= 100) {
                              fillColor = '#52c41a';
                            } else if (rate < 20) {
                              fillColor = '#ff4d4f';
                            }
                            return (
                              <Cell key={`cell-${index}`} fill={fillColor} />
                            );
                          })}
                          <LabelList
                            dataKey="completionRate"
                            position="top"
                            formatter={(value: number, entry: any) => {
                              const data = entry?.payload || entry;
                              const rate = value?.toFixed(1) || '0.0';
                              const completed = data?.completed || 0;
                              const total = data?.total || 0;
                              return `${rate}% (${completed}/${total})`;
                            }}
                            style={{ fontSize: '11px', fill: '#666', fontWeight: 'bold' }}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* 排查率统计 */}
                {checkStats.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <BarChart3 className="h-4 w-4 text-gray-500" />
                      <h3 className="text-sm font-medium">楼栋排查率统计（根据排查时间）</h3>
                    </div>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={checkStats} margin={{ top: 30, right: 10, left: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="name" stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} />
                        <YAxis stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length > 0) {
                              const data = payload[0].payload;
                              return (
                                <div style={{
                                  backgroundColor: 'var(--background)',
                                  border: '1px solid var(--border)',
                                  borderRadius: '6px',
                                  padding: '12px',
                                  fontSize: '12px',
                                }}>
                                  <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>{data.name}</div>
                                  <div style={{ color: '#666' }}>完成率：{data.completionRate.toFixed(1)}%</div>
                                  <div style={{ color: '#666' }}>已完成：{data.completed}条</div>
                                  <div style={{ color: '#666' }}>总数量：{data.total}条</div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Bar
                          dataKey="completionRate"
                          name="完成率"
                          barSize={40}
                          radius={[4, 4, 0, 0]}
                        >
                          {checkStats.map((entry, index) => {
                            const rate = entry.completionRate;
                            let fillColor = '#1890ff';
                            if (rate >= 100) {
                              fillColor = '#52c41a';
                            } else if (rate < 20) {
                              fillColor = '#ff4d4f';
                            }
                            return (
                              <Cell key={`cell-${index}`} fill={fillColor} />
                            );
                          })}
                          <LabelList
                            dataKey="completionRate"
                            position="top"
                            formatter={(value: number, entry: any) => {
                              const data = entry?.payload || entry;
                              const rate = value?.toFixed(1) || '0.0';
                              const completed = data?.completed || 0;
                              const total = data?.total || 0;
                              return `${rate}% (${completed}/${total})`;
                            }}
                            style={{ fontSize: '11px', fill: '#666', fontWeight: 'bold' }}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
            {showRawData ? (
              <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-auto border border-gray-100">
                <pre className="font-mono text-xs whitespace-pre-wrap break-all text-gray-700">
                  {JSON.stringify(data, null, 2)}
                </pre>
              </div>
                ) : (
                  <div className="max-h-[500px] overflow-auto">
                    {Array.isArray(data?.list) && data.list.length > 0 ? (
                      <Table
                        columns={[
                          { title: '机楼', dataIndex: 'buildingName', width: 100 },
                          { title: '风险编号', dataIndex: 'fxxbh_', width: 150, ellipsis: true },
                          { title: '风险等级', dataIndex: 'fxdj_', width: 100, render: (value: string) => getRiskLevelText(value) },
                          { title: '排查周期', dataIndex: 'pczq_', width: 120, render: (value: string) => getCheckPeriodText(value) },
                          { title: '排查状态', dataIndex: 'pczt_', width: 120 },
                          { title: '检查地点', dataIndex: 'jcd_', width: 100 },
                          { title: '排查时间', dataIndex: 'pcsj_', width: 150 },
                          { 
                            title: '审核时间', 
                            dataIndex: 'pcwcsj_$rel', 
                            width: 150,
                            render: (value: string, record: any) => {
                              // 如果审核时间为空或无效，使用排查时间作为备选
                              if (!value || value === '' || value === 'null' || value === 'undefined') {
                                if (record.pcsj_ && record.pcsj_ !== '' && record.pcsj_ !== 'null') {
                                  return record.pcsj_;
                                }
                                return '-';
                              }
                              return value;
                            }
                          },
                          { title: '此前风险状态', dataIndex: 'cqfxzt_', width: 120, render: (value: string) => getRiskStatusText(value) },
                          { title: '当前风险状态', dataIndex: 'dqfxzt_', width: 120, render: (value: string) => getRiskStatusText(value) },
                          { title: '风险现场情况', dataIndex: 'fxxcqk_', width: 150, ellipsis: true },
                        ]}
                        dataSource={data.list}
                        rowKey={getStableRowKey}
                        scroll={{ x: 1690, y: 500 }}
                        pagination={{ pageSize: 50, showSizeChanger: false }}
                      />
                    ) : (
                      <div className="text-sm text-gray-500 text-center py-8">
                        无数据
                      </div>
                    )}
                  </div>
                )}
          </CardContent>
        </Card>
      )}

      {data && !error && riskRecords.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base font-medium">
              风险状态异常记录
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              共 {riskRecords.length} 条
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[500px] overflow-auto">
              <Table
                columns={[
                  { title: '机楼', dataIndex: 'buildingName', width: 100 },
                  { title: '风险编号', dataIndex: 'fxxbh_', width: 150, ellipsis: true },
                  { title: '风险现场情况', dataIndex: 'fxxcqk_', width: 150, ellipsis: true },
                  { title: '此前风险状态', dataIndex: 'cqfxzt_', width: 120, render: (value: string) => {
                    const text = getRiskStatusText(value);
                    return text === '有' ? (
                      <span className="text-red-600 font-medium">{text}</span>
                    ) : (
                      <span>{text}</span>
                    );
                  } },
                  { title: '当前风险状态', dataIndex: 'dqfxzt_', width: 120, render: (value: string) => {
                    const text = getRiskStatusText(value);
                    return text === '有' ? (
                      <span className="text-red-600 font-medium">{text}</span>
                    ) : (
                      <span>{text}</span>
                    );
                  } },
                  { title: '风险等级', dataIndex: 'fxdj_', width: 100, render: (value: string) => getRiskLevelText(value) },
                  { title: '排查周期', dataIndex: 'pczq_', width: 120, render: (value: string) => getCheckPeriodText(value) },
                  { title: '排查状态', dataIndex: 'pczt_', width: 120 },
                  { title: '检查地点', dataIndex: 'jcd_', width: 100, ellipsis: { showTitle: true } },
                  { title: '排查时间', dataIndex: 'pcsj_', width: 150 },
                  { title: '审核时间', dataIndex: 'pcwcsj_$rel', width: 150 },
                ]}
                dataSource={riskRecords}
                rowKey={getStableRowKey}
                scroll={{ x: 1690, y: 500 }}
                pagination={{ pageSize: 20, showSizeChanger: false }}
                size="middle"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            获取历史
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table
            columns={historyColumns}
            dataSource={history}
            rowKey={(record, index) => `${record.timestamp}-${index}`}
            pagination={false}
            scroll={{ x: 800, y: 300 }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
