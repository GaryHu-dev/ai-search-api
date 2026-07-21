import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// AuthGuard('google') with its failure behaviour softened: instead of throwing a
// 401 (which would surface a raw JSON error in the user's browser mid-redirect),
// we let the handler run with no `request.user` so the callback route can bounce
// the browser back to the frontend with an error fragment.
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  handleRequest<TUser>(_err: unknown, user: TUser): TUser {
    return user || (null as TUser);
  }
}
