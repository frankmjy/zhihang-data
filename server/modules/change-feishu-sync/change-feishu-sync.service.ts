import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'node:crypto';
import type { BasicDataItem, WorkOrder } from '@shared/api.interface';

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

type ChangeTable = 'workOrders' | 'basicData';

const DEFAULT_CHANGE_BITABLE_APP_TOKEN = '';
const DEFAULT_CHANGE_TABLE_ID = '';
interface ChangeSyncResult {
  success: number;
  failed: number;
  insertedCount: number;
  deletedCount: number;
  notified: boolean;
  message?: string;
}

interface ChangeSyncMessageContext {
  insertedCount: number;
  deletedCount: number;
  syncSuccess: boolean;
}

interface ChangeSyncMessageOptions {
  notifyMessage?: string;
  successMessage?: (context: ChangeSyncMessageContext) => string;
}

const CHANGE_NODE_WITHOUT_DETAILS = '区域经理关闭';

@Injectable()
export class ChangeFeishuSyncService {
  private readonly logger = new Logger(ChangeFeishuSyncService.name);
  private readonly baseUrl = process.env.CHANGE_FEISHU_OPEN_BASE_URL || process.env.FEISHU_OPEN_BASE_URL || 'https://open.feishu.cn/open-apis';
  private readonly batchSize = 500;
  private readonly pageSize = 100;
  private readonly chatPageSize = 100;
  private tenantAccessToken: string | null = null;
  private tokenExpireAt = 0;

  constructor(private readonly httpService: HttpService) {}

  private get appId(): string {
    return process.env.CHANGE_FEISHU_APP_ID || process.env.FEISHU_APP_ID || '';
  }

  private get appSecret(): string {
    return process.env.CHANGE_FEISHU_APP_SECRET || process.env.FEISHU_APP_SECRET || '';
  }

  private get appToken(): string {
    return process.env.CHANGE_FEISHU_BITABLE_APP_TOKEN || DEFAULT_CHANGE_BITABLE_APP_TOKEN;
  }

  private get notifyChatId(): string {
    return process.env.CHANGE_FEISHU_NOTIFY_CHAT_ID || process.env.FEISHU_NOTIFY_CHAT_ID || '';
  }

  private get notifyChatName(): string {
    return process.env.CHANGE_FEISHU_NOTIFY_CHAT_NAME || process.env.FEISHU_NOTIFY_CHAT_NAME || '';
  }

  private getTableId(table: ChangeTable): string {
    return table === 'workOrders'
      ? process.env.CHANGE_FEISHU_WORKORDER_TABLE_ID || process.env.CHANGE_FEISHU_BASIC_DATA_TABLE_ID || DEFAULT_CHANGE_TABLE_ID
      : process.env.CHANGE_FEISHU_BASIC_DATA_TABLE_ID || DEFAULT_CHANGE_TABLE_ID;
  }

  private assertConfig(table: ChangeTable): void {
    const tableIdKey = table === 'workOrders'
      ? 'CHANGE_FEISHU_WORKORDER_TABLE_ID'
      : 'CHANGE_FEISHU_BASIC_DATA_TABLE_ID';
    const missing = [
      ['CHANGE_FEISHU_APP_ID or FEISHU_APP_ID', this.appId],
      ['CHANGE_FEISHU_APP_SECRET or FEISHU_APP_SECRET', this.appSecret],
      ['CHANGE_FEISHU_BITABLE_APP_TOKEN', this.appToken],
      [tableIdKey, this.getTableId(table)],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missing.length > 0) {
      throw new Error(`变更工单飞书配置不完整，请在 .env 中补充：${missing.join(', ')}`);
    }
  }

  private assertNotifyConfig(chatName?: string): void {
    if (this.notifyChatId || chatName || this.notifyChatName) {
      return;
    }

    throw new Error('未配置飞书群通知目标，请在 .env 中填写 FEISHU_NOTIFY_CHAT_NAME 或 FEISHU_NOTIFY_CHAT_ID');
  }

