import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter } from '../all-exceptions.filter';

function mockHost(
  request = { method: 'GET', url: '/thing', id: 'req-1' },
  headersSent = false,
) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status, headersSent }),
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('wraps an HttpException in the error envelope', () => {
    const { host, status, json } = mockHost();

    filter.catch(new BadRequestException('bad input'), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'bad input',
        requestId: 'req-1',
        path: '/thing',
      }),
    );
  });

  it('masks an unexpected error as a 500 without leaking its details', () => {
    const { host, status, json } = mockHost();

    filter.catch(new Error('postgres://secret@host/db'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('preserves validation message arrays', () => {
    const { host, json } = mockHost();

    filter.catch(
      new BadRequestException(['email invalid', 'name required']),
      host,
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: ['email invalid', 'name required'] }),
    );
  });

  it('does not write a body once the response has started (mid-stream)', () => {
    const { host, status } = mockHost(undefined, true);

    filter.catch(new Error('boom during stream'), host);

    expect(status).not.toHaveBeenCalled();
  });
});
