import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DrillFeishuSyncController } from './drill-feishu-sync.controller';
import { DrillFeishuSyncService } from './drill-feishu-sync.service';

@Module({
  imports: [HttpModule],
  controllers: [DrillFeishuSyncController],
  providers: [DrillFeishuSyncService],
  exports: [DrillFeishuSyncService],
})
export class DrillFeishuSyncModule {}
