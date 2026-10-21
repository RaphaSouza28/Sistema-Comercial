import { useState, type FormEvent } from 'react'
import { LogIn } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PasswordField, TextField } from '@/components/ui/Field'
import { ErrorState } from '@/components/ui/Feedback'
import { useAuth } from '@/contexts/AuthContext'
import { AuthLayout } from '@/layouts/AuthLayout'
import { errorMessage } from '@/services/api'

export function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Informe usuário e senha.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await login({ username, password })
    } catch (err) {
      setError(errorMessage(err))
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} className="animate-in w-full max-w-sm" aria-label="Entrar no sistema">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Entrar</h1>
        <p className="mt-1 text-sm text-muted">Use seu usuário e senha para acessar o sistema.</p>

        <div className="mt-8 flex flex-col gap-4">
          {error && <ErrorState message={error} />}
          <TextField
            label="Usuário"
            name="username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <PasswordField
            label="Senha"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" size="lg" loading={loading} icon={<LogIn className="size-4" />} className="mt-2 w-full">
            Entrar
          </Button>
        </div>
        <p className="mt-6 text-center text-xs text-muted">
          Esqueceu a senha? Peça ao administrador para redefini-la em Usuários.
        </p>
      </form>
    </AuthLayout>
  )
}
