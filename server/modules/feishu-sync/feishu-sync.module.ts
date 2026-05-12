import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { FeishuSyncController } from './feishu-sync.controller';
import { FeishuSyncService } from './feishu-sync.service';

@Module({
  imports: [HttpModule],
  controllers: [FeishuSyncController],
  providers: [FeishuSyncService],
  exports: [FeishuSyncService],
})
export class FeishuSyncModule {}
