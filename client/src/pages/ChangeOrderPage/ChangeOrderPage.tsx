import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table } from '@lark-apaas/client-toolkit/antd-table';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import dayjs from 'dayjs';
import { 
  RefreshCw, 
  Loader2,
  Download,
  ExternalLink,
  Send,
  Trash2
} from 'lucide-react';

interface Task {
  id: string;
  targetUrl: string;
  status: 'pending' | 'testing' | 'connected' | 'extracting' | 'completed' | 'failed';
  headers?: string;
  payload?: string;
  response?: string;
  createdAt: string;
  updatedAt: string;
}

interface Result {
  id: string;
  taskId: string;
  data: Record<string, any>;
  extractedAt: string;
}

interface WorkOrder {
  id: number;
  orderCode: string;
  title: string;
  changeType: string;
  changeLevel: string;
  changeCategory: string;
  currentNode: string;
  status: string;
  applicant?: string;
  applyTime?: string;
  leadTime?: string;
  planStartTime?: string;
  planEndTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
  delayedStartTime?: string;
  delayedEndTime?: string;
  delayedReason?: string;
}

type BasicDataListItem = {
  orderId: number;
  data: any;
};

const defaultPayload = JSON.stringify({
  pageNo: 1,
  pageSize: 15,
  userId: "",
  operType: "4",
  customParam: "",
  dc: "",
  applyEndTime: "",
  applyStartTime: "",
  buildingCode: "",
  category: "",
  implementEndTime: "",
  implementEndTimeEnd: "",
  implementEndTimeStart: "",
  implementStartTime: "",
  level: "",
  planEndTime: "",
  planEndTimeEnd: "",
  planEndTimeStart: "",
  planStartTime: "",
  actualStartTime: "",
  actualStartTimeStart: "",
  actualStartTimeEnd: "",
  actualEndTime: "",
  actualEndTimeStart: "",
  actualEndTimeEnd: "",
  delayedStartTime: "",
  delayedStartTimeStart: "",
  delayedStartTimeEnd: "",
  delayedEndTime: "",
  delayedEndTimeStart: "",
  delayedEndTimeEnd: "",
  delayedReason: "",
  progress: "",
  status: "",
  type: ""
}, null, 2);

const CHANGE_BROWSER_FETCH_URL = '/api/change/browser-fetch';
const CHANGE_LIST_URL = 'https://change.example.internal/api/change/change/order/listPage';
const CHANGE_LIST_METHOD: 'GET' | 'POST' = 'POST';
const CHANGE_LIST_PAGE_SIZE = 15;
const CHANGE_LIST_PAGE_CONCURRENCY = 4;
const CHANGE_BASIC_DATA_CONCURRENCY = 8;
const CHANGE_BASIC_DATA_URL = 'https://change.example.internal/api/change/changeDetails/getBasicInformation';
const CHANGE_BASIC_DATA_METHOD: 'GET' | 'POST' = 'POST';
const CHANGE_BASIC_DATA_BASE_PAYLOAD = '{"orderId": "", "userId": ""}';

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
  const total = items.length;
  const runnerCount = Math.max(1, Math.min(concurrency, total));
  let nextIndex = 0;
  let completed = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= total) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
      completed += 1;
      onProgress?.({ completed, total });
    }
  };

  await Promise.all(Array.from({ length: runnerCount }, () => runWorker()));
  return results;
}

