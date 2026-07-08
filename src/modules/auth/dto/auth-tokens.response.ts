import { ApiProperty } from '@nestjs/swagger';

// Documents the token payload returned by the auth endpoints (for Swagger).
export class AuthTokensResponse {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: string;

  @ApiProperty({
    example: 900,
    description: 'Access-token lifetime in seconds.',
  })
  expiresIn!: number;
}
