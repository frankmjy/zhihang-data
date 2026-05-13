import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { InspectBrowserFetchController } from './inspect-browser-fetch.controller';
import { InspectBrowserFetchService } from './inspect-browser-fetch.service';

@Module({
  imports: [HttpModule],
  controllers: [InspectBrowserFetchController],
  providers: [InspectBrowserFetchService],
})
export class InspectBrowserFetchModule {}
