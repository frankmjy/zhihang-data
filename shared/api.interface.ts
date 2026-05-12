export interface TestConnectionDTO {
  url: string;
  headers?: Record<string, string>;
}

export interface TestConnectionResponse {
  isReachable: boolean;
  statusCode?: number;
  message?: string;
}

export interface CreateExtractionDTO {
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
  responseConfig?: ResponseConfigDTO;
}

export interface ResponseConfigDTO {
  extractFields?: string[];
  format?: 'json' | 'html' | 'text';
}

export type ExtractionStatus = 'pending' | 'success' | 'failed';

export interface ExtractionRecordDTO {
  id: string;
  url: string;
  status: ExtractionStatus;
  extractedContent?: string;
  errorMessage?: string;
  headers?: Record<string, string>;
  payload?: unknown;
  responseConfig?: ResponseConfigDTO;
  createdAt: string;
}

export interface GetExtractionsQuery {
  page?: number;
  limit?: number;
}

export interface GetExtractionsResponse {
  items: ExtractionRecordDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SyncToFeishuDTO {
  records: FeishuRecordDTO[];
}

export interface FeishuRecordDTO {
  fields: {
    楼栋?: string;
    风险编号?: string;
    检查项目?: string;
    风险等级?: string;
    排查周期?: string;
    排查状态?: string;
    检查地点?: string;
    排查时间?: string;
    审核时间?: string;
    此前风险状态?: string;
    当前风险状态?: string;
    风险现场情况?: string;
  };
}

export interface SyncToFeishuResponse {
  success: boolean;
  message?: string;
  insertedCount?: number;
  deletedCount?: number;
  notified?: boolean;
}

export interface DeleteFeishuRecordsResponse {
  success: boolean;
  deletedCount: number;
  message?: string;
}

export interface WorkOrder {
  id: string | number;
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

export interface SyncWorkOrdersDto {
  workOrders: WorkOrder[];
}

export interface SyncWorkOrdersResp {
  success: number;
  failed: number;
  total: number;
  insertedCount?: number;
  deletedCount?: number;
  notified?: boolean;
  message?: string;
}

export interface ClearTableResp {
  deletedCount: number;
}

export interface BasicDataItem {
  orderId: number;
  data: any;
}

export interface SyncBasicDataDto {
  basicDataList: BasicDataItem[];
  appendMode?: boolean;
}

export interface SyncBasicDataResp {
  success: number;
  failed: number;
  insertedCount?: number;
  deletedCount?: number;
  notified?: boolean;
  message?: string;
}

export interface DrillExercisePlanRecord {
  id?: string;
  operationPlanNumber?: string;
  exerciseScenarioName?: string;
  exerciseMajor?: string;
  exerciseCategory?: string;
  exerciseType?: string;
  implementationArea?: string[];
  implementationAreaStr?: string;
  exerciseCycle?: string;
  exerciseMonth?: string;
  exerciseYear?: number;
  approvalStatus?: string;
  createTime?: string;
  createBy?: string;
  plannedExerciseTime?: string;
  plannedExerciseEndTime?: string;
  actualExerciseTime?: string;
  triggerTime?: string;
  triggerBy?: string;
  executeStatus?: string;
  orderStatus?: string | null;
  overdue?: boolean;
  showEop?: boolean;
  eopFlowStr?: string;
  exerciseObjectStr?: string;
  dutyUserList?: Array<{ jobNumber?: string; name?: string }> | null;
  responsibleUserList?: Array<{ jobNumber?: string; name?: string }> | null;
  evaluationUserList?: Array<{ jobNumber?: string; name?: string }> | null;
  relatedEventList?: Array<{ eventNumber?: string; title?: string; orderStatus?: string }> | null;
  evaluationEventList?: Array<{
    id?: string;
    drillId?: string;
    eventNumber?: string;
    eventTitle?: string;
    highestLevelTitle?: string;
    eventCurrentLevelName?: string;
    eventHighestLevelName?: string;
    eventFirstLevelName?: string;
    orderStatus?: string | number | null;
    responseTimeCost?: string;
    ackTimeCost?: string;
    incidentRecoveryTime?: string;
    updateTime?: string;
    creatTime?: string;
    [key: string]: unknown;
  }> | null;
  drillEvaluationScore?: string;
  drillEvaluationEventNumber?: string;
  drillEvaluationEventTitle?: string;
  [key: string]: unknown;
}

export interface SyncDrillRecordsDto {
  records: DrillExercisePlanRecord[];
}

export interface SyncDrillRecordsResp {
  success: number;
  failed: number;
  total: number;
  insertedCount: number;
  deletedCount: number;
  notified: boolean;
  evaluationFetched?: boolean;
  evaluationMatchedCount?: number;
  message?: string;
}

export interface EventRecordDTO {
  id?: string;
  eventNumber?: string;
  eventTitle?: string;
  eventStatus?: string | number | null;
  eventCurrentLevelName?: string;
  eventHighestLevelName?: string;
  eventFirstLevelName?: string;
  orderStatus?: string | number | null;
  dcCode?: string;
  dcName?: string;
  eventType?: string;
  eventSource?: string | number | null;
  location?: string;
  eventDescription?: string;
  realEvent?: boolean | string | null;
  eventAlarmStatus?: string | number | null;
  [key: string]: unknown;
}

export interface SyncEventRecordsDto {
  records: EventRecordDTO[];
}

export interface SyncEventRecordsResp {
  success: number;
  failed: number;
  total: number;
  insertedCount: number;
  deletedCount: number;
  notified: boolean;
  message?: string;
}

export type EventSyncMode = 'full' | 'incremental';

export interface EventSyncProgressDTO {
  running: boolean;
  runId?: string;
  mode?: EventSyncMode | string;
  phase?: string;
  message?: string;
  startedAt?: string;
  updatedAt?: string;
  percent?: number;
  fetch?: {
    completedPages?: number;
    totalPages?: number;
    records?: number;
    totalFromApi?: number;
  };
  feishu?: {
    listedRecords?: number;
    deleteTotal?: number;
    deleteBatchesCompleted?: number;
    deleteBatchesTotal?: number;
    createTotal?: number;
    createBatchesCompleted?: number;
    createBatchesTotal?: number;
  };
  steps?: Array<{
    time?: string;
    message?: string;
  }>;
}

export interface EventSyncRunResp {
  success: boolean;
  mode: EventSyncMode;
  fetchedCount: number;
  total: number;
  syncedCount: number;
  diffCount: number;
  insertedCount: number;
  updatedCount: number;
  deletedCount: number;
  failedCount: number;
  notified: boolean;
  totalFromApi?: number;
  totalPages?: number;
  activeRecordCount?: number;
  completedRecordCount?: number;
  completedAddedCount?: number;
  durationMs?: number;
  fetchedAt?: string;
  previousStateAt?: string;
  statePath?: string;
  reasonSummary?: string;
  reasonCounts?: Record<string, number>;
  records?: EventRecordDTO[];
  previewLimit?: number;
  progress?: EventSyncProgressDTO;
  views?: {
    incomplete?: {
      name?: string;
      viewId?: string;
      url?: string;
    };
    falseReal?: {
      name?: string;
      viewId?: string;
      url?: string;
    };
  };
  viewSetup?: {
    success?: boolean;
    createdCount?: number;
    message?: string;
  };
  message?: string;
}

export interface FeishuConnectivityStatusDTO {
  ok: boolean;
  message: string;
}

export interface FeishuConnectivityResponseDTO {
  success: boolean;
  checkedAt: string;
  tenantName?: string;
  appName?: string;
  chatId?: string;
  chatName?: string;
  tableId?: string;
  tableRecordCount?: number;
  tenant: FeishuConnectivityStatusDTO;
  bitable: FeishuConnectivityStatusDTO;
  chat: FeishuConnectivityStatusDTO;
  messageStatus: FeishuConnectivityStatusDTO;
  messageId?: string;
}

export interface RiskBuildingOptionDTO {
  value: string;
  label: string;
  recordDate?: string;
  detailCount?: number;
  totalCountFromApi?: number;
}

export interface RefreshRiskBuildingOptionsResponseDTO {
  success: boolean;
  message?: string;
  yearMonth: string;
  updatedAt: string;
  sourcePath: string;
  scannedCount: number;
  matchedCount: number;
  options: RiskBuildingOptionDTO[];
  missingLabels: string[];
}

export interface ServiceScheduleStatusDTO {
  enabled: boolean;
  running: boolean;
  queued?: boolean;
  statusMessage?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  nextRunAt?: string;
}

export interface KeepAliveStatusDTO extends ServiceScheduleStatusDTO {
  intervalMs: number;
  startDelayMs: number;
  status?: string;
  lastFailureAt?: string;
  lastWarning?: string;
  lastSkippedReason?: string;
  lastTargetUrl?: string;
  consecutiveFailures?: number;
  origins?: string[];
  lastCheckedOrigins?: string[];
}

export interface AutoSyncStatusDTO extends ServiceScheduleStatusDTO {
  hour: number;
  minute: number;
  scheduleTimes?: string[];
  lastInsertedCount: number;
}

export interface ServiceHealthResponseDTO {
  ok: boolean;
  mode: string;
  intranetOrigin: string;
  changeIntranetOrigin?: string;
  drillIntranetOrigin?: string;
  eventIntranetOrigin?: string;
  browserDebugPort: number;
  keepAlive?: KeepAliveStatusDTO;
  autoSync?: AutoSyncStatusDTO;
  changeAutoSync?: AutoSyncStatusDTO;
  drillAutoSync?: AutoSyncStatusDTO;
  eventAutoSync?: AutoSyncStatusDTO;
}

export type WeatherType = 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'partlyCloudy';

export interface WeatherDTO {
  location: string;
  temperature: number;
  weather: string;
  weatherType: WeatherType;
  humidity: number;
  windSpeed: string;
}
