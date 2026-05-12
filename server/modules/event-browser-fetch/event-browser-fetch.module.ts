import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EventBrowserFetchController } from './event-browser-fetch.controller';
import { EventBrowserFetchService } from './event-browser-fetch.service';

@Module({
  imports: [HttpModule],
  controllers: [EventBrowserFetchController],
  providers: [EventBrowserFetchService],
})
export class EventBrowserFetchModule {}
