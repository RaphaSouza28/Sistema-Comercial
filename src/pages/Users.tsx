import { useMemo, useState, type FormEvent } from 'react'
import { KeyRound, Lock, Pencil, Plus, ShieldCheck, UserCog } from 'lucide-react'
import type { PermissionDto, RoleDto, UserDto } from '@shared/api'
import { formatDateTime, formatPercentBps } from '@shared/format'
import type { Permission } from '@shared/permissions'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, PageHeader } from '@/components/ui/Card'
import { Checkbox, PasswordField, SelectField, TextField } from '@/components/ui/Field'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call, errorMessage, fieldErrors } from '@/services/api'

type Tab = 'users' | 'roles'

export function UsersPage() {
  const [tab, setTab] = useState<Tab>('users')
  const users = useAsync(() => call(api.users.list()))
  const roles = useAsync(() => call(api.roles.list()))
  const permissions = useAsync(() => call(api.roles.permissions()))

  const reloadAll = () => {
    void users.reload()
    void roles.reload()
  }

  return (
    <div className="animate-in">
      <PageHeader title="Usuários" description="Funcionários com acesso ao sistema, perfis e permissões." />
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {(
          [
            ['users', 'Funcionários', UserCog],
            ['roles', 'Perfis e permissões', ShieldCheck]
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm ${
              tab === key ? 'border-primary font-medium text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            <Icon className="size-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {tab === 'users' ? (
        <UsersTab users={users.data} roles={roles.data ?? []} loading={users.loading} error={users.error} onChanged={reloadAll} />
      ) : (
        <RolesTab
          roles={roles.data}
          permissions={permissions.data ?? []}
          loading={roles.loading || permissions.loading}
          error={roles.error ?? permissions.error}
          onChanged={reloadAll}
        />
      )}
    </div>
  )
}

// ───────────── Funcionários ─────────────

function UsersTab({
  users,
  roles,
  loading,
  error,
  onChanged
}: {
  users: UserDto[] | null
  roles: RoleDto[]
  loading: boolean
  error: string | null
  onChanged(): void
}) {
  const { user: me } = useAuth()
  const [editing, setEditing] = useState<UserDto | 'new' | null>(null)
  const [resetting, setResetting] = useState<UserDto | null>(null)

  return (
    <Card>
      <CardHeader
        title="Funcionários"
        description={users ? `${users.filter((u) => u.active).length} ativo(s) de ${users.length}` : undefined}
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')} disabled={roles.length === 0}>
            Novo usuário
          </Button>
        }
      />
      {error && (
        <div className="px-5 pb-4">
          <ErrorState message={error} />
        </div>
      )}
      {!users && loading && <Spinner />}
      {users && users.length === 0 && <EmptyState title="Nenhum usuário cadastrado" />}
      {users && users.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line bg-surface-2 text-left text-[12px] font-medium tracking-wide text-muted uppercase">
                <th className="px-5 py-2.5 font-medium">Nome</th>
                <th className="px-3 py-2.5 font-medium">Usuário</th>
                <th className="px-3 py-2.5 font-medium">Perfil</th>
                <th className="px-3 py-2.5 text-right font-medium">Desconto máx.</th>
                <th className="px-3 py-2.5 font-medium">Último acesso</th>
                <th className="px-3 py-2.5 font-medium">Situação</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date()
                return (
                  <tr key={u.id} className="border-b border-line last:border-0 hover:bg-surface-hover/60">
                    <td className="px-5 py-3 font-medium text-ink">
                      {u.name}
                      {u.id === me?.id && <span className="ml-2 text-xs font-normal text-muted">(você)</span>}
                    </td>
                    <td className="px-3 py-3 text-ink-2">{u.username}</td>
                    <td className="px-3 py-3">
                      <Badge tone={u.role.key === 'ADMIN' ? 'primary' : 'neutral'}>{u.role.name}</Badge>
                    </td>
                    <td className="tabular px-3 py-3 text-right text-ink-2">
                      {u.role.key === 'ADMIN' ? 'Ilimitado' : formatPercentBps(u.maxDiscountBps)}
                    </td>
                    <td className="px-3 py-3 text-ink-2">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.active ? <Badge tone="success">Ativo</Badge> : <Badge>Desativado</Badge>}
                        {locked && (
                          <Badge tone="warning">
                            <Lock className="size-3" /> Bloqueado
                          </Badge>
                        )}
                        {u.mustChangePassword && <Badge tone="warning">Trocar senha</Badge>}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />} onClick={() => setResetting(u)}>
                          Senha
                        </Button>
                        <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(u)}>
                          Editar
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <UserFormModal
          user={editing === 'new' ? null : editing}
          roles={roles}
          isSelf={editing !== 'new' && editing.id === me?.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} onSaved={onChanged} />}
    </Card>
  )
}

