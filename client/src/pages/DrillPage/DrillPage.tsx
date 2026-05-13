import { useMemo, useState } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { Table } from '@lark-apaas/client-toolkit/antd-table';
import type { ColumnsType } from 'antd/es/table';
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  Copy,
  Database,
  Download,
  Loader2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { browserFetchDrill, runDrillSync, syncDrillRecordsToFeishu } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const DRILL_LIST_URL = 'https://emergencydrill.meta42.indc.vnet.com/api/emergencydrill/exercisePlan/queryExercisePlanList';
const DRILL_EVALUATION_URL = 'https://emergencydrill.meta42.indc.vnet.com/api/event/eventOrder/selEventMsg';
const DRILL_EVALUATION_DETAIL_URL = 'https://emergencydrill.meta42.indc.vnet.com/api/emergencydrill/exerciseEvaluation/selExerciseEvaluationTemplate';
const DRILL_API_PAGE_SIZE = 100;
const DRILL_TABLE_PAGE_SIZE = 15;
const DRILL_PAGE_CONCURRENCY = 6;
const DRILL_MAX_PAGES = 1000;
const DRILL_EVALUATION_API_PAGE_SIZE = 100;
const DRILL_EVALUATION_PAGE_CONCURRENCY = 6;
const DRILL_EVALUATION_MAX_PAGES = 1000;
const DRILL_EVALUATION_DETAIL_CONCURRENCY = 4;
const DRILL_EVALUATION_DETAIL_JOB_NUMBER = '';
const DRILL_MONTH_BACKFILL_ENABLED = true;
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
] as const;

const DEFAULT_DRILL_PAYLOAD = {
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
  pageNo: 1,
  pageSize: DRILL_API_PAGE_SIZE,
  planApprovalStatusMulti: '',
  plannedExerciseEndTime: '',
  plannedExerciseStartTime: '',
};

const DEFAULT_DRILL_EVALUATION_PAYLOAD = {
  creator: '',
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
    pageNumber: 1,
    pageSize: DRILL_EVALUATION_API_PAGE_SIZE,
  },
  startAskDate: '',
  startHappendDate: '',
  startIncidentRecoveryDate: '',
  startResponseDate: '',
};

interface DrillUser {
  jobNumber?: string;
  name?: string;
}

interface DrillRelatedEvent {
  id?: string;
  eventId?: string;
  eventNumber?: string;
  title?: string;
  orderStatus?: string;
  endTime?: string;
  incidentRecoveryTime?: string;
  [key: string]: unknown;
}

interface DrillEvaluationEvent {
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
}

interface DrillRecord {
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
  dutyUserList?: DrillUser[] | null;
  responsibleUserList?: DrillUser[] | null;
  evaluationUserList?: DrillUser[] | null;
  relatedEventList?: DrillRelatedEvent[];
  evaluationEventList?: DrillEvaluationEvent[];
  drillEvaluationScore?: string;
  drillEvaluationEventNumber?: string;
  drillEvaluationEventTitle?: string;
  [key: string]: unknown;
}

interface DrillApiResponse {
  code?: string;
  message?: string;
  success?: boolean;
  data?: {
    records?: DrillRecord[];
    total?: number;
    totalCount?: number;
    totalRecords?: number;
    count?: number;
    pages?: number;
    totalPages?: number;
    pageNo?: number;
    pageSize?: number;
    [key: string]: unknown;
  };
}

interface DrillPageResult {
  pageNo: number;
  records: DrillRecord[];
  total: number;
  totalPages: number;
  raw: DrillApiResponse;
}

interface DrillEvaluationApiResponse {
  code?: string;
  message?: string;
  success?: boolean;
  data?: {
    dataList?: DrillEvaluationEvent[];
    records?: DrillEvaluationEvent[];
    total?: number;
    count?: number;
    pages?: number;
    totalPages?: number;
    pageNumber?: number;
    pageSize?: number;
    [key: string]: unknown;
  };
}

interface DrillEvaluationPageResult {
  pageNumber: number;
  events: DrillEvaluationEvent[];
  total: number;
  totalPages: number;
  raw: DrillEvaluationApiResponse;
}

interface DrillFetchResult {
  records: DrillRecord[];
  rawPages: DrillApiResponse[];
  rawEvaluationPages: DrillEvaluationApiResponse[];
  recordCount?: number;
  monthlyCount?: number;
  insertedCount?: number;
  notified?: boolean;
  notExecutedCount?: number;
  eventLinkedCount?: number;
  totalFromApi: number;
  totalPages: number;
  evaluationEventCount: number;
  evaluationMatchedCount: number;
  evaluationDetailFetchedCount: number;
  evaluationDetailFailedCount: number;
  evaluationScoreMatchedCount: number;
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

type DrillTableRecord = DrillRecord & { _index?: number; _rowKey?: string };

const categoryMap: Record<string, string> = {
  plan: '计划演练',
  surpriseAttack: '突袭演练',
  surpriseAttackPlan: '突袭演练-计划性',
};

const executeStatusMap: Record<string, string> = {
  NOT_EXECUTED: '未执行',
  EXECUTING: '执行中',
  EXECUTED: '已执行',
  COMPLETED: '已完成',
};

const approvalStatusMap: Record<string, string> = {
  NOAPPROVAL: '未审批',
  APPROVING: '审批中',
  COMPLETED: '审批完成',
  REJECTED: '已驳回',
};

const orderStatusMap: Record<string, string> = {
  '5': '待评估',
  '11': '完成',
  '12': '评估待审批',
  '13': '终止',
};

const exerciseTypeMap: Record<string, string> = {
  run: '跑位演练',
};

const exerciseCycleMap: Record<string, string> = {
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

function getText(value: unknown, fallback = '--') {
  const text = String(value ?? '').trim();
  return text ? text : fallback;
}

function normalizeBuildingLetter(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace('Ａ', 'A')
    .replace('Ｂ', 'B')
    .replace('Ｃ', 'C')
    .replace('Ｄ', 'D')
    .replace('Ｅ', 'E');
}

function getBuildingLabel(value: string) {
  const letter = normalizeBuildingLetter(value);
  return /^[A-E]$/.test(letter) ? `${letter}楼` : '';
}

const domainBuildingLabelMap: Record<string, string> = {
  '5': 'A楼',
  '6': 'B楼',
  '7': 'C楼',
  '8': 'D楼',
  '9': 'E楼',
};

function getBuildingLabelFromDomainCode(value: unknown) {
  const match = String(value ?? '').trim().match(/^([5-9])(?:\.|$)/);
  return match ? (domainBuildingLabelMap[match[1]] || '') : '';
}

function collectImplementationAreaLabels(values: unknown[]) {
  const labels: string[] = [];
  const addLabel = (label: string) => {
    if (label && !labels.includes(label)) {
      labels.push(label);
    }
  };
  const scan = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(scan);
      return;
    }
    if (value && typeof value === 'object') {
      const source = value as Record<string, unknown>;
      [
        source.datacenterName,
        source.datacenterCode,
        source.dcName,
        source.dcCode,
        source.buildingName,
        source.buildingCode,
        source.name,
        source.label,
        source.value,
      ].forEach(scan);
      return;
    }

    const text = String(value ?? '').trim();
    if (!text) return;
    const domainLabel = getBuildingLabelFromDomainCode(text);
    if (domainLabel) {
      addLabel(domainLabel);
      return;
    }

    const directLabel = getBuildingLabel(text);
    if (directLabel) {
      addLabel(directLabel);
      return;
    }

    text
      .split(/[、,，;；|]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        const label = getBuildingLabel(part);
        if (label) {
          addLabel(label);
        }
      });

