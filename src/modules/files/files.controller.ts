import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Page, PaginationQuery } from '../../core/common/pagination';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FileResponse } from './dto/file.response';
import { FilesService } from './files.service';

// All routes operate strictly within the caller's tenant. Uploads are buffered
// through the API (simple and correct at our scale); if large files become
// common, this is the seam to switch to presigned direct-to-storage uploads.
@ApiTags('files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<FileResponse> {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return FileResponse.from(
      await this.files.upload(user.tenantId, user.userId, file),
    );
  }

  @Get()
  async list(@Query() query: PaginationQuery): Promise<Page<FileResponse>> {
    const page = await this.files.list(query);
    return {
      items: page.items.map((file) => FileResponse.from(file)),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':id/download')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const { file, stream } = await this.files.download(id);
    return new StreamableFile(stream, {
      type: file.contentType,
      disposition: `attachment; filename="${file.filename}"`,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.files.remove(id);
  }
}
