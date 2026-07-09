// pg-boss queue for GEO audits, and the payload the worker receives.
export const GEO_AUDIT_QUEUE = 'geo.audit';

export interface GeoAuditJobData {
  auditId: string;
  tenantId: string;
}
