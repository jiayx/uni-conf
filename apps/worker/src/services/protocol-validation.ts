import { PROTOCOL_FORM_FIELDS, PROXY_PROTOCOL_REGISTRY, type ProtocolFieldDefinition, type ProxyProtocol } from '@uni-conf/types';
import { jsonParse } from '../db/helpers';

export function isUsableProxyProtocol(value: unknown): value is ProxyProtocol {
  return typeof value === 'string'
    && value in PROXY_PROTOCOL_REGISTRY
    && PROXY_PROTOCOL_REGISTRY[value as ProxyProtocol].mainstream === true;
}

export function missingRequiredProtocolFields(
  protocol: ProxyProtocol,
  parsedConfig: unknown,
  rawConfig: unknown
): string[] {
  const parsed = normalizeRecordValue(parsedConfig) ?? {};
  const raw = normalizeRecordValue(rawConfig) ?? {};
  const extra = normalizeRecordValue(parsed.extra) ?? {};
  return protocolFields(protocol)
    .filter((field) => 'required' in field && field.required)
    .filter((field) => {
      const values = [
        extra[field.key],
        parsed[field.key],
        raw[field.key],
        ...Object.values(field.nativeKeys ?? {}).map((key) => valueAtPath(raw, key)),
        field.defaultValue,
      ];
      return values.every(isMissingValue);
    })
    .map((field) => field.key);
}

function protocolFields(protocol: ProxyProtocol): readonly ProtocolFieldDefinition[] {
  return PROTOCOL_FORM_FIELDS[protocol] as readonly ProtocolFieldDefinition[];
}

function valueAtPath(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, record);
}

function isMissingValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function normalizeRecordValue(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') return jsonParse<Record<string, unknown>>(value) ?? null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
