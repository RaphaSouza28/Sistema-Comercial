import { useState, type FormEvent } from 'react'
import { CornerDownRight, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react'
import type { CategoryDto } from '@shared/api'
import { formatPercentBps } from '@shared/format'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Checkbox, SelectField, TextField } from '@/components/ui/Field'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { PercentField } from '@/components/ui/NumberFields'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call, errorMessage, fieldErrors } from '@/services/api'

/** Ordena como árvore: categoria seguida de suas subcategorias. */
function asTree(list: CategoryDto[]): CategoryDto[] {
  const roots = list.filter((c) => c.parentId === null)
  return roots.flatMap((r) => [r, ...list.filter((c) => c.parentId === r.id)])
}

export function CategoriesTab() {
  const { can } = useAuth()
  const toast = useToast()
  const canManage = can('products.manage')
  const { data, error, loading, reload } = useAsync(() => call(api.categories.list()))
  const [editing, setEditing] = useState<CategoryDto | 'new' | null>(null)
  const [removing, setRemoving] = useState<CategoryDto | null>(null)

  return (
    <Card>
      <CardHeader
        title="Categorias"
        description="Até dois níveis: categoria e subcategoria. A margem padrão é usada na precificação por categoria."
        actions={
          canManage && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Nova categoria
            </Button>
          )
        }
      />
      {error && (
        <div className="px-5 pb-4">
          <ErrorState message={error} />
        </div>
      )}
      {!data && loading && <Spinner />}
      {data && data.length === 0 && <EmptyState icon={<FolderTree />} title="Nenhuma categoria cadastrada" />}
      {data && data.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
              <th className="px-5 py-2.5 font-medium">Nome</th>
              <th className="px-3 py-2.5 text-right font-medium">Margem padrão</th>
              <th className="px-3 py-2.5 text-right font-medium">Produtos</th>
              <th className="px-3 py-2.5 font-medium">Situação</th>
              <th className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {asTree(data).map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className={`py-2.5 text-ink ${c.parentId ? 'pl-10' : 'pl-5 font-medium'}`}>
                  {c.parentId && <CornerDownRight className="mr-1.5 inline size-3.5 text-muted" aria-hidden />}
                  {c.name}
                </td>
                <td className="tabular px-3 py-2.5 text-right text-ink-2">{c.defaultMarginBps !== null ? formatPercentBps(c.defaultMarginBps) : '—'}</td>
                <td className="tabular px-3 py-2.5 text-right text-ink-2">{c.productCount}</td>
                <td className="px-3 py-2.5">{c.active ? <Badge tone="success">Ativa</Badge> : <Badge>Inativa</Badge>}</td>
                <td className="px-5 py-2.5">
                  {canManage && (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(c)}>
                        Editar
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Excluir ${c.name}`} icon={<Trash2 className="size-3.5 text-danger" />} onClick={() => setRemoving(c)} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <CategoryModal
          category={editing === 'new' ? null : editing}
          roots={(data ?? []).filter((c) => c.parentId === null && (editing === 'new' || c.id !== editing.id))}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void reload()
          }}
        />
      )}
      <ConfirmModal
        open={!!removing}
        danger
        title="Excluir categoria"
        confirmLabel="Excluir"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          try {
            await call(api.categories.remove({ id: removing!.id }))
            toast.success('Categoria excluída.')
            setRemoving(null)
            void reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      >
        Excluir a categoria <strong className="text-ink">{removing?.name}</strong>? Só é possível excluir categorias sem
        produtos e sem subcategorias; nos demais casos, desative-a.
      </ConfirmModal>
    </Card>
  )
}

function CategoryModal({
  category,
  roots,
  onClose,
  onSaved
}: {
  category: CategoryDto | null
  roots: CategoryDto[]
  onClose(): void
  onSaved(): void
}) {
  const toast = useToast()
  const [form, setForm] = useState({
    name: category?.name ?? '',
    parentId: category?.parentId ?? null,
    defaultMarginBps: category?.defaultMarginBps ?? null,
    active: category?.active ?? true
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      if (category) await call(api.categories.update({ id: category.id, ...form }))
      else await call(api.categories.create(form))
      toast.success(category ? 'Categoria atualizada.' : 'Categoria criada.')
      onSaved()
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
      title={category ? 'Editar categoria' : 'Nova categoria'}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="category-form" loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField label="Nome" required value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <SelectField
          label="Pertence a"
          value={form.parentId ?? ''}
          error={errors.parentId}
          onChange={(e) => setForm({ ...form, parentId: e.target.value ? Number(e.target.value) : null })}
          options={[{ value: '', label: 'Nenhuma (categoria principal)' }, ...roots.map((r) => ({ value: r.id, label: r.name }))]}
        />
        <PercentField
          label="Margem padrão"
          nullable
          value={form.defaultMarginBps}
          onChange={(v) => setForm({ ...form, defaultMarginBps: v })}
          error={errors.defaultMarginBps}
          hint="Opcional. Sugere preços na precificação por categoria."
        />
        {category && <Checkbox label="Categoria ativa" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />}
      </form>
    </Modal>
  )
}
