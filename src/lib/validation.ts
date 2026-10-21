import type { ZodType } from 'zod'

/** Valida no cliente com o mesmo schema do processo principal; devolve erros por campo. */
export function validate(schema: ZodType, value: unknown): Record<string, string> {
  const result = schema.safeParse(value)
  if (result.success) return {}
  const fields: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_'
    fields[key] ??= issue.message
  }
  return fields
}

/** Remove um prefixo das chaves ("company.legalName" -> "legalName"). */
export function scoped(fields: Record<string, string>, prefix: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (k.startsWith(prefix + '.')) out[k.slice(prefix.length + 1)] = v
  }
  return out
}
