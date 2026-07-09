import type { CheerioAPI } from 'cheerio';

export type FindingStatus = 'ok' | 'needs_work';

// 'hard' = a first-party fact or established standard; 'advisory' = best practice.
export type EvidenceStrength = 'hard' | 'advisory';

// One audited dimension's result. `basis` is the citable source behind the call.
export interface Finding {
  dimension: string;
  title: string;
  status: FindingStatus;
  summary: string;
  detail: string;
  recommendation: string;
  basis: string;
  strength: EvidenceStrength;
}

// Everything a check needs about the fetched homepage, parsed once.
export interface PageContext {
  url: string;
  html: string;
  $: CheerioAPI;
  robotsTxt: string | null;
  llmsTxt: string | null;
}

// A pluggable audit dimension. Pure: no I/O, no state — just context in, finding out.
export interface GeoCheck {
  readonly dimension: string;
  run(ctx: PageContext): Finding;
}
