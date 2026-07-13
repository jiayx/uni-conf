import type { SourceFormat, SourceImportInput } from '@uni-conf/types';

export interface ImportSourcePayloadOptions {
  name?: string;
  content: string;
  format: SourceFormat;
  importStructured?: boolean;
}

export function buildImportSourcePayload(options: ImportSourcePayloadOptions): SourceImportInput {
  return {
    ...(options.name?.trim() ? { name: options.name.trim() } : {}),
    content: options.content,
    ...(options.format !== 'auto' ? { format: options.format } : {}),
    ...(options.importStructured ? { importStructured: true } : {}),
  };
}

export function isImportContentValid(content: string): boolean {
  return content.trim().length > 0;
}
