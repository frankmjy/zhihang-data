#!/usr/bin/env node
'use strict';

const { randomUUID } = require('node:crypto');

const DEFAULT_BASE_URL = 'https://open.feishu.cn/open-apis';
const DEFAULT_BATCH_SIZE = Math.max(1, Math.min(Number(process.env.FEISHU_BATCH_SIZE || 500) || 500, 500));
const DEFAULT_BATCH_CONCURRENCY = Math.max(1, Math.min(Number(process.env.FEISHU_BATCH_CONCURRENCY || 3) || 3, 6));
const DEFAULT_RECORD_PAGE_SIZE = Math.max(1, Math.min(Number(process.env.FEISHU_RECORD_PAGE_SIZE || 500) || 500, 500));
const DEFAULT_CHAT_PAGE_SIZE = 100;

async function runLimitedConcurrency(items, concurrency, worker) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const results = new Array(items.length);
  const runnerCount = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: runnerCount }, () => runWorker()));
  return results;
}

class FeishuOpenApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'FeishuOpenApiError';
    this.details = details;
  }
}

class FeishuOpenApiClient {
  constructor(options = {}) {
    this.options = options;
    this.tenantAccessToken = null;
    this.tokenExpireAt = 0;
  }

  get config() {
    return {
      baseUrl: this.options.baseUrl || process.env.FEISHU_OPEN_BASE_URL || DEFAULT_BASE_URL,
      appId: this.options.appId || process.env.FEISHU_APP_ID || '',
      appSecret: this.options.appSecret || process.env.FEISHU_APP_SECRET || '',
      appToken: this.options.appToken || process.env.FEISHU_BITABLE_APP_TOKEN || '',
      tableId: this.options.tableId || process.env.FEISHU_BITABLE_TABLE_ID || '',
      viewId: this.options.viewId || process.env.FEISHU_BITABLE_VIEW_ID || '',
      notifyChatId: this.options.notifyChatId || process.env.FEISHU_NOTIFY_CHAT_ID || '',
      notifyChatName: this.options.notifyChatName || process.env.FEISHU_NOTIFY_CHAT_NAME || '',
    };
  }

