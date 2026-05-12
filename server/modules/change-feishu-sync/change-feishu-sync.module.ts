import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ChangeFeishuSyncController } from './change-feishu-sync.controller';
import { ChangeFeishuSyncService } from './change-feishu-sync.service';

@Module({
  imports: [HttpModule],
  controllers: [ChangeFeishuSyncController],
  providers: [ChangeFeishuSyncService],
  exports: [ChangeFeishuSyncService],
})
export class ChangeFeishuSyncModule {}
