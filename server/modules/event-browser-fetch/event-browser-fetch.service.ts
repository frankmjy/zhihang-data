import { BadRequestException, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class EventBrowserFetchService {
  constructor(private readonly httpService: HttpService) {}

  async fetch(options: { url: string; method?: 'GET' | 'POST'; payload?: unknown }) {
    if (!options.url) {
      throw new BadRequestException('缺少 url');
    }

    const targetUrl = new URL(options.url);
    const method = options.method || 'POST';
    const response = await firstValueFrom(
      this.httpService.request({
        url: targetUrl.toString(),
        method,
        data: method === 'POST' ? options.payload : undefined,
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 45000,
        validateStatus: () => true,
      }),
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`事件内网接口返回 HTTP ${response.status}: ${response.statusText}`);
    }

    return response.data;
  }
}
