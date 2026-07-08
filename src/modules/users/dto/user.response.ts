import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '@prisma/client';

// The public representation of a user. Explicit mapping keeps internal columns
// (tenant id, timestamps we don't expose, soft-delete state) out of responses,
// and gives us one place to evolve the API shape independently of the table.
export class UserResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiPropertyOptional({ nullable: true })
  displayName!: string | null;

  @ApiProperty()
  createdAt!: Date;

  static from(user: User): UserResponse {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
    };
  }
}
