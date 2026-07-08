// The claims we put in an access token. Kept small: only what we trust to read
// back on every request without touching the database.
export interface JwtPayload {
  sub: string; // user id
  tenantId: string;
  email: string;
}

// The shape attached to `request.user` after JwtAuthGuard runs.
export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number; // access-token lifetime in seconds
}
