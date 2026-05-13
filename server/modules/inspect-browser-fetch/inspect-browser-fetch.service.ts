import { BadRequestException, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class InspectBrowserFetchService {
  constructor(private readonly httpService: HttpService) {}

  async fetch(options: { url: string; method?: 'GET' | 'POST'; payload?: Record<string, unknown> | unknown }) {
    if (!options.url) {
      throw new BadRequestException('缺少 url');
    }

    const targetUrl = new URL(options.url);
    const method = options.method || 'GET';
    if (method === 'GET' && options.payload && typeof options.payload === 'object' && !Array.isArray(options.payload)) {
      Object.entries(options.payload as Record<string, unknown>).forEach(([key, value]) => {
        if (value !== undefined && value !== null && !targetUrl.searchParams.has(key)) {
          targetUrl.searchParams.set(key, String(value));
        }
      });
    }

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
      throw new Error(`巡检内网接口返回 HTTP ${response.status}: ${response.statusText}`);
    }

    return response.data;
  }
}
