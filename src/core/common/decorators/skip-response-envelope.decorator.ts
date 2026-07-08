import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_ENVELOPE = 'skipResponseEnvelope';

// Opts a route (or a whole controller) out of the standard success envelope, so
// the handler's response is returned exactly as-is. Used by the health probes,
// which must return Terminus's own output. (Binary downloads bypass the envelope
// automatically via the StreamableFile check, without this decorator.)
export const SkipResponseEnvelope = () =>
  SetMetadata(SKIP_RESPONSE_ENVELOPE, true);
