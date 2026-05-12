import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Automation, BindTrigger } from '@lark-apaas/fullstack-nestjs-core';
import { FeishuSyncService } from '../feishu-sync/feishu-sync.service';

interface ApiResponse {
  isOk: boolean;
  message?: string;
  msg?: string;
  data?: {
    list: any[];
    count: number;
  };
}

interface FetchBuildingDataResult {
  building: string;
  pcjlid: string;
  data: any[];
  count: number;
  totalCountFromApi: number;
}

@Automation()
export class AutomationTasksService {
  private readonly logger = new Logger(AutomationTasksService.name);

  private readonly FIXED_URL = process.env.RISK_FIXED_URL
    || 'https://risk.example.internal/api/ab-bpm/biz/bizCustGrid/view/list_fxgl_xcydfxpcmxsjlb';
  private readonly RECORD_LIST_URL = process.env.RISK_RECORD_LIST_URL
    || 'https://risk.example.internal/api/ab-bpm/biz/bizCustGrid/view/fxgl_xcydfxpcjlsjlb';
  private readonly PAGE_SIZE = 50;
  private readonly MAX_PAGES = 100;
  private readonly RECORD_LIST_PAGE_SIZE = 50;
  private readonly RECORD_LIST_MAX_PAGES = 10;

  private readonly BUILDING_OPTIONS = [
    { value: '2039149320796995584', label: 'A楼' },
    { value: '2039149403600945152', label: 'B楼' },
    { value: '2039149486492975104', label: 'C楼' },
    { value: '2039149571654123520', label: 'D楼' },
    { value: '2039150408220639232', label: 'E楼' },
  ];
  private readonly BUILDING_LABELS = this.BUILDING_OPTIONS.map((item) => item.label);

  private readonly riskLevelMap: Record<string, string> = {
    '1': '低',
    '2': '中',
    '3': '高',
    'low': '低',
    'l': '低',
    'lo': '低',
    'medium': '中',
    'mid': '中',
    'm': '中',
    'in': '中',
    'im': '中',
    'ic': '一般',
    'high': '高',
    'h': '高',
    '一般': '一般',
    '低': '低',
    '中': '中',
    '高': '高',
  };

