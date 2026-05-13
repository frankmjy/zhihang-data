import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { InspectBrowserFetchService } from './inspect-browser-fetch.service';

@Controller('api/inspect')
export class InspectBrowserFetchController {
  constructor(private readonly inspectBrowserFetchService: InspectBrowserFetchService) {}

  @Post('browser-fetch')
  @HttpCode(HttpStatus.OK)
  async browserFetch(@Body() body: { url: string; method?: 'GET' | 'POST'; payload?: unknown }) {
    const data = await this.inspectBrowserFetchService.fetch(body);
    return {
      success: true,
      data,
    };
  }
}
