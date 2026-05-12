import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  CreateExtractionDTO,
  DeleteFeishuRecordsResponse,
  DrillExercisePlanRecord,
  EventRecordDTO,
  EventSyncRunResp,
  ExtractionRecordDTO,
  FeishuConnectivityResponseDTO,
  GetExtractionsQuery,
  GetExtractionsResponse,
  RefreshRiskBuildingOptionsResponseDTO,
  ServiceHealthResponseDTO,
  SyncDrillRecordsResp,
  SyncEventRecordsResp,
  SyncToFeishuDTO,
  SyncToFeishuResponse,
  TestConnectionDTO,
  TestConnectionResponse,
  WeatherDTO,
} from '@shared/api.interface';

const EVENT_SYNC_TIMEOUT_MS = 60 * 60 * 1000;

function getApiErrorMessage(error: any, fallback: string) {
  const responseMessage = error?.response?.data?.message;
  const rawMessage = error?.message;
  if (error?.code === 'ECONNABORTED') {
    return `${fallback}：请求超时，本地同步可能仍在执行，请稍后查看进度或重新启动后重试`;
  }
  if (rawMessage === 'Network Error') {
    return `${fallback}：本地 API 连接中断或长任务代理超时，请覆盖最新补丁并重启启动脚本后重试`;
  }
  return responseMessage || rawMessage || fallback;
}

export interface DrillBrowserFetchDTO {
  url: string;
  method?: 'GET' | 'POST';
  payload?: unknown;
}

export type EventBrowserFetchDTO = DrillBrowserFetchDTO;

export interface RiskBrowserFetchDTO {
  path: string;
  payload?: unknown;
}

export interface DrillBrowserFetchResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  meta?: {
    browserUrl?: string;
    requestUrl?: string;
    requestPath?: string;
    status?: number;
  };
}

export type RiskBrowserFetchResponse<T = unknown> = DrillBrowserFetchResponse<T>;
export type EventBrowserFetchResponse<T = unknown> = DrillBrowserFetchResponse<T>;

