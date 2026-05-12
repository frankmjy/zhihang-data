import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { EventBrowserFetchService } from './event-browser-fetch.service';

@Controller('api/event')
export class EventBrowserFetchController {
  constructor(private readonly eventBrowserFetchService: EventBrowserFetchService) {}

  @Post('browser-fetch')
  @HttpCode(HttpStatus.OK)
  async browserFetch(@Body() body: { url: string; method?: 'GET' | 'POST'; payload?: unknown }) {
    const data = await this.eventBrowserFetchService.fetch(body);
    return {
      success: true,
      data,
    };
  }
}
