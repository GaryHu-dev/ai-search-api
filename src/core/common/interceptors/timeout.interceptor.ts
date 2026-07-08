import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { Env } from '../../config/env.validation';

// Fails a request that takes too long to produce its response, so a stuck
// handler can't hold a connection (and a worker slot) open indefinitely. Applies
// to the handler's response, not to streaming bodies emitted afterwards.
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  private readonly ms: number;

  constructor(config: ConfigService<Env, true>) {
    this.ms = config.get('REQUEST_TIMEOUT_MS', { infer: true });
  }

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.ms),
      catchError((error: unknown) =>
        error instanceof TimeoutError
          ? throwError(() => new RequestTimeoutException())
          : throwError(() => error),
      ),
    );
  }
}
