import { Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { count, desc, eq } from 'drizzle-orm';
import type { Request } from 'express';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import {
  extractionRecord,
} from '../../database/schema';
import type {
  TestConnectionDTO,
  TestConnectionResponse,
  CreateExtractionDTO,
  ExtractionRecordDTO,
  GetExtractionsResponse,
  ResponseConfigDTO,
} from '@shared/api.interface';

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly httpService: HttpService,
  ) {}

  async testConnection(dto: TestConnectionDTO): Promise<TestConnectionResponse> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(dto.url, {
          headers: dto.headers,
          timeout: 30000,
          validateStatus: () => true,
        }),
      );

      return {
        isReachable: true,
        statusCode: response.status,
        message: 'Connection successful',
      };
    } catch (error: any) {
      this.logger.error(`Failed to test connection for URL ${dto.url}: ${error.message}`);
      return {
        isReachable: false,
        message: error.message || 'Connection failed',
      };
    }
  }

  async createExtraction(req: Request, dto: CreateExtractionDTO): Promise<ExtractionRecordDTO> {
    const userId: string = req.userContext?.userId;
    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }

    const headersJson = dto.headers ? JSON.stringify(dto.headers) : undefined;
    const payloadJson = dto.payload !== undefined ? JSON.stringify(dto.payload) : undefined;
    const responseConfigJson = dto.responseConfig ? JSON.stringify(dto.responseConfig) : undefined;

    try {
      const requestConfig = {
        headers: dto.headers,
        timeout: 30000,
        validateStatus: () => true,
      };

      const response = await firstValueFrom(
        dto.payload === undefined
          ? this.httpService.get(dto.url, requestConfig)
          : this.httpService.post(dto.url, dto.payload, requestConfig),
      );

      const isSuccessful = response.status >= 200 && response.status < 300;
      let extractedContent: string | undefined;

      if (isSuccessful && dto.responseConfig) {
        extractedContent = this.processResponse(response.data, dto.responseConfig);
      } else if (isSuccessful) {
        extractedContent = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      }

      const newRecord = await this.db
        .insert(extractionRecord)
        .values({
          url: dto.url,
          status: isSuccessful ? 'success' : 'failed',
          extractedContent,
          errorMessage: isSuccessful ? undefined : `HTTP ${response.status}: ${response.statusText}`,
          userId: userId,
          headers: headersJson,
          payload: payloadJson,
          responseConfig: responseConfigJson,
        })
        .returning();

      const record = newRecord[0];

      return {
        id: record.id,
        url: record.url,
        status: record.status as any,
        extractedContent: record.extractedContent ?? undefined,
        errorMessage: record.errorMessage ?? undefined,
        headers: dto.headers,
        payload: dto.payload,
        responseConfig: dto.responseConfig,
        createdAt: record.createdAt.toISOString(),
      };
    } catch (error: any) {
      this.logger.error(`Failed to extract data from URL ${dto.url}: ${error.message}`);

      const failedRecord = await this.db
        .insert(extractionRecord)
        .values({
          url: dto.url,
          status: 'failed',
          errorMessage: error.message || 'Unknown error occurred',
          userId: userId,
          headers: headersJson,
          payload: payloadJson,
          responseConfig: responseConfigJson,
        })
        .returning();

      const record = failedRecord[0];

      return {
        id: record.id,
        url: record.url,
        status: 'failed',
        errorMessage: record.errorMessage ?? undefined,
        headers: dto.headers,
        payload: dto.payload,
        responseConfig: dto.responseConfig,
        createdAt: record.createdAt.toISOString(),
      };
    }
  }

  private processResponse(data: unknown, config: { extractFields?: string[]; format?: 'json' | 'html' | 'text' }): string {
    const format = config.format || 'json';

    if (format === 'json' && typeof data === 'object' && data !== null) {
      if (config.extractFields && config.extractFields.length > 0) {
        const extracted: Record<string, unknown> = {};
        for (const field of config.extractFields) {
          const keys = field.split('.');
          let value: unknown = data;
          for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
              value = (value as Record<string, unknown>)[key];
            } else {
              value = undefined;
              break;
            }
          }
          extracted[field] = value;
        }
        return JSON.stringify(extracted, null, 2);
      }
      return JSON.stringify(data, null, 2);
    }

    if (format === 'html' || format === 'text') {
      return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    }

    return JSON.stringify(data, null, 2);
  }

  async getExtractions(page: number = 1, limit: number = 20): Promise<GetExtractionsResponse> {
    const offset = (page - 1) * limit;

    const [itemsResult, totalResult] = await Promise.all([
      this.db
        .select({
          id: extractionRecord.id,
          url: extractionRecord.url,
          status: extractionRecord.status,
          extractedContent: extractionRecord.extractedContent,
          errorMessage: extractionRecord.errorMessage,
          createdAt: extractionRecord.createdAt,
          headers: extractionRecord.headers,
          payload: extractionRecord.payload,
          responseConfig: extractionRecord.responseConfig,
        })
        .from(extractionRecord)
        .orderBy(desc(extractionRecord.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(extractionRecord)
    ]);

    const items = itemsResult.map((record) => ({
      id: record.id,
      url: record.url,
      status: record.status as any,
      extractedContent: record.extractedContent ?? undefined,
      errorMessage: record.errorMessage ?? undefined,
      headers: this.safeParseJson<Record<string, string>>(record.headers),
      payload: this.safeParseJson<unknown>(record.payload),
      responseConfig: this.safeParseJson<ResponseConfigDTO>(record.responseConfig),
      createdAt: record.createdAt.toISOString(),
    }));

    return {
      items,
      total: Number(totalResult[0]?.total ?? 0),
      page,
      pageSize: limit,
    };
  }

  async getExtractionById(id: string): Promise<ExtractionRecordDTO> {
    const records = await this.db
      .select({
        id: extractionRecord.id,
        url: extractionRecord.url,
        status: extractionRecord.status,
        extractedContent: extractionRecord.extractedContent,
        errorMessage: extractionRecord.errorMessage,
        createdAt: extractionRecord.createdAt,
        headers: extractionRecord.headers,
        payload: extractionRecord.payload,
        responseConfig: extractionRecord.responseConfig,
      })
      .from(extractionRecord)
      .where(eq(extractionRecord.id, id))
      .limit(1);

    if (records.length === 0) {
      throw new NotFoundException('Extraction record not found');
    }

    const record = records[0];

    return {
      id: record.id,
      url: record.url,
      status: record.status as any,
      extractedContent: record.extractedContent ?? undefined,
      errorMessage: record.errorMessage ?? undefined,
      headers: this.safeParseJson<Record<string, string>>(record.headers),
      payload: this.safeParseJson<unknown>(record.payload),
      responseConfig: this.safeParseJson<ResponseConfigDTO>(record.responseConfig),
      createdAt: record.createdAt.toISOString(),
    };
  }

  private safeParseJson<T>(value?: string | null): T | undefined {
    if (!value) return undefined;

    try {
      return JSON.parse(value) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to parse stored extraction JSON: ${message}`);
      return undefined;
    }
  }
}
