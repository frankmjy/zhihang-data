import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { FeishuConnectivityResponseDTO } from '@shared/api.interface';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'node:crypto';

export interface FeishuRecord {
  fields: Record<string, string>;
}

export interface FeishuSyncResult {
  success: boolean;
  insertedCount: number;
  deletedCount: number;
  notified: boolean;
  message?: string;
}

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

interface FeishuSyncMessageOptions {
  notify?: boolean;
  chatName?: string;
  notifyMessage?: string;
  successMessage?: string;
}

const RISK_FIELD_BUILDING = '\u697c\u680b';
const RISK_FIELD_LEVEL = '\u98ce\u9669\u7b49\u7ea7';
const RISK_FIELD_CHECK_STATUS = '\u6392\u67e5\u72b6\u6001';
const RISK_FIELD_CHECK_TIME = '\u6392\u67e5\u65f6\u95f4';
const RISK_FIELD_AUDIT_TIME = '\u5ba1\u6838\u65f6\u95f4';
const RISK_FIELD_CURRENT_STATUS = '\u5f53\u524d\u98ce\u9669\u72b6\u6001';
const RISK_BUILDING_SUMMARY_ORDER = ['A\u697c', 'B\u697c', 'C\u697c', 'D\u697c', 'E\u697c'];

@Injectable()
export class FeishuSyncService {
  private readonly logger = new Logger(FeishuSyncService.name);
  private readonly baseUrl = process.env.FEISHU_OPEN_BASE_URL || 'https://open.feishu.cn/open-apis';
  private readonly batchSize = 500;
  private readonly recordPageSize = 100;
  private readonly chatPageSize = 100;

  private tenantAccessToken: string | null = null;
  private tokenExpireAt = 0;

  constructor(private readonly httpService: HttpService) {}

  private get appId(): string {
    return process.env.FEISHU_APP_ID || '';
  }

  private get appSecret(): string {
    return process.env.FEISHU_APP_SECRET || '';
  }

  private get appToken(): string {
    return process.env.FEISHU_BITABLE_APP_TOKEN || '';
  }

  private get tableId(): string {
    return process.env.FEISHU_BITABLE_TABLE_ID || '';
  }

  private get notifyChatId(): string {
    return process.env.FEISHU_NOTIFY_CHAT_ID || '';
  }

  private get notifyChatName(): string {
    return process.env.FEISHU_NOTIFY_CHAT_NAME || '';
  }

  private assertCoreConfig(): void {
    const missing = [
      ['FEISHU_APP_ID', this.appId],
      ['FEISHU_APP_SECRET', this.appSecret],
      ['FEISHU_BITABLE_APP_TOKEN', this.appToken],
      ['FEISHU_BITABLE_TABLE_ID', this.tableId],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missing.length > 0) {
      throw new Error(`Feishu 配置不完整，请在 .env 中补充：${missing.join(', ')}`);
    }
  }

  private assertNotifyConfig(chatName?: string): void {
    if (this.notifyChatId || chatName || this.notifyChatName) {
      return;
    }

    throw new Error('未配置飞书群通知目标，请在 .env 中填写 FEISHU_NOTIFY_CHAT_NAME 或 FEISHU_NOTIFY_CHAT_ID');
  }

  private async getTenantAccessToken(): Promise<string> {
    this.assertCoreConfig();

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

    const payload = response.data;
    if (payload.code !== 0 || !payload.tenant_access_token) {
      throw new Error(payload.msg || '获取 tenant_access_token 失败');
    }

    this.tenantAccessToken = payload.tenant_access_token;
    this.tokenExpireAt = Date.now() + Math.max((payload.expire || 3600) - 300, 60) * 1000;
    return this.tenantAccessToken;
  }

  private async request<T = any>(
    path: string,
    options: {
      method?: 'GET' | 'POST';
      body?: unknown;
      params?: Record<string, string | number | undefined>;
    } = {},
  ): Promise<FeishuResponse<T>> {
    const token = await this.getTenantAccessToken();
    const method = options.method || 'GET';

    const response = await firstValueFrom(
      this.httpService.request<FeishuResponse<T>>({
        url: `${this.baseUrl}/${path}`,
        method,
        data: options.body,
        params: options.params,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
      }),
    );

    return response.data;
  }