  assertCoreConfig() {
    const required = {
      FEISHU_APP_ID: this.config.appId,
      FEISHU_APP_SECRET: this.config.appSecret,
      FEISHU_BITABLE_APP_TOKEN: this.config.appToken,
      FEISHU_BITABLE_TABLE_ID: this.config.tableId,
    };

    const missing = Object.entries(required)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missing.length > 0) {
      throw new FeishuOpenApiError(`Feishu 配置不完整，请在 .env 中补充：${missing.join(', ')}`);
    }
  }

  assertNotifyConfig(chatName) {
    if (this.config.notifyChatId) return;
    if (chatName || this.config.notifyChatName) return;
    throw new FeishuOpenApiError('未配置飞书群通知目标，请在 .env 中填写 FEISHU_NOTIFY_CHAT_NAME 或 FEISHU_NOTIFY_CHAT_ID');
  }

  getErrorCode(error) {
    const code = error?.details?.code;
    return typeof code === 'number' ? code : null;
  }

  explainBitableError(error, fallbackMessage) {
    const message = error instanceof Error ? error.message : String(error || fallbackMessage);
    const code = this.getErrorCode(error);

    if (code === 91403 || message === 'Forbidden') {
      return '飞书多维表访问被拒绝（91403）。请确认当前应用已开通多维表读写权限，并且这个应用已被授权访问目标 Base / Table。';
    }

    return message || fallbackMessage;
  }

  explainChatError(error) {
    const message = error instanceof Error ? error.message : String(error || '发送飞书群消息失败');
    if (message.includes('未找到飞书群')) {
      return `${message}。请先把应用机器人加入目标群，或在 .env 中直接填写 FEISHU_NOTIFY_CHAT_ID。`;
    }

    return message;
  }

  async getTenantAccessToken() {
    this.assertCoreConfig();

    if (this.tenantAccessToken && Date.now() < this.tokenExpireAt) {
      return this.tenantAccessToken;
    }

    const response = await fetch(`${this.config.baseUrl}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    const payload = await this.readJsonResponse(response, '获取 tenant_access_token 失败');
    if (payload.code !== 0 || !payload.tenant_access_token) {
      throw new FeishuOpenApiError(payload.msg || '获取 tenant_access_token 失败', payload);
    }

    this.tenantAccessToken = payload.tenant_access_token;
    this.tokenExpireAt = Date.now() + Math.max((Number(payload.expire) || 3600) - 300, 60) * 1000;
    return this.tenantAccessToken;
  }

  async request(pathname, options = {}) {
    const token = options.skipAuth ? null : await this.getTenantAccessToken();
    const url = new URL(pathname, `${this.config.baseUrl}/`);

    const query = options.query || {};
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json; charset=utf-8',
        ...(options.headers || {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    return this.readJsonResponse(response, `${options.method || 'GET'} ${pathname} 失败`);
  }

  async readJsonResponse(response, fallbackMessage) {
    const text = await response.text();
    let payload = null;

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }

    if (!response.ok) {
      const errorMessage = payload?.msg || payload?.message || `${fallbackMessage}，HTTP ${response.status}`;
      throw new FeishuOpenApiError(errorMessage, payload);
    }

    if (!payload || typeof payload !== 'object') {
      throw new FeishuOpenApiError(`${fallbackMessage}，返回内容不是合法 JSON`, payload);
    }

    return payload;
  }

  normalizeRecords(records) {
    if (!Array.isArray(records)) {
      return [];
    }

    return records
      .filter((record) => record && typeof record === 'object' && record.fields && typeof record.fields === 'object')
      .map((record) => ({
        fields: Object.fromEntries(
          Object.entries(record.fields).map(([fieldName, value]) => [fieldName, this.normalizeFieldValue(value)]),
        ),
      }))
      .filter((record) => Object.keys(record.fields).length > 0);
  }

  normalizeFieldValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value;
    if (value instanceof Date) return value.getTime();
    return value;
  }

  parseDateTimeToTimestamp(value) {
    if (value === undefined || value === null || value === '') return null;
    if (value instanceof Date) {
      const time = value.getTime();
      return Number.isFinite(time) ? time : null;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value <= 0) return null;
      return value < 100000000000 ? value * 1000 : value;
    }

    const text = String(value).trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) {
      const numericValue = Number(text);
      if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
      return numericValue < 100000000000 ? numericValue * 1000 : numericValue;
    }

    const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (match) {
      const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
      const time = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        0,
      ).getTime();
      return Number.isFinite(time) ? time : null;
    }

    const parsed = new Date(text.replace(' ', 'T')).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  normalizeFieldForApi(fieldName, value, fieldMeta) {
    const normalizedValue = this.normalizeFieldValue(value);
    const fieldType = Number(fieldMeta?.type || 0);
    if (fieldType === 5) {
      const timestamp = this.parseDateTimeToTimestamp(normalizedValue);
      return timestamp === null ? undefined : timestamp;
    }

    if (fieldType === 1) {
      return normalizedValue == null ? '' : String(normalizedValue);
    }

    return normalizedValue;
  }

  normalizeFieldsForApi(fields, fieldMap) {
    return Object.fromEntries(
      Object.entries(fields)
        .filter(([fieldName]) => fieldMap.has(fieldName))
        .map(([fieldName, value]) => [fieldName, this.normalizeFieldForApi(fieldName, value, fieldMap.get(fieldName))])
        .filter(([, value]) => value !== undefined),
    );
  }

  async listTableFields() {
    this.assertCoreConfig();

    const fieldMap = new Map();
    let pageToken = '';

    do {
      const payload = await this.request(
        `bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/fields`,
        {
          query: {
            page_size: DEFAULT_RECORD_PAGE_SIZE,
            page_token: pageToken || undefined,
          },
        },
      );

      if (payload.code !== 0) {
        throw new FeishuOpenApiError(payload.msg || '获取多维表字段失败', payload);
      }

      const items = Array.isArray(payload.data?.items) ? payload.data.items : [];
      items.forEach((field) => {
        if (field?.field_name && field?.field_id) {
          fieldMap.set(field.field_name, {
            fieldId: field.field_id,
            type: field.type,
            property: field.property || {},
          });
        }
      });

      pageToken = payload.data?.has_more ? payload.data.page_token || '' : '';
    } while (pageToken);

    return fieldMap;
  }

  async createTextField(fieldName) {
    const payload = await this.request(
      `bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/fields`,
      {
        method: 'POST',
        body: {
          field_name: fieldName,
          type: 1,
        },
      },
    );

    if (payload.code === 0) {
      return payload.data?.field || null;
    }

    if (payload.code === 99991663) {
      return null;
    }

    throw new FeishuOpenApiError(payload.msg || `创建字段失败: ${fieldName}`, payload);
  }

  async ensureFields(records) {
    const requiredFieldNames = new Set();
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

  normalizeRecordsWithRecordId(records) {
    if (!Array.isArray(records)) {
      return [];
    }

    return records
      .filter((record) => record && typeof record === 'object' && record.fields && typeof record.fields === 'object')
      .map((record) => ({
        record_id: String(record.record_id || record.id || '').trim(),
        fields: Object.fromEntries(
          Object.entries(record.fields).map(([fieldName, value]) => [fieldName, this.normalizeFieldValue(value)]),
        ),
      }))
      .filter((record) => record.record_id && Object.keys(record.fields).length > 0);
  }

  async createRecords(records, options = {}) {
    const normalizedRecords = this.normalizeRecords(records);
    if (normalizedRecords.length === 0) {
      return {
        success: true,
        insertedCount: 0,
        message: '没有需要新增的飞书记录',
      };
    }

    return this.syncRecords(normalizedRecords, options);
  }

  async updateRecords(records, options = {}) {
    const normalizedRecords = this.normalizeRecordsWithRecordId(records);
    if (normalizedRecords.length === 0) {
      return {
        success: true,
        updatedCount: 0,
        message: '没有需要更新的飞书记录',
      };
    }

    try {
      const fieldMap = await this.ensureFields(normalizedRecords);
      const recordsForApi = normalizedRecords.map((record) => ({
        record_id: record.record_id,
        fields: this.normalizeFieldsForApi(record.fields, fieldMap),
      }));

      const batches = [];
      for (let index = 0; index < recordsForApi.length; index += DEFAULT_BATCH_SIZE) {
        batches.push(recordsForApi.slice(index, index + DEFAULT_BATCH_SIZE));
      }

      let updatedCount = 0;
      let failedBatches = 0;
      let lastError = null;

      let completedBatches = 0;
      const batchResults = await runLimitedConcurrency(batches, DEFAULT_BATCH_CONCURRENCY, async (batch) => {
        try {
          const payload = await this.request(
            `bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records/batch_update`,
            {
              method: 'POST',
              body: {
                records: batch,
              },
            },
          );

          if (payload.code !== 0) {
            throw new FeishuOpenApiError(payload.msg || '更新飞书多维表失败', payload);
          }

          const updatedRecords = Array.isArray(payload.data?.records) ? payload.data.records : [];
          return { success: true, count: updatedRecords.length || batch.length };
        } catch (error) {
          return { success: false, count: 0, error };
        } finally {
          completedBatches += 1;
          options.onProgress?.({
            action: 'update',
            completedBatches,
            totalBatches: batches.length,
          });
        }
      });

      batchResults.forEach((result) => {
        if (result?.success) {
          updatedCount += result.count || 0;
        } else {
          failedBatches += 1;
          lastError = result?.error || lastError;
        }
      });

      if (failedBatches > 0 && updatedCount === 0) {
        return {
          success: false,
          updatedCount: 0,
          message: this.explainBitableError(lastError, '更新飞书多维表失败'),
        };
      }

      if (failedBatches > 0) {
        return {
          success: false,
          updatedCount,
          message: `已更新 ${updatedCount} 条记录，但仍有 ${failedBatches} 个批次失败：${this.explainBitableError(lastError, '更新飞书多维表失败')}`,
        };
      }

      return {
        success: true,
        updatedCount,
        message: `成功更新 ${updatedCount} 条飞书多维表记录`,
      };
    } catch (error) {
      return {
        success: false,
        updatedCount: 0,
        message: this.explainBitableError(error, '更新飞书多维表失败'),
      };
    }
  }

  async syncRecords(records, options = {}) {
    const normalizedRecords = this.normalizeRecords(records);
    if (normalizedRecords.length === 0) {
      return {
        success: false,
        insertedCount: 0,
        message: '没有可同步的数据',
      };
    }

    try {
      const fieldMap = await this.ensureFields(normalizedRecords);
      const recordsForApi = normalizedRecords.map((record) => ({
        fields: this.normalizeFieldsForApi(record.fields, fieldMap),
      }));

      const batches = [];
      for (let index = 0; index < recordsForApi.length; index += DEFAULT_BATCH_SIZE) {
        batches.push(recordsForApi.slice(index, index + DEFAULT_BATCH_SIZE));
      }

      let insertedCount = 0;
      let failedBatches = 0;
      let lastError = null;

      let completedBatches = 0;
      const batchResults = await runLimitedConcurrency(batches, DEFAULT_BATCH_CONCURRENCY, async (batch) => {
        try {
          const payload = await this.request(
            `bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records/batch_create`,
            {
              method: 'POST',
              body: {
                records: batch,
              },
            },
          );

          if (payload.code !== 0) {
            throw new FeishuOpenApiError(payload.msg || '写入飞书多维表失败', payload);
          }

          const createdRecords = Array.isArray(payload.data?.records) ? payload.data.records : [];
          return { success: true, count: createdRecords.length || batch.length };
        } catch (error) {
          return { success: false, count: 0, error };
        } finally {
          completedBatches += 1;
          options.onProgress?.({
            action: 'create',
            completedBatches,
            totalBatches: batches.length,
          });
        }
      });

      batchResults.forEach((result) => {
        if (result?.success) {
          insertedCount += result.count || 0;
        } else {
          failedBatches += 1;
          lastError = result?.error || lastError;
        }
      });

      if (failedBatches > 0 && insertedCount === 0) {
        return {
          success: false,
          insertedCount: 0,
          message: this.explainBitableError(lastError, '写入飞书多维表失败'),
        };
      }

      if (failedBatches > 0) {
        return {
          success: false,
          insertedCount,
          message: `已写入 ${insertedCount} 条记录，但仍有 ${failedBatches} 个批次失败：${this.explainBitableError(lastError, '写入飞书多维表失败')}`,
        };
      }

      return {
        success: true,
        insertedCount,
        message: `成功同步 ${insertedCount} 条记录到飞书多维表`,
      };
    } catch (error) {
      return {
        success: false,
        insertedCount: 0,
        message: this.explainBitableError(error, '写入飞书多维表失败'),
      };
    }
  }

  async listAllRecords(options = {}) {
    const records = [];
    let pageToken = '';
    let pageCount = 0;
    const maxRecords = Math.max(0, Number(options.maxRecords || 0) || 0);

    do {
      const pageSize = maxRecords > 0
        ? Math.max(1, Math.min(options.pageSize || DEFAULT_RECORD_PAGE_SIZE, maxRecords - records.length))
        : options.pageSize || DEFAULT_RECORD_PAGE_SIZE;
      const payload = await this.request(
        `bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records`,
        {
          query: {
            page_size: pageSize,
            page_token: pageToken || undefined,
          },
        },
      );

      if (payload.code !== 0) {
        throw new FeishuOpenApiError(payload.msg || '获取飞书多维表记录失败', payload);
      }

      const items = Array.isArray(payload.data?.items)
        ? payload.data.items
        : Array.isArray(payload.data?.records)
          ? payload.data.records
          : [];
      const remainingSlots = maxRecords > 0 ? Math.max(maxRecords - records.length, 0) : items.length;
      records.push(...items.slice(0, remainingSlots));
      pageCount += 1;
      options.onProgress?.({
        action: 'list',
        pageCount,
        records: records.length,
        total: Number(payload.data?.total || 0),
      });

      pageToken = payload.data?.has_more ? payload.data.page_token || '' : '';
    } while (pageToken && (maxRecords <= 0 || records.length < maxRecords));

    return records;
  }

  async listAllRecordIds() {
    const recordIds = [];
    let pageToken = '';

    do {
      const payload = await this.request(
        `bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records`,
        {
          query: {
            page_size: DEFAULT_RECORD_PAGE_SIZE,
            page_token: pageToken || undefined,
          },
        },
      );

      if (payload.code !== 0) {
        throw new FeishuOpenApiError(payload.msg || '获取多维表记录失败', payload);
      }

      const items = Array.isArray(payload.data?.items)
        ? payload.data.items
        : Array.isArray(payload.data?.records)
          ? payload.data.records
          : [];

      items.forEach((item) => {
        const recordId = item?.record_id || item?.id;
        if (recordId) {
          recordIds.push(recordId);
        }
      });

      pageToken = payload.data?.has_more ? payload.data.page_token || '' : '';
    } while (pageToken);

    return recordIds;
  }

  async deleteRecords(recordIds, options = {}) {
    const uniqueRecordIds = Array.from(
      new Set(
        (Array.isArray(recordIds) ? recordIds : [])
          .map((recordId) => String(recordId || '').trim())
          .filter(Boolean),
      ),
    );
    const targetLabel = options.targetLabel || '飞书多维表记录';
    const actionLabel = options.actionLabel || '删除飞书多维表记录';

    try {
      if (uniqueRecordIds.length === 0) {
        return {
          success: true,
          deletedCount: 0,
          message: `${targetLabel}中没有需要删除的数据`,
        };
      }

      const batches = [];
      for (let index = 0; index < uniqueRecordIds.length; index += DEFAULT_BATCH_SIZE) {
        batches.push(uniqueRecordIds.slice(index, index + DEFAULT_BATCH_SIZE));
      }

      let deletedCount = 0;
      let failedBatches = 0;
      let lastError = null;

      let completedBatches = 0;
      const batchResults = await runLimitedConcurrency(batches, DEFAULT_BATCH_CONCURRENCY, async (batch) => {
        try {
          const payload = await this.request(
            `bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records/batch_delete`,
            {
              method: 'POST',
              body: {
                records: batch,
              },
            },
          );

          if (payload.code !== 0) {
            throw new FeishuOpenApiError(payload.msg || `${actionLabel}失败`, payload);
          }

          const deletedRecords = Array.isArray(payload.data?.records) ? payload.data.records : [];
          return { success: true, count: deletedRecords.length || batch.length };
        } catch (error) {
          return { success: false, count: 0, error };
        } finally {
          completedBatches += 1;
          options.onProgress?.({
            action: 'delete',
            completedBatches,
            totalBatches: batches.length,
          });
        }
      });

      batchResults.forEach((result) => {
        if (result?.success) {
          deletedCount += result.count || 0;
        } else {
          failedBatches += 1;
          lastError = result?.error || lastError;
        }
      });

      if (failedBatches > 0 && deletedCount === 0) {
        return {
          success: false,
          deletedCount: 0,
          message: this.explainBitableError(lastError, `${actionLabel}失败`),
        };
      }

      if (failedBatches > 0) {
        return {
          success: false,
          deletedCount,
          message: `已删除 ${deletedCount} 条旧数据，但仍有 ${failedBatches} 个批次失败：${this.explainBitableError(lastError, `${actionLabel}失败`)}`,
        };
      }

      return {
        success: true,
        deletedCount,
        message: `已删除 ${deletedCount} 条旧数据`,
      };
    } catch (error) {
      return {
        success: false,
        deletedCount: 0,
        message: this.explainBitableError(error, `${actionLabel}失败`),
      };
    }
  }

  async deleteAllRecords(options = {}) {
    try {
      const recordIds = await this.listAllRecordIds();
      if (recordIds.length === 0) {
        return {
          success: true,
          deletedCount: 0,
          message: '飞书多维表中没有需要清空的数据',
        };
      }

      return this.deleteRecords(recordIds, {
        targetLabel: '飞书多维表',
        actionLabel: '清空飞书多维表',
        onProgress: options.onProgress,
      });
    } catch (error) {
      return {
        success: false,
        deletedCount: 0,
        message: this.explainBitableError(error, '清空飞书多维表失败'),
      };
    }
  }

  async listTableViews() {
    this.assertCoreConfig();

    const payload = await this.request(
      `bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/views`,
      {
        query: {
          page_size: DEFAULT_RECORD_PAGE_SIZE,
        },
      },
    );

    if (payload.code !== 0) {
      throw new FeishuOpenApiError(payload.msg || '获取飞书多维表视图失败', payload);
    }

    return Array.isArray(payload.data?.items)
      ? payload.data.items
      : Array.isArray(payload.data?.views)
        ? payload.data.views
        : [];
  }

  async createTableView(viewName, viewType = 'grid') {
    const name = String(viewName || '').trim();
    if (!name) {
      throw new FeishuOpenApiError('飞书多维表视图名称不能为空');
    }

    const payload = await this.request(
      `bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/views`,
      {
        method: 'POST',
        body: {
          view_name: name,
          view_type: viewType,
        },
      },
    );

    if (payload.code !== 0) {
      throw new FeishuOpenApiError(payload.msg || `创建飞书多维表视图失败：${name}`, payload);
    }

    return payload.data?.view || null;
  }

  async ensureTableViews(viewNames) {
    const names = (Array.isArray(viewNames) ? viewNames : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean);
    if (names.length === 0) {
      return {
        success: true,
        createdCount: 0,
        views: {},
      };
    }

    const existingViews = await this.listTableViews();
    const viewMap = new Map();
    existingViews.forEach((view) => {
      const name = String(view?.view_name || view?.name || '').trim();
      const viewId = String(view?.view_id || view?.id || '').trim();
      if (name && viewId) {
        viewMap.set(name, {
          viewId,
          viewName: name,
          viewType: String(view?.view_type || view?.type || ''),
          created: false,
        });
      }
    });

    let createdCount = 0;
    for (const name of names) {
      if (viewMap.has(name)) {
        continue;
      }

      const view = await this.createTableView(name, 'grid');
      const viewId = String(view?.view_id || view?.id || '').trim();
      if (viewId) {
        createdCount += 1;
        viewMap.set(name, {
          viewId,
          viewName: name,
          viewType: String(view?.view_type || 'grid'),
          created: true,
        });
      }
    }

    const views = {};
    names.forEach((name) => {
      if (viewMap.has(name)) {
        views[name] = viewMap.get(name);
      }
    });

    return {
      success: true,
      createdCount,
      views,
    };
  }

  async findChatIdByName(chatName) {
    if (this.config.notifyChatId) {
      return this.config.notifyChatId;
    }

    const targetName = (chatName || this.config.notifyChatName || '').trim();
    this.assertNotifyConfig(targetName);

    const normalizedTargetName = targetName.toLowerCase();
    let pageToken = '';
    const exactMatches = [];
    const partialMatches = [];

    do {
      const payload = await this.request('im/v1/chats', {
        query: {
          page_size: DEFAULT_CHAT_PAGE_SIZE,
          page_token: pageToken || undefined,
        },
      });

      if (payload.code !== 0) {
        throw new FeishuOpenApiError(payload.msg || '获取飞书群列表失败', payload);
      }

      const items = Array.isArray(payload.data?.items) ? payload.data.items : [];
      items.forEach((item) => {
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

    throw new FeishuOpenApiError(`未找到飞书群：${targetName}。请确认机器人已加入该群，并已开通群相关权限`);
  }

  async sendTextMessageToChat(text, chatName) {
    const chatId = await this.findChatIdByName(chatName);
    const payload = await this.request('im/v1/messages', {
      method: 'POST',
      query: {
        receive_id_type: 'chat_id',
      },
      body: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
        uuid: randomUUID(),
      },
    });

    if (payload.code !== 0) {
      throw new FeishuOpenApiError(payload.msg || '发送飞书群消息失败', payload);
    }

    return {
      success: true,
      chatId,
      messageId: payload.data?.message_id || '',
    };
  }

  async sendInteractiveMessageToChat(card, chatName) {
    const chatId = await this.findChatIdByName(chatName);
    const payload = await this.request('im/v1/messages', {
      method: 'POST',
      query: {
        receive_id_type: 'chat_id',
      },
      body: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
        uuid: randomUUID(),
      },
    });

    if (payload.code !== 0) {
      throw new FeishuOpenApiError(payload.msg || '发送飞书卡片消息失败', payload);
    }

    return {
      success: true,
      chatId,
      messageId: payload.data?.message_id || '',
    };
  }

  async sendMessageToChat(message, chatName) {
    if (message && typeof message === 'object' && message.type === 'interactive') {
      try {
        return await this.sendInteractiveMessageToChat(message.card || message.content || message, chatName);
      } catch (error) {
        if (typeof message.fallbackText === 'string' && message.fallbackText.trim()) {
          return this.sendTextMessageToChat(message.fallbackText, chatName);
        }

        throw error;
      }
    }

    return this.sendTextMessageToChat(String(message || ''), chatName);
  }

  resolveMessageOption(messageOption, context, fallbackMessage) {
    if (typeof messageOption === 'function') {
      const resolved = messageOption(context);
      if (typeof resolved === 'string' && resolved.trim()) {
        return resolved.trim();
      }
      if (resolved && typeof resolved === 'object') {
        return resolved;
      }
    }

    if (typeof messageOption === 'string' && messageOption.trim()) {
      return messageOption.trim();
    }
    if (messageOption && typeof messageOption === 'object') {
      return messageOption;
    }

    return fallbackMessage;
  }

  async testConnectivity(options = {}) {
    const checkedAt = new Date().toISOString();
    const sendTestMessage = options.sendTestMessage !== false;
    const result = {
      success: false,
      checkedAt,
      tenantName: '',
      appName: '',
      chatId: this.config.notifyChatId || '',
      chatName: '',
      tableId: this.config.tableId || '',
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
      const tenantPayload = await this.request('tenant/v2/tenant/query');
      const tenantName = tenantPayload.data?.tenant?.name || '';
      result.tenantName = tenantName;
      result.tenant = {
        ok: true,
        message: tenantName ? `当前租户：${tenantName}` : '租户查询成功',
      };
    } catch (error) {
      result.tenant = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      const botPayload = await this.request('bot/v3/info');
      const appName = botPayload.bot?.app_name || '';
      result.appName = appName;
      if (result.tenant.ok) {
        result.tenant.message = appName
          ? `${result.tenant.message}，应用：${appName}`
          : result.tenant.message;
      }
    } catch (error) {
      if (result.tenant.ok) {
        result.tenant.message = `${result.tenant.message}，但应用信息读取失败：${error instanceof Error ? error.message : String(error)}`;
      }
    }

    try {
      const chatId = this.config.notifyChatId || await this.findChatIdByName(options.chatName);
      const chatPayload = await this.request(`im/v1/chats/${chatId}`);
      result.chatId = chatId;
      result.chatName = chatPayload.data?.name || '';
      result.chat = {
        ok: true,
        message: result.chatName
          ? `群会话可访问：${result.chatName}`
          : '群会话可访问',
      };
    } catch (error) {
      result.chat = {
        ok: false,
        message: this.explainChatError(error),
      };
    }

    try {
      const bitablePayload = await this.request(
        `bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records`,
        {
          query: {
            page_size: 1,
            view_id: this.config.viewId || undefined,
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
        message: this.explainBitableError(error, '多维表访问失败'),
      };
    }

    if (sendTestMessage) {
      try {
        const appName = result.appName || '飞书应用';
        const messageResult = await this.sendTextMessageToChat(
          `【飞书连通性测试】${appName} 于 ${checkedAt} 验证群消息链路正常`,
          options.chatName,
        );

        result.messageId = messageResult.messageId || '';
        result.messageStatus = {
          ok: true,
          message: result.messageId
            ? `测试消息发送成功，messageId：${result.messageId}`
            : '测试消息发送成功',
        };
      } catch (error) {
        result.messageStatus = {
          ok: false,
          message: this.explainChatError(error),
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

  async replaceTableRecords(records, options = {}) {
    const normalizedRecords = this.normalizeRecords(records);
    if (normalizedRecords.length === 0) {
      return {
        success: false,
        deletedCount: 0,
        insertedCount: 0,
        notified: false,
        message: '没有可同步的数据',
      };
    }

    const deleteResult = await this.deleteAllRecords({
      onProgress: options.onProgress,
    });
    if (!deleteResult.success && deleteResult.deletedCount === 0) {
      return {
        success: false,
        deletedCount: deleteResult.deletedCount,
        insertedCount: 0,
        notified: false,
        message: deleteResult.message,
      };
    }

    const syncResult = await this.syncRecords(normalizedRecords, {
      onProgress: options.onProgress,
    });
    if (!syncResult.success && syncResult.insertedCount === 0) {
      return {
        success: false,
        deletedCount: deleteResult.deletedCount,
        insertedCount: syncResult.insertedCount,
        notified: false,
        message: syncResult.message,
      };
    }

    const messageContext = {
      deletedCount: deleteResult.deletedCount,
      insertedCount: syncResult.insertedCount,
      syncSuccess: Boolean(syncResult.success),
    };
    const successMessage = this.resolveMessageOption(
      options.successMessage,
      messageContext,
      `已清空旧数据并同步 ${syncResult.insertedCount} 条记录到飞书多维表`,
    );

    if (options.notify === false) {
      return {
        success: syncResult.success,
        deletedCount: deleteResult.deletedCount,
        insertedCount: syncResult.insertedCount,
        notified: false,
        message: successMessage,
      };
    }

    try {
      const notifyMessage = this.resolveMessageOption(
        options.notifyMessage,
        messageContext,
        `${syncResult.insertedCount}条成功同步`,
      );
      await this.sendMessageToChat(notifyMessage, options.chatName);
      return {
        success: syncResult.success,
        deletedCount: deleteResult.deletedCount,
        insertedCount: syncResult.insertedCount,
        notified: true,
        message: `${successMessage}，群通知已发送`,
      };
    } catch (error) {
      return {
        success: false,
        deletedCount: deleteResult.deletedCount,
        insertedCount: syncResult.insertedCount,
        notified: false,
        message: `${successMessage}，但群通知发送失败：${this.explainChatError(error)}`,
      };
    }
  }
}

module.exports = {
  FeishuOpenApiClient,
  FeishuOpenApiError,
};