function UserFormModal({
  user,
  roles,
  isSelf,
  onClose,
  onSaved
}: {
  user: UserDto | null
  roles: RoleDto[]
  isSelf: boolean
  onClose(): void
  onSaved(): void
}) {
  const toast = useToast()
  const defaultRole = roles.find((r) => r.key === 'OPERATOR') ?? roles[0]
  const [form, setForm] = useState({
    name: user?.name ?? '',
    username: user?.username ?? '',
    roleId: user?.role.id ?? defaultRole?.id ?? 0,
    active: user?.active ?? true,
    discountPercent: user ? String(user.maxDiscountBps / 100).replace('.', ',') : '0',
    password: '',
    passwordConfirm: '',
    mustChangePassword: true
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const selectedRole = roles.find((r) => r.id === form.roleId)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const pct = Number(form.discountPercent.replace(',', '.'))
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setErrors({ maxDiscountBps: 'Informe um percentual entre 0 e 100' })
      return
    }
    const maxDiscountBps = Math.round(pct * 100)
    setSaving(true)
    setErrors({})
    try {
      if (user) {
        await call(api.users.update({ id: user.id, name: form.name, roleId: form.roleId, active: form.active, maxDiscountBps }))
        toast.success('Usuário atualizado.')
      } else {
        await call(
          api.users.create({
            name: form.name,
            username: form.username,
            roleId: form.roleId,
            password: form.password,
            passwordConfirm: form.passwordConfirm,
            maxDiscountBps,
            mustChangePassword: form.mustChangePassword
          })
        )
        toast.success('Usuário cadastrado.')
      }
      onSaved()
    } catch (err) {
      setErrors(fieldErrors(err))
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const text = (key: 'name' | 'username' | 'password' | 'passwordConfirm' | 'discountPercent') => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value })
  })

  return (
    <Modal
      open
      onClose={onClose}
      locked={saving}
      title={user ? 'Editar usuário' : 'Novo usuário'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="user-form" loading={saving}>
            {user ? 'Salvar alterações' : 'Cadastrar'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="grid grid-cols-2 gap-4" noValidate>
        <TextField label="Nome completo" required containerClassName="col-span-2" error={errors.name} {...text('name')} />
        <TextField
          label="Usuário para login"
          required
          disabled={!!user}
          hint={user ? 'O nome de usuário não pode ser alterado.' : 'Letras sem acento, números, ponto ou hífen.'}
          error={errors.username}
          {...text('username')}
        />
        <SelectField
          label="Perfil"
          required
          disabled={isSelf}
          value={form.roleId}
          onChange={(e) => setForm({ ...form, roleId: Number(e.target.value) })}
          options={roles.map((r) => ({ value: r.id, label: r.name }))}
          error={errors.roleId}
          hint={isSelf ? 'Você não pode alterar o próprio perfil.' : selectedRole?.description ?? undefined}
        />
        <TextField
          label="Desconto máximo (%)"
          inputMode="decimal"
          disabled={selectedRole?.key === 'ADMIN'}
          hint={selectedRole?.key === 'ADMIN' ? 'Administradores não têm limite.' : 'Limite aplicado no PDV.'}
          error={errors.maxDiscountBps}
          {...text('discountPercent')}
        />
        {!user ? (
          <>
            <PasswordField label="Senha inicial" required autoComplete="new-password" error={errors.password} hint="Mínimo de 8 caracteres, com letras e números." {...text('password')} />
            <PasswordField label="Confirmar senha" required autoComplete="new-password" error={errors.passwordConfirm} {...text('passwordConfirm')} />
            <div className="col-span-2">
              <Checkbox
                label="Exigir troca de senha no primeiro acesso"
                checked={form.mustChangePassword}
                onChange={(v) => setForm({ ...form, mustChangePassword: v })}
              />
            </div>
          </>
        ) : (
          <div className="col-span-2 flex items-end">
            <Checkbox
              label="Usuário ativo"
              description={isSelf ? 'Você não pode desativar o próprio usuário.' : 'Usuários desativados não conseguem entrar no sistema.'}
              checked={form.active}
              disabled={isSelf}
              onChange={(v) => setForm({ ...form, active: v })}
            />
          </div>
        )}
      </form>
    </Modal>
  )
}

function ResetPasswordModal({ user, onClose, onSaved }: { user: UserDto; onClose(): void; onSaved(): void }) {
  const toast = useToast()
  const { user: me } = useAuth()
  const [form, setForm] = useState({ password: '', passwordConfirm: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      await call(api.users.resetPassword({ id: user.id, ...form }))
      toast.success(`Senha de ${user.name} redefinida.`)
      onSaved()
      onClose()
    } catch (err) {
      setErrors(fieldErrors(err))
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      locked={saving}
      title="Redefinir senha"
      description={
        user.id === me?.id
          ? 'Defina uma nova senha para o seu usuário.'
          : `${user.name} deverá escolher uma nova senha no próximo acesso. O bloqueio por tentativas também é removido.`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="reset-form" loading={saving}>
            Redefinir
          </Button>
        </>
      }
    >
      <form id="reset-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <PasswordField label="Nova senha" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={errors.password} hint="Mínimo de 8 caracteres, com letras e números." />
        <PasswordField label="Confirmar nova senha" autoComplete="new-password" value={form.passwordConfirm} onChange={(e) => setForm({ ...form, passwordConfirm: e.target.value })} error={errors.passwordConfirm} />
      </form>
    </Modal>
  )
}

// ───────────── Perfis e permissões ─────────────

function RolesTab({
  roles,
  permissions,
  loading,
  error,
  onChanged
}: {
  roles: RoleDto[] | null
  permissions: PermissionDto[]
  loading: boolean
  error: string | null
  onChanged(): void
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const role = roles?.find((r) => r.id === selectedId) ?? roles?.find((r) => r.editable) ?? roles?.[0] ?? null

  if (error) return <ErrorState message={error} />
  if (!roles && loading) return <Spinner />
  if (!roles || !role) return null

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="h-fit p-2">
        {roles.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setSelectedId(r.id)}
            className={`flex w-full flex-col items-start rounded-lg px-3 py-2.5 text-left ${r.id === role.id ? 'bg-primary-soft' : 'hover:bg-surface-hover'}`}
          >
            <span className="flex w-full items-center justify-between text-sm font-medium text-ink">
              {r.name}
              <span className="text-xs font-normal text-muted">{r.userCount} usuário(s)</span>
            </span>
            <span className="mt-0.5 text-xs text-muted">{r.description}</span>
          </button>
        ))}
      </Card>
      <RolePermissionsEditor key={role.id + ':' + role.permissions.join(',')} role={role} permissions={permissions} onSaved={onChanged} />
    </div>
  )
}

