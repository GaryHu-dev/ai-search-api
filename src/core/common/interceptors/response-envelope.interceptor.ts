import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SKIP_RESPONSE_ENVELOPE } from '../decorators/skip-response-envelope.decorator';

export interface ResponseEnvelope<T> {
  data: T;
  requestId?: string;
}

// Wraps successful responses in a consistent { data, requestId } envelope — the
// success-side counterpart to AllExceptionsFilter's error envelope, so clients
// get one predictable shape and the same correlation id on both paths.
//
// Left untouched: binary downloads (StreamableFile), empty 204 responses, and
// anything explicitly marked @SkipResponseEnvelope (e.g. health probes).
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_ENVELOPE,
      [context.getHandler(), context.getClass()],
    );
    if (skip) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<{ id?: string }>();

    return next.handle().pipe(
      map((data: unknown) => {
        if (
          data instanceof StreamableFile ||
          data === undefined ||
          data === null
        ) {
          return data;
        }
        return { data, requestId: request.id };
      }),
    );
  }
}