  private async getTenantAccessToken(table: ChangeTable): Promise<string> {
    this.assertConfig(table);

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
    table: ChangeTable,
    path: string,
    options: {
      method?: 'GET' | 'POST';
      body?: unknown;
      params?: Record<string, string | number | undefined>;
    } = {},
  ): Promise<FeishuResponse<T>> {
    const accessToken = await this.getTenantAccessToken(table);
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

  private async listFields(table: ChangeTable): Promise<Map<string, string>> {
    const tableId = this.getTableId(table);
    const fieldMap = new Map<string, string>();
    let pageToken = '';

    do {
      const payload = await this.request<{ has_more?: boolean; page_token?: string; items?: FeishuField[] }>(
        table,
        `bitable/v1/apps/${this.appToken}/tables/${tableId}/fields`,
        {
          params: {
            page_size: this.pageSize,
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

  private async createTextField(table: ChangeTable, fieldName: string): Promise<void> {
    const tableId = this.getTableId(table);
    const payload = await this.request<{ field?: FeishuField }>(
      table,
      `bitable/v1/apps/${this.appToken}/tables/${tableId}/fields`,
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

  private async ensureFields(table: ChangeTable, records: Array<Record<string, string>>): Promise<Map<string, string>> {
    let fieldMap = await this.listFields(table);
    const requiredFields = new Set<string>();
    records.forEach((record) => {
      Object.keys(record).forEach((fieldName) => requiredFields.add(fieldName));
    });

    for (const fieldName of requiredFields) {
      if (!fieldMap.has(fieldName)) {
        await this.createTextField(table, fieldName);
      }
    }

    fieldMap = await this.listFields(table);
    return fieldMap;
  }

  private async listAllRecordIds(table: ChangeTable): Promise<string[]> {
    const tableId = this.getTableId(table);
    const recordIds: string[] = [];
    let pageToken = '';

    do {
      const payload = await this.request<{
        has_more?: boolean;
        page_token?: string;
        items?: FeishuRecordItem[];
        records?: FeishuRecordItem[];
      }>(
        table,
        `bitable/v1/apps/${this.appToken}/tables/${tableId}/records`,
        {
          params: {
            page_size: this.pageSize,
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

  private async deleteAllRecords(table: ChangeTable): Promise<{ deletedCount: number }> {
    const tableId = this.getTableId(table);
    const recordIds = await this.listAllRecordIds(table);
    let deletedCount = 0;

    for (let index = 0; index < recordIds.length; index += this.batchSize) {
      const batch = recordIds.slice(index, index + this.batchSize);
      const payload = await this.request<{ records?: FeishuRecordItem[] }>(
        table,
        `bitable/v1/apps/${this.appToken}/tables/${tableId}/records/batch_delete`,
        {
          method: 'POST',
          body: {
            records: batch,
          },
        },
      );

      if (payload.code !== 0) {
        throw new Error(payload.msg || '清空多维表失败');
      }

      deletedCount += payload.data?.records?.length || batch.length;
    }

    return { deletedCount };
  }

  private async syncRecords(table: ChangeTable, records: Array<Record<string, string>>): Promise<{ success: number; failed: number }> {
    const normalizedRecords = records
      .map((record) => Object.fromEntries(
        Object.entries(record).map(([fieldName, value]) => [fieldName, value == null ? '' : String(value)]),
      ))
      .filter((record) => Object.keys(record).length > 0);

    if (normalizedRecords.length === 0) {
      return { success: 0, failed: 0 };
    }

    const tableId = this.getTableId(table);
    const fieldMap = await this.ensureFields(table, normalizedRecords);
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
          table,
          `bitable/v1/apps/${this.appToken}/tables/${tableId}/records/batch_create`,
          {
            method: 'POST',
            body: {
              records: batch,
            },
          },
        );

        if (payload.code !== 0) {
          failed += batch.length;
          this.logger.warn(`变更工单飞书批次写入失败：${payload.msg}`);
          continue;
        }

        success += payload.data?.records?.length || batch.length;
      } catch (error) {
        failed += batch.length;
        this.logger.warn(`变更工单飞书批次写入异常：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { success, failed };
  }

  private async findChatIdByName(table: ChangeTable, chatName?: string): Promise<string> {
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
        table,
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

  private async sendSuccessMessage(
    table: ChangeTable,
    insertedCount: number,
    chatName?: string,
    notifyMessage?: string,
  ): Promise<void> {
    const chatId = await this.findChatIdByName(table, chatName);
    const payload = await this.request<{ message_id?: string }>(
      table,
      'im/v1/messages',
      {
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
      },
    );

    if (payload.code !== 0) {
      throw new Error(payload.msg || '发送飞书群消息失败');
    }
  }

  private async replaceTableRecords(
    table: ChangeTable,
    records: Array<Record<string, string>>,
    options?: ChangeSyncMessageOptions,
  ): Promise<ChangeSyncResult> {
    const normalizedRecords = records.filter((record) => record && Object.keys(record).length > 0);
    if (normalizedRecords.length === 0) {
      return {
        success: 0,
        failed: 0,
        insertedCount: 0,
        deletedCount: 0,
        notified: false,
        message: '没有可同步的数据',
      };
    }

    const deleteResult = await this.deleteAllRecords(table);
    const syncResult = await this.syncRecords(table, normalizedRecords);
    const insertedCount = syncResult.success;
    const messageContext: ChangeSyncMessageContext = {
      insertedCount,
      deletedCount: deleteResult.deletedCount,
      syncSuccess: insertedCount > 0,
    };

    if (insertedCount === 0) {
      return {
        success: 0,
        failed: syncResult.failed || normalizedRecords.length,
        insertedCount: 0,
        deletedCount: deleteResult.deletedCount,
        notified: false,
        message: '已清空旧数据，但写入飞书多维表失败',
      };
    }

    const successMessage = options?.successMessage?.(messageContext)
      || `已清空旧数据并同步 ${insertedCount} 条记录到飞书多维表`;

    try {
      await this.sendSuccessMessage(table, insertedCount, undefined, options?.notifyMessage);
      return {
        success: insertedCount,
        failed: syncResult.failed,
        insertedCount,
        deletedCount: deleteResult.deletedCount,
        notified: true,
        message: `${successMessage}，群通知已发送`,
      };
    } catch (error) {
      return {
        success: insertedCount,
        failed: syncResult.failed,
        insertedCount,
        deletedCount: deleteResult.deletedCount,
        notified: false,
        message: `${successMessage}，但群通知发送失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private normalizeStatus(status: unknown): string {
    const mapping: Record<string, string> = {
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
    const key = String(status || '');
    return mapping[key] || key;
  }

  private isTerminatedChangeStatus(status: unknown): boolean {
    const raw = String(status ?? '').trim();
    return raw === '8' || this.normalizeStatus(raw) === '终止';
  }

  private normalizeChangeCategory(value: unknown): string {
    const mapping: Record<string, string> = {
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

  private normalizeChangeLevel(data: Record<string, any>): string {
    const leadTimeMatch = String(data.leadTime || '').match(/(I[1-4]级)/);
    if (leadTimeMatch) return leadTimeMatch[1];

    const level = String(data.level || data.changeLevel || data.change_level || '');
    const mapping: Record<string, string> = {
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

  private normalizeCurrentNode(data: Record<string, any>): string {
    const progressValue = String(data.progress || '').trim();
    const statusValue = String(data.status || '').trim();
    const explicitNode = this.firstFilledChangeValue(
      data.currentNode,
      data.current_node,
      data.currentNodeName,
      data.current_node_name,
      data.nodeName,
      data.node_name,
      data.taskName,
      data.task_name,
      data.activityName,
      data.activity_name,
    );
    const progressMap: Record<string, string> = {
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
    const closedStatusMap: Record<string, string> = {
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

  private mapBasicDataItem(item: BasicDataItem): Record<string, string> {
    const data = item.data || {};
    return {
      工单号: data.orderCode || data.order_code || String(item.orderId),
      标题: data.title || data.description || data.name || '',
      提交人: data.applicant || '',
      变更类型: ({ '1': '紧急变更', '2': '计划变更', '3': '计划变更', '4': '其他' } as Record<string, string>)[data.type || data.changeType || data.change_type || ''] || data.type || '',
      变更等级: this.normalizeChangeLevel(data),
      变更类别: this.normalizeChangeCategory(data.category || data.changeCategory || data.change_category),
      当前节点: this.normalizeCurrentNode(data),
      状态: this.normalizeStatus(data.status),
      计划开始时间: data.planStartTime || data.plan_start_time || '',
      计划结束时间: data.planEndTime || data.plan_end_time || '',
      实际开始时间: data.implementStartTime || data.implement_start_time || data.actualStartTime || data.actual_start_time || '',
      实际结束时间: data.implementEndTime || data.implement_end_time || data.actualEndTime || data.actual_end_time || '',
      计划延时开始时间: data.planDelayStartTime || data.plan_delay_start_time || data.delayedStartTime || data.delayed_start_time || '',
      计划延时结束时间: data.planDelayEndTime || data.plan_delay_end_time || data.delayedEndTime || data.delayed_end_time || '',
    };
  }

  private mapWorkOrder(workOrder: WorkOrder): Record<string, string> {
    return {
      工单号: String(workOrder.orderCode || ''),
      标题: workOrder.title || '',
      提交人: workOrder.applicant || '',
      变更类型: workOrder.changeType || '',
      变更等级: workOrder.changeLevel || '',
      变更类别: this.normalizeChangeCategory(workOrder.changeCategory),
      当前节点: workOrder.currentNode || '',
      状态: this.normalizeStatus(workOrder.status),
      申请人: workOrder.applicant || '',
      申请时间: workOrder.applyTime || '',
      计划开始时间: workOrder.planStartTime || '',
      计划结束时间: workOrder.planEndTime || '',
      实际开始时间: workOrder.actualStartTime || '',
      实际结束时间: workOrder.actualEndTime || '',
      延迟开始时间: workOrder.delayedStartTime || '',
      延迟结束时间: workOrder.delayedEndTime || '',
      延迟原因: workOrder.delayedReason || '',
    };
  }

  private formatChangeSyncTime(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  private isFilledChangeSummaryValue(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    const text = String(value).trim();
    return text !== '' && text !== 'null' && text !== 'undefined' && text !== '-';
  }

  private firstFilledChangeValue(...values: unknown[]): string {
    const value = values.find((item) => this.isFilledChangeSummaryValue(item));
    return value === undefined || value === null ? '' : String(value).trim();
  }

  private formatChangeOrderTimeText({
    delayedStart,
    delayedEnd,
    planStart,
    planEnd,
  }: {
    delayedStart: string;
    delayedEnd: string;
    planStart: string;
    planEnd: string;
  }): string {
    if (this.isFilledChangeSummaryValue(delayedStart) || this.isFilledChangeSummaryValue(delayedEnd)) {
      return `延期开始 ${delayedStart || '--'}，延期结束 ${delayedEnd || '--'}`;
    }

    return `计划开始 ${planStart || '--'}，计划结束 ${planEnd || '--'}`;
  }

  private isChangeNodeDetailVisible(node: string): boolean {
    const normalizedNode = String(node || '').trim();
    return Boolean(normalizedNode)
      && normalizedNode !== CHANGE_NODE_WITHOUT_DETAILS
      && normalizedNode !== '流程结束'
      && normalizedNode !== '未知节点';
  }

  private formatChangeNodeDetailSummary(items: Array<{ node: string; detail: string }>): string {
    const grouped = new Map<string, string[]>();

    items.forEach((item) => {
      const node = String(item.node || '').trim() || '未知节点';
      if (!this.isChangeNodeDetailVisible(node)) {
        return;
      }

      const details = grouped.get(node) || [];
      details.push(item.detail);
      grouped.set(node, details);
    });

    return Array.from(grouped.entries())
      .map(([node, details]) => [
        `${node} ${details.length}：`,
        ...details.map((detail) => `- ${detail}`),
      ].join('\n'))
      .join('\n');
  }

  private getBasicDataNodeDetail(item: BasicDataItem): { node: string; detail: string } {
    const data = item.data || {};
    const node = this.normalizeCurrentNode(data) || '未知节点';
    const orderCode = this.firstFilledChangeValue(data.orderCode, data.order_code, item.orderId);
    const title = this.firstFilledChangeValue(data.title, data.description, data.name, orderCode, `ID ${item.orderId}`);
    const name = orderCode && title !== orderCode ? `${title}（${orderCode}）` : title;
    const timeText = this.formatChangeOrderTimeText({
      delayedStart: this.firstFilledChangeValue(data.planDelayStartTime, data.plan_delay_start_time, data.delayedStartTime, data.delayed_start_time),
      delayedEnd: this.firstFilledChangeValue(data.planDelayEndTime, data.plan_delay_end_time, data.delayedEndTime, data.delayed_end_time),
      planStart: this.firstFilledChangeValue(data.planStartTime, data.plan_start_time),
      planEnd: this.firstFilledChangeValue(data.planEndTime, data.plan_end_time),
    });

    return {
      node,
      detail: `${name || '未命名工单'}：${timeText}`,
    };
  }

  private getWorkOrderNodeDetail(workOrder: WorkOrder): { node: string; detail: string } {
    const node = String(workOrder.currentNode || '').trim() || '未知节点';
    const orderCode = this.firstFilledChangeValue(workOrder.orderCode);
    const title = this.firstFilledChangeValue(workOrder.title, orderCode);
    const name = orderCode && title !== orderCode ? `${title}（${orderCode}）` : title;
    const timeText = this.formatChangeOrderTimeText({
      delayedStart: this.firstFilledChangeValue(workOrder.delayedStartTime),
      delayedEnd: this.firstFilledChangeValue(workOrder.delayedEndTime),
      planStart: this.firstFilledChangeValue(workOrder.planStartTime),
      planEnd: this.firstFilledChangeValue(workOrder.planEndTime),
    });

    return {
      node,
      detail: `${name || '未命名工单'}：${timeText}`,
    };
  }

  private incrementCounter(counter: Map<string, number>, rawValue: unknown): void {
    const key = String(rawValue || '').trim();
    if (!key) {
      return;
    }

    counter.set(key, (counter.get(key) || 0) + 1);
  }

  private formatCounterSummary(counter: Map<string, number>, limit = 3): string {
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

  private buildBasicDataSyncSummary(basicDataList: BasicDataItem[]): ChangeSyncMessageOptions {
    const syncableItems = basicDataList.filter((item) => item && item.data && typeof item.data === 'object' && !item.data.error);
    const statusCounter = new Map<string, number>();
    const levelCounter = new Map<string, number>();
    const nodeCounter = new Map<string, number>();
    const nodeDetails: Array<{ node: string; detail: string }> = [];

    syncableItems.forEach((item) => {
      const data = item.data || {};
      this.incrementCounter(statusCounter, this.normalizeStatus(data.status) || '未知状态');
      this.incrementCounter(levelCounter, this.normalizeChangeLevel(data) || '未分级');
      const detail = this.getBasicDataNodeDetail(item);
      this.incrementCounter(nodeCounter, detail.node || '未知节点');
      nodeDetails.push(detail);
    });

    const statusSummary = this.formatCounterSummary(statusCounter, 0);
    const levelSummary = this.formatCounterSummary(levelCounter, 0);
    const nodeSummary = this.formatCounterSummary(nodeCounter, 0);
    const nodeDetailSummary = this.formatChangeNodeDetailSummary(nodeDetails);

    return {
      notifyMessage: [
        '【变更工单同步】',
        `同步时间：${this.formatChangeSyncTime()}`,
        `覆盖记录：${syncableItems.length} 条`,
        statusSummary ? `状态分布：${statusSummary}` : '',
        levelSummary ? `等级分布：${levelSummary}` : '',
        nodeSummary ? `当前节点：${nodeSummary}` : '',
        nodeDetailSummary ? `节点明细：\n${nodeDetailSummary}` : '',
      ].filter(Boolean).join('\n'),
      successMessage: ({ insertedCount }) => {
        const parts = [`已清空旧数据并覆盖同步 ${insertedCount} 条变更工单到飞书多维表`];
        if (statusSummary) parts.push(`状态：${statusSummary}`);
        if (levelSummary) parts.push(`等级：${levelSummary}`);
        if (nodeSummary) parts.push(`节点：${nodeSummary}`);
        if (nodeDetailSummary) parts.push(`节点明细：${nodeDetailSummary.replace(/\n/g, '；')}`);
        return parts.join('；');
      },
    };
  }

  private buildWorkOrderSyncSummary(workOrders: WorkOrder[]): ChangeSyncMessageOptions {
    const statusCounter = new Map<string, number>();
    const levelCounter = new Map<string, number>();
    const nodeCounter = new Map<string, number>();
    const nodeDetails: Array<{ node: string; detail: string }> = [];

    workOrders.forEach((item) => {
      this.incrementCounter(statusCounter, this.normalizeStatus(item.status) || '未知状态');
      this.incrementCounter(levelCounter, item.changeLevel || '未分级');
      const detail = this.getWorkOrderNodeDetail(item);
      this.incrementCounter(nodeCounter, detail.node || '未知节点');
      nodeDetails.push(detail);
    });

    const statusSummary = this.formatCounterSummary(statusCounter, 0);
    const levelSummary = this.formatCounterSummary(levelCounter, 0);
    const nodeSummary = this.formatCounterSummary(nodeCounter, 0);
    const nodeDetailSummary = this.formatChangeNodeDetailSummary(nodeDetails);

    return {
      notifyMessage: [
        '【变更工单列表同步】',
        `同步时间：${this.formatChangeSyncTime()}`,
        `覆盖记录：${workOrders.length} 条`,
        statusSummary ? `状态分布：${statusSummary}` : '',
        levelSummary ? `等级分布：${levelSummary}` : '',
        nodeSummary ? `当前节点：${nodeSummary}` : '',
        nodeDetailSummary ? `节点明细：\n${nodeDetailSummary}` : '',
      ].filter(Boolean).join('\n'),
      successMessage: ({ insertedCount }) => {
        const parts = [`已清空旧数据并覆盖同步 ${insertedCount} 条变更工单列表到飞书多维表`];
        if (statusSummary) parts.push(`状态：${statusSummary}`);
        if (levelSummary) parts.push(`等级：${levelSummary}`);
        if (nodeSummary) parts.push(`节点：${nodeSummary}`);
        if (nodeDetailSummary) parts.push(`节点明细：${nodeDetailSummary.replace(/\n/g, '；')}`);
        return parts.join('；');
      },
    };
  }

  async clearBasicData(): Promise<{ deletedCount: number }> {
    return this.deleteAllRecords('basicData');
  }

  async syncBasicData(basicDataList: BasicDataItem[]): Promise<ChangeSyncResult> {
    return this.replaceTableRecords(
      'basicData',
      basicDataList.map((item) => this.mapBasicDataItem(item)),
      this.buildBasicDataSyncSummary(basicDataList),
    );
  }

  async clearWorkOrderTable(): Promise<{ deletedCount: number }> {
    return this.deleteAllRecords('workOrders');
  }

  async syncWorkOrders(workOrders: WorkOrder[]): Promise<ChangeSyncResult> {
    return this.replaceTableRecords(
      'workOrders',
      workOrders.map((item) => this.mapWorkOrder(item)),
      this.buildWorkOrderSyncSummary(workOrders),
    );
  }
}