    const patterns = [
      /数据中心[\s_/-]*([A-EＡ-Ｅ])(?:楼|栋)?/gi,
      /中心[\s_/-]*([A-EＡ-Ｅ])(?:楼|栋)?/gi,
      /([A-EＡ-Ｅ])(?:楼|栋)/gi,
      /(?:^|[_/\s-])([A-EＡ-Ｅ])(?:$|[^\w])/gi,
    ];

    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const label = match?.[1] ? getBuildingLabel(match[1]) : '';
        if (label) {
          addLabel(label);
        }
      }
    }
  };

  values.forEach(scan);
  return labels;
}

function getImplementationAreaText(record: DrillRecord) {
  const exerciseObjects = Array.isArray(record.exerciseObjectList) ? record.exerciseObjectList : [];
  const labels = collectImplementationAreaLabels([
    record.implementationAreaStr,
    record.implementationArea,
    record.dcCode,
    record.domainCode,
    ...exerciseObjects,
  ]);
  if (labels.length > 0) {
    return labels.join('、');
  }

  return getText(record.implementationAreaStr || record.implementationArea?.join('、'));
}

function normalizeTotal(data: DrillApiResponse['data']) {
  const rawTotal = data?.total ?? data?.totalCount ?? data?.totalRecords ?? data?.count ?? 0;
  const total = Number(rawTotal);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

function normalizeTotalPages(data: DrillApiResponse['data'], total: number) {
  const rawPages = data?.pages ?? data?.totalPages;
  const pages = Number(rawPages);
  if (Number.isFinite(pages) && pages > 0) {
    return Math.ceil(pages);
  }

  return total > 0 ? Math.max(1, Math.ceil(total / DRILL_API_PAGE_SIZE)) : 1;
}

function getCurrentDrillExerciseMonthToken(now = new Date()) {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][now.getMonth()];
}

function isCurrentMonthDrillRecord(record: DrillRecord, now = new Date()) {
  const monthTokens = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const year = Number(record.exerciseYear);
  const monthText = String(record.exerciseMonth || '').trim().toLowerCase();
  const monthIndex = monthTokens.indexOf(monthText.slice(0, 3));
  if (Number.isFinite(year) && monthIndex >= 0) {
    return year === now.getFullYear() && monthIndex === now.getMonth();
  }

  const timeText = [
    record.plannedExerciseTime,
    record.actualExerciseTime,
    record.triggerTime,
    record.createTime,
  ].find((value) => String(value || '').trim());
  if (!timeText) {
    return false;
  }

  const timestamp = new Date(String(timeText).replace(/-/g, '/')).getTime();
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const date = new Date(timestamp);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function normalizeEvaluationTotal(data: DrillEvaluationApiResponse['data']) {
  const rawTotal = data?.total ?? data?.count ?? 0;
  const total = Number(rawTotal);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

function normalizeEvaluationTotalPages(data: DrillEvaluationApiResponse['data'], total: number) {
  const rawPages = data?.pages ?? data?.totalPages;
  const pages = Number(rawPages);
  if (Number.isFinite(pages) && pages > 0) {
    return Math.ceil(pages);
  }

  return total > 0 ? Math.max(1, Math.ceil(total / DRILL_EVALUATION_API_PAGE_SIZE)) : 1;
}

const evaluationScoreFields = [
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

const evaluationDetailScoreFields = [
  'totalScore',
  'finalScore',
  'actualTotalScore',
  'evaluationTotalScore',
  'drillEvaluationScore',
  'evaluationScore',
  'score',
];

function normalizeScoreText(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, '').replace(/\.$/, '');
  }
  const text = String(value).trim();
  return text === 'null' || text === 'undefined' ? '' : text;
}

function getFirstText(source: Record<string, unknown> | undefined, fieldNames: string[]) {
  if (!source) return '';

  for (const fieldName of fieldNames) {
    const text = normalizeScoreText(source[fieldName]);
    if (text) {
      return text;
    }
  }

  return '';
}

function getEvaluationDetailData(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const data = record.data;
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : record;
}

function sumEvaluationActualScores(items: unknown) {
  let total = 0;
  let count = 0;

  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const record = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, 'actualScore')) {
      const numericScore = Number(record.actualScore);
      if (Number.isFinite(numericScore)) {
        total += numericScore;
        count += 1;
      }
    }

    ['exerciseEvaluationDetailDtoList', 'children', 'childrenList', 'detailList'].forEach((fieldName) => {
      if (Array.isArray(record[fieldName])) {
        visit(record[fieldName]);
      }
    });
  };

  visit(items);
  return count > 0 ? total : null;
}