  private readonly checkPeriodMap: Record<string, string> = {
    'monthly': '月度',
    'm': '月度',
    'month': '月度',
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

  private readonly riskStatusMap: Record<string, string> = {
    'w': '无',
    '无': '无',
    '有': '有',
  };

  constructor(
    private readonly httpService: HttpService,
    private readonly feishuSyncService: FeishuSyncService,
  ) {}

  @BindTrigger('daily_auto_sync_feishu_data')
  async autoSyncFeishuData() {
    this.logger.log('开始执行自动化任务：测试链接、获取数据并同步到飞书');
    const startTime = Date.now();

    try {
      const allData = await this.fetchAllBuildingsData();
      this.logger.log(`数据获取完成，共 ${allData.length} 条记录`);

      const feishuRecords = this.formatDataForFeishu(allData);
      this.logger.log(`数据格式化完成，准备同步 ${feishuRecords.length} 条记录`);

      const syncResult = await this.feishuSyncService.replaceTableRecords(feishuRecords);

      if (syncResult.success) {
        this.logger.log(`自动化任务执行成功 - 成功同步 ${syncResult.insertedCount} 条记录到飞书多维表`);
      } else {
        this.logger.error(`自动化任务执行失败 - 同步失败: ${syncResult.message}`);
      }

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      this.logger.log(`自动化任务执行完成，耗时: ${duration} 秒`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      this.logger.error(`自动化任务执行失败: ${errorMessage}`);
      throw error;
    }
  }

  private getCurrentYearMonth(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private flattenRecordValues(record: any): string[] {
    return Object.values(record || {})
      .filter((value) => value !== null && value !== undefined)
      .map((value) => String(value).trim())
      .filter(Boolean);
  }

  private getRecordSearchText(record: any): string {
    return this.flattenRecordValues(record).join(' ');
  }

  private getRecordId(record: any): string {
    const preferredKeys = ['id_', 'id', 'id_$rel', 'ID_', 'pcjlid_', 'pcjlid_$rel'];

    for (const key of preferredKeys) {
      const value = record?.[key];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }

    const candidate = this.flattenRecordValues(record).find((value) => /^\d{16,22}$/.test(value));
    return candidate || '';
  }

  private extractRecordDate(record: any): string {
    const match = this.getRecordSearchText(record).match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/);
    if (!match) return '';

    const [year, month, day] = match[0].replace(/\//g, '-').split('-');
    return `${year}-${String(Number(month)).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
  }

  private recordMatchesYearMonth(record: any, yearMonth: string): boolean {
    const text = this.getRecordSearchText(record);
    return text.includes(yearMonth) || text.includes(yearMonth.replace('-', '/'));
  }

  private recordMatchesBuilding(record: any, label: string): boolean {
    const letter = label.replace('楼', '');
    const text = this.getRecordSearchText(record).replace(/\s+/g, '');
    return [
      `南通${letter}楼`,
      `南通${letter}栋`,
      `${letter}楼`,
      `${letter}栋`,
    ].some((pattern) => text.includes(pattern));
  }

  private scoreBuildingRecord(record: any, label: string, yearMonth: string, index: number): number {
    const dateText = this.extractRecordDate(record);
    const dateScore = dateText ? Date.parse(`${dateText}T00:00:00`) / 100000000 : 0;
    let score = dateScore - index;

    if (this.recordMatchesYearMonth(record, yearMonth)) score += 100000;
    if (this.recordMatchesBuilding(record, label)) score += 10000;

    return score;
  }

  private async fetchRecordList(yearMonth: string): Promise<Array<{ record: any; index: number }>> {
    const records: Array<{ record: any; index: number }> = [];
    let currentPage = 1;

    while (true) {
      if (currentPage > this.RECORD_LIST_MAX_PAGES) {
        throw new Error(`排查记录列表超过 ${this.RECORD_LIST_MAX_PAGES} 页仍未找全，已停止`);
      }

      const payload = {
        orderBy: '',
        pageSize: this.RECORD_LIST_PAGE_SIZE,
        currentPage,
        queryData: [],
      };

      const response = await firstValueFrom(
        this.httpService.post<ApiResponse>(
          this.RECORD_LIST_URL,
          payload,
          {
            headers: {
              'Content-Type': 'application/json',
            },
            timeout: 30000,
            validateStatus: () => true,
          }
        )
      );

      if (response.status !== 200) {
        throw new Error(`排查记录列表 HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.data?.isOk) {
        throw new Error(response.data?.message || response.data?.msg || '排查记录列表接口返回失败');
      }

      const list = response.data.data?.list || [];
      const totalCount = response.data.data?.count || 0;
      this.logger.log(`排查记录列表 ${yearMonth} 第 ${currentPage} 页：总数 ${totalCount}，当前 ${list.length} 条`);

      list.forEach((record, offset) => {
        records.push({
          record,
          index: (currentPage - 1) * this.RECORD_LIST_PAGE_SIZE + offset,
        });
      });

      const expectedPageCount = totalCount > 0 ? Math.ceil(totalCount / this.RECORD_LIST_PAGE_SIZE) : 0;
      const hasMore = expectedPageCount > 0
        ? currentPage < expectedPageCount
        : list.length === this.RECORD_LIST_PAGE_SIZE;

      if (!hasMore) break;
      currentPage++;
    }

    return records;
  }

  private async resolveLatestBuildingOptions(): Promise<Array<{ value: string; label: string }>> {
    const yearMonth = this.getCurrentYearMonth();
    const records = await this.fetchRecordList(yearMonth);
    const monthRecords = records.filter((item) => this.recordMatchesYearMonth(item.record, yearMonth));
    const searchRecords = monthRecords.length >= this.BUILDING_LABELS.length ? monthRecords : records;
    const options: Array<{ value: string; label: string }> = [];
    const missingLabels: string[] = [];

    for (const label of this.BUILDING_LABELS) {
      const matches = searchRecords
        .filter((item) => this.recordMatchesBuilding(item.record, label))
        .sort((a, b) => this.scoreBuildingRecord(b.record, label, yearMonth, b.index) - this.scoreBuildingRecord(a.record, label, yearMonth, a.index));

      const best = matches[0];
      const value = best ? this.getRecordId(best.record) : '';
      if (!best || !value) {
        missingLabels.push(label);
        continue;
      }

      options.push({ value, label });
    }

    if (missingLabels.length > 0) {
      throw new Error(`未能找到 ${yearMonth} 的 ${missingLabels.join('、')} 编号，请确认排查记录列表已生成`);
    }

    this.logger.log(`已自动更新 ${yearMonth} 楼栋编号：${options.map((item) => `${item.label}:${item.value}`).join(', ')}`);
    return options;
  }

  private async fetchAllBuildingsData(): Promise<any[]> {
    const buildingOptions = await this.resolveLatestBuildingOptions();
    const buildingResults = await Promise.all(
      buildingOptions.map(async (building) => {
        return await this.fetchBuildingData(building);
      })
    );

    const allData: any[] = [];
    buildingResults.forEach((result) => {
      const dataList = result.data.map((item: any) => ({
        ...item,
        buildingName: result.building,
      }));
      allData.push(...dataList);
      this.logger.log(`${result.building}获取成功 - 记录数: ${dataList.length}`);
    });

    return allData;
  }

  private async fetchBuildingData(building: { value: string; label: string }): Promise<FetchBuildingDataResult> {
    const pageSize = this.PAGE_SIZE;
    let currentPage = 1;
    let hasMore = true;
    const allBuildingData: any[] = [];
    let totalCountFromApi = 0;

    while (hasMore) {
      if (currentPage > this.MAX_PAGES) {
        throw new Error(`${building.label} 翻页超过 ${this.MAX_PAGES} 页，已停止，避免无限请求`);
      }

      const payload = {
        orderBy: '',
        pageSize: pageSize,
        currentPage: currentPage,
        queryData: [
          {
            name: 'pcjlid_',
            con: 'like',
            val: building.value,
          },
        ],
      };

      this.logger.log(`${building.label} 请求第 ${currentPage} 页 - PCJLID: ${building.value}, PageSize: ${pageSize}`);

      try {
        const response = await firstValueFrom(
          this.httpService.post<ApiResponse>(
            this.FIXED_URL,
            payload,
            {
              headers: {
                'Content-Type': 'application/json',
              },
              timeout: 30000,
              validateStatus: () => true,
            }
          )
        );

        if (response.status !== 200) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const dataList = response.data.data?.list || [];
        const pageCount = response.data.data?.count || 0;
        const isOk = response.data.isOk;

        if (!isOk) {
          throw new Error(response.data.message || response.data.msg || '内网接口返回失败');
        }

        totalCountFromApi = pageCount;
        this.logger.log(`${building.label} 响应第 ${currentPage} 页 - isOk: ${isOk}, 总数: ${pageCount}, 当前页记录数: ${dataList.length}`);

        if (dataList.length === 0) {
          hasMore = false;
        } else {
          allBuildingData.push(...dataList);
          const expectedPageCount = pageCount > 0 ? Math.ceil(pageCount / pageSize) : 0;
          hasMore = expectedPageCount > 0
            ? currentPage < expectedPageCount
            : dataList.length === pageSize;
          currentPage++;
        }
      } catch (error) {
        this.logger.error(`${building.label} 请求失败: ${error instanceof Error ? error.message : '未知错误'}`);
        throw error;
      }
    }

    return {
      building: building.label,
      pcjlid: building.value,
      data: allBuildingData,
      count: allBuildingData.length,
      totalCountFromApi,
    };
  }

  private formatDataForFeishu(data: any[]): Array<{ fields: Record<string, string> }> {
    return data.map((item) => {
      return {
        fields: {
          楼栋: item.buildingName || '',
          风险编号: item.fxxbh_ || '',
          检查项目: item.jcxms_ || '',
          风险等级: this.getRiskLevelText(item.fxdj_) || '',
          排查周期: this.getCheckPeriodText(item.pczq_) || '',
          排查状态: item.pczt_ || '',
          检查地点: item.jcd_ || '',
          排查时间: item.pcsj_ || '',
          审核时间: item.pcwcsj_$rel || '',
          此前风险状态: this.getRiskStatusText(item.cqfxzt_) || '',
          当前风险状态: this.getRiskStatusText(item.dqfxzt_) || '',
          风险现场情况: item.fxxcqk_ || '',
        },
      };
    });
  }

  private getRiskLevelText(value: string): string {
    return this.riskLevelMap[value] || value;
  }

  private getCheckPeriodText(value: string): string {
    return this.checkPeriodMap[value] || value;
  }

  private getRiskStatusText(value: string): string {
    if (!value) return '';
    return this.riskStatusMap[value] || '有';
  }
}
