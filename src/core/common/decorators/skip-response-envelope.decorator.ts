import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_ENVELOPE = 'skipResponseEnvelope';

// Opts a route (or a whole controller) out of the standard success envelope —
// for health probes and binary downloads whose response shape must stay raw.
export const SkipResponseEnvelope = () =>
  SetMetadata(SKIP_RESPONSE_ENVELOPE, true);