function RolePermissionsEditor({ role, permissions, onSaved }: { role: RoleDto; permissions: PermissionDto[]; onSaved(): void }) {
  const toast = useToast()
  const [granted, setGranted] = useState<Set<Permission>>(new Set(role.permissions))
  const [saving, setSaving] = useState(false)
  const dirty = granted.size !== role.permissions.length || role.permissions.some((p) => !granted.has(p))

  const groups = useMemo(() => {
    const map = new Map<string, PermissionDto[]>()
    for (const p of permissions) map.set(p.module, [...(map.get(p.module) ?? []), p])
    return [...map]
  }, [permissions])

  const toggle = (key: Permission, on: boolean) =>
    setGranted((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const save = async () => {
    setSaving(true)
    try {
      await call(api.roles.updatePermissions({ roleId: role.id, permissions: [...granted] }))
      toast.success(`Permissões do perfil ${role.name} atualizadas.`)
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={`Permissões — ${role.name}`}
        description={
          role.editable
            ? 'As alterações valem imediatamente para todos os usuários deste perfil.'
            : 'O perfil Administrador sempre possui acesso completo e não pode ser alterado.'
        }
        actions={
          role.editable && (
            <>
              <Button variant="secondary" disabled={!dirty || saving} onClick={() => setGranted(new Set(role.permissions))}>
                Descartar
              </Button>
              <Button disabled={!dirty} loading={saving} onClick={() => void save()}>
                Salvar permissões
              </Button>
            </>
          )
        }
      />
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 px-5 pb-5 md:grid-cols-2">
        {groups.map(([module, items]) => (
          <fieldset key={module}>
            <legend className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{module}</legend>
            <div className="flex flex-col gap-2">
              {items.map((p) => (
                <Checkbox
                  key={p.key}
                  label={p.description}
                  checked={!role.editable || granted.has(p.key)}
                  disabled={!role.editable}
                  onChange={(v) => toggle(p.key, v)}
                />
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </Card>
  )
}
