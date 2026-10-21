import { z } from 'zod'
import { isValidCpfOrCnpj, onlyDigits } from './documents'
import { ALL_PERMISSIONS } from './permissions'

/** Texto opcional: espaços removidos; vazio vira null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null))

const optionalDigits = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v ? onlyDigits(v) : ''))
    .refine((v) => v.length <= max, `Máximo de ${max} dígitos`)
    .transform((v) => (v ? v : null))

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'O usuário deve ter ao menos 3 caracteres')
  .max(32, 'O usuário deve ter no máximo 32 caracteres')
  .regex(/^[a-z0-9._-]+$/, 'Use apenas letras sem acento, números, ponto, hífen ou sublinhado')

export const passwordSchema = z
  .string()
  .min(8, 'A senha deve ter ao menos 8 caracteres')
  .max(128, 'A senha deve ter no máximo 128 caracteres')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'A senha deve conter letras e números')

export const personNameSchema = z
  .string()
  .trim()
  .min(2, 'Informe o nome')
  .max(120, 'Máximo de 120 caracteres')

export const companySchema = z.object({
  legalName: z.string().trim().min(2, 'Informe a razão social ou nome da empresa').max(150),
  tradeName: optionalText(150),
  document: optionalDigits(14).refine((v) => v === null || isValidCpfOrCnpj(v), 'CPF/CNPJ inválido'),
  stateRegistration: optionalText(30),
  /** Código de Regime Tributário (CRT) da NF-e: 1 Simples Nacional, 2 Simples (excesso de sublimite), 3 Normal, 4 MEI. */
  taxRegime: z
    .string()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[1-4]$/.test(v), 'Regime tributário inválido'),
  phone: optionalDigits(13),
  email: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.email().safeParse(v).success, 'E-mail inválido'),
  zipCode: optionalDigits(8),
  street: optionalText(150),
  number: optionalText(20),
  complement: optionalText(80),
  district: optionalText(80),
  city: optionalText(80),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[A-Z]{2}$/.test(v), 'UF deve ter 2 letras')
})

export const setupSchema = z
  .object({
    company: companySchema,
    admin: z.object({
      name: personNameSchema,
      username: usernameSchema,
      password: passwordSchema,
      passwordConfirm: z.string()
    }),
    preferences: z.object({
      lowStockAlerts: z.boolean().default(true),
      allowNegativeStock: z.boolean().default(false)
    })
  })
  .refine((v) => v.admin.password === v.admin.passwordConfirm, {
    message: 'As senhas não conferem',
    path: ['admin', 'passwordConfirm']
  })

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Informe o usuário').max(64),
  password: z.string().min(1, 'Informe a senha').max(128)
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual').max(128),
    newPassword: passwordSchema,
    newPasswordConfirm: z.string()
  })
  .refine((v) => v.newPassword === v.newPasswordConfirm, {
    message: 'As senhas não conferem',
    path: ['newPasswordConfirm']
  })

const discountBpsSchema = z.number().int().min(0, 'Mínimo 0%').max(10000, 'Máximo 100%')

export const userCreateSchema = z
  .object({
    name: personNameSchema,
    username: usernameSchema,
    roleId: z.number().int().positive('Selecione o perfil'),
    password: passwordSchema,
    passwordConfirm: z.string(),
    maxDiscountBps: discountBpsSchema.default(0),
    mustChangePassword: z.boolean().default(true)
  })
  .refine((v) => v.password === v.passwordConfirm, {
    message: 'As senhas não conferem',
    path: ['passwordConfirm']
  })

export const userUpdateSchema = z.object({
  id: z.number().int().positive(),
  name: personNameSchema,
  roleId: z.number().int().positive('Selecione o perfil'),
  active: z.boolean(),
  maxDiscountBps: discountBpsSchema
})

export const userResetPasswordSchema = z
  .object({
    id: z.number().int().positive(),
    password: passwordSchema,
    passwordConfirm: z.string()
  })
  .refine((v) => v.password === v.passwordConfirm, {
    message: 'As senhas não conferem',
    path: ['passwordConfirm']
  })

export const roleUpdatePermissionsSchema = z.object({
  roleId: z.number().int().positive(),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).max(ALL_PERMISSIONS.length)
})

export type SetupInput = z.input<typeof setupSchema>
export type CompanyInput = z.input<typeof companySchema>
export type LoginInput = z.input<typeof loginSchema>
export type ChangePasswordInput = z.input<typeof changePasswordSchema>
export type UserCreateInput = z.input<typeof userCreateSchema>
export type UserUpdateInput = z.input<typeof userUpdateSchema>
export type UserResetPasswordInput = z.input<typeof userResetPasswordSchema>
export type RoleUpdatePermissionsInput = z.input<typeof roleUpdatePermissionsSchema>
