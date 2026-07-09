import { GeoCheck } from '../geo.types';
import { basicAuthorityCheck } from './basic-authority.check';
import { clientRenderingCheck } from './client-rendering.check';
import { coreMetadataCheck } from './core-metadata.check';
import { crawlerAccessCheck } from './crawler-access.check';
import { llmsTxtCheck } from './llms-txt.check';
import { structuredDataCheck } from './structured-data.check';

// Order = display order in the report.
export const ALL_CHECKS: GeoCheck[] = [
  crawlerAccessCheck,
  clientRenderingCheck,
  structuredDataCheck,
  coreMetadataCheck,
  basicAuthorityCheck,
  llmsTxtCheck,
];
