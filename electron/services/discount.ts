import { forbidden } from '../utils/errors'
import type { AuthService } from './auth.service'
import type { Actor } from './context'

/** Limite de desconto do usuário (bps): 0 sem a permissão pdv.discount. */
export async function discountLimitOf(auth: AuthService, actor: Actor): Promise<number> {
  if (!actor.permissions.has('pdv.discount')) return 0
  return (await auth.loadActor(actor.userId)).session.maxDiscountBps
}

/** Desconto em bps: exibição (arredondado) e menor limite que o cobre (sem arredondar a favor do usuário). */
export function discountBps(discountCents: number, subtotalCents: number) {
  if (subtotalCents <= 0) return { shown: 0, required: 0 }
  return { shown: Math.round((discountCents * 10000) / subtotalCents), required: Math.ceil((discountCents * 10000) / subtotalCents) }
}

/**
 * Exige autorização de supervisor quando o desconto passa do limite do usuário.
 * Devolve o id de quem autorizou (ou null quando não foi preciso).
 */
export async function authorizeDiscount(
  auth: AuthService,
  actor: Actor,
  discountCents: number,
  requiredBps: number,
  authorization: unknown,
  action: string
): Promise<number | null> {
  if (discountCents <= 0 || requiredBps <= (await discountLimitOf(auth, actor))) return null
  if (!authorization) {
    throw forbidden(`Desconto de ${(requiredBps / 100).toLocaleString('pt-BR')}% acima do seu limite. É necessária a autorização de um supervisor.`)
  }
  const authorizer = await auth.verifyAuthorizer(authorization, 'pdv.discount', { action, requestedBy: actor.userId, minDiscountBps: requiredBps })
  return authorizer.userId
}
