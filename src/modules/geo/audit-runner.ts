import { Injectable } from '@nestjs/common';
import { load } from 'cheerio';
import { ALL_CHECKS } from './checks';
import { Finding, PageContext } from './geo.types';
import { PageFetcher } from './page-fetcher';

@Injectable()
export class AuditRunner {
  constructor(private readonly fetcher: PageFetcher) {}

  async run(url: string): Promise<Finding[]> {
    const page = await this.fetcher.fetch(url);
    const ctx: PageContext = {
      url: page.url,
      html: page.html,
      $: load(page.html),
      robotsTxt: page.robotsTxt,
      llmsTxt: page.llmsTxt,
    };
    return ALL_CHECKS.map((check) => check.run(ctx));
  }
}