export async function testConnection(dto: TestConnectionDTO): Promise<TestConnectionResponse> {
  try {
    const response = await axiosForBackend({
      url: '/api/extractions/test-connection',
      method: 'POST',
      data: dto,
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '测试连接失败';
    logger.error(`测试连接失败 - ${errorMessage}`);
    throw error;
  }
}

export async function createExtraction(dto: CreateExtractionDTO): Promise<ExtractionRecordDTO> {
  try {
    const response = await axiosForBackend({
      url: '/api/extractions',
      method: 'POST',
      data: dto,
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '创建提取任务失败';
    logger.error(`创建提取任务失败 - ${errorMessage}`);
    throw error;
  }
}

export async function getExtractions(query: GetExtractionsQuery = {}): Promise<GetExtractionsResponse> {
  try {
    const { page = 1, limit = 20 } = query;
    const response = await axiosForBackend({
      url: '/api/extractions',
      method: 'GET',
      params: { page, limit },
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '获取提取记录列表失败';
    logger.error(`获取提取记录列表失败 - ${errorMessage}`);
    throw error;
  }
}

export async function getExtractionById(id: string): Promise<ExtractionRecordDTO> {
  try {
    const response = await axiosForBackend({
      url: `/api/extractions/${id}`,
      method: 'GET',
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '获取提取记录详情失败';
    logger.error(`获取提取记录详情失败 - ${errorMessage}`);
    throw error;
  }
}

export async function syncToFeishu(dto: SyncToFeishuDTO): Promise<SyncToFeishuResponse> {
  try {
    const response = await axiosForBackend({
      url: '/api/feishu/sync',
      method: 'POST',
      data: dto,
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '同步飞书失败';
    logger.error(`同步飞书失败 - ${errorMessage}`);
    throw error;
  }
}

export async function deleteFeishuRecords(): Promise<DeleteFeishuRecordsResponse> {
  try {
    const response = await axiosForBackend({
      url: '/api/feishu/records',
      method: 'DELETE',
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '删除飞书数据失败';
    logger.error(`删除飞书数据失败 - ${errorMessage}`);
    throw error;
  }
}

export async function testFeishuConnectivity(sendTestMessage = true): Promise<FeishuConnectivityResponseDTO> {
  try {
    const response = await axiosForBackend({
      url: '/api/feishu/connectivity',
      method: 'POST',
      data: { sendTestMessage },
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '飞书连通性测试失败';
    logger.error(`飞书连通性测试失败 - ${errorMessage}`);
    throw error;
  }
}

export async function refreshRiskBuildingOptions(
  validateDetails = true,
  yearMonth?: string,
): Promise<RefreshRiskBuildingOptionsResponseDTO> {
  try {
    const response = await axiosForBackend({
      url: '/api/risk/building-options/refresh',
      method: 'POST',
      data: { validateDetails, yearMonth },
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '更新楼栋编号失败';
    logger.error(`更新楼栋编号失败 - ${errorMessage}`);
    throw error;
  }
}

export async function browserFetchRisk<T = unknown>(
  dto: RiskBrowserFetchDTO,
  timeout = 90000,
): Promise<RiskBrowserFetchResponse<T>> {
  try {
    const response = await axiosForBackend({
      url: '/api/risk/browser-fetch',
      method: 'POST',
      data: dto,
      timeout,
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '风险数据拉取失败';
    logger.error(`风险数据拉取失败 - ${errorMessage}`);
    throw error;
  }
}

export async function browserFetchDrill<T = unknown>(
  dto: DrillBrowserFetchDTO,
): Promise<DrillBrowserFetchResponse<T>> {
  try {
    const response = await axiosForBackend({
      url: '/api/drill/browser-fetch',
      method: 'POST',
      data: dto,
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '演练数据拉取失败';
    logger.error(`演练数据拉取失败 - ${errorMessage}`);
    throw error;
  }
}

export async function browserFetchEvent<T = unknown>(
  dto: EventBrowserFetchDTO,
): Promise<EventBrowserFetchResponse<T>> {
  try {
    const response = await axiosForBackend({
      url: '/api/event/browser-fetch',
      method: 'POST',
      data: dto,
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '事件数据拉取失败';
    logger.error(`事件数据拉取失败 - ${errorMessage}`);
    throw error;
  }
}

export async function syncDrillRecordsToFeishu(
  records: DrillExercisePlanRecord[],
): Promise<SyncDrillRecordsResp> {
  try {
    const response = await axiosForBackend({
      url: '/api/drill/feishu/sync',
      method: 'POST',
      data: { records },
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '同步演练数据到飞书失败';
    logger.error(`同步演练数据到飞书失败 - ${errorMessage}`);
    throw error;
  }
}

export interface DrillSyncRunResp {
  success: number;
  failed?: number;
  total: number;
  fetchedCount?: number;
  monthlyCount?: number;
  insertedCount: number;
  notified: boolean;
  message?: string;
  evaluationEventCount?: number;
  evaluationMatchedCount?: number;
  evaluationDetailFetchedCount?: number;
  evaluationDetailFailedCount?: number;
  evaluationScoreMatchedCount?: number;
  notExecutedCount?: number;
  eventLinkedCount?: number;
  fetchedAt?: string;
  durationMs?: number;
}

export async function runDrillSync(): Promise<DrillSyncRunResp> {
  try {
    const response = await axiosForBackend({
      url: '/api/drill/sync/run',
      method: 'POST',
      timeout: 900000,
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '演练拉取同步失败';
    logger.error(`演练拉取同步失败 - ${errorMessage}`);
    throw error;
  }
}

export async function syncEventRecordsToFeishu(
  records: EventRecordDTO[],
): Promise<SyncEventRecordsResp> {
  try {
    const response = await axiosForBackend({
      url: '/api/event/feishu/sync',
      method: 'POST',
      data: { records },
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '同步事件数据到飞书失败';
    logger.error(`同步事件数据到飞书失败 - ${errorMessage}`);
    throw error;
  }
}

export async function syncEventFull(): Promise<EventSyncRunResp> {
  try {
    const response = await axiosForBackend({
      url: '/api/event/sync/full',
      method: 'POST',
      timeout: EVENT_SYNC_TIMEOUT_MS,
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = getApiErrorMessage(error, '事件全量同步失败');
    logger.error(`事件全量同步失败 - ${errorMessage}`);
    throw new Error(errorMessage);
  }
}

export async function syncEventIncremental(): Promise<EventSyncRunResp> {
  try {
    const response = await axiosForBackend({
      url: '/api/event/sync/incremental',
      method: 'POST',
      timeout: EVENT_SYNC_TIMEOUT_MS,
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = getApiErrorMessage(error, '事件增量同步失败');
    logger.error(`事件增量同步失败 - ${errorMessage}`);
    throw new Error(errorMessage);
  }
}

export async function getEventSyncProgress(): Promise<EventSyncRunResp['progress']> {
  try {
    const response = await axiosForBackend({
      url: '/api/event/sync/progress',
      method: 'GET',
      timeout: 12000,
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '获取事件同步进度失败';
    logger.error(`获取事件同步进度失败 - ${errorMessage}`);
    throw error;
  }
}

export async function getWeather(): Promise<WeatherDTO> {
  try {
    const response = await axiosForBackend({
      url: '/api/weather',
      method: 'GET',
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '获取天气数据失败';
    logger.error(`获取天气数据失败 - ${errorMessage}`);
    throw error;
  }
}

export async function getServiceHealth(): Promise<ServiceHealthResponseDTO> {
  try {
    const response = await axiosForBackend({
      url: '/api/health',
      method: 'GET',
      timeout: 12000,
    });
    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '获取服务状态失败';
    logger.error(`获取服务状态失败 - ${errorMessage}`);
    throw error;
  }
}
