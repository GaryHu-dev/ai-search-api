import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ListQuery, Page } from '../../core/common/pagination';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditsService } from './audits.service';
import { AuditResponse, AuditSummaryResponse } from './dto/audit.response';
import { CreateAuditDto } from './dto/create-audit.dto';

@ApiTags('audits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audits')
export class AuditsController {
  constructor(private readonly audits: AuditsService) {}

  @Post()
  @HttpCode(202) // accepted; runs asynchronously, poll GET /audits/:id
  // Each audit makes several outbound fetches, so cap submissions tighter than
  // the global limit. (A per-tenant quota would need a custom throttler — later.)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAuditDto,
  ): Promise<AuditResponse> {
    return AuditResponse.from(
      await this.audits.create(dto.url, user.userId, user.tenantId),
    );
  }

  @Get()
  async list(@Query() query: ListQuery): Promise<Page<AuditSummaryResponse>> {
    const page = await this.audits.list(query);
    return {
      items: page.items.map((a) => AuditSummaryResponse.from(a)),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AuditResponse> {
    return AuditResponse.from(await this.audits.findOne(id));
  }
}
