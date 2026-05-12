import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ExtractionModule } from '../extraction/extraction.module';
import { FeishuSyncModule } from '../feishu-sync/feishu-sync.module';
import { AutomationTasksService } from './automation.automation';

@Module({
  imports: [
    HttpModule,
    ExtractionModule,
    FeishuSyncModule,
  ],
  providers: [AutomationTasksService],
  exports: [AutomationTasksService],
})
export class AutomationModule {}
