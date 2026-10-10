import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const BUCKET_NAME = 'question-images';
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

@Injectable()
export class StorageService {
  private readonly supabase: SupabaseClient;

  constructor(configService: ConfigService) {
    const supabaseUrl = configService.getOrThrow<string>('SUPABASE_URL');
    const serviceRoleKey = configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');
    const parsedUrl = new URL(supabaseUrl);

    if (
      !['http:', 'https:'].includes(parsedUrl.protocol) ||
      (parsedUrl.hostname === 'supabase.com' && parsedUrl.pathname.includes('/dashboard'))
    ) {
      throw new Error(
        'SUPABASE_URL must be the project API URL (for example, https://<project-ref>.supabase.co), not a dashboard URL.',
      );
    }

    this.supabase = createClient(supabaseUrl, serviceRoleKey);
  }

  async uploadQuestionImage(file: Buffer, fileName: string): Promise<string> {
    if (!Buffer.isBuffer(file) || file.length === 0) {
      throw new Error('Question image must be a non-empty Buffer.');
    }

    const safeFileName = fileName.trim();
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(gif|jpe?g|png|webp)$/i.test(safeFileName) ||
      safeFileName.includes('..')
    ) {
      throw new Error('Question image filename must be a simple name with a supported image extension.');
    }

    const contentType = IMAGE_CONTENT_TYPES[
      safeFileName.slice(safeFileName.lastIndexOf('.')).toLowerCase()
    ];
    const objectPath = `questions/${safeFileName}`;
    const { error } = await this.supabase.storage
      .from(BUCKET_NAME)
      .upload(objectPath, file, { contentType, upsert: false });

    if (error) {
      throw new Error('Failed to upload question image to Supabase Storage.', { cause: error });
    }

    return objectPath;
  }

  async createSignedQuestionImageUrls(paths: string[]): Promise<Map<string, string>> {
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length === 0) return new Map();

    for (const path of uniquePaths) {
      if (!/^questions\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(gif|jpe?g|png|webp)$/i.test(path) || path.includes('..')) {
        throw new Error('Question image paths must point to supported files in the questions folder.');
      }
    }

    const { data, error } = await this.supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrls(uniquePaths, 3600);

    if (error) {
      throw new Error('Failed to create signed URLs for question images.', { cause: error });
    }

    const signedUrls = new Map<string, string>();
    for (const item of data) {
      if (!item.path || !item.signedUrl || item.error) {
        throw new Error(`Failed to create a signed URL for question image "${item.path ?? 'unknown'}".`);
      }
      signedUrls.set(item.path, item.signedUrl);
    }

    if (signedUrls.size !== uniquePaths.length) {
      throw new Error('Supabase returned an incomplete set of signed question image URLs.');
    }

    return signedUrls;
  }
}
