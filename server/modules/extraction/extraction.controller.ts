import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ExtractionService } from './extraction.service';
import type {
  TestConnectionDTO,
  TestConnectionResponse,
  CreateExtractionDTO,
  ExtractionRecordDTO,
  GetExtractionsQuery,
  GetExtractionsResponse,
} from '@shared/api.interface';
import {
  NeedLogin
} from "@lark-apaas/fullstack-nestjs-core";
import type { Request } from 'express';

@Controller('api/extractions')
export class ExtractionController {
  constructor(private readonly extractionService: ExtractionService) {}

  @Get(':id')
  async getExtractionById(
    @Param('id') id: string,
  ): Promise<ExtractionRecordDTO> {
    return this.extractionService.getExtractionById(id);
  }

  @Get()
  async getExtractions(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<GetExtractionsResponse> {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
      throw new BadRequestException('Invalid page or limit parameters');
    }

    return this.extractionService.getExtractions(pageNum, limitNum);
  }

  @Post('test-connection')
  async testConnection(
    @Body() dto: TestConnectionDTO,
  ): Promise<TestConnectionResponse> {
    return this.extractionService.testConnection(dto);
  }

  @NeedLogin()
  @Post()
  async createExtraction(
    @Req() req: Request,
    @Body() dto: CreateExtractionDTO,
  ): Promise<ExtractionRecordDTO> {
    return this.extractionService.createExtraction(req, dto);
  }
}
