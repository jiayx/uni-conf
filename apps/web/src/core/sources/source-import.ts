import type { SourceFormat, SourceImportInput } from '@uni-conf/types';
import { MAX_SOURCE_CONTENT_BYTES } from '@uni-conf/shared';

export interface ImportSourcePayloadOptions {
  name?: string;
  content: string;
  format: SourceFormat;
  importStructured?: boolean;
  nodeImportMode?: SourceImportInput['nodeImportMode'];
  structuredConflictResolutions?: SourceImportInput['structuredConflictResolutions'];
}

export function buildImportSourcePayload(options: ImportSourcePayloadOptions): SourceImportInput {
  return {
    ...(options.name?.trim() ? { name: options.name.trim() } : {}),
    content: options.content,
    ...(options.format !== 'auto' ? { format: options.format } : {}),
    ...(options.importStructured ? { importStructured: true } : {}),
    ...(options.nodeImportMode === 'new-only' ? { nodeImportMode: 'new-only' as const } : {}),
    ...(options.structuredConflictResolutions && Object.keys(options.structuredConflictResolutions).length > 0
      ? { structuredConflictResolutions: options.structuredConflictResolutions }
      : {}),
  };
}

export function isImportContentValid(content: string): boolean {
  return content.trim().length > 0;
}

export function getImportContentByteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

export function isImportContentWithinSizeLimit(content: string): boolean {
  return getImportContentByteLength(content) <= MAX_SOURCE_CONTENT_BYTES;
}

export function isImportFileWithinSizeLimit(size: number): boolean {
  return Number.isFinite(size) && size >= 0 && size <= MAX_SOURCE_CONTENT_BYTES;
}
