import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { Request, Response } from 'express';

// The 5xx cutoff: at or above this we log and report to Sentry; below it is an
// expected client error.
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

    // Map the Prisma errors we expect to their HTTP meaning so they don't fall
    // through to a generic 500 (e.g. a unique-constraint race on register).
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'A record with these details already exists',
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          error: 'NotFound',
          message: 'The requested record was not found',
        };
      }
    }

    // Multer rejects oversize/invalid uploads before the handler runs.
    if (exception instanceof Error && exception.name === 'MulterError') {
      const code = (exception as { code?: string }).code;
      return code === 'LIMIT_FILE_SIZE'
        ? {
            status: HttpStatus.PAYLOAD_TOO_LARGE,
            error: 'PayloadTooLarge',
            message: 'The uploaded file exceeds the maximum allowed size',
          }
        : {
            status: HttpStatus.BAD_REQUEST,
            error: 'BadRequest',
            message: 'Invalid file upload',
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
