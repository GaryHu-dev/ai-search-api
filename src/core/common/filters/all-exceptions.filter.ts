import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Request, Response } from 'express';

// HttpStatus.INTERNAL_SERVER_ERROR as a plain number, so the threshold check
// stays a number-to-number comparison.
const SERVER_ERROR_MIN = 500;

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId?: string;
  path: string;
  timestamp: string;
}

// Turns every thrown error into one consistent JSON envelope, so clients and
// support tooling can rely on a stable shape — and quote `requestId` back to us
// to find the matching log line.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();

    const { status, error, message } = this.describe(exception);

    // Expected 4xx are part of normal operation; only surface 5xx (with a
    // stack) as errors worth investigating.
    if (status >= SERVER_ERROR_MIN) {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // Report to Sentry (a no-op when no DSN is configured). 4xx are expected
      // client errors and deliberately not reported.
      Sentry.captureException(exception);
    }

    // If the response has already started (e.g. a file stream that failed
    // mid-flight), we can't render an envelope — writing again would throw.
    // The error is already logged above; let the stream terminate.
    if (response.headersSent) {
      return;
    }

    const body: ErrorBody = {
      statusCode: status,
      error,
      message,
      requestId: request.id,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }

  private describe(exception: unknown): {
    status: number;
    error: string;
    message: string | string[];
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { status, error: exception.name, message: payload };
      }

      const record = payload as { message?: string | string[]; error?: string };
      return {
        status,
        error: record.error ?? exception.name,
        message: record.message ?? exception.message,
      };
    }

    // Anything that isn't an HttpException is a bug: never leak its details.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      message: 'An unexpected error occurred',
    };
  }
}
