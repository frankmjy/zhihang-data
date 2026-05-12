import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { DrillExercisePlanRecord, SyncDrillRecordsResp } from '@shared/api.interface';
import { randomUUID } from 'node:crypto';

interface FeishuResponse<T = any> {
  code: number;
  msg: string;
  data?: T;
  tenant_access_token?: string;
  expire?: number;
}

interface FeishuField {
  field_id: string;
  field_name: string;
}

interface FeishuRecordItem {
  record_id?: string;
  id?: string;
}

const DEFAULT_DRILL_BITABLE_APP_TOKEN = '';
const DEFAULT_DRILL_TABLE_ID = '';
const DEFAULT_DRILL_VIEW_ID = '';

@Injectable()
export class DrillFeishuSyncService {
  private readonly logger = new Logger(DrillFeishuSyncService.name);
  private readonly baseUrl = process.env.DRILL_FEISHU_OPEN_BASE_URL || process.env.FEISHU_OPEN_BASE_URL || 'https://open.feishu.cn/open-apis';
  private readonly batchSize = 500;
  private readonly pageSize = 100;
  private readonly chatPageSize = 100;
  private tenantAccessToken: string | null = null;
  private tokenExpireAt = 0;

  constructor(private readonly httpService: HttpService) {}

  private get appId(): string {
    return process.env.DRILL_FEISHU_APP_ID || process.env.FEISHU_APP_ID || '';
  }

  private get appSecret(): string {
    return process.env.DRILL_FEISHU_APP_SECRET || process.env.FEISHU_APP_SECRET || '';
  }

  private get appToken(): string {
    return process.env.DRILL_FEISHU_BITABLE_APP_TOKEN || DEFAULT_DRILL_BITABLE_APP_TOKEN;
  }

  private get tableId(): string {
    return process.env.DRILL_FEISHU_TABLE_ID || DEFAULT_DRILL_TABLE_ID;
  }

  private get viewId(): string {
    return process.env.DRILL_FEISHU_VIEW_ID || DEFAULT_DRILL_VIEW_ID;
  }

  private get notifyChatId(): string {
    return process.env.DRILL_FEISHU_NOTIFY_CHAT_ID || process.env.FEISHU_NOTIFY_CHAT_ID || '';
  }

  private get notifyChatName(): string {
    return process.env.DRILL_FEISHU_NOTIFY_CHAT_NAME || process.env.FEISHU_NOTIFY_CHAT_NAME || '';
  }

  private assertConfig(): void {
    const missing = [
      ['DRILL_FEISHU_APP_ID or FEISHU_APP_ID', this.appId],
      ['DRILL_FEISHU_APP_SECRET or FEISHU_APP_SECRET', this.appSecret],
      ['DRILL_FEISHU_BITABLE_APP_TOKEN', this.appToken],
      ['DRILL_FEISHU_TABLE_ID', this.tableId],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missing.length > 0) {
      throw new Error(`演练飞书配置不完整，请在 .env 中补充：${missing.join(', ')}`);
    }
  }

  private async getTenantAccessToken(): Promise<string> {
    this.assertConfig();

    if (this.tenantAccessToken && Date.now() < this.tokenExpireAt) {
      return this.tenantAccessToken;
    }

    const response = await firstValueFrom(
      this.httpService.post<FeishuResponse>(
        `${this.baseUrl}/auth/v3/tenant_access_token/internal`,
        {
          app_id: this.appId,
          app_secret: this.appSecret,
        },
        {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
        },
      ),
    );

    if (response.data.code !== 0 || !response.data.tenant_access_token) {
      throw new Error(response.data.msg || '获取 tenant_access_token 失败');
    }

    this.tenantAccessToken = response.data.tenant_access_token;
    this.tokenExpireAt = Date.now() + Math.max((response.data.expire || 3600) - 300, 60) * 1000;
    return this.tenantAccessToken;
  }

