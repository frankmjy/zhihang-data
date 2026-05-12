import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DrillBrowserFetchController } from './drill-browser-fetch.controller';
import { DrillBrowserFetchService } from './drill-browser-fetch.service';

@Module({
  imports: [HttpModule],
  controllers: [DrillBrowserFetchController],
  providers: [DrillBrowserFetchService],
})
export class DrillBrowserFetchModule {}
