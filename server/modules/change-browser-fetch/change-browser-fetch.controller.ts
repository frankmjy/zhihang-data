import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ChangeBrowserFetchService } from './change-browser-fetch.service';

@Controller('api/change')
export class ChangeBrowserFetchController {
  constructor(private readonly changeBrowserFetchService: ChangeBrowserFetchService) {}

  @Post('browser-fetch')
  @HttpCode(HttpStatus.OK)
  async browserFetch(@Body() body: { url: string; method?: 'GET' | 'POST'; payload?: unknown }) {
    const data = await this.changeBrowserFetchService.fetch(body);
    return {
      success: true,
      data,
    };
  }
}
