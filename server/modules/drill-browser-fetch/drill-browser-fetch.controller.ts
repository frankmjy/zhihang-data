import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { DrillBrowserFetchService } from './drill-browser-fetch.service';

@Controller('api/drill')
export class DrillBrowserFetchController {
  constructor(private readonly drillBrowserFetchService: DrillBrowserFetchService) {}

  @Post('browser-fetch')
  @HttpCode(HttpStatus.OK)
  async browserFetch(@Body() body: { url: string; method?: 'GET' | 'POST'; payload?: unknown }) {
    const data = await this.drillBrowserFetchService.fetch(body);
    return {
      success: true,
      data,
    };
  }
}
