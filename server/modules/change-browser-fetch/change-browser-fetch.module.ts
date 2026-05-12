import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ChangeBrowserFetchController } from './change-browser-fetch.controller';
import { ChangeBrowserFetchService } from './change-browser-fetch.service';

@Module({
  imports: [HttpModule],
  controllers: [ChangeBrowserFetchController],
  providers: [ChangeBrowserFetchService],
})
export class ChangeBrowserFetchModule {}