  private normalizeRecords(records: FeishuRecord[]): FeishuRecord[] {
    if (!Array.isArray(records)) {
      return [];
    }

    return records
      .filter((record) => record && typeof record === 'object' && record.fields)
      .map((record) => ({
        fields: Object.fromEntries(
          Object.entries(record.fields).map(([fieldName, value]) => [fieldName, value == null ? '' : String(value)]),
        ),
      }))
      .filter((record) => Object.keys(record.fields).length > 0);
  }

  private async listTableFields(): Promise<Map<string, string>> {
    const fieldMap = new Map<string, string>();
    let pageToken = '';

    do {
      const payload = await this.request<{ has_more?: boolean; page_token?: string; items?: FeishuField[] }>(
        `bitable/v1/apps/${this.appToken}/tables/${this.tableId}/fields`,
        {
          params: {
            page_size: this.recordPageSize,
            page_token: pageToken || undefined,
          },
        },
      );

      if (payload.code !== 0) {
        throw new Error(payload.msg || '获取多维表字段失败');
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

  private async ensureFields(records: FeishuRecord[]): Promise<Map<string, string>> {
    const requiredFieldNames = new Set<string>();
    records.forEach((record) => {
      Object.keys(record.fields || {}).forEach((fieldName) => requiredFieldNames.add(fieldName));
    });

    let fieldMap = await this.listTableFields();
    for (const fieldName of requiredFieldNames) {
      if (!fieldMap.has(fieldName)) {
        await this.createTextField(fieldName);
      }
    }

    fieldMap = await this.listTableFields();
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
            page_size: this.recordPageSize,
            page_token: pageToken || undefined,
          },
        },
      );

      if (payload.code !== 0) {
        throw new Error(payload.msg || '获取多维表记录失败');
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

  async deleteAllRecords(): Promise<{ success: boolean; deletedCount: number; message?: string }> {
    const recordIds = await this.listAllRecordIds();
    if (recordIds.length === 0) {
      return {
        success: true,
        deletedCount: 0,
        message: '飞书多维表中没有需要清空的数据',
      };
    }

    const batches: string[][] = [];
    for (let index = 0; index < recordIds.length; index += this.batchSize) {
      batches.push(recordIds.slice(index, index + this.batchSize));
    }

    let deletedCount = 0;
    let failedBatches = 0;

    for (const batch of batches) {
      try {
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
          failedBatches += 1;
          continue;
        }

        deletedCount += payload.data?.records?.length || batch.length;
      } catch (error) {
        failedBatches += 1;
        this.logger.warn(`删除飞书批次失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (failedBatches > 0 && deletedCount === 0) {
      return {
        success: false,
        deletedCount: 0,
        message: '清空飞书多维表失败',
      };
    }

    if (failedBatches > 0) {
      return {
        success: false,
        deletedCount,
        message: `已清空 ${deletedCount} 条旧数据，但有 ${failedBatches} 个批次失败`,
      };
    }

    return {
      success: true,
      deletedCount,
      message: `已清空 ${deletedCount} 条旧数据`,
    };
  }

  async syncRecords(records: FeishuRecord[]): Promise<{ success: boolean; insertedCount: number; message?: string }> {
    const normalizedRecords = this.normalizeRecords(records);
    if (normalizedRecords.length === 0) {
      return {
        success: false,
        insertedCount: 0,
        message: '没有可同步的数据',
      };
    }

    const fieldMap = await this.ensureFields(normalizedRecords);
    const recordsForApi = normalizedRecords.map((record) => ({
      fields: Object.fromEntries(
        Object.entries(record.fields).filter(([fieldName]) => fieldMap.has(fieldName)),
      ),
    }));

    const batches: Array<typeof recordsForApi> = [];
    for (let index = 0; index < recordsForApi.length; index += this.batchSize) {
      batches.push(recordsForApi.slice(index, index + this.batchSize));
    }

    let insertedCount = 0;
    let failedBatches = 0;

    for (const batch of batches) {
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
          failedBatches += 1;
          continue;
        }

        insertedCount += payload.data?.records?.length || batch.length;
      } catch (error) {
        failedBatches += 1;
        this.logger.warn(`同步飞书批次失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (failedBatches > 0 && insertedCount === 0) {
      return {
        success: false,
        insertedCount: 0,
        message: '写入飞书多维表失败',
      };
    }

    if (failedBatches > 0) {
      return {
        success: false,
        insertedCount,
        message: `已写入 ${insertedCount} 条记录，但有 ${failedBatches} 个批次失败`,
      };
    }

    return {
      success: true,
      insertedCount,
      message: `成功同步 ${insertedCount} 条记录到飞书多维表`,
    };
  }

  private formatRiskSyncTime(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  private incrementCounter(counter: Map<string, number>, rawValue: unknown): void {
    const key = String(rawValue || '').trim();
    if (!key) {
      return;
    }

    counter.set(key, (counter.get(key) || 0) + 1);
  }

  private formatCounterSummary(counter: Map<string, number>, limit = 0): string {
    const entries = Array.from(counter.entries())
      .sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }

        return left[0].localeCompare(right[0], 'zh-CN');
      });
    const maxItems = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : entries.length;

    return entries
      .slice(0, maxItems)
      .map(([label, count]) => `${label} ${count}`)
      .join('、');
  }

  private normalizeRiskBuildingLabel(rawValue: unknown): string {
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

  private isFilledRiskSummaryValue(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    const text = String(value).trim();
    return text !== '' && text !== 'null' && text !== 'undefined' && text !== '-';
  }

  private formatCompletionRate(completed: number, total: number): string {
    if (!Number.isFinite(total) || total <= 0) {
      return '0.0%';
    }

    return `${((completed / total) * 100).toFixed(1)}%`;
  }

  private formatBuildingProgressSummary(
    statsMap: Map<string, { total: number; checkCompleted: number; auditCompleted: number }>,
  ): string {
    const orderMap = new Map(RISK_BUILDING_SUMMARY_ORDER.map((label, index) => [label, index]));

    return Array.from(statsMap.entries())
      .sort((left, right) => {
        const leftOrder = orderMap.has(left[0]) ? orderMap.get(left[0])! : Number.MAX_SAFE_INTEGER;
        const rightOrder = orderMap.has(right[0]) ? orderMap.get(right[0])! : Number.MAX_SAFE_INTEGER;

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        return left[0].localeCompare(right[0], 'zh-CN');
      })
      .map(([label, stats]) => (
        `${label}：共计 ${stats.total} 条，排查完成率 ${this.formatCompletionRate(stats.checkCompleted, stats.total)}，审核完成率 ${this.formatCompletionRate(stats.auditCompleted, stats.total)}`
      ))
      .join('\n');
  }

  private buildRiskSyncSummary(records: FeishuRecord[]): {
    notifyMessage: string;
    buildingProgressSummary: string;
    levelSummary: string;
    checkStatusSummary: string;
    currentStatusSummary: string;
  } {
    const levelCounter = new Map<string, number>();
    const checkStatusCounter = new Map<string, number>();
    const currentStatusCounter = new Map<string, number>();
    const buildingStatsMap = new Map<string, { total: number; checkCompleted: number; auditCompleted: number }>();

    records.forEach((record) => {
      const fields = record.fields || {};
      const buildingLabel = this.normalizeRiskBuildingLabel(fields[RISK_FIELD_BUILDING]) || '未识别楼栋';
      this.incrementCounter(levelCounter, fields[RISK_FIELD_LEVEL]);
      this.incrementCounter(checkStatusCounter, fields[RISK_FIELD_CHECK_STATUS]);
      this.incrementCounter(currentStatusCounter, fields[RISK_FIELD_CURRENT_STATUS]);

      const stats = buildingStatsMap.get(buildingLabel) || {
        total: 0,
        checkCompleted: 0,
        auditCompleted: 0,
      };
      stats.total += 1;
      if (this.isFilledRiskSummaryValue(fields[RISK_FIELD_CHECK_TIME])) {
        stats.checkCompleted += 1;
      }
      if (this.isFilledRiskSummaryValue(fields[RISK_FIELD_AUDIT_TIME])) {
        stats.auditCompleted += 1;
      }
      buildingStatsMap.set(buildingLabel, stats);
    });

    const buildingProgressSummary = this.formatBuildingProgressSummary(buildingStatsMap);
    const levelSummary = this.formatCounterSummary(levelCounter);
    const checkStatusSummary = this.formatCounterSummary(checkStatusCounter);
    const currentStatusSummary = this.formatCounterSummary(currentStatusCounter);

    return {
      notifyMessage: [
        '【风险排查同步】',
        `同步时间：${this.formatRiskSyncTime()}`,
        `覆盖记录：${records.length} 条`,
        buildingProgressSummary ? `楼栋进度：\n${buildingProgressSummary}` : '',
        levelSummary ? `风险等级：${levelSummary}` : '',
        checkStatusSummary ? `排查状态：${checkStatusSummary}` : '',
        currentStatusSummary ? `当前风险：${currentStatusSummary}` : '',
      ].filter(Boolean).join('\n'),
      buildingProgressSummary,
      levelSummary,
      checkStatusSummary,
      currentStatusSummary,
    };
  }

  private async findChatIdByName(chatName?: string): Promise<string> {
    if (this.notifyChatId) {
      return this.notifyChatId;
    }

    const targetName = (chatName || this.notifyChatName || '').trim();
    this.assertNotifyConfig(targetName);

    const normalizedTargetName = targetName.toLowerCase();
    let pageToken = '';
    const exactMatches: string[] = [];
    const partialMatches: string[] = [];

    do {
      const payload = await this.request<{ has_more?: boolean; page_token?: string; items?: Array<{ chat_id: string; name: string }> }>(
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
        const name = String(item.name || '').trim();
        const chatId = String(item.chat_id || '').trim();
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

  async sendSuccessMessage(insertedCount: number, chatName?: string, notifyMessage?: string): Promise<void> {
    const chatId = await this.findChatIdByName(chatName);
    const payload = await this.request<{ message_id?: string }>('im/v1/messages', {
      method: 'POST',
      params: {
        receive_id_type: 'chat_id',
      },
      body: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({
          text: notifyMessage || `${insertedCount}条成功同步`,
        }),
        uuid: randomUUID(),
      },
    });

    if (payload.code !== 0) {
      throw new Error(payload.msg || '发送飞书群消息失败');
    }
  }

  async testConnectivity(sendTestMessage = true): Promise<FeishuConnectivityResponseDTO> {
    const checkedAt = new Date().toISOString();
    const result: FeishuConnectivityResponseDTO = {
      success: false,
      checkedAt,
      tenantName: '',
      appName: '',
      chatId: this.notifyChatId,
      chatName: '',
      tableId: this.tableId,
      tableRecordCount: 0,
      tenant: {
        ok: false,
        message: '',
      },
      bitable: {
        ok: false,
        message: '',
      },
      chat: {
        ok: false,
        message: '',
      },
      messageStatus: {
        ok: false,
        message: '',
      },
      messageId: '',
    };

    try {
      const tenantPayload = await this.request<{ tenant?: { name?: string } }>('tenant/v2/tenant/query');
      result.tenantName = tenantPayload.data?.tenant?.name || '';
      result.tenant = {
        ok: true,
        message: result.tenantName ? `当前租户：${result.tenantName}` : '租户查询成功',
      };
    } catch (error) {
      result.tenant = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      const botPayload = await this.request<{ bot?: { app_name?: string } }>('bot/v3/info');
      result.appName = botPayload.data?.bot?.app_name || '';
      if (result.tenant.ok && result.appName) {
        result.tenant.message = `${result.tenant.message}，应用：${result.appName}`;
      }
    } catch (error) {
      if (result.tenant.ok) {
        result.tenant.message = `${result.tenant.message}，但应用信息读取失败：${error instanceof Error ? error.message : String(error)}`;
      }
    }

    try {
      const chatId = this.notifyChatId || await this.findChatIdByName();
      const chatPayload = await this.request<{ name?: string }>(`im/v1/chats/${chatId}`);
      result.chatId = chatId;
      result.chatName = chatPayload.data?.name || '';
      result.chat = {
        ok: true,
        message: result.chatName ? `群会话可访问：${result.chatName}` : '群会话可访问',
      };
    } catch (error) {
      result.chat = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      const bitablePayload = await this.request<{ total?: number }>(
        `bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records`,
        {
          params: {
            page_size: 1,
            view_id: process.env.FEISHU_BITABLE_VIEW_ID || undefined,
          },
        },
      );

      result.tableRecordCount = Number(bitablePayload.data?.total || 0);
      result.bitable = {
        ok: true,
        message: `多维表可访问，当前共 ${result.tableRecordCount} 条记录`,
      };
    } catch (error) {
      result.bitable = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (sendTestMessage) {
      try {
        const chatId = result.chatId || this.notifyChatId || await this.findChatIdByName();
        const payload = await this.request<{ message_id?: string }>('im/v1/messages', {
          method: 'POST',
          params: {
            receive_id_type: 'chat_id',
          },
          body: {
            receive_id: chatId,
            msg_type: 'text',
            content: JSON.stringify({
              text: `【飞书连通性测试】${result.appName || '飞书应用'} 于 ${checkedAt} 验证群消息链路正常`,
            }),
            uuid: randomUUID(),
          },
        });

        if (payload.code !== 0) {
          throw new Error(payload.msg || '发送测试消息失败');
        }

        result.messageId = payload.data?.message_id || '';
        result.messageStatus = {
          ok: true,
          message: result.messageId
            ? `测试消息发送成功，messageId：${result.messageId}`
            : '测试消息发送成功',
        };
      } catch (error) {
        result.messageStatus = {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      result.messageStatus = {
        ok: result.chat.ok,
        message: result.chat.ok ? '未发送测试消息' : '群会话不可用，已跳过消息测试',
      };
    }

    result.success = result.tenant.ok && result.bitable.ok && result.chat.ok && result.messageStatus.ok;
    return result;
  }

  async replaceTableRecords(records: FeishuRecord[], options?: FeishuSyncMessageOptions): Promise<FeishuSyncResult> {
    const normalizedRecords = this.normalizeRecords(records);
    if (normalizedRecords.length === 0) {
      return {
        success: false,
        insertedCount: 0,
        deletedCount: 0,
        notified: false,
        message: '没有可同步的数据',
      };
    }

    const deleteResult = await this.deleteAllRecords();
    if (!deleteResult.success && deleteResult.deletedCount === 0) {
      return {
        success: false,
        insertedCount: 0,
        deletedCount: deleteResult.deletedCount,
        notified: false,
        message: deleteResult.message,
      };
    }

    const syncResult = await this.syncRecords(normalizedRecords);
    if (!syncResult.success && syncResult.insertedCount === 0) {
      return {
        success: false,
        insertedCount: 0,
        deletedCount: deleteResult.deletedCount,
        notified: false,
        message: syncResult.message,
      };
    }

    const summary = this.buildRiskSyncSummary(normalizedRecords);
    const successMessage = options?.successMessage || [
      `已清空旧数据并覆盖同步 ${syncResult.insertedCount} 条风险排查记录到飞书多维表`,
      summary.buildingProgressSummary ? `楼栋进度：${summary.buildingProgressSummary.replace(/\n/g, '；')}` : '',
      summary.levelSummary ? `等级：${summary.levelSummary}` : '',
      summary.checkStatusSummary ? `排查：${summary.checkStatusSummary}` : '',
      summary.currentStatusSummary ? `当前风险：${summary.currentStatusSummary}` : '',
    ].filter(Boolean).join('；');
    const notifyMessage = options?.notifyMessage || summary.notifyMessage;

    if (options?.notify === false) {
      return {
        success: syncResult.success,
        insertedCount: syncResult.insertedCount,
        deletedCount: deleteResult.deletedCount,
        notified: false,
        message: successMessage,
      };
    }

    try {
      await this.sendSuccessMessage(syncResult.insertedCount, options?.chatName, notifyMessage);
      return {
        success: syncResult.success,
        insertedCount: syncResult.insertedCount,
        deletedCount: deleteResult.deletedCount,
        notified: true,
        message: `${successMessage}，群通知已发送`,
      };
    } catch (error) {
      return {
        success: false,
        insertedCount: syncResult.insertedCount,
        deletedCount: deleteResult.deletedCount,
        notified: false,
        message: `${successMessage}，但群通知发送失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
