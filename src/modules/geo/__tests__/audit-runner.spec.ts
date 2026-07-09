import { AuditRunner } from '../audit-runner';
import { PageFetcher } from '../page-fetcher';

describe('AuditRunner', () => {
  it('runs every check against the fetched page', async () => {
    const fetcher = {
      fetch: jest.fn().mockResolvedValue({
        url: 'https://x.com',
        html: '<html><body>hello world</body></html>',
        robotsTxt: 'User-agent: *\nDisallow:',
        llmsTxt: null,
      }),
    } as unknown as PageFetcher;

    const findings = await new AuditRunner(fetcher).run('https://x.com');

    expect(fetcher.fetch).toHaveBeenCalledWith('https://x.com');
    expect(findings.map((f) => f.dimension)).toEqual(
      expect.arrayContaining([
        'ai-crawler-access',
        'structured-data',
        'core-metadata',
        'client-rendering',
        'basic-authority',
        'llms-txt',
      ]),
    );
  });
});
