import { useEffect, useState, type FormEvent } from 'react'
import { UserPlus } from 'lucide-react'
import type { CustomerLite } from '@shared/api'
import { formatDocument } from '@shared/documents'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { useDebounced } from '@/hooks/useDebounced'
import { api, call, errorMessage, fieldErrors } from '@/services/api'

/** Busca de cliente com cadastro rápido (PDV, pedidos e orçamentos). */
export function CustomerPickerModal({ open, onClose, onSelect }: { open: boolean; onClose(): void; onSelect(c: CustomerLite): void }) {
  const { can } = useAuth()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query)
  const results = useAsync(() => (open && debounced.trim() ? call(api.customers.search({ query: debounced })) : Promise.resolve([])), [open, debounced])
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', document: '', phone: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (open) {
      setQuery('')
      setCreating(false)
      setForm({ name: '', document: '', phone: '' })
      setErrors({})
    }
  }, [open])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const c = await call(api.customers.quickCreate(form))
      toast.success(`Cliente ${c.name} cadastrado.`)
      onSelect(c)
    } catch (err) {
      setErrors(fieldErrors(err))
      toast.error(errorMessage(err))
    }
  }

  return (
    <Modal open={open} title="Identificar cliente" onClose={onClose} size="md">
      {!creating ? (
        <div className="flex flex-col gap-3">
          <TextField label="Buscar por nome, CPF/CNPJ ou telefone" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
          <ul className="max-h-64 overflow-auto">
            {(results.data ?? []).map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onSelect(c)} className="flex w-full justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-surface-hover">
                  <span className="text-ink">{c.name}</span>
                  <span className="text-xs text-muted">{c.document ? formatDocument(c.document) : ''}</span>
                </button>
              </li>
            ))}
            {debounced && results.data?.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nenhum cliente encontrado.</li>}
          </ul>
          {can('customers.manage') && (
            <Button variant="secondary" icon={<UserPlus className="size-4" />} onClick={() => { setCreating(true); setForm({ ...form, name: query }) }}>
              Cadastrar novo cliente
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={create} className="flex flex-col gap-3" noValidate>
          <TextField label="Nome" required autoFocus value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="CPF/CNPJ" inputMode="numeric" value={form.document} error={errors.document} onChange={(e) => setForm({ ...form, document: e.target.value })} />
            <TextField label="Telefone" inputMode="tel" value={form.phone} error={errors.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <p className="text-xs text-muted">Dados pessoais usados apenas para a venda e o histórico do cliente (LGPD).</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Voltar
            </Button>
            <Button type="submit">Cadastrar e usar</Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
