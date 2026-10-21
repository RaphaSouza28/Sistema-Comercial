import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SessionUser } from '@shared/api'
import type { Permission } from '@shared/permissions'
import type { LoginInput, SetupInput } from '@shared/schemas'
import { api, call } from '@/services/api'
import { useToast } from './ToastContext'

type Status = 'loading' | 'needs-setup' | 'anonymous' | 'authenticated' | 'error'

interface AuthContextValue {
  status: Status
  user: SessionUser | null
  error: string | null
  login(input: LoginInput): Promise<void>
  completeSetup(input: SetupInput): Promise<void>
  logout(): Promise<void>
  refresh(): Promise<void>
  can(...anyOf: Permission[]): boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Cada sessão começa na tela inicial do perfil (evita herdar a rota do usuário anterior). */
const goHome = () => {
  if (window.location.hash !== '#/') window.location.hash = '#/'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<SessionUser | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { needsSetup } = await call(api.setup.status())
      if (needsSetup) {
        setUser(null)
        setStatus('needs-setup')
        return
      }
      const session = await call(api.auth.session())
      setUser(session)
      setStatus(session ? 'authenticated' : 'anonymous')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao iniciar')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Sessão invalidada no processo principal (ex.: usuário desativado).
  useEffect(() => {
    const onUnauthenticated = () => {
      setUser(null)
      setStatus((s) => (s === 'authenticated' ? 'anonymous' : s))
    }
    window.addEventListener('sc:unauthenticated', onUnauthenticated)
    return () => window.removeEventListener('sc:unauthenticated', onUnauthenticated)
  }, [])

  // Bloqueio por inatividade: sem teclado/mouse pelo tempo configurado, a sessão é encerrada e a tela
  // volta ao login (nada fica exposto na tela). O servidor também expira a sessão por conta própria.
  const toast = useToast()
  const lastActivity = useRef(Date.now())
  const lastPing = useRef(Date.now())
  const idleMinutes = status === 'authenticated' ? (user?.idleMinutes ?? 0) : 0
  useEffect(() => {
    if (!idleMinutes) return
    lastActivity.current = Date.now()
    const onActivity = () => {
      lastActivity.current = Date.now()
      // Uso contínuo sem chamadas ao sistema (ex.: lendo um relatório) também mantém a sessão viva no servidor
      if (Date.now() - lastPing.current > 2 * 60_000) {
        lastPing.current = Date.now()
        void api.auth.session()
      }
    }
    const events = ['mousedown', 'mousemove', 'keydown', 'wheel', 'touchstart'] as const
    for (const e of events) window.addEventListener(e, onActivity, { passive: true })
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current < idleMinutes * 60_000) return
      void call(api.auth.logout()).catch(() => undefined)
      goHome()
      setUser(null)
      setStatus('anonymous')
      toast.info('Sessão encerrada por inatividade. Entre novamente.')
    }, 15_000)
    return () => {
      for (const e of events) window.removeEventListener(e, onActivity)
      clearInterval(timer)
    }
  }, [idleMinutes, toast])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      error,
      refresh,
      async login(input) {
        const session = await call(api.auth.login(input))
        goHome()
        setUser(session)
        setStatus('authenticated')
      },
      async completeSetup(input) {
        const session = await call(api.setup.complete(input))
        goHome()
        setUser(session)
        setStatus('authenticated')
      },
      async logout() {
        try {
          await call(api.auth.logout())
        } finally {
          goHome()
          setUser(null)
          setStatus('anonymous')
        }
      },
      can: (...anyOf) => !!user && anyOf.some((p) => user.permissions.includes(p))
    }),
    [status, user, error, refresh]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}
