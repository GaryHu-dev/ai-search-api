import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Audit } from '@prisma/client';
import { ListQuery, Page, parseSort } from '../../core/common/pagination';
import { JobsService } from '../../core/jobs/jobs.service';
import {
  TENANT_PRISMA,
  TenantPrismaClient,
} from '../../core/prisma/prisma.module';
import { GEO_AUDIT_QUEUE, GeoAuditJobData } from './geo.constants';

const SORTABLE_FIELDS = ['createdAt', 'url', 'status'] as const;

// Cap concurrent in-flight audits per tenant: each fans out to several outbound
// fetches, so this blunts queue-flooding and outbound amplification.
const MAX_INFLIGHT_PER_TENANT = 5;

// List rows omit the (potentially large) findings JSON; full findings come from
// findOne.
export type AuditSummary = Pick<
  Audit,
  'id' | 'url' | 'status' | 'error' | 'createdAt'
>;

@Injectable()
export class AuditsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    private readonly jobs: JobsService,
  ) {}

  // tenantId is a required column; it's passed explicitly here (the tenant-scope
  // extension also injects it from request context, so the two agree) and read
  // back for the job payload.
  async create(
    url: string,
    requestedById: string,
    tenantId: string,
  ): Promise<Audit> {
    // Tenant-scoped count (the extension injects tenantId): reject if too many
    // are already queued/running for this tenant.
    const inflight = await this.prisma.audit.count({
      where: { status: { in: ['PENDING', 'PROCESSING'] } },
    });
    if (inflight >= MAX_INFLIGHT_PER_TENANT) {
      throw new HttpException(
        'Too many audits in progress; wait for some to finish',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const audit = await this.prisma.audit.create({
      data: { url, requestedById, tenantId },
    });
    const payload: GeoAuditJobData = {
      auditId: audit.id,
      tenantId: audit.tenantId,
    };
    try {
      // A slow audit shouldn't be reclaimed mid-run; the reaper handles crashes.
      await this.jobs.enqueue(GEO_AUDIT_QUEUE, payload, {
        expireInSeconds: 300,
        retryLimit: 0,
      });
    } catch (err) {
      // Don't leave a PENDING orphan that no worker will ever pick up.
      await this.prisma.audit.update({
        where: { id: audit.id },
        data: { status: 'FAILED', error: 'Could not queue the audit' },
      });
      throw err;
    }
    return audit;
  }

  async findOne(id: string): Promise<Audit> {
    const audit = await this.prisma.audit.findFirst({ where: { id } });
    if (!audit) throw new NotFoundException('Audit not found');
    return audit;
  }

  async list(query: ListQuery): Promise<Page<AuditSummary>> {
    const where = query.search
      ? { url: { contains: query.search, mode: 'insensitive' as const } }
      : {};
    const rows = await this.prisma.audit.findMany({
      where,
      select: {
        id: true,
        url: true,
        status: true,
        error: true,
        createdAt: true,
      },
      orderBy: parseSort(query.sort, SORTABLE_FIELDS, {
        field: 'createdAt',
        order: 'desc',
      }),
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }
}
