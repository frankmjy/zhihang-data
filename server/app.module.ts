import { APP_FILTER } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { AutomationModule } from './modules/automation/automation.module';
import { ChangeBrowserFetchModule } from './modules/change-browser-fetch/change-browser-fetch.module';
import { ChangeFeishuSyncModule } from './modules/change-feishu-sync/change-feishu-sync.module';
import { DrillBrowserFetchModule } from './modules/drill-browser-fetch/drill-browser-fetch.module';
import { DrillFeishuSyncModule } from './modules/drill-feishu-sync/drill-feishu-sync.module';
import { EventBrowserFetchModule } from './modules/event-browser-fetch/event-browser-fetch.module';
import { ExtractionModule } from './modules/extraction/extraction.module';
import { FeishuSyncModule } from './modules/feishu-sync/feishu-sync.module';
import { ViewModule } from './modules/view/view.module';
import { WeatherModule } from './modules/weather/weather.module';

@Module({
  imports: [
    // 平台 Module，提供平台能力
    PlatformModule.forRoot(),
    // ====== @route-section: business-modules START ======
    // Place all business modules here.Do NOT add fallback modules here.
    AutomationModule,
    ChangeBrowserFetchModule,
    ChangeFeishuSyncModule,
    DrillBrowserFetchModule,
    DrillFeishuSyncModule,
    EventBrowserFetchModule,
    ExtractionModule,
    FeishuSyncModule,
    WeatherModule,
    // ====== @route-section: business-modules END ======

    // ⚠️ @route-order: last
    // ViewModule is the fallback route module, must be registered last.
    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
