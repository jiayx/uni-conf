export function validateOptionalBooleanFields(
  value: object,
  fields: readonly string[],
): string | null {
  const body = value as Record<string, unknown>
  const invalidField = fields.find(
    field => body[field] !== undefined && typeof body[field] !== 'boolean',
  )
  return invalidField ? `${invalidField} must be a boolean` : null
}
