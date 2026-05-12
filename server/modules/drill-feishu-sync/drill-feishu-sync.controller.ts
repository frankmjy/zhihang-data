import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { SyncDrillRecordsDto, SyncDrillRecordsResp } from '@shared/api.interface';
import { DrillFeishuSyncService } from './drill-feishu-sync.service';

@Controller('api/drill/feishu')
export class DrillFeishuSyncController {
  constructor(private readonly drillFeishuSyncService: DrillFeishuSyncService) {}

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async syncDrillRecords(@Body() dto: SyncDrillRecordsDto): Promise<SyncDrillRecordsResp> {
    const records = Array.isArray(dto?.records) ? dto.records : [];
    return this.drillFeishuSyncService.syncDrillRecords(records);
  }
}
