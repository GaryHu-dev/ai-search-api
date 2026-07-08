import { ApiProperty } from '@nestjs/swagger';

// Swagger needs a concrete class to document the response shape; the value
// returned at runtime is the AuthTokens interface.
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