  private async request<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST';
      body?: unknown;
      params?: Record<string, string | number | undefined>;
    } = {},
  ): Promise<FeishuResponse<T>> {
    const accessToken = await this.getTenantAccessToken();
    const response = await firstValueFrom(
      this.httpService.request<FeishuResponse<T>>({
        url: `${this.baseUrl}/${path}`,
        method: options.method || 'GET',
        data: options.body,
        params: options.params,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
      }),
    );

    return response.data;
  }

  private explainChatError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error || '发送飞书群消息失败');
    if (message.includes('未找到飞书群')) {
      return `${message}。请确认机器人已加入目标群，或在 .env 中配置 FEISHU_NOTIFY_CHAT_ID。`;
    }

    return message;
  }

  private async findChatIdByName(chatName?: string): Promise<string> {
    if (this.notifyChatId) {
      return this.notifyChatId;
    }

    const targetName = String(chatName || this.notifyChatName || '').trim();
    if (!targetName) {
      throw new Error('未配置飞书群通知目标，请在 .env 中填写 FEISHU_NOTIFY_CHAT_NAME 或 FEISHU_NOTIFY_CHAT_ID');
    }

    const normalizedTargetName = targetName.toLowerCase();
    let pageToken = '';
    const exactMatches: string[] = [];
    const partialMatches: string[] = [];

    do {
      const payload = await this.request<{ has_more?: boolean; page_token?: string; items?: Array<{ name?: string; chat_id?: string }> }>(
        'im/v1/chats',
        {
          params: {
            page_size: this.chatPageSize,
            page_token: pageToken || undefined,
          },
        },
      );

      if (payload.code !== 0) {
        throw new Error(payload.msg || '获取飞书群列表失败');
      }

      (payload.data?.items || []).forEach((item) => {
        const name = String(item?.name || '').trim();
        const chatId = item?.chat_id;
        if (!name || !chatId) {
          return;
        }

        const normalizedName = name.toLowerCase();
        if (normalizedName === normalizedTargetName) {
          exactMatches.push(chatId);
        } else if (normalizedName.includes(normalizedTargetName)) {
          partialMatches.push(chatId);
        }
      });

      pageToken = payload.data?.has_more ? payload.data.page_token || '' : '';
    } while (pageToken && exactMatches.length === 0);

    if (exactMatches.length > 0) {
      return exactMatches[0];
    }

    if (partialMatches.length > 0) {
      return partialMatches[0];
    }

    throw new Error(`未找到飞书群：${targetName}。请确认机器人已加入该群，并已开通群相关权限`);
  }

  private async sendTextMessageToChat(text: string, chatName?: string): Promise<void> {
    const chatId = await this.findChatIdByName(chatName);
    const payload = await this.request<{ message_id?: string }>(
      'im/v1/messages',
      {
        method: 'POST',
        params: {
          receive_id_type: 'chat_id',
        },
        body: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
          uuid: randomUUID(),
        },
      },
    );

    if (payload.code !== 0) {
      throw new Error(payload.msg || '发送飞书群消息失败');
    }
  }

  private async listFields(): Promise<Map<string, string>> {
    const fieldMap = new Map<string, string>();
    let pageToken = '';

    do {
      const payload = await this.request<{ has_more?: boolean; page_token?: string; items?: FeishuField[] }>(
        `bitable/v1/apps/${this.appToken}/tables/${this.tableId}/fields`,
        {
          params: {
            page_size: this.pageSize,
            page_token: pageToken || undefined,
          },
        },
      );

      if (payload.code !== 0) {
        throw new Error(payload.msg || '获取飞书字段失败');
      }

      (payload.data?.items || []).forEach((field) => {
        if (field.field_name && field.field_id) {
          fieldMap.set(field.field_name, field.field_id);
        }
      });

      pageToken = payload.data?.has_more ? payload.data.page_token || '' : '';
    } while (pageToken);

    return fieldMap;
  }

  private async createTextField(fieldName: string): Promise<void> {
    const payload = await this.request<{ field?: FeishuField }>(
      `bitable/v1/apps/${this.appToken}/tables/${this.tableId}/fields`,
      {
        method: 'POST',
        body: {
          field_name: fieldName,
          type: 1,
        },
      },
    );

    if (payload.code === 0 || payload.code === 99991663) {
      return;
    }

    throw new Error(payload.msg || `创建字段失败：${fieldName}`);
  }

  private async ensureFields(records: Array<Record<string, string>>): Promise<Map<string, string>> {
    let fieldMap = await this.listFields();
    const requiredFields = new Set<string>();
    records.forEach((record) => {
      Object.keys(record).forEach((fieldName) => requiredFields.add(fieldName));
    });

    for (const fieldName of requiredFields) {
      if (!fieldMap.has(fieldName)) {
        await this.createTextField(fieldName);
      }
    }

    fieldMap = await this.listFields();
    return fieldMap;
  }

  private async listAllRecordIds(): Promise<string[]> {
    const recordIds: string[] = [];
    let pageToken = '';

    do {
      const payload = await this.request<{
        has_more?: boolean;
        page_token?: string;
        items?: FeishuRecordItem[];
        records?: FeishuRecordItem[];
      }>(
        `bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records`,
        {
          params: {
            page_size: this.pageSize,
            page_token: pageToken || undefined,
            view_id: this.viewId || undefined,
          },
        },
      );

      if (payload.code !== 0) {
        throw new Error(payload.msg || '获取飞书记录失败');
      }

      const items = payload.data?.items || payload.data?.records || [];
      items.forEach((item) => {
        const recordId = item.record_id || item.id;
        if (recordId) {
          recordIds.push(recordId);
        }
      });

      pageToken = payload.data?.has_more ? payload.data.page_token || '' : '';
    } while (pageToken);

    return recordIds;
  }

  private async deleteAllRecords(): Promise<number> {
    const recordIds = await this.listAllRecordIds();
    let deletedCount = 0;

    for (let index = 0; index < recordIds.length; index += this.batchSize) {
      const batch = recordIds.slice(index, index + this.batchSize);
      const payload = await this.request<{ records?: FeishuRecordItem[] }>(
        `bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records/batch_delete`,
        {
          method: 'POST',
          body: {
            records: batch,
          },
        },
      );

      if (payload.code !== 0) {
        throw new Error(payload.msg || '清空飞书表格失败');
      }

      deletedCount += payload.data?.records?.length || batch.length;
    }

    return deletedCount;
  }

  private formatUsers(users: DrillExercisePlanRecord['dutyUserList']): string {
    if (!Array.isArray(users) || users.length === 0) {
      return '';
    }

    return users.map((user) => user.name || user.jobNumber).filter(Boolean).join('、');
  }

  private formatRelatedEvents(events: DrillExercisePlanRecord['relatedEventList']): string {
    if (!Array.isArray(events) || events.length === 0) {
      return '';
    }

    return events
      .map((event) => [event.eventNumber, event.title, event.orderStatus ? `状态${event.orderStatus}` : ''].filter(Boolean).join(' / '))
      .join('\n');
  }

  private readonly evaluationScoreFields = [
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

  private getFirstTextFromFields(source: Record<string, unknown> | null | undefined, fieldNames: string[]): string {
    if (!source) {
      return '';
    }

    for (const fieldName of fieldNames) {
      const text = String(source[fieldName] ?? '').trim();
      if (text) {
        return text;
      }
    }

    return '';
  }

  private getEvaluationEventScore(event?: Record<string, unknown> | null): string {
    return this.getFirstTextFromFields(event, this.evaluationScoreFields);
  }

  private getEvaluationScore(record: DrillExercisePlanRecord): string {
    const score = this.getFirstTextFromFields(record, this.evaluationScoreFields);
    if (score) {
      return score;
    }

    const events = Array.isArray(record.evaluationEventList) ? record.evaluationEventList : [];
    const eventWithScore = events.find((event) => this.getEvaluationEventScore(event));
    return this.getEvaluationEventScore(eventWithScore);
  }

  private getPrimaryEvaluationEvent(record: DrillExercisePlanRecord): Record<string, unknown> | null {
    const events = Array.isArray(record.evaluationEventList) ? record.evaluationEventList : [];
    return events.find((event) => this.getEvaluationEventScore(event)) || events[0] || null;
  }

  private formatEvaluationEvents(events: DrillExercisePlanRecord['evaluationEventList']): string {
    if (!Array.isArray(events) || events.length === 0) {
      return '';
    }

    return events
      .map((event) => [event.eventNumber, event.eventTitle || event.highestLevelTitle].filter(Boolean).join(' / '))
      .filter(Boolean)
      .join('\n');
  }

  private getEvaluationLevelText(event: Record<string, unknown> | null): string {
    return String(event?.eventCurrentLevelName || event?.eventHighestLevelName || event?.eventFirstLevelName || '');
  }

  private readonly buildingSummaryOrder = ['A楼', 'B楼', 'C楼', 'D楼', 'E楼'];

  private formatSyncTime(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  private formatCompletionRate(completed: number, total: number): string {
    if (!Number.isFinite(total) || total <= 0) {
      return '0.0%';
    }

    return `${((completed / total) * 100).toFixed(1)}%`;
  }

  private normalizeMonthIndex(value: unknown): number | null {
    const text = String(value || '').trim();
    if (!text) {
      return null;
    }

    const numericMonth = Number(text);
    if (Number.isInteger(numericMonth) && numericMonth >= 1 && numericMonth <= 12) {
      return numericMonth - 1;
    }

    const monthMap: Record<string, number> = {
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

  private parseRecordDate(value: unknown): Date | null {
    const text = String(value || '').trim();
    if (!text) {
      return null;
    }

    const date = new Date(text.replace(/-/g, '/'));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private getRecordYearMonth(record: DrillExercisePlanRecord): { year: number; monthIndex: number } | null {
    const year = Number(record.exerciseYear);
    const monthIndex = this.normalizeMonthIndex(record.exerciseMonth);
    if (Number.isInteger(year) && year > 1900 && monthIndex !== null) {
      return { year, monthIndex };
    }

    const dateCandidates = [
      record.plannedExerciseTime,
      record.plannedExerciseEndTime,
      record.actualExerciseTime,
      record.triggerTime,
      record.createTime,
    ];

    for (const value of dateCandidates) {
      const date = this.parseRecordDate(value);
      if (date) {
        return {
          year: date.getFullYear(),
          monthIndex: date.getMonth(),
        };
      }
    }

    return null;
  }

  private isCurrentMonthRecord(record: DrillExercisePlanRecord, now = new Date()): boolean {
    const yearMonth = this.getRecordYearMonth(record);
    return Boolean(yearMonth && yearMonth.year === now.getFullYear() && yearMonth.monthIndex === now.getMonth());
  }

  private isCompletedRecord(record: DrillExercisePlanRecord): boolean {
    const orderStatus = String(record.orderStatus ?? '').trim();
    return orderStatus === '11' || this.normalizeOrderStatus(orderStatus) === '完成';
  }

  private getBuildingLabels(record: DrillExercisePlanRecord): string[] {
    const labels = this.normalizeImplementationArea(record)
      .split(/[、,，;；\s]+/)
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .filter((item, index, array) => array.indexOf(item) === index);

    return labels.length > 0 ? labels : ['未识别楼栋'];
  }

  private createBuildingStats(): { total: number; completed: number; overdue: number } {
    return {
      total: 0,
      completed: 0,
      overdue: 0,
    };
  }

  private incrementCounter(counter: Map<string, number>, value: unknown): void {
    const key = String(value ?? '').trim();
    if (!key) {
      return;
    }

    counter.set(key, (counter.get(key) || 0) + 1);
  }

  private formatCounterSummary(counter: Map<string, number>): string {
    return Array.from(counter.entries())
      .sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }

        return left[0].localeCompare(right[0], 'zh-CN');
      })
      .map(([label, count]) => `${label} ${count}`)
      .join('，');
  }

  private formatBuildingProgressSummary(statsMap: Map<string, { total: number; completed: number; overdue: number }>): string {
    const sortOrder = new Map(this.buildingSummaryOrder.map((label, index) => [label, index]));
    const orderedLabels = [
      ...this.buildingSummaryOrder,
      ...Array.from(statsMap.keys())
        .filter((label) => !sortOrder.has(label))
        .sort((left, right) => left.localeCompare(right, 'zh-CN')),
    ];

    return orderedLabels
      .map((label) => {
        const stats = statsMap.get(label) || this.createBuildingStats();
        return `${label}：本月任务 ${stats.total}，完成 ${stats.completed}，完成率 ${this.formatCompletionRate(stats.completed, stats.total)}，逾期 ${stats.overdue}`;
      })
      .join('\n');
  }

  private buildDrillSyncSummary(records: DrillExercisePlanRecord[]): { notifyMessage: string } {
    const sourceRecords = Array.isArray(records) ? records : [];
    const monthlyRecords = sourceRecords.filter((record) => this.isCurrentMonthRecord(record));
    const buildingStatsMap = new Map(this.buildingSummaryOrder.map((label) => [label, this.createBuildingStats()]));
    const statusCounter = new Map<string, number>();
    const evaluationMatchedCount = sourceRecords.filter((record) => (
      Array.isArray(record.evaluationEventList) && record.evaluationEventList.length > 0
    )).length;

    monthlyRecords.forEach((record) => {
      this.incrementCounter(statusCounter, this.normalizeOrderStatus(record.orderStatus));
      this.getBuildingLabels(record).forEach((buildingLabel) => {
        const stats = buildingStatsMap.get(buildingLabel) || this.createBuildingStats();
        stats.total += 1;
        if (this.isCompletedRecord(record)) {
          stats.completed += 1;
        }
        if (record.overdue) {
          stats.overdue += 1;
        }
        buildingStatsMap.set(buildingLabel, stats);
      });
    });

    const buildingProgressSummary = this.formatBuildingProgressSummary(buildingStatsMap);
    const statusSummary = this.formatCounterSummary(statusCounter);

    return {
      notifyMessage: [
        '【演练推进同步】',
        `同步时间：${this.formatSyncTime()}`,
        `覆盖记录：${sourceRecords.length} 条`,
        `二次拉取：匹配评估事件 ${evaluationMatchedCount} 条`,
        `本月进展：\n${buildingProgressSummary}`,
        statusSummary ? `本月状态：${statusSummary}` : '',
      ].filter(Boolean).join('\n'),
    };
  }

  private normalizeCategory(value: unknown): string {
    const mapping: Record<string, string> = {
      plan: '计划演练',
      surpriseAttack: '突袭演练',
      surpriseAttackPlan: '突袭演练-计划性',
    };
    const key = String(value || '');
    return mapping[key] || key;
  }

  private normalizeExerciseType(value: unknown): string {
    const mapping: Record<string, string> = {
      run: '跑位演练',
    };
    const key = String(value || '').trim();
    return mapping[key] || key;
  }

  private normalizeExerciseCycle(value: unknown): string {
    const mapping: Record<string, string> = {
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

  private normalizeBuildingLetter(value: unknown): string {
    const normalized = String(value || '').trim().toUpperCase();
    const fullWidthMap: Record<string, string> = {
      Ａ: 'A',
      Ｂ: 'B',
      Ｃ: 'C',
      Ｄ: 'D',
      Ｅ: 'E',
    };
    return fullWidthMap[normalized] || normalized;
  }

  private getBuildingLabel(value: unknown): string {
    const letter = this.normalizeBuildingLetter(value);
    return /^[A-E]$/.test(letter) ? `${letter}楼` : '';
  }

  private collectImplementationAreaLabels(values: unknown[]): string[] {
    const labels: string[] = [];
    const seen = new Set<string>();
    const patterns = [
      /数据中心[\s_/-]*([A-EＡ-Ｅ])(?:楼|栋)?/i,
      /中心[\s_/-]*([A-EＡ-Ｅ])(?:楼|栋)?/i,
      /([A-EＡ-Ｅ])(?:楼|栋)/i,
      /[_/\s-]([A-EＡ-Ｅ])(?:$|[^\w])/i,
    ];

    const pushLabel = (label: string) => {
      if (label && !seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    };

    const scan = (value: unknown) => {
      if (value == null || value === '') {
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(scan);
        return;
      }

      const text = String(value);
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
          pushLabel(this.getBuildingLabel(match[1]));
          return;
        }
      }
    };

    values.forEach(scan);
    return labels;
  }

  private normalizeImplementationArea(record: DrillExercisePlanRecord): string {
    const source = record as DrillExercisePlanRecord & {
      exerciseObjectList?: Array<{ datacenterName?: string; datacenterCode?: string }> | null;
    };
    const values: unknown[] = [source.implementationAreaStr, source.implementationArea];
    if (Array.isArray(source.exerciseObjectList)) {
      source.exerciseObjectList.forEach((exerciseObject) => {
        values.push(exerciseObject?.datacenterName, exerciseObject?.datacenterCode);
      });
    }

    const labels = this.collectImplementationAreaLabels(values);
    if (labels.length > 0) {
      return labels.join('、');
    }

    const rawArea = Array.isArray(source.implementationArea) ? source.implementationArea.join('、') : '';
    return String(source.implementationAreaStr || rawArea || '');
  }

  private normalizeExecuteStatus(value: unknown): string {
    const mapping: Record<string, string> = {
      NOT_EXECUTED: '未执行',
      EXECUTING: '执行中',
      EXECUTED: '已执行',
      COMPLETED: '已完成',
    };
    const key = String(value || '');
    return mapping[key] || key;
  }

  private normalizeApprovalStatus(value: unknown): string {
    const mapping: Record<string, string> = {
      NOAPPROVAL: '未审批',
      APPROVING: '审批中',
      COMPLETED: '审批完成',
      REJECTED: '已驳回',
    };
    const key = String(value || '');
    return mapping[key] || key;
  }

  private normalizeOrderStatus(value: unknown): string {
    const mapping: Record<string, string> = {
      '5': '待评估',
      '11': '完成',
      '12': '评估待审批',
      '13': '终止',
    };
    const key = String(value ?? '').trim();
    return key ? (mapping[key] || key) : '待演练';
  }

  private mapDrillRecord(record: DrillExercisePlanRecord): Record<string, string> {
    const primaryEvaluationEvent = this.getPrimaryEvaluationEvent(record);
    return {
      计划ID: String(record.id || ''),
      计划编号: String(record.operationPlanNumber || ''),
      演练场景: String(record.exerciseScenarioName || ''),
      专业: String(record.exerciseMajor || ''),
      演练类别: this.normalizeCategory(record.exerciseCategory),
      演练类型: this.normalizeExerciseType(record.exerciseType),
      实施区域: this.normalizeImplementationArea(record),
      演练周期: this.normalizeExerciseCycle(record.exerciseCycle),
      演练月份: String(record.exerciseMonth || ''),
      演练年份: record.exerciseYear == null ? '' : String(record.exerciseYear),
      审批状态: this.normalizeApprovalStatus(record.approvalStatus),
      执行状态: this.normalizeExecuteStatus(record.executeStatus),
      演练状态: this.normalizeOrderStatus(record.orderStatus),
      计划演练时间: String(record.plannedExerciseTime || ''),
      计划结束时间: String(record.plannedExerciseEndTime || ''),
      实际演练时间: String(record.actualExerciseTime || ''),
      触发时间: String(record.triggerTime || ''),
      触发人: String(record.triggerBy || ''),
      创建时间: String(record.createTime || ''),
      创建人: String(record.createBy || ''),
      班组: String(record.exerciseObjectStr || ''),
      值班人员: this.formatUsers(record.dutyUserList),
      负责人: this.formatUsers(record.responsibleUserList),
      评估人: this.formatUsers(record.evaluationUserList),
      EOP流程: String(record.eopFlowStr || ''),
      关联事件: this.formatRelatedEvents(record.relatedEventList),
      演练评分: this.getEvaluationScore(record),
      评估事件: this.formatEvaluationEvents(record.evaluationEventList),
      评估事件状态: primaryEvaluationEvent?.orderStatus == null ? '' : this.normalizeOrderStatus(primaryEvaluationEvent.orderStatus),
      评估事件等级: this.getEvaluationLevelText(primaryEvaluationEvent),
      响应耗时: String(primaryEvaluationEvent?.responseTimeCost || ''),
      确认耗时: String(primaryEvaluationEvent?.ackTimeCost || ''),
      恢复时间: String(primaryEvaluationEvent?.incidentRecoveryTime || ''),
      是否逾期: record.overdue ? '是' : '否',
      是否展示EOP: record.showEop ? '是' : '否',
    };
  }

  private async syncRecords(records: Array<Record<string, string>>): Promise<{ success: number; failed: number }> {
    const normalizedRecords = records.filter((record) => record && Object.keys(record).length > 0);
    if (normalizedRecords.length === 0) {
      return { success: 0, failed: 0 };
    }

    const fieldMap = await this.ensureFields(normalizedRecords);
    let success = 0;
    let failed = 0;

    for (let index = 0; index < normalizedRecords.length; index += this.batchSize) {
      const batch = normalizedRecords.slice(index, index + this.batchSize).map((record) => ({
        fields: Object.fromEntries(
          Object.entries(record).filter(([fieldName]) => fieldMap.has(fieldName)),
        ),
      }));

      try {
        const payload = await this.request<{ records?: FeishuRecordItem[] }>(
          `bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records/batch_create`,
          {
            method: 'POST',
            body: {
              records: batch,
            },
          },
        );

        if (payload.code !== 0) {
          failed += batch.length;
          this.logger.warn(`演练飞书批次写入失败：${payload.msg}`);
          continue;
        }

        success += payload.data?.records?.length || batch.length;
      } catch (error) {
        failed += batch.length;
        this.logger.warn(`演练飞书批次写入异常：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { success, failed };
  }

  async syncDrillRecords(records: DrillExercisePlanRecord[]): Promise<SyncDrillRecordsResp> {
    const sourceRecords = Array.isArray(records) ? records : [];
    if (sourceRecords.length === 0) {
      return {
        success: 0,
        failed: 0,
        total: 0,
        insertedCount: 0,
        deletedCount: 0,
        notified: false,
        message: '没有可同步的演练数据',
      };
    }

    const summary = this.buildDrillSyncSummary(sourceRecords);
    const deletedCount = await this.deleteAllRecords();
    const syncResult = await this.syncRecords(sourceRecords.map((record) => this.mapDrillRecord(record)));
    let message = syncResult.success > 0
      ? `已清空旧数据并同步 ${syncResult.success} 条演练计划到飞书多维表`
      : '已清空旧数据，但写入飞书多维表失败';
    let notified = false;

    if (syncResult.success > 0) {
      try {
        await this.sendTextMessageToChat(summary.notifyMessage);
        notified = true;
        message = `${message}，群通知已发送`;
      } catch (error) {
        message = `${message}，但群通知发送失败：${this.explainChatError(error)}`;
      }
    }

    return {
      success: syncResult.success,
      failed: syncResult.failed,
      total: sourceRecords.length,
      insertedCount: syncResult.success,
      deletedCount,
      notified,
      message,
    };
  }
}