function getEvaluationDetailScore(payload: unknown) {
  const detailData = getEvaluationDetailData(payload);
  if (!detailData) return '';

  const directScore = getFirstText(detailData, evaluationDetailScoreFields);
  if (directScore) return directScore;

  const contentList = Array.isArray(detailData.exerciseEvaluationContentDtoList)
    ? detailData.exerciseEvaluationContentDtoList
    : Array.isArray(detailData.evaluationContentList)
      ? detailData.evaluationContentList
      : [];
  const summedScore = sumEvaluationActualScores(contentList);
  return summedScore === null ? '' : normalizeScoreText(summedScore);
}

function getEvaluationEventScore(event?: DrillEvaluationEvent) {
  return (
    getFirstText(event, evaluationScoreFields)
    || getEvaluationDetailScore(event?.evaluationDetail)
    || getEvaluationDetailScore(event?.evaluationDetailPayload)
  );
}

function getDrillEvaluationScore(record: DrillRecord) {
  const score = getFirstText(record, evaluationScoreFields) || getEvaluationDetailScore(record.evaluationDetail);
  if (score) {
    return score;
  }

  const eventWithScore = record.evaluationEventList?.find((event) => getEvaluationEventScore(event));
  return getEvaluationEventScore(eventWithScore);
}

function getEvaluationEventTime(event: DrillEvaluationEvent) {
  const rawTime = event.updateTime || event.creatTime || '';
  const timestamp = rawTime ? new Date(String(rawTime).replace(/-/g, '/')).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getPrimaryEvaluationEvent(record: DrillRecord) {
  const events = Array.isArray(record.evaluationEventList) ? record.evaluationEventList : [];
  return events.find((event) => getEvaluationEventScore(event)) || events[0];
}

function buildEvaluationEventMap(events: DrillEvaluationEvent[]) {
  const eventMap = new Map<string, DrillEvaluationEvent[]>();

  const addEvent = (key: unknown, event: DrillEvaluationEvent) => {
    const normalizedKey = String(key ?? '').trim();
    if (!normalizedKey) return;
    const list = eventMap.get(normalizedKey) || [];
    list.push(event);
    eventMap.set(normalizedKey, list);
  };

  events.forEach((event) => {
    addEvent(event.drillId, event);
    addEvent(event.eventNumber, event);
  });

  return eventMap;
}

function getPlanEvaluationKeys(record: DrillRecord) {
  const keys = new Set<string>();
  const id = String(record.id ?? '').trim();
  if (id) {
    keys.add(`plan_id_${id}`);
  }

  (record.relatedEventList || []).forEach((event) => {
    const eventNumber = String(event.eventNumber ?? '').trim();
    if (eventNumber) {
      keys.add(eventNumber);
    }
  });

  return Array.from(keys);
}

function firstNonEmptyText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function getRelatedEvaluationEvent(record: DrillRecord, event?: DrillEvaluationEvent) {
  const relatedEvents = Array.isArray(record.relatedEventList) ? record.relatedEventList : [];
  const eventNumber = String(event?.eventNumber || '').trim();
  const eventId = String(event?.eventId || event?.id || '').trim();

  return relatedEvents.find((relatedEvent) => {
    const relatedNumber = String(relatedEvent.eventNumber || '').trim();
    const relatedId = String(relatedEvent.id || relatedEvent.eventId || '').trim();
    return (eventNumber && relatedNumber === eventNumber) || (eventId && relatedId === eventId);
  });
}

function getEvaluationDetailEndTime(record: DrillRecord, event?: DrillEvaluationEvent, relatedEvent?: DrillRelatedEvent) {
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
    record.evaluationCompleteTime,
    record.actualExerciseTime,
    record.triggerTime,
  );
}

