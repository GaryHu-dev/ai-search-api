import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContext } from './tenant-context';

// Binds the authenticated user's tenant to the request's async context, so the
// Prisma tenant-scope extension can filter automatically. Runs after the JWT
// guard (which populates request.user); unauthenticated requests carry no
// tenant, and tenant-scoped models are only reachable behind the guard anyway.
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { tenantId?: string } }>();

    // enterWith, not run(): the binding must outlive this synchronous call and
    // stay in scope while the returned observable is subscribed and the handler
    // runs. run()'s scope would end the moment this method returns.
    const tenantId = request.user?.tenantId;
    if (tenantId) {
      TenantContext.enterWith(tenantId);
    }

    return next.handle();
  }
}
