import { useState, type FormEvent } from 'react'
import { Pencil, Plus, Search, Trash2, Truck } from 'lucide-react'
import type { SupplierDto } from '@shared/api'
import { formatDocument, formatPhone } from '@shared/documents'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Checkbox, TextField } from '@/components/ui/Field'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { useDebounced } from '@/hooks/useDebounced'
import { api, call, errorMessage, fieldErrors } from '@/services/api'

export function SuppliersPage() {
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const debounced = useDebounced(search)
  const { data, error, loading, reload } = useAsync(
    () => call(api.suppliers.list({ search: debounced || undefined, includeInactive })),
    [debounced, includeInactive]
  )
  const [editing, setEditing] = useState<SupplierDto | 'new' | null>(null)
  const [removing, setRemoving] = useState<SupplierDto | null>(null)

  return (
    <div className="animate-in">
      <PageHeader
        title="Fornecedores"
        description="Empresas e pessoas de quem você compra mercadorias."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Novo fornecedor
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, CNPJ/CPF, contato ou cidade…"
              aria-label="Buscar fornecedores"
              className="h-9 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted"
            />
          </div>
          <Checkbox label="Mostrar inativos" checked={includeInactive} onChange={setIncludeInactive} />
        </div>
        {error && (
          <div className="p-4">
            <ErrorState message={error} />
          </div>
        )}
        {!data && loading && <Spinner />}
        {data && data.length === 0 && <EmptyState icon={<Truck />} title={debounced ? 'Nenhum fornecedor encontrado' : 'Nenhum fornecedor cadastrado'} />}
        {data && data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
                  <th className="px-5 py-2.5 font-medium">Fornecedor</th>
                  <th className="px-3 py-2.5 font-medium">CNPJ/CPF</th>
                  <th className="px-3 py-2.5 font-medium">Contato</th>
                  <th className="px-3 py-2.5 font-medium">Cidade</th>
                  <th className="px-3 py-2.5 text-right font-medium">Produtos</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0 hover:bg-surface-hover/60">
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-ink">{s.name}</span>
                      {s.tradeName && <span className="block text-xs text-muted">{s.tradeName}</span>}
                    </td>
                    <td className="tabular px-3 py-2.5 text-ink-2">{s.document ? formatDocument(s.document) : '—'}</td>
                    <td className="px-3 py-2.5 text-ink-2">
                      {s.contactName ?? '—'}
                      <span className="block text-xs text-muted">{[formatPhone(s.phone), s.email].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className="px-3 py-2.5 text-ink-2">{[s.city, s.state].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="tabular px-3 py-2.5 text-right text-ink-2">{s.productCount}</td>
                    <td className="px-3 py-2.5">{s.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(s)}>
                          Editar
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`Excluir ${s.name}`} icon={<Trash2 className="size-3.5 text-danger" />} onClick={() => setRemoving(s)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <SupplierModal
          supplier={editing === 'new' ? null : editing}
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
        title="Excluir fornecedor"
        confirmLabel="Excluir"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          try {
            await call(api.suppliers.remove({ id: removing!.id }))
            toast.success('Fornecedor excluído.')
            setRemoving(null)
            void reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      >
        Excluir <strong className="text-ink">{removing?.name}</strong>? Ele deixa de aparecer nas listas, mas continua
        vinculado aos produtos e ao histórico já registrados.
      </ConfirmModal>
    </div>
  )
}

type SupplierForm = Omit<SupplierDto, 'id' | 'productCount' | 'createdAt' | 'active'> & { active: boolean }
const fields: (keyof Omit<SupplierForm, 'active'>)[] = [
  'name', 'tradeName', 'document', 'phone', 'email', 'contactName', 'zipCode', 'street', 'number', 'complement', 'district', 'city', 'state', 'notes'
]

function SupplierModal({ supplier, onClose, onSaved }: { supplier: SupplierDto | null; onClose(): void; onSaved(): void }) {
  const toast = useToast()
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f, (supplier?.[f] as string | null) ?? '']))
  )
  const [active, setActive] = useState(supplier?.active ?? true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const field = (key: string) => ({ value: form[key], error: errors[key], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }) })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const data = form as unknown as SupplierForm
      if (supplier) await call(api.suppliers.update({ ...data, id: supplier.id, active }))
      else await call(api.suppliers.create(data))
      toast.success(supplier ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.')
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
      size="lg"
      title={supplier ? 'Editar fornecedor' : 'Novo fornecedor'}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="supplier-form" loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="supplier-form" onSubmit={submit} className="grid grid-cols-6 gap-4" noValidate>
        <TextField label="Razão social ou nome" required containerClassName="col-span-6 md:col-span-4" {...field('name')} />
        <TextField label="Nome fantasia" containerClassName="col-span-6 md:col-span-2" {...field('tradeName')} />
        <TextField label="CNPJ ou CPF" inputMode="numeric" containerClassName="col-span-3 md:col-span-2" {...field('document')} />
        <TextField label="Telefone" inputMode="tel" containerClassName="col-span-3 md:col-span-2" {...field('phone')} />
        <TextField label="E-mail" type="email" containerClassName="col-span-6 md:col-span-2" {...field('email')} />
        <TextField label="Pessoa de contato" containerClassName="col-span-6 md:col-span-3" {...field('contactName')} />
        <TextField label="CEP" inputMode="numeric" containerClassName="col-span-2 md:col-span-1" {...field('zipCode')} />
        <TextField label="Cidade" containerClassName="col-span-3 md:col-span-1" {...field('city')} />
        <TextField label="UF" maxLength={2} containerClassName="col-span-1" {...field('state')} />
        <TextField label="Endereço" containerClassName="col-span-6 md:col-span-3" {...field('street')} />
        <TextField label="Número" containerClassName="col-span-2 md:col-span-1" {...field('number')} />
        <TextField label="Complemento" containerClassName="col-span-4 md:col-span-2" {...field('complement')} />
        <TextField label="Bairro" containerClassName="col-span-6 md:col-span-3" {...field('district')} />
        <TextField label="Observações" containerClassName="col-span-6 md:col-span-3" {...field('notes')} />
        {supplier && (
          <div className="col-span-6">
            <Checkbox label="Fornecedor ativo" checked={active} onChange={setActive} />
          </div>
        )}
      </form>
    </Modal>
  )
}
