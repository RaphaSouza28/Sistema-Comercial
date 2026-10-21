import { z } from 'zod'

export const BACKUP_INTERVALS = { 6: 'A cada 6 horas', 12: 'A cada 12 horas', 24: 'Diário', 168: 'Semanal' } as const

export const backupSettingsSchema = z.object({
  /** Pasta de destino (pode ser um pendrive/HD externo). null = pasta padrão do sistema. */
  directory: z
    .string()
    .trim()
    .max(400)
    .nullish()
    .transform((v) => (v ? v : null)),
  automatic: z.boolean().default(true),
  intervalHours: z.union([z.literal(6), z.literal(12), z.literal(24), z.literal(168)]).default(24),
  /** Quantos backups automáticos manter (os mais antigos são apagados). */
  retention: z.number().int().min(3).max(120).default(14),
  /** Criptografa os arquivos (AES-256-GCM) com a senha do backup. */
  encrypt: z.boolean().default(false)
})
export type BackupSettings = z.output<typeof backupSettingsSchema>
export type BackupSettingsInput = z.input<typeof backupSettingsSchema>

export const backupPasswordSchema = z
  .object({
    password: z.string().min(8, 'Use ao menos 8 caracteres').max(128),
    passwordConfirm: z.string()
  })
  .refine((v) => v.password === v.passwordConfirm, { message: 'As senhas não conferem', path: ['passwordConfirm'] })

/** Restauração: exige a senha do próprio usuário (confirmação de operação crítica). */
export const restoreSchema = z
  .object({
    recordId: z.number().int().positive().optional(),
    token: z.string().uuid().optional(),
    /** Senha do arquivo criptografado (quando o backup veio de outro computador ou a senha mudou). */
    backupPassword: z.string().max(128).optional(),
    userPassword: z.string().min(1, 'Confirme com a sua senha'),
    confirmText: z.literal('RESTAURAR', { error: 'Digite RESTAURAR para confirmar' })
  })
  .refine((v) => !!v.recordId !== !!v.token, { message: 'Escolha o backup a restaurar' })

export const securitySettingsSchema = z.object({
  /** Encerra a sessão após N minutos sem uso (0 = nunca). */
  idleMinutes: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60), z.literal(120)]).default(60)
})
export type SecuritySettings = z.output<typeof securitySettingsSchema>

export type RestoreInput = z.input<typeof restoreSchema>
export type BackupPasswordInput = z.input<typeof backupPasswordSchema>