export default function ChangeOrderPage() {
  const targetUrl = CHANGE_LIST_URL;
  const requestMethod = CHANGE_LIST_METHOD;
  const payload = defaultPayload;
  const [workOrderList, setWorkOrderList] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const basicDataUrl = CHANGE_BASIC_DATA_URL;
  const basicDataMethod = CHANGE_BASIC_DATA_METHOD;
  const basicDataPayload = CHANGE_BASIC_DATA_BASE_PAYLOAD;
  const [idListDialogOpen, setIdListDialogOpen] = useState(false);
  const [idList, setIdList] = useState<number[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [basicDataList, setBasicDataList] = useState<BasicDataListItem[]>([]);
  const [syncingBatch, setSyncingBatch] = useState(false);

  const requestChangeIntranetData = async ({
    url,
    method,
    payload,
  }: {
    url: string;
    method: 'GET' | 'POST';
    payload?: unknown;
  }) => {
    const response = await fetch(CHANGE_BROWSER_FETCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        method,
        payload,
      }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
      throw new Error(result?.message || `请求失败: ${response.status} ${response.statusText}`);
    }

    return result.data;
  };

  const getErrorMessage = (error: unknown) => {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return '未知错误';
  };

  const parseBasicDataBasePayload = (): Record<string, any> => {
    let basePayload: Record<string, any>;

    try {
      basePayload = JSON.parse(basicDataPayload);
    } catch {
      throw new Error('基础信息 Payload 格式无效，必须是有效 JSON');
    }

    if (typeof basePayload !== 'object' || basePayload === null || Array.isArray(basePayload)) {
      throw new Error('基础信息 Payload 必须是有效 JSON 对象');
    }

    if (!('orderId' in basePayload)) {
      throw new Error('基础信息 Payload 中必须包含 orderId 字段');
    }

    return basePayload;
  };

  const extractOrderIds = (items: Array<Record<string, any>>) => {
    const idSet = new Set<number>();

    items.forEach((item) => {
      const rawId = item?.id ?? item?.orderId ?? item?.order_id;
      const numericId = typeof rawId === 'number' ? rawId : Number(rawId);
      if (Number.isFinite(numericId) && numericId > 0) {
        idSet.add(numericId);
      }
    });

    return Array.from(idSet);
  };

  const getSyncableBasicDataList = (items: BasicDataListItem[]) =>
    items.filter((item) => Boolean(item?.orderId)
      && Boolean(item?.data)
      && typeof item.data === 'object'
      && !Array.isArray(item.data)
      && !item.data.error);

  const fetchBatchBasicData = async (
    orderIds: number[],
    options?: { showToast?: boolean },
  ): Promise<{
    items: BasicDataListItem[];
    successItems: BasicDataListItem[];
    failedCount: number;
  }> => {
    if (orderIds.length === 0) {
      return {
        items: [],
        successItems: [],
        failedCount: 0,
      };
    }

    if (!basicDataUrl) {
      throw new Error('请输入基础信息 URL');
    }

    if (basicDataMethod !== 'POST') {
      throw new Error('批量获取基础信息仅支持 POST 方法');
    }

    const basePayload = parseBasicDataBasePayload();
    const startedAt = Date.now();

    setBatchLoading(true);
    setBatchProgress({ current: 0, total: orderIds.length });
    setBasicDataList([]);

    try {
      const results = await runConcurrentTasks<number, BasicDataListItem>({
        items: orderIds,
        concurrency: CHANGE_BASIC_DATA_CONCURRENCY,
        worker: async (orderId) => {
          try {
            const payloadWithId = { ...basePayload, orderId: String(orderId) };
            const responseData = await requestChangeIntranetData({
              url: basicDataUrl,
              method: 'POST',
              payload: payloadWithId,
            });

            if (responseData.code !== '200' || !responseData.success) {
              logger.warn(`ID ${orderId} 接口返回失败: ${responseData.message}`);
              return {
                orderId,
                data: { error: responseData.message || '接口返回失败' },
              };
            }

            return {
              orderId,
              data: responseData.data,
            };
          } catch (error) {
            logger.error(`ID ${orderId} 请求异常:`, error);
            return {
              orderId,
              data: { error: getErrorMessage(error) || '请求异常' },
            };
          }
        },
        onProgress: ({ completed, total }) => {
          setBatchProgress({ current: completed, total });
        },
      });

      setBasicDataList(results);
      const successItems = getSyncableBasicDataList(results);
      const failedCount = results.length - successItems.length;
      const durationMs = Date.now() - startedAt;

      logger.debug('批量拉取变更基础信息完成', {
        total: results.length,
        success: successItems.length,
        failed: failedCount,
        durationMs,
        concurrency: CHANGE_BASIC_DATA_CONCURRENCY,
      });

      if (options?.showToast !== false) {
        if (failedCount > 0) {
          toast.warning(`基础信息拉取完成，成功 ${successItems.length} 条，失败 ${failedCount} 条`);
        } else {
          toast.success(`基础信息拉取完成，共 ${successItems.length} 条`);
        }
      }

      return {
        items: results,
        successItems,
        failedCount,
      };
    } finally {
      setBatchLoading(false);
    }
  };

  const syncBasicDataItemsToFeishu = async (
    items: BasicDataListItem[],
    options?: { showToast?: boolean },
  ) => {
    const syncableItems = getSyncableBasicDataList(items);
    if (syncableItems.length === 0) {
      const message = '没有可同步的变更基础数据';
      if (options?.showToast !== false) {
        toast.error(message);
      }

      return {
        result: null,
        successCount: 0,
        failedCount: items.length,
      };
    }

    setSyncingBatch(true);
    try {
      logger.debug('开始按 risk 逻辑同步变更基础数据到飞书多维表', {
        count: syncableItems.length,
      });

      const response = await axiosForBackend.post('/api/change/feishu/sync-basic-data', {
        basicDataList: syncableItems,
      });
      const result = response.data || {};
      const successCount = Number(result.insertedCount ?? result.success ?? 0);
      const failedCount = Number(result.failed || 0);

      logger.debug('变更基础数据同步飞书响应:', result);

      if (options?.showToast !== false) {
        if (successCount > 0 && failedCount === 0 && result.notified) {
          toast.success(result.message || `已同步 ${successCount} 条最新数据到飞书多维表，群通知已发送`);
        } else if (successCount > 0) {
          toast.warning(result.message || `已同步 ${successCount} 条数据到飞书多维表，请检查群通知结果`);
        } else {
          toast.error(result.message || '同步到飞书多维表失败');
        }
      }

      return {
        result,
        successCount,
        failedCount,
      };
    } catch (error: any) {
      logger.error('同步到飞书多维失败:', {
        message: error?.message,
        code: error?.code,
        response: error?.response,
        request: error?.request,
        stack: error?.stack,
      });

      if (options?.showToast !== false) {
        toast.error(error?.response?.data?.message || getErrorMessage(error));
      }

      throw error;
    } finally {
      setSyncingBatch(false);
    }
  };

  const fetchTasks = async () => {
    setLoadingTasks(true);
    try {
      setTasks([]);
      logger.debug('变更工单历史任务在 risk 合并版中暂不从独立任务库读取');
    } finally {
      setLoadingTasks(false);
    }
  };

  const fetchResults = async () => {
    setResults([]);
  };

  useEffect(() => {
    fetchTasks();
    fetchResults();
  }, []);

  const handleFetchData = async () => {
    if (!targetUrl) {
      toast.error('请输入目标URL');
      return;
    }

    if (requestMethod === 'POST' && payload) {
      try {
        JSON.parse(payload);
      } catch {
        toast.error('Payload 格式无效，必须是有效的 JSON');
        return;
      }
    }

    setLoading(true);
    try {
      const parsedListPayload = requestMethod === 'POST' && payload
        ? JSON.parse(payload)
        : null;
      const listFetchStartedAt = Date.now();

      const fetchPageData = async (pageNo: number): Promise<{ records: any[]; totalPages: number }> => {
        let requestUrl = targetUrl;
        let requestPayload: unknown;
        if (requestMethod === 'POST' && parsedListPayload) {
          requestPayload = { ...parsedListPayload, pageNo, pageSize: CHANGE_LIST_PAGE_SIZE };
        } else {
          const url = new URL(targetUrl);
          url.searchParams.set('pageNo', pageNo.toString());
          url.searchParams.set('pageSize', String(CHANGE_LIST_PAGE_SIZE));
          requestUrl = url.toString();
        }

        logger.debug(`获取第 ${pageNo} 页数据`);
        const data = await requestChangeIntranetData({
          url: requestUrl,
          method: requestMethod,
          payload: requestPayload,
        });

        if (data.success && data.data && data.data.records) {
          const total = data.data.total || data.data.totalCount || data.data.totalRecords || 0;
          const totalPages = Math.ceil(total / CHANGE_LIST_PAGE_SIZE);
          logger.debug(`第 ${pageNo} 页数据获取成功, 总数: ${total}, 总页数: ${totalPages}`);
          return { records: data.data.records, totalPages };
        }
        return { records: [], totalPages: 1 };
      };

      const firstPageData = await fetchPageData(1);
      const allRecords: any[] = [...firstPageData.records];
      const totalPages = firstPageData.totalPages;

      if (totalPages > 1) {
        const remainingPages = Array.from({ length: totalPages - 1 }, (_, index) => index + 2);
        toast.info(`开始并发获取剩余 ${remainingPages.length} 页数据...`);

        const pageResults = await runConcurrentTasks<number, { pageNo: number; pageData: { records: any[]; totalPages: number } }>({
          items: remainingPages,
          concurrency: CHANGE_LIST_PAGE_CONCURRENCY,
          worker: async (pageNo) => ({
            pageNo,
            pageData: await fetchPageData(pageNo),
          }),
        });

        pageResults
          .sort((a, b) => a.pageNo - b.pageNo)
          .forEach(({ pageData }) => {
            allRecords.push(...pageData.records);
          });
      }

      logger.debug('变更工单列表获取完成', {
        totalRecords: allRecords.length,
        totalPages,
        durationMs: Date.now() - listFetchStartedAt,
        pageConcurrency: CHANGE_LIST_PAGE_CONCURRENCY,
      });

      const changeTypeMap: Record<string, string> = {
        '1': '紧急变更',
        '2': '计划变更',
        '3': '计划变更',
        '4': '其他',
      };
      
      const changeLevelMap: Record<string, string> = {
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
        // 其他可能的值
        '20': 'I3级',
        '30': 'I2级',
        '40': 'I1级',
      };
      
      const changeCategoryMap: Record<string, string> = {
        '1': '故障解决',
        '2': '升级改善',
        '3': '预防维护',
        '4': '容量扩容',
        '5': '安全加固',
        '6': '预防维护',
        '7': '升级改善',
        '8': '外部需求',
      };
      
      const statusMap: Record<string, string> = {
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
      
      logger.info(`statusMap内容:`, statusMap);
      
      const closedStatusToCurrentNodeMap: Record<string, string> = {
        '3': '区域经理关闭',
        '5': '区域经理关闭',
        '8': '流程结束',
        '13': '区域经理关闭',
        '14': '区域经理关闭',
      };
      
      // 保留progress映射作为备选（某些特殊场景可能使用）
      const progressToCurrentNodeMap: Record<string, string> = {
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
      
      const records = allRecords.map((item: any, index: number) => {
        // 调试：打印前5条记录的所有字段名称
        if (index < 5) {
          const allFields = Object.keys(item).join(', ');
          logger.info(`第 ${index + 1} 条记录的所有字段: ${allFields}`);
          
          // 调试：打印期望字段的值
          logger.info(`第 ${index + 1} 条记录的期望字段值:`, {
            actualStartTime: item.actualStartTime,
            actual_start_time: item.actual_start_time,
            actualEndTime: item.actualEndTime,
            actual_end_time: item.actual_end_time,
            delayedStartTime: item.delayedStartTime,
            delayed_start_time: item.delayed_start_time,
            delayedEndTime: item.delayedEndTime,
            delayed_end_time: item.delayed_end_time,
            delayedReason: item.delayedReason,
            delayed_reason: item.delayed_reason,
            planStartTime: item.planStartTime,
            plan_start_time: item.plan_start_time,
            planEndTime: item.planEndTime,
            plan_end_time: item.plan_end_time,
          });
        }
        
        const originalValues = {
          type: item.type,
          level: item.level,
          category: item.category,
          progress: item.progress,
          status: item.status,
          leadTime: item.leadTime,
          // 添加更多字段的原始值
          orderCode: item.orderCode,
          currentNode: item.currentNode,
          changeCategory: item.changeCategory,
          changeLevel: item.changeLevel,
          // 新增字段的原始值
          planStartTime: item.planStartTime,
          planEndTime: item.planEndTime,
          actualStartTime: item.actualStartTime,
          actualEndTime: item.actualEndTime,
          delayedStartTime: item.delayedStartTime,
          delayedEndTime: item.delayedEndTime,
          delayedReason: item.delayedReason,
          // 检查下划线命名
          plan_start_time: item.plan_start_time,
          plan_end_time: item.plan_end_time,
          actual_start_time: item.actual_start_time,
          actual_end_time: item.actual_end_time,
          delayed_start_time: item.delayed_start_time,
          delayed_end_time: item.delayed_end_time,
          delayed_reason: item.delayed_reason,
        };
        
        // 优先从leadTime字段提取变更等级
        let changeLevel = '';
        if (item.leadTime) {
          const leadTimeMatch = item.leadTime.match(/(I[1-4]级)/);
          if (leadTimeMatch) {
            changeLevel = leadTimeMatch[1];
          }
        }
        
        // 如果leadTime中没有找到，使用level映射
        if (!changeLevel) {
          changeLevel = changeLevelMap[item.level || item.changeLevel || item.change_level || ''] || item.level || '';
        }
        
        // 当前节点：优先基于progress字段映射
        let currentNode = '';
        const statusValue = String(item.status || '').trim();
        const progressValue = String(item.progress || '').trim();
        
        // 特殊调试：针对包含151的工单号
        const currentOrderCode = item.orderCode || item.order_code || '';
        if (currentOrderCode.includes('151')) {
          logger.info(`调试工单 ${currentOrderCode}:`, {
            status原始值: item.status,
            status类型: typeof item.status,
            status值: statusValue,
            progress原始值: item.progress,
            progress类型: typeof item.progress,
            progress值: progressValue,
            closedStatusToCurrentNodeMap映射: closedStatusToCurrentNodeMap[statusValue],
            progressToCurrentNodeMap映射: progressToCurrentNodeMap[progressValue],
            currentNode原始值: item.currentNode || item.current_node || ''
          });
        }
        
        // 优先使用progress映射（只要progress存在且不为空）
        if (progressValue && progressToCurrentNodeMap[progressValue]) {
          currentNode = progressToCurrentNodeMap[progressValue];
          if (currentOrderCode.includes('151')) {
            logger.info(`工单 ${currentOrderCode} 使用progress映射: ${currentNode}`);
          }
        } 
        // 备选：优先使用接口返回的明确节点，避免把“审批中”等状态误判成具体审批节点
        else if (item.currentNode || item.current_node) {
          currentNode = item.currentNode || item.current_node;
          if (currentOrderCode.includes('151')) {
            logger.info(`工单 ${currentOrderCode} 使用原始节点: ${currentNode}`);
          }
        }
        else if (!progressValue && statusValue && closedStatusToCurrentNodeMap[statusValue]) {
          currentNode = closedStatusToCurrentNodeMap[statusValue];
          if (currentOrderCode.includes('151')) {
            logger.info(`工单 ${currentOrderCode} 使用status映射: ${currentNode}`);
          }
        }
        // 最后使用原始值
        else {
          currentNode = item.currentNode || item.current_node || progressValue || statusValue || '';
          if (currentOrderCode.includes('151')) {
            logger.info(`工单 ${currentOrderCode} 使用原始值: ${currentNode}`);
          }
        }
        
        const record = {
          id: item.id || index,
          orderCode: item.orderCode || item.order_code || '',
          title: item.title || item.description || item.name || '',
          changeType: changeTypeMap[item.type || item.changeType || item.change_type || ''] || item.type || '',
          changeLevel: changeLevel,
          changeCategory: changeCategoryMap[item.category || item.changeCategory || item.change_category || ''] || item.category || '',
          currentNode: currentNode,
          status: statusMap[String(item.status || '')] || item.status || '',
          applicant: item.applicant,
          applyTime: item.applyTime || item.apply_time,
          planStartTime: item.planStartTime || item.plan_start_time,
          planEndTime: item.planEndTime || item.plan_end_time,
          actualStartTime: item.implementStartTime || item.implement_start_time,
          actualEndTime: item.implementEndTime || item.implement_end_time,
          delayedStartTime: '',
          delayedEndTime: '',
          delayedReason: '',
          leadTime: item.leadTime,
          _planEndTime: item.planEndTime || item.plan_end_time,
          _progress: item.progress,
        };
        
        // 延迟时间判断逻辑
        const planStart = item.planStartTime || item.plan_start_time;
        const planEnd = item.planEndTime || item.plan_end_time;
        const actualStart = item.implementStartTime || item.implement_start_time;
        const actualEnd = item.implementEndTime || item.implement_end_time;
        
        // 如果实际时间与计划时间不一致，说明有延迟
        if (planStart && actualStart && planStart !== actualStart) {
          record.delayedStartTime = actualStart;
        }
        if (planEnd && actualEnd && planEnd !== actualEnd) {
          record.delayedEndTime = actualEnd;
        }
        if ((record.delayedStartTime || record.delayedEndTime) && item.delayedReason) {
          record.delayedReason = item.delayedReason || item.delayed_reason || item.delayReason || item.delay_reason || '';
        }
        
        // 逾期判断：如果状态为已关闭，且满足逾期条件，则修改为逾期实施成功
        if (record.status === '已关闭' && record._planEndTime) {
          try {
            const planEndTime = dayjs(record._planEndTime);
            const now = dayjs();
            if (now.isAfter(planEndTime)) {
              // 逾期完成：修改为逾期实施成功
              record.status = '逾期实施成功';
            }
          } catch (error) {
            // 忽略时间解析错误
          }
        }
        
        // 保存原始状态值用于调试
        return { ...record, _originalStatus: item.status, _originalStatusType: typeof item.status };
      });
      
      // 增强调试日志：输出所有工单的状态映射详情
      const statusDetails = records.map((r, idx) => ({
        索引: idx + 1,
        工单编号: r.orderCode,
        status原始值: r._originalStatus,
        status类型: r._originalStatusType,
        映射结果: r.status,
        映射逻辑: `statusMap["${String(r._originalStatus)}"] = "${statusMap[String(r._originalStatus)]}"`
      }));
      logger.info(`状态映射详情 - 共 ${records.length} 条工单:`, statusDetails);
      
      // 特殊关注：筛选出status原始值为14的工单
      const status14Orders = records.filter(r => r._originalStatus === 14 || r._originalStatus === '14');
      if (status14Orders.length > 0) {
        logger.info(`发现 ${status14Orders.length} 条status原始值为14的工单:`, 
          status14Orders.map((r, idx) => ({
            索引: records.indexOf(r) + 1,
            工单编号: r.orderCode,
            状态显示: r.status,
            status原始值: r._originalStatus
          }))
        );
      } else {
        logger.warn(`未找到status原始值为14的工单`);
      }
      
      // 筛选出状态为"已关闭"的工单
      const closedOrders = records.filter(r => r.status === '已关闭');
      if (closedOrders.length > 0) {
        logger.warn(`发现 ${closedOrders.length} 条工单状态为"已关闭":`, 
          closedOrders.map((r, idx) => ({
            索引: records.indexOf(r) + 1,
            工单编号: r.orderCode,
            status: r.status,
            status原始值: r._originalStatus,
            status类型: r._originalStatusType
          }))
        );
      }
      
      // 移除调试字段
      records.forEach(r => {
        delete (r as any)._originalStatus;
        delete (r as any)._originalStatusType;
        delete (r as any)._planEndTime;
        delete (r as any)._progress;
      });
      
      logger.debug(`解析后的工单列表 (${records.length} 条):`, records);
      setWorkOrderList(records);

      const ids = extractOrderIds(allRecords);
      setIdList(ids);

      toast.success(`数据获取成功，共 ${records.length} 条工单`);
      logger.debug('获取数据成功:', { totalRecords: records.length, totalPages });

      if (ids.length === 0) {
        toast.warning('工单列表已获取，但未识别到可同步的工单 ID');
        return;
      }

      toast.info(`已获取 ${records.length} 条工单，开始自动拉取基础信息并同步飞书...`);

      try {
        const batchResult = await fetchBatchBasicData(ids, { showToast: false });
        if (batchResult.successItems.length === 0) {
          toast.error('工单列表已获取，但基础信息全部拉取失败，未同步飞书');
          return;
        }

        const { result, successCount, failedCount } = await syncBasicDataItemsToFeishu(
          batchResult.successItems,
          { showToast: false },
        );
        const syncMessage = result?.message || '';

        if (successCount > 0 && failedCount === 0 && result?.notified) {
          if (batchResult.failedCount > 0) {
            toast.warning(
              syncMessage || `工单列表已获取，基础信息成功 ${batchResult.successItems.length} 条、失败 ${batchResult.failedCount} 条；飞书多维表已更新，群通知已发送`,
            );
          } else {
            toast.success(syncMessage || `已自动同步 ${successCount} 条最新数据到飞书多维表，群通知已发送`);
          }
          return;
        }

        if (successCount > 0) {
          if (batchResult.failedCount > 0) {
            toast.warning(
              syncMessage || `工单列表已获取，基础信息成功 ${batchResult.successItems.length} 条、失败 ${batchResult.failedCount} 条；飞书同步 ${successCount} 条，请检查群通知结果`,
            );
          } else {
            toast.warning(syncMessage || `已自动同步 ${successCount} 条数据到飞书多维表，请检查群通知结果`);
          }
          return;
        }

        toast.error(syncMessage || '自动同步到飞书失败');
      } catch (autoSyncError) {
        logger.error('自动同步变更基础数据失败:', autoSyncError);
        toast.error(getErrorMessage(autoSyncError) || '自动同步到飞书失败');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      logger.error('获取数据失败:', error);
      toast.error(`获取数据失败: ${errorMessage}`);
      setWorkOrderList([]);
    } finally {
      setLoading(false);
    }
  };

  const handleClearData = () => {
    setWorkOrderList([]);
    setIdList([]);
    setBasicDataList([]);
    setBatchProgress({ current: 0, total: 0 });
  };

  const handleSyncBatchToFeishu = async () => {
    try {
      await syncBasicDataItemsToFeishu(basicDataList, { showToast: true });
    } catch {
      // toast 已在 syncBasicDataItemsToFeishu 中处理
    }
  };

  const getWorkOrderStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; color: string }> = {
      '审批中': { label: '审批中', color: 'bg-blue-100 text-blue-700' },
      '实施中': { label: '实施中', color: 'bg-emerald-100 text-emerald-700' },
      '实施成功': { label: '实施成功', color: 'bg-green-700 text-white' },
      '待审批': { label: '待审批', color: 'bg-yellow-100 text-yellow-700' },
      '已完成': { label: '已完成', color: 'bg-gray-100 text-gray-700' },
    };

    const config = statusConfig[status] || { label: status, color: 'bg-gray-100 text-gray-700' };
    return (
      <Badge className={config.color}>
        {config.label}
      </Badge>
    );
  };

  const mapBasicDataToWorkOrder = (item: { orderId: number; data: any }): WorkOrder => {
    const data = item.data || {};
    
    if (data.error) {
      return {
        id: item.orderId,
        orderCode: `ID: ${item.orderId}`,
        title: data.error,
        changeType: '',
        changeLevel: '',
        changeCategory: '',
        currentNode: '',
        status: '',
      } as WorkOrder;
    }
    
    const changeTypeMap: Record<string, string> = {
      '1': '紧急变更',
      '2': '计划变更',
      '3': '计划变更',
      '4': '其他',
    };
    
    const changeLevelMap: Record<string, string> = {
      '10': 'I3级',
      '20': 'I2级',
      '30': 'I1级',
      '40': 'E级',
    };
    
    const changeCategoryMap: Record<string, string> = {
      '1': '故障解决',
      '2': '预防问题',
      '3': '升级部署',
      '4': '主动性改善',
      '5': '业务需求',
      '6': '预防维护',
      '7': '升级改善',
      '8': '外部需求',
    };
    
    const statusMap: Record<string, string> = {
      '1': '审批中',
      '2': '实施中',
      '3': '计划内实施成功',
      '4': '计划内实施失败',
      '5': '计划外实施成功',
      '6': '计划外实施失败',
      '7': '挂起',
      '8': '终止',
      '13': '计划内实施成功',
    };
    
    const progressToCurrentNodeMap: Record<string, string> = {
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
    
    const closedStatusToCurrentNodeMap: Record<string, string> = {
      '3': '区域经理关闭',
      '5': '区域经理关闭',
      '8': '流程结束',
      '13': '区域经理关闭',
      '14': '区域经理关闭',
    };
    
    let changeLevel = '';
    if (data.leadTime) {
      const leadTimeMatch = data.leadTime.match(/(I[1-4]级)/);
      if (leadTimeMatch) {
        changeLevel = leadTimeMatch[1];
      }
    }
    
    if (!changeLevel) {
      changeLevel = changeLevelMap[data.level || data.changeLevel || data.change_level || ''] || data.level || '';
    }
    
    let currentNode = '';
    const statusValue = String(data.status || '').trim();
    const progressValue = String(data.progress || '').trim();
    
    // 优先使用progress映射（只要progress存在且不为空）
    if (progressValue && progressToCurrentNodeMap[progressValue]) {
      currentNode = progressToCurrentNodeMap[progressValue];
    } 
    else if (data.currentNode || data.current_node) {
      currentNode = data.currentNode || data.current_node;
    }
    else if (!progressValue && statusValue && closedStatusToCurrentNodeMap[statusValue]) {
      currentNode = closedStatusToCurrentNodeMap[statusValue];
    }
    // 最后使用原始值
    else {
      currentNode = data.currentNode || data.current_node || progressValue || statusValue || '';
    }
    
    const planStart = data.planStartTime || data.plan_start_time;
    const planEnd = data.planEndTime || data.plan_end_time;
    const actualStart = data.implementStartTime || data.implement_start_time || data.actualStartTime || data.actual_start_time;
    const actualEnd = data.implementEndTime || data.implement_end_time || data.actualEndTime || data.actual_end_time;
    const delayedStart = data.planDelayStartTime || data.plan_delay_start_time || data.delayedStartTime || data.delayed_start_time;
    const delayedEnd = data.planDelayEndTime || data.plan_delay_end_time || data.delayedEndTime || data.delayed_end_time;
    
    return {
      id: item.orderId,
      orderCode: data.orderCode || data.order_code || String(item.orderId),
      title: data.title || data.description || data.name || '',
      changeType: changeTypeMap[data.type || data.changeType || data.change_type || ''] || data.type || '',
      changeLevel: changeLevel,
      changeCategory: changeCategoryMap[data.category || data.changeCategory || data.change_category || ''] || data.category || '',
      currentNode: currentNode,
      status: statusMap[String(data.status || '')] || data.status || '',
      applicant: data.applicant,
      applyTime: data.applyTime || data.apply_time,
      planStartTime: planStart,
      planEndTime: planEnd,
      actualStartTime: actualStart,
      actualEndTime: actualEnd,
      delayedStartTime: delayedStart,
      delayedEndTime: delayedEnd,
      delayedReason: data.delayedReason || data.delayed_reason || '',
      leadTime: data.leadTime,
    };
  };

  const batchWorkOrderList = basicDataList.map((item, index) => ({
    ...mapBasicDataToWorkOrder(item),
    _globalIndex: index + 1,
  }));

  const syncedBasicDataCount = basicDataList.filter((item) => !item.data?.error).length;
  const failedBasicDataCount = basicDataList.length - syncedBasicDataCount;
  const overviewCards = [
    {
      label: '工单列表',
      value: workOrderList.length,
      hint: loading ? '正在拉取' : '已识别工单',
    },
    {
      label: '可同步ID',
      value: idList.length,
      hint: loading ? '准备中' : '已识别编号',
    },
    {
      label: '基础信息',
      value: syncedBasicDataCount,
      hint: batchLoading ? '正在补全' : '已准备同步',
    },
    {
      label: '异常记录',
      value: Math.max(failedBasicDataCount, 0),
      hint: failedBasicDataCount > 0 ? '建议复核' : '当前无异常',
    },
  ];

  const batchWorkOrderColumns = [
    {
      title: '序号',
      dataIndex: 'index',
      key: 'index',
      width: 80,
      render: (_: any, record: any) => record._globalIndex,
    },
    {
      title: '工单号',
      dataIndex: 'orderCode',
      key: 'orderCode',
      width: 240,
      ellipsis: true,
    },
    {
      title: '提交人',
      dataIndex: 'applicant',
      key: 'applicant',
      width: 100,
      ellipsis: true,
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      width: 250,
      ellipsis: true,
    },
    {
      title: '变更类型',
      dataIndex: 'changeType',
      key: 'changeType',
      width: 100,
    },
    {
      title: '变更等级',
      dataIndex: 'changeLevel',
      key: 'changeLevel',
      width: 80,
    },
    {
      title: '变更类别',
      dataIndex: 'changeCategory',
      key: 'changeCategory',
      width: 100,
    },
    {
      title: '当前节点',
      dataIndex: 'currentNode',
      key: 'currentNode',
      width: 120,
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => getWorkOrderStatusBadge(status),
    },
    {
      title: '计划开始时间',
      dataIndex: 'planStartTime',
      key: 'planStartTime',
      width: 130,
      ellipsis: true,
    },
    {
      title: '计划结束时间',
      dataIndex: 'planEndTime',
      key: 'planEndTime',
      width: 130,
      ellipsis: true,
    },
    {
      title: '实际开始时间',
      dataIndex: 'actualStartTime',
      key: 'actualStartTime',
      width: 130,
      ellipsis: true,
    },
    {
      title: '实际结束时间',
      dataIndex: 'actualEndTime',
      key: 'actualEndTime',
      width: 130,
      ellipsis: true,
    },
    {
      title: '计划延时开始时间',
      dataIndex: 'delayedStartTime',
      key: 'delayedStartTime',
      width: 130,
      ellipsis: true,
    },
    {
      title: '计划延时结束时间',
      dataIndex: 'delayedEndTime',
      key: 'delayedEndTime',
      width: 130,
      ellipsis: true,
    },
  ];

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { label: '待处理', color: 'bg-neutral-100 text-neutral-700' },
      testing: { label: '测试中', color: 'bg-blue-100 text-blue-700' },
      connected: { label: '已连接', color: 'bg-emerald-100 text-emerald-700' },
      extracting: { label: '提取中', color: 'bg-blue-100 text-blue-700' },
      completed: { label: '已完成', color: 'bg-emerald-100 text-emerald-700' },
      failed: { label: '失败', color: 'bg-red-100 text-red-700' },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    return (
      <Badge className={config.color}>
        {config.label}
      </Badge>
    );
  };

  const taskColumns = [
    {
      title: '目标地址',
      dataIndex: 'targetUrl',
      key: 'targetUrl',
      width: 400,
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => getStatusBadge(status),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (date: string) => new Date(date).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: any, record: Task) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => window.open(record.targetUrl, '_blank')}
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const resultColumns = [
    {
      title: '数据ID',
      dataIndex: 'id',
      key: 'id',
      width: 250,
    },
    {
      title: '数据内容',
      dataIndex: 'data',
      key: 'data',
      render: (data: Record<string, any>) => (
        <div className="max-w-md truncate">
          {typeof data === 'object' ? JSON.stringify(data) : String(data)}
        </div>
      ),
    },
    {
      title: '提取时间',
      dataIndex: 'extractedAt',
      key: 'extractedAt',
      width: 180,
      render: (date: string) => new Date(date).toLocaleString('zh-CN'),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-lg font-medium">智航变更数据提取</h1>
        <p className="text-sm text-muted-foreground">
          从已登录的内网页签提取变更工单，自动补全基础信息，并同步飞书多维表和群消息。
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-1.5">
              <CardTitle className="text-base">自动获取与同步</CardTitle>
              <CardDescription className="text-sm">
                固定接口、固定载荷和同步目标已内置，前端只保留核心操作。
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {workOrderList.length > 0 && (
                <Button
                  className="gap-2"
                  variant="outline"
                  onClick={() => setIdListDialogOpen(true)}
                >
                  查看ID
                </Button>
              )}
              {(workOrderList.length > 0 || basicDataList.length > 0) && (
                <Button
                  className="gap-2"
                  variant="ghost"
                  onClick={handleClearData}
                >
                  <Trash2 className="h-4 w-4" />
                  清空结果
                </Button>
              )}
              <Button
                className="gap-2"
                onClick={handleFetchData}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                获取数据
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
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

          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <div className="text-sm font-medium text-slate-900">工单列表</div>
                <div className="text-xs leading-5 text-slate-500">
                  直接读取已登录页面中的变更列表，并按分页自动汇总。
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium text-slate-900">基础信息</div>
                <div className="text-xs leading-5 text-slate-500">
                  自动补全每条工单的基础信息，保留成功与失败统计。
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium text-slate-900">飞书同步</div>
                <div className="text-xs leading-5 text-slate-500">
                  获取完成后自动覆盖写入多维表，并同步群通知结果。
                </div>
              </div>
            </div>
          </div>

          {batchLoading && (
            <div className="rounded-lg border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm text-sky-700">
              正在补全基础信息：{batchProgress.current} / {batchProgress.total}
            </div>
          )}

          {basicDataList.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium">批量获取结果</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    已补全 {syncedBasicDataCount} 条，异常 {Math.max(failedBasicDataCount, 0)} 条。
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSyncBatchToFeishu}
                    disabled={syncingBatch || basicDataList.length === 0}
                  >
                    {syncingBatch ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="mr-1 h-3 w-3" />
                    )}
                    重新同步飞书
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setBasicDataList([])}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    清除
                  </Button>
                </div>
              </div>
              <div className="rounded-md border">
                <Table
                  columns={batchWorkOrderColumns}
                  dataSource={batchWorkOrderList}
                  scroll={{ x: 2000, y: 400 }}
                  rowKey="id"
                  pagination={{ pageSize: 10 }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">历史提取记录</CardTitle>
              <CardDescription className="text-sm">
                查看所有数据提取任务和历史结果
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                fetchTasks();
                fetchResults();
              }}
              disabled={loadingTasks}
            >
              {loadingTasks ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="text-sm font-medium mb-2">任务列表</h3>
            <Table
              columns={taskColumns}
              dataSource={tasks}
              rowKey="id"
              pagination={{
                pageSize: 5,
                showSizeChanger: false,
              }}
              scroll={{ y: 200 }}
            />
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2">结果数据</h3>
            <Table
              columns={resultColumns}
              dataSource={results}
              rowKey="id"
              pagination={{
                pageSize: 5,
                showSizeChanger: false,
              }}
              scroll={{ y: 200 }}
            />
          </div>
        </CardContent>
      </Card>

      <Dialog open={idListDialogOpen} onOpenChange={setIdListDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>工单ID列表</DialogTitle>
            <DialogDescription>
              共 {idList.length} 个ID号
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto my-4">
            <div className="bg-muted rounded-md p-4">
              <div className="grid grid-cols-4 gap-2 text-sm">
                {idList.map((id) => (
                  <div key={id} className="bg-background rounded px-3 py-2 text-center">
                    {id}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setIdListDialogOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

