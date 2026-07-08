import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  email!: string;

  // No length rules here on purpose: login shouldn't advertise the password
  // policy, and rejecting on length would leak it.
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;
}
