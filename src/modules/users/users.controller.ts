import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponse } from './dto/user.response';
import { UsersService } from './users.service';

// Everything here operates on the caller's own account. There is no
// cross-account access surface, which is why these routes only ever read the
// user id from the token, never from a path parameter.
@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<UserResponse> {
    return UserResponse.from(await this.users.getActiveById(user.userId));
  }

  @Patch('me')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponse> {
    return UserResponse.from(await this.users.updateProfile(user.userId, dto));
  }

  @Delete('me')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.users.softDelete(user.userId);
  }
}
