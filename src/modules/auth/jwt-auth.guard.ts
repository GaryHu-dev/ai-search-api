import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Guards routes that require a valid access token. Rejects with 401 when the
// bearer token is missing, malformed, or expired.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
