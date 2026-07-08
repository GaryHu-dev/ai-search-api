import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// Exports UsersService so Auth can reuse it (register and Google sign-in create
// users). The dependency runs one way only: Auth depends on Users, never the
// reverse.
@Module({
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
