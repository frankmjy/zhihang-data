import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  FeishuConnectivityResponseDTO,
  SyncToFeishuDTO,
  SyncToFeishuResponse,
} from '@shared/api.interface';
import { FeishuSyncService } from './feishu-sync.service';

@ApiTags('feishu-sync')
@Controller('api/feishu')
export class FeishuSyncController {
  constructor(private readonly feishuSyncService: FeishuSyncService) {}

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '清空飞书多维表后重新同步，并发送群通知' })
  @ApiResponse({ status: HttpStatus.OK, description: '同步完成' })
  async syncToFeishu(@Body() dto: SyncToFeishuDTO): Promise<SyncToFeishuResponse> {
    return this.feishuSyncService.replaceTableRecords(dto.records);
  }

  @Post('connectivity')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '测试飞书群会话、多维表与消息发送链路' })
  @ApiResponse({ status: HttpStatus.OK, description: '测试完成' })
  async testConnectivity(@Body() body: { sendTestMessage?: boolean }): Promise<FeishuConnectivityResponseDTO> {
    return this.feishuSyncService.testConnectivity(body.sendTestMessage !== false);
  }

  @Delete('records')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '清空飞书多维表中的所有记录' })
  @ApiResponse({ status: HttpStatus.OK, description: '清空完成' })
  async deleteAllRecords() {
    return this.feishuSyncService.deleteAllRecords();
  }
}
