import { describe, expect, it } from 'vitest'
import type { WebContents } from 'electron'
import { SessionStore } from '../../electron/main/ipc/router'

const fakeSender = (id: number) => ({ id, once: () => undefined }) as unknown as WebContents

describe('sessões', () => {
  it('bloqueio por inatividade: sessão parada além do limite é encerrada; uso renova o prazo', () => {
    let now = 0
    const store = new SessionStore(() => now)
    store.idleMinutes = 30
    store.set(fakeSender(1), 7)
    now = 29 * 60_000
    expect(store.get(1)).toBe(7) // usada: renova
    now += 29 * 60_000
    expect(store.get(1)).toBe(7)
    now += 31 * 60_000
    expect(store.get(1)).toBeUndefined()
    expect(store.get(1)).toBeUndefined() // continua encerrada
  })

  it('sem limite configurado a sessão não expira', () => {
    let now = 0
    const store = new SessionStore(() => now)
    store.set(fakeSender(2), 3)
    now = 10 * 24 * 3600_000
    expect(store.get(2)).toBe(3)
  })
})