function buildEvaluationDetailUrl(record: DrillRecord, event?: DrillEvaluationEvent) {
  if (!event) return '';

  const relatedEvent = getRelatedEvaluationEvent(record, event);
  const recordId = String(record.id ?? '').trim();
  const drillId = firstNonEmptyText(event.drillId, recordId ? `plan_id_${recordId}` : '');
  const eventId = firstNonEmptyText(event.eventId, relatedEvent?.eventId, relatedEvent?.id, event.id);
  const endTime = getEvaluationDetailEndTime(record, event, relatedEvent);
  const jobNumber = firstNonEmptyText(event.jobNumber, event.creatorJobNumber, DRILL_EVALUATION_DETAIL_JOB_NUMBER);

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

function enrichDrillRecordsWithEvaluationEvents(records: DrillRecord[], events: DrillEvaluationEvent[]) {
  const eventMap = buildEvaluationEventMap(events);
  let matchedCount = 0;

  const enrichedRecords = records.map((record) => {
    const seenEvents = new Set<string>();
    const matchedEvents = getPlanEvaluationKeys(record)
      .flatMap((key) => eventMap.get(key) || [])
      .filter((event, index) => {
        const key = String(event.id || event.eventNumber || `${event.drillId || ''}-${index}`);
        if (seenEvents.has(key)) {
          return false;
        }
        seenEvents.add(key);
        return true;
      })
      .sort((left, right) => getEvaluationEventTime(right) - getEvaluationEventTime(left));

    if (matchedEvents.length > 0) {
      matchedCount += 1;
    }
    const primaryEvent = matchedEvents.find((event) => getEvaluationEventScore(event)) || matchedEvents[0];
    return {
      ...record,
      evaluationEventList: matchedEvents,
      drillEvaluationScore: getEvaluationEventScore(primaryEvent),
      drillEvaluationEventNumber: primaryEvent?.eventNumber || '',
      drillEvaluationEventTitle: primaryEvent?.eventTitle || primaryEvent?.highestLevelTitle || '',
    };
  });

  return {
    records: enrichedRecords,
    matchedCount,
  };
}

function getRecordKey(record: DrillRecord, index: number) {
  return String(
    record.id
      || record.operationPlanNumber
      || `${record.exerciseScenarioName || 'unknown'}-${record.exerciseObjectStr || ''}-${record.createTime || ''}-${index}`,
  );
}

function getStableRecordKey(record: DrillRecord, index: number) {
  return String(
    record.id
      || [
        record.operationPlanNumber,
        record.exerciseScenarioId,
        record.exerciseObjectStr,
        record.dcCode,
        record.createTime,
        index,
      ].filter(Boolean).join('|'),
  );
}

function mergeDrillRecords(baseRecords: DrillRecord[], extraRecords: DrillRecord[]) {
  const merged: DrillRecord[] = [];
  const indexMap = new Map<string, number>();

  [...baseRecords, ...extraRecords].forEach((record, index) => {
    const key = getStableRecordKey(record, index);
    if (!key) return;
    if (indexMap.has(key)) {
      const existingIndex = indexMap.get(key) as number;
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

function getCategoryText(value?: string) {
  return categoryMap[String(value || '')] || getText(value);
}

function getExerciseTypeText(value?: string) {
  const key = String(value || '').trim();
  return exerciseTypeMap[key] || getText(key);
}

function getExerciseCycleText(value?: string) {
  const key = String(value || '').trim();
  return exerciseCycleMap[key] || getText(key);
}

function getCategoryTone(value?: string): 'blue' | 'amber' {
  return String(value || '').startsWith('surpriseAttack') ? 'amber' : 'blue';
}

function getExecuteStatusText(value?: string) {
  return executeStatusMap[String(value || '')] || getText(value);
}

function getApprovalStatusText(value?: string) {
  return approvalStatusMap[String(value || '')] || getText(value);
}

function getOrderStatusText(value?: string | null) {
  const key = String(value ?? '').trim();
  return key ? (orderStatusMap[key] || getText(key)) : '待演练';
}

function getOrderStatusTone(value?: string | null): 'slate' | 'green' | 'blue' | 'amber' | 'red' {
  const key = String(value ?? '').trim();
  if (!key) return 'amber';
  if (key === '11') return 'green';
  if (key === '12') return 'blue';
  if (key === '13') return 'red';
  if (key === '5') return 'amber';
  return 'slate';
}

function formatEvaluationEvents(events?: DrillEvaluationEvent[]) {
  if (!Array.isArray(events) || events.length === 0) {
    return '--';
  }

  return events
    .map((event) => event.eventNumber || event.eventTitle || event.highestLevelTitle)
    .filter(Boolean)
    .join('、') || '--';
}

function getEvaluationLevelText(event?: DrillEvaluationEvent) {
  return getText(event?.eventCurrentLevelName || event?.eventHighestLevelName || event?.eventFirstLevelName);
}

function formatUsers(users?: DrillUser[] | null) {
  if (!Array.isArray(users) || users.length === 0) {
    return '--';
  }

  return users.map((user) => user.name || user.jobNumber).filter(Boolean).join('、') || '--';
}

function formatDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '--';
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
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

export default function DataExtractionPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DrillFetchResult | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [showRawData, setShowRawData] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const requestPage = async (
    pageNo: number,
    overrides: Partial<typeof DEFAULT_DRILL_PAYLOAD> = {},
    logLabel = '演练计划',
  ): Promise<DrillPageResult> => {
    const payload = {
      ...DEFAULT_DRILL_PAYLOAD,
      ...overrides,
      pageNo,
      pageSize: DRILL_API_PAGE_SIZE,
    };

    logger.info(`开始拉取${logLabel}第 ${pageNo} 页`);
    const bridgeResult = await browserFetchDrill<DrillApiResponse>({
      url: DRILL_LIST_URL,
      method: 'POST',
      payload,
    });

    if (!bridgeResult.success || !bridgeResult.data) {
      throw new Error(bridgeResult.message || `第 ${pageNo} 页拉取失败`);
    }

    const apiResult = bridgeResult.data;
    if (!apiResult || typeof apiResult !== 'object' || Array.isArray(apiResult)) {
      throw new Error('演练接口未返回 JSON 对象，请确认浏览器页签已登录演练系统');
    }

    if (apiResult.code && apiResult.code !== '200') {
      throw new Error(apiResult.message || `演练接口返回异常：${apiResult.code}`);
    }

    if (apiResult.success === false) {
      throw new Error(apiResult.message || '演练接口返回失败');
    }

    const records = Array.isArray(apiResult.data?.records) ? apiResult.data.records : [];
    const total = normalizeTotal(apiResult.data);
    const totalPages = normalizeTotalPages(apiResult.data, total);

    logger.info(`${logLabel}第 ${pageNo} 页完成，records=${records.length} total=${total} totalPages=${totalPages}`);
    return {
      pageNo,
      records,
      total,
      totalPages,
      raw: apiResult,
    };
  };

  const requestEvaluationPage = async (pageNumber: number): Promise<DrillEvaluationPageResult> => {
    const payload = {
      ...DEFAULT_DRILL_EVALUATION_PAYLOAD,
      pageBean: {
        pageNumber,
        pageSize: DRILL_EVALUATION_API_PAGE_SIZE,
      },
    };

    logger.info(`开始拉取演练评估事件第 ${pageNumber} 页`);
    const bridgeResult = await browserFetchDrill<DrillEvaluationApiResponse>({
      url: DRILL_EVALUATION_URL,
      method: 'POST',
      payload,
    });

    if (!bridgeResult.success || !bridgeResult.data) {
      throw new Error(bridgeResult.message || `评估事件第 ${pageNumber} 页拉取失败`);
    }

    const apiResult = bridgeResult.data;
    if (!apiResult || typeof apiResult !== 'object' || Array.isArray(apiResult)) {
      throw new Error('演练评估接口未返回 JSON 对象，请确认浏览器页签已登录演练系统');
    }

    if (apiResult.code && apiResult.code !== '200') {
      throw new Error(apiResult.message || `演练评估接口返回异常：${apiResult.code}`);
    }

    if (apiResult.success === false) {
      throw new Error(apiResult.message || '演练评估接口返回失败');
    }

    const events = Array.isArray(apiResult.data?.dataList)
      ? apiResult.data.dataList
      : Array.isArray(apiResult.data?.records)
        ? apiResult.data.records
        : [];
    const total = normalizeEvaluationTotal(apiResult.data);
    const totalPages = normalizeEvaluationTotalPages(apiResult.data, total);

    logger.info(`演练评估事件第 ${pageNumber} 页完成，records=${events.length} total=${total} totalPages=${totalPages}`);
    return {
      pageNumber,
      events,
      total,
      totalPages,
      raw: apiResult,
    };
  };

  const fetchAllEvaluationEvents = async () => {
    setProgress('正在请求演练评估事件第 1 页');
    const firstPage = await requestEvaluationPage(1);
    const rawPages = [firstPage.raw];
    const allEvents = [...firstPage.events];
    const totalPages = firstPage.totalPages;

    if (totalPages > DRILL_EVALUATION_MAX_PAGES) {
      throw new Error(`评估事件接口总页数 ${totalPages} 超过安全上限 ${DRILL_EVALUATION_MAX_PAGES}，已停止拉取`);
    }

    if (totalPages > 1) {
      const remainingPages = Array.from({ length: totalPages - 1 }, (_, index) => index + 2);
      setProgress(`正在并发拉取评估事件剩余 ${remainingPages.length} 页`);

      const pageResults = await runConcurrentTasks<number, DrillEvaluationPageResult>({
        items: remainingPages,
        concurrency: DRILL_EVALUATION_PAGE_CONCURRENCY,
        worker: (pageNumber) => requestEvaluationPage(pageNumber),
        onProgress: ({ completed, total }) => {
          setProgress(`正在拉取评估事件剩余页：${completed} / ${total}`);
        },
      });

      pageResults
        .sort((left, right) => left.pageNumber - right.pageNumber)
        .forEach((page) => {
          allEvents.push(...page.events);
          rawPages.push(page.raw);
        });
    } else if (firstPage.events.length === DRILL_EVALUATION_API_PAGE_SIZE && firstPage.total === 0) {
      let nextPage = 2;
      while (nextPage <= DRILL_EVALUATION_MAX_PAGES) {
        setProgress(`评估事件未返回总数，正在探测第 ${nextPage} 页`);
        const page = await requestEvaluationPage(nextPage);
        rawPages.push(page.raw);
        if (page.events.length === 0) {
          break;
        }

        allEvents.push(...page.events);
        if (page.events.length < DRILL_EVALUATION_API_PAGE_SIZE) {
          break;
        }

        nextPage += 1;
      }
    }

    return {
      events: allEvents,
      rawPages,
    };
  };

  const enrichRecordsWithEvaluationDetails = async (sourceRecords: DrillRecord[]) => {
    const records = sourceRecords.map((record) => ({
      ...record,
      evaluationEventList: Array.isArray(record.evaluationEventList)
        ? record.evaluationEventList.map((event) => ({ ...event }))
        : record.evaluationEventList,
    }));
    const tasksByUrl = new Map<string, { detailUrl: string; targets: DrillEvaluationEvent[] }>();

    records.forEach((record) => {
      const primaryEvent = getPrimaryEvaluationEvent(record);
      if (!primaryEvent || getEvaluationEventScore(primaryEvent)) {
        return;
      }

      const detailUrl = buildEvaluationDetailUrl(record, primaryEvent);
      if (!detailUrl) {
        return;
      }

      const task = tasksByUrl.get(detailUrl) || { detailUrl, targets: [] };
      task.targets.push(primaryEvent);
      tasksByUrl.set(detailUrl, task);
    });

    const tasks = Array.from(tasksByUrl.values());
    if (tasks.length === 0) {
      return {
        records,
        fetchedCount: 0,
        failedCount: 0,
        scoreMatchedCount: records.filter((record) => getDrillEvaluationScore(record)).length,
      };
    }

    setProgress(`正在拉取演练评分详情，共 ${tasks.length} 个事件`);
    const detailResults = await runConcurrentTasks({
      items: tasks,
      concurrency: DRILL_EVALUATION_DETAIL_CONCURRENCY,
      worker: async (task) => {
        try {
          const bridgeResult = await browserFetchDrill<Record<string, unknown>>({
            url: task.detailUrl,
            method: 'GET',
          });
          if (!bridgeResult.success || !bridgeResult.data) {
            throw new Error(bridgeResult.message || 'evaluation detail fetch failed');
          }

          const apiResult = bridgeResult.data;
          if (apiResult.code && apiResult.code !== '200') {
            throw new Error(String(apiResult.message || `evaluation detail code ${apiResult.code}`));
          }
          if (apiResult.success === false) {
            throw new Error(String(apiResult.message || 'evaluation detail returned success=false'));
          }

          const detailData = getEvaluationDetailData(apiResult);
          return {
            task,
            success: true,
            detailData,
            score: getEvaluationDetailScore(detailData),
          };
        } catch (detailError: any) {
          logger.warn(`演练评分详情拉取失败 - ${detailError?.message || detailError}`);
          return {
            task,
            success: false,
          };
        }
      },
      onProgress: ({ completed, total }) => {
        setProgress(`正在拉取演练评分详情：${completed} / ${total}`);
      },
    });

    let fetchedCount = 0;
    let failedCount = 0;
    detailResults.forEach((detailResult) => {
      if (!detailResult.success) {
        failedCount += 1;
        return;
      }

      fetchedCount += 1;
      detailResult.task.targets.forEach((event) => {
        event.evaluationDetail = detailResult.detailData;
        if (detailResult.score) {
          event.drillEvaluationScore = detailResult.score;
        }
      });
    });

    records.forEach((record) => {
      const primaryEvent = getPrimaryEvaluationEvent(record);
      const score = getEvaluationEventScore(primaryEvent);
      if (score) {
        record.drillEvaluationScore = score;
      }
    });

    return {
      records,
      fetchedCount,
      failedCount,
      scoreMatchedCount: records.filter((record) => getDrillEvaluationScore(record)).length,
    };
  };

  const fetchAllPages = async (): Promise<DrillFetchResult> => {
    const startedAt = Date.now();
    setProgress('正在请求第 1 页');
    const firstPage = await requestPage(1);
    const rawPages = [firstPage.raw];
    const allRecords = [...firstPage.records];
    const totalFromApi = firstPage.total;
    const totalPages = firstPage.totalPages;

    if (totalPages > DRILL_MAX_PAGES) {
      throw new Error(`接口总页数 ${totalPages} 超过安全上限 ${DRILL_MAX_PAGES}，已停止拉取`);
    }

    if (totalPages > 1) {
      const remainingPages = Array.from({ length: totalPages - 1 }, (_, index) => index + 2);
      setProgress(`正在并发拉取剩余 ${remainingPages.length} 页`);

      const pageResults = await runConcurrentTasks<number, DrillPageResult>({
        items: remainingPages,
        concurrency: DRILL_PAGE_CONCURRENCY,
        worker: (pageNo) => requestPage(pageNo),
        onProgress: ({ completed, total }) => {
          setProgress(`正在拉取剩余页：${completed} / ${total}`);
        },
      });

      pageResults
        .sort((left, right) => left.pageNo - right.pageNo)
        .forEach((page) => {
          allRecords.push(...page.records);
          rawPages.push(page.raw);
        });
    } else if (firstPage.records.length === DRILL_API_PAGE_SIZE && totalFromApi === 0) {
      let nextPage = 2;
      while (nextPage <= DRILL_MAX_PAGES) {
        setProgress(`未返回总数，正在探测第 ${nextPage} 页`);
        const page = await requestPage(nextPage);
        rawPages.push(page.raw);
        if (page.records.length === 0) {
          break;
        }

        allRecords.push(...page.records);
        if (page.records.length < DRILL_API_PAGE_SIZE) {
          break;
        }

        nextPage += 1;
      }
    }

    if (DRILL_MONTH_BACKFILL_ENABLED) {
      const monthToken = getCurrentDrillExerciseMonthToken();
      const monthRecords: DrillRecord[] = [];

      for (const filter of DRILL_MONTH_BACKFILL_FILTERS) {
        const logLabel = `本月计划补拉(${monthToken}-${filter.label})`;
        setProgress(`正在补拉本月演练计划：${monthToken} ${filter.label}`);
        const monthFirstPage = await requestPage(1, {
          ...filter.overrides,
          ...(filter.monthScoped ? { exerciseMonth: monthToken } : {}),
        }, logLabel);
        monthRecords.push(...monthFirstPage.records);
        rawPages.push(monthFirstPage.raw);

        if (monthFirstPage.totalPages > DRILL_MAX_PAGES) {
          throw new Error(`本月补拉接口总页数 ${monthFirstPage.totalPages} 超过安全上限 ${DRILL_MAX_PAGES}，已停止拉取`);
        }

        if (monthFirstPage.totalPages > 1) {
          const remainingPages = Array.from({ length: monthFirstPage.totalPages - 1 }, (_, index) => index + 2);
          const monthPageResults = await runConcurrentTasks<number, DrillPageResult>({
            items: remainingPages,
            concurrency: DRILL_PAGE_CONCURRENCY,
            worker: (pageNo) => requestPage(pageNo, {
              ...filter.overrides,
              ...(filter.monthScoped ? { exerciseMonth: monthToken } : {}),
            }, logLabel),
            onProgress: ({ completed, total }) => {
              setProgress(`正在补拉本月演练计划 ${filter.label}：${completed} / ${total}`);
            },
          });

          monthPageResults
            .sort((left, right) => left.pageNo - right.pageNo)
            .forEach((page) => {
              monthRecords.push(...page.records);
              rawPages.push(page.raw);
            });
        }
      }

      const beforeCount = allRecords.length;
      const mergedRecords = mergeDrillRecords(allRecords, monthRecords);
      allRecords.splice(0, allRecords.length, ...mergedRecords);
      logger.info(`本月演练计划补拉完成，fetched=${monthRecords.length} merged=${allRecords.length} added=${Math.max(allRecords.length - beforeCount, 0)} filters=${DRILL_MONTH_BACKFILL_FILTERS.length}`);
    }

    setProgress(`演练计划拉取完成，共 ${allRecords.length} 条；正在拉取评估事件`);
    const evaluationResult = await fetchAllEvaluationEvents();
    const enrichedResult = enrichDrillRecordsWithEvaluationEvents(allRecords, evaluationResult.events);
    const detailResult = await enrichRecordsWithEvaluationDetails(enrichedResult.records);
    const records = detailResult.records;
    return {
      records,
      rawPages,
      rawEvaluationPages: evaluationResult.rawPages,
      totalFromApi,
      totalPages: Math.max(totalPages, rawPages.length),
      evaluationEventCount: evaluationResult.events.length,
      evaluationMatchedCount: enrichedResult.matchedCount,
      evaluationDetailFetchedCount: detailResult.fetchedCount,
      evaluationDetailFailedCount: detailResult.failedCount,
      evaluationScoreMatchedCount: detailResult.scoreMatchedCount,
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    };
  };

  const syncRecordsToFeishu = async (
    records: DrillRecord[],
    trigger: 'manual' | 'auto',
  ) => {
    if (!records.length) {
      const message = '没有可同步的演练数据';
      if (trigger === 'manual') {
        toast.error(message);
      }
      return { ok: false, insertedCount: 0, notified: false, message };
    }

    setSyncing(true);
    try {
      const syncResult = await syncDrillRecordsToFeishu(records);
      const insertedCount = Number(syncResult.insertedCount || 0);
      const notified = Boolean(syncResult.notified);
      if (insertedCount > 0 && notified) {
        toast.success(syncResult.message || `已同步 ${insertedCount} 条演练数据到飞书多维表，群通知已发送`);
      } else if (insertedCount > 0) {
        toast.warning(syncResult.message || `已同步 ${insertedCount} 条演练数据到飞书多维表，请检查群通知结果`);
      } else {
        toast.error(syncResult.message || '同步到飞书失败');
      }

      return {
        ok: insertedCount > 0,
        insertedCount,
        notified,
        message: syncResult.message || '',
      };
    } catch (syncError: any) {
      const message = syncError?.response?.data?.message || syncError?.message || '同步到飞书失败';
      toast.error(message);
      logger.error(`同步演练数据到飞书失败 - ${message}`);
      return { ok: false, insertedCount: 0, notified: false, message };
    } finally {
      setSyncing(false);
    }
  };

  const handleFetchData = async () => {
    setLoading(true);
    setError('');
    setProgress('准备拉取演练数据');

    try {
      setProgress('后端正在拉取演练计划、补拉本月楼栋、同步飞书');
      const syncResult = await runDrillSync();
      const insertedCount = Number(syncResult.insertedCount || 0);
      const recordCount = Number(syncResult.total || syncResult.fetchedCount || insertedCount || 0);
      const monthlyCount = Number(syncResult.monthlyCount || 0);
      if (insertedCount <= 0) {
        throw new Error(syncResult.message || '演练同步未写入数据');
      }

      const nextResult: DrillFetchResult = {
        records: [],
        rawPages: [],
        rawEvaluationPages: [],
        recordCount,
        monthlyCount,
        insertedCount,
        notified: Boolean(syncResult.notified),
        notExecutedCount: Number(syncResult.notExecutedCount || 0),
        eventLinkedCount: Number(syncResult.eventLinkedCount || 0),
        totalFromApi: Number(syncResult.fetchedCount || recordCount),
        totalPages: 0,
        evaluationEventCount: Number(syncResult.evaluationEventCount || 0),
        evaluationMatchedCount: Number(syncResult.evaluationMatchedCount || 0),
        evaluationDetailFetchedCount: Number(syncResult.evaluationDetailFetchedCount || 0),
        evaluationDetailFailedCount: Number(syncResult.evaluationDetailFailedCount || 0),
        evaluationScoreMatchedCount: Number(syncResult.evaluationScoreMatchedCount || 0),
        fetchedAt: syncResult.fetchedAt || new Date().toISOString(),
        durationMs: Number(syncResult.durationMs || 0),
      };
      setResult(nextResult);
      setProgress(
        `拉取完成，本月计划 ${monthlyCount} 条；全量同步 ${insertedCount} 条；评估事件匹配 ${nextResult.evaluationMatchedCount} 条；评分 ${nextResult.evaluationScoreMatchedCount} 条${
          nextResult.notified ? '，群通知已发送' : ''
        }`,
      );
      const historyItem: HistoryItem = {
        id: `${Date.now()}`,
        time: nextResult.fetchedAt,
        status: 'success',
        recordCount,
        pageCount: nextResult.totalPages,
        durationMs: nextResult.durationMs,
        message: `拉取成功，本月计划 ${monthlyCount} 条，全量同步 ${insertedCount} 条，评分 ${nextResult.evaluationScoreMatchedCount} 条`,
      };
      setHistory((items) => [historyItem, ...items].slice(0, 20));
      toast.success(syncResult.message || `演练数据拉取并同步完成，本月计划 ${monthlyCount} 条`);
    } catch (fetchError: any) {
      const message = fetchError?.response?.data?.message || fetchError?.message || '演练数据拉取失败';
      setError(message);
      setProgress('');
      const historyItem: HistoryItem = {
        id: `${Date.now()}`,
        time: new Date().toISOString(),
        status: 'failed',
        recordCount: 0,
        pageCount: 0,
        durationMs: 0,
        message,
      };
      setHistory((items) => [historyItem, ...items].slice(0, 20));
      toast.error(message);
      logger.error(`演练数据拉取失败 - ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyData = async () => {
    if (!result) {
      toast.error('没有可复制的数据');
      return;
    }

    await navigator.clipboard.writeText(JSON.stringify(result.records, null, 2));
    toast.success('已复制演练记录 JSON');
  };

  const handleSyncFeishu = async () => {
    await syncRecordsToFeishu(result?.records || [], 'manual');
  };

  const handleReset = () => {
    setResult(null);
    setError('');
    setProgress('');
    setShowRawData(false);
  };

  const summaryCards = useMemo(() => {
    const records = result?.records || [];
    const recordCount = result?.recordCount ?? records.length;
    const monthlyCount = result?.monthlyCount ?? records.filter((item) => isCurrentMonthDrillRecord(item)).length;
    const notExecuted = result?.notExecutedCount ?? records.filter((item) => item.executeStatus === 'NOT_EXECUTED').length;
    const eventLinked = result?.eventLinkedCount ?? records.filter((item) => Array.isArray(item.relatedEventList) && item.relatedEventList.length > 0).length;
    const evaluationMatched = records.filter((item) => Array.isArray(item.evaluationEventList) && item.evaluationEventList.length > 0).length;
    const scored = result?.evaluationScoreMatchedCount ?? records.filter((item) => getDrillEvaluationScore(item)).length;

    return [
      { label: '本月计划', value: monthlyCount, hint: result ? `全量同步 ${result.insertedCount || recordCount}` : '等待拉取' },
      { label: '未执行', value: notExecuted, hint: 'executeStatus' },
      { label: '关联事件', value: eventLinked, hint: 'relatedEventList' },
      { label: '评估事件', value: result?.evaluationMatchedCount ?? evaluationMatched, hint: result ? `事件总数 ${result.evaluationEventCount}` : 'drillId' },
      { label: '有评分', value: scored, hint: 'score fields' },
    ];
  }, [result]);

  const columns: ColumnsType<DrillTableRecord> = [
    {
      title: '序号',
      dataIndex: '_index',
      width: 72,
      fixed: 'left',
    },
    {
      title: '计划编号',
      dataIndex: 'operationPlanNumber',
      width: 260,
      ellipsis: true,
      render: (value: string) => getText(value),
    },
    {
      title: '演练场景',
      dataIndex: 'exerciseScenarioName',
      width: 260,
      ellipsis: true,
      render: (value: string) => getText(value),
    },
    {
      title: '专业',
      dataIndex: 'exerciseMajor',
      width: 90,
      render: (value: string) => getText(value),
    },
    {
      title: '类别',
      dataIndex: 'exerciseCategory',
      width: 150,
      render: (value: string) => <StatusBadge value={getCategoryText(value)} tone={getCategoryTone(value)} />,
    },
    {
      title: '实施区域',
      dataIndex: 'implementationAreaStr',
      width: 180,
      ellipsis: true,
      render: (_value: string, record) => getImplementationAreaText(record),
    },
    {
      title: '演练类型',
      dataIndex: 'exerciseType',
      width: 120,
      render: (value: string) => getExerciseTypeText(value),
    },
    {
      title: '演练周期',
      dataIndex: 'exerciseCycle',
      width: 110,
      render: (value: string) => getExerciseCycleText(value),
    },
    {
      title: '班组',
      dataIndex: 'exerciseObjectStr',
      width: 90,
      render: (value: string) => getText(value),
    },
    {
      title: '值班人员',
      dataIndex: 'dutyUserList',
      width: 180,
      ellipsis: true,
      render: (value: DrillUser[] | null) => formatUsers(value),
    },
    {
      title: '计划时间',
      dataIndex: 'plannedExerciseTime',
      width: 160,
      render: (value: string) => getText(value),
    },
    {
      title: '实际时间',
      dataIndex: 'actualExerciseTime',
      width: 160,
      render: (value: string) => getText(value),
    },
    {
      title: '触发时间',
      dataIndex: 'triggerTime',
      width: 160,
      render: (value: string) => getText(value),
    },
    {
      title: '执行状态',
      dataIndex: 'executeStatus',
      width: 110,
      render: (value: string) => <StatusBadge value={getExecuteStatusText(value)} tone={value === 'NOT_EXECUTED' ? 'amber' : 'green'} />,
    },
    {
      title: '审批状态',
      dataIndex: 'approvalStatus',
      width: 110,
      render: (value: string) => <StatusBadge value={getApprovalStatusText(value)} tone={value === 'COMPLETED' ? 'green' : 'slate'} />,
    },
    {
      title: '演练状态',
      dataIndex: 'orderStatus',
      width: 120,
      render: (value: string | null) => <StatusBadge value={getOrderStatusText(value)} tone={getOrderStatusTone(value)} />,
    },
    {
      title: '评分',
      dataIndex: 'drillEvaluationScore',
      width: 100,
      render: (_value: string, record) => getText(getDrillEvaluationScore(record)),
    },
    {
      title: '评估事件',
      dataIndex: 'evaluationEventList',
      width: 240,
      ellipsis: true,
      render: (value: DrillEvaluationEvent[]) => formatEvaluationEvents(value),
    },
    {
      title: '评估状态',
      dataIndex: 'evaluationEventList',
      width: 120,
      render: (_value: DrillEvaluationEvent[], record) => {
        const event = getPrimaryEvaluationEvent(record);
        if (!event) return '--';
        return <StatusBadge value={getOrderStatusText(event?.orderStatus == null ? null : String(event.orderStatus))} tone={getOrderStatusTone(event?.orderStatus == null ? null : String(event.orderStatus))} />;
      },
    },
    {
      title: '事件等级',
      dataIndex: 'evaluationEventList',
      width: 100,
      render: (_value: DrillEvaluationEvent[], record) => getEvaluationLevelText(getPrimaryEvaluationEvent(record)),
    },
    {
      title: '响应/确认耗时',
      dataIndex: 'evaluationEventList',
      width: 160,
      render: (_value: DrillEvaluationEvent[], record) => {
        const event = getPrimaryEvaluationEvent(record);
        return event ? `${getText(event.responseTimeCost)} / ${getText(event.ackTimeCost)}` : '--';
      },
    },
    {
      title: '关联事件',
      dataIndex: 'relatedEventList',
      width: 220,
      ellipsis: true,
      render: (value: DrillRelatedEvent[]) => (
        Array.isArray(value) && value.length > 0
          ? value.map((event) => event.eventNumber || event.title).filter(Boolean).join('、')
          : '--'
      ),
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

  const dataSource: DrillTableRecord[] = (result?.records || []).map((item, index) => ({
    ...item,
    _index: index + 1,
    _rowKey: `${getRecordKey(item, index)}-${index}`,
  }));
  const resultDisplayCount = result ? (result.recordCount ?? result.records.length) : 0;
  const hasClientRecords = dataSource.length > 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div className="space-y-2">
        <h1 className="text-lg font-medium leading-normal text-slate-900">智航演练数据拉取</h1>
        <p className="text-sm leading-6 text-slate-500">
          固定读取应急演练计划列表接口，按分页自动汇总 records，并保留本次结果与拉取历史。
        </p>
      </div>

      <Card className="rounded-lg">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1.5">
              <CardTitle className="text-base font-medium leading-normal tracking-normal">接口拉取</CardTitle>
              <CardDescription className="text-sm">
                使用已登录浏览器页签请求演练系统，适配内网登录态与分页响应。
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
                  <Button variant="outline" className="gap-2" onClick={handleSyncFeishu} disabled={syncing || loading || !hasClientRecords}>
                    {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                    {syncing ? '同步中' : '同步飞书'}
                  </Button>
                  <Button variant="ghost" className="gap-2" onClick={handleReset}>
                    <Trash2 className="h-4 w-4" />
                    清空
                  </Button>
                </>
              )}
              <Button className="gap-2" onClick={handleFetchData} disabled={loading || syncing}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {loading ? '拉取中' : '获取数据'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
            <div className="text-xs text-slate-500">目标接口</div>
            <div className="mt-1 break-all font-mono text-xs leading-5 text-slate-700">{DRILL_LIST_URL}</div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map((card) => (
              <div key={card.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs text-slate-500">{card.label}</div>
                <div className="mt-1 text-lg font-medium tabular-nums text-slate-900">{card.value}</div>
                <div className="mt-1 text-xs text-slate-500">{card.hint}</div>
              </div>
            ))}
          </div>

          {progress && (
            <div className="flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-700">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
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
              <CardTitle className="text-base font-medium leading-normal tracking-normal">演练计划列表</CardTitle>
              <CardDescription className="text-sm">
                本次同步 {resultDisplayCount} 条，耗时 {formatDuration(result.durationMs)}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="gap-2 text-xs" onClick={handleFetchData} disabled={loading || syncing}>
              <RotateCcw className="h-3.5 w-3.5" />
              重新拉取
            </Button>
          </CardHeader>
          <CardContent>
            {showRawData ? (
              <div className="max-h-[520px] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
                <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-slate-700">
                  {JSON.stringify(result.rawPages.length > 0 ? result.rawPages : result, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="rounded-md border border-slate-200">
                <Table
                  columns={columns}
                  dataSource={dataSource}
                  rowKey={(record, index) => record._rowKey || `${getRecordKey(record, index || 0)}-${index || 0}`}
                  scroll={{ x: 3040, y: 520 }}
                  pagination={{ pageSize: DRILL_TABLE_PAGE_SIZE, showSizeChanger: false }}
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
