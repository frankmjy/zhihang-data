import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type {
  ClearTableResp,
  SyncBasicDataDto,
  SyncBasicDataResp,
  SyncWorkOrdersDto,
  SyncWorkOrdersResp,
} from '@shared/api.interface';
import { ChangeFeishuSyncService } from './change-feishu-sync.service';

@Controller('api/change/feishu')
export class ChangeFeishuSyncController {
  constructor(private readonly changeFeishuSyncService: ChangeFeishuSyncService) {}

  @Post('clear-basic-data')
  @NeedLogin()
  @HttpCode(HttpStatus.OK)
  async clearBasicData(): Promise<ClearTableResp> {
    const { deletedCount } = await this.changeFeishuSyncService.clearBasicData();
    return { deletedCount };
  }

  @Post('sync-basic-data')
  @NeedLogin()
  @HttpCode(HttpStatus.OK)
  async syncBasicData(@Body() dto: SyncBasicDataDto): Promise<SyncBasicDataResp> {
    const basicDataList = Array.isArray(dto?.basicDataList) ? dto.basicDataList : [];
    return this.changeFeishuSyncService.syncBasicData(basicDataList);
  }

  @Post('clear-table')
  @NeedLogin()
  @HttpCode(HttpStatus.OK)
  async clearTable(): Promise<ClearTableResp> {
    const { deletedCount } = await this.changeFeishuSyncService.clearWorkOrderTable();
    return { deletedCount };
  }

  @Post('sync-workorders')
  @NeedLogin()
  @HttpCode(HttpStatus.OK)
  async syncWorkOrders(@Body() dto: SyncWorkOrdersDto): Promise<SyncWorkOrdersResp> {
    const workOrders = Array.isArray(dto?.workOrders) ? dto.workOrders : [];
    const result = await this.changeFeishuSyncService.syncWorkOrders(workOrders);
    return {
      ...result,
      total: workOrders.length,
    };
  }
}
