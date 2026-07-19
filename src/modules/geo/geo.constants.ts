// pg-boss queue for GEO audits, and the payload the worker receives.
export const GEO_AUDIT_QUEUE = 'geo.audit';

// Recurring sweep that fails audits stuck in PROCESSING after a worker crash.
export const GEO_REAP_QUEUE = 'geo.audit.reap';

// Recurring retention sweep that deletes old audits (and their scraped content).
export const GEO_PURGE_QUEUE = 'geo.audit.purge';

export interface GeoAuditJobData {
  auditId: string;
  tenantId: string;
}
