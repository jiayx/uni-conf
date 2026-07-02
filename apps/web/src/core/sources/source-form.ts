import type { SourceCreateInput, SourceFormat } from '@uni-conf/types';

export interface CreateSourcePayloadOptions {
  name?: string;
  url: string;
  format: SourceFormat;
  updateInterval: number;
  userAgent?: string;
  notes?: string;
  refreshAfterCreate: boolean;
}

export function buildCreateSourcePayload(options: CreateSourcePayloadOptions): SourceCreateInput {
  return {
    ...(options.name?.trim() ? { name: options.name.trim() } : {}),
    url: options.url,
    ...(options.format !== 'auto' ? { format: options.format } : {}),
    ...(options.updateInterval > 0 ? { updateInterval: options.updateInterval } : {}),
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
    ...(options.notes?.trim() ? { notes: options.notes.trim() } : {}),
    ...(options.refreshAfterCreate === false ? { refreshAfterCreate: false } : {}),
  };
}

export function resolveCreateSourceUserAgent(selection: string, customValue: string): string | undefined {
  if (selection === 'custom') return customValue.trim() || undefined;
  return selection || undefined;
}

export function resolveUpdateSourceUserAgent(selection: string, customValue: string): string {
  if (selection === 'custom') return customValue.trim();
  return selection;
}
