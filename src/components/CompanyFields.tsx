import type { CompanyInput } from '@shared/schemas'
import { SelectField, TextField } from './ui/Field'

export const TAX_REGIMES = [
  { value: '', label: 'Não informado' },
  { value: '1', label: 'Simples Nacional' },
  { value: '2', label: 'Simples Nacional — excesso de sublimite' },
  { value: '3', label: 'Regime Normal (Lucro Presumido/Real)' },
  { value: '4', label: 'Simples Nacional — MEI' }
]

export type CompanyForm = { [K in keyof Required<CompanyInput>]: string }

export const emptyCompany: CompanyForm = {
  legalName: '',
  tradeName: '',
  document: '',
  stateRegistration: '',
  taxRegime: '',
  phone: '',
  email: '',
  zipCode: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: ''
}

/** Campos de cadastro da empresa, usados no assistente inicial e nas configurações. */
export function CompanyFields({
  value,
  onChange,
  errors
}: {
  value: CompanyForm
  onChange(next: CompanyForm): void
  errors: Record<string, string>
}) {
  const field = (key: keyof CompanyForm) => ({
    value: value[key],
    error: errors[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: e.target.value })
  })

  return (
    <div className="grid grid-cols-6 gap-4">
      <TextField label="Razão social ou nome" required containerClassName="col-span-6 md:col-span-4" {...field('legalName')} />
      <TextField label="Nome fantasia" containerClassName="col-span-6 md:col-span-2" {...field('tradeName')} />
      <TextField label="CNPJ ou CPF" inputMode="numeric" containerClassName="col-span-3 md:col-span-2" {...field('document')} />
      <TextField label="Inscrição estadual" containerClassName="col-span-3 md:col-span-2" {...field('stateRegistration')} />
      <SelectField label="Regime tributário" containerClassName="col-span-6 md:col-span-2" value={value.taxRegime} error={errors.taxRegime} onChange={(e) => onChange({ ...value, taxRegime: e.target.value })} options={TAX_REGIMES} />
      <TextField label="Telefone" inputMode="tel" containerClassName="col-span-3 md:col-span-2" {...field('phone')} />
      <TextField label="E-mail" type="email" containerClassName="col-span-3 md:col-span-4" {...field('email')} />
      <TextField label="CEP" inputMode="numeric" containerClassName="col-span-2 md:col-span-1" {...field('zipCode')} />
      <TextField label="Cidade" containerClassName="col-span-3 md:col-span-1" {...field('city')} />
      <TextField label="UF" maxLength={2} containerClassName="col-span-1" {...field('state')} />
      <TextField label="Endereço" containerClassName="col-span-6 md:col-span-3" {...field('street')} />
      <TextField label="Número" containerClassName="col-span-2 md:col-span-1" {...field('number')} />
      <TextField label="Complemento" containerClassName="col-span-4 md:col-span-2" {...field('complement')} />
      <TextField label="Bairro" containerClassName="col-span-6 md:col-span-3" {...field('district')} />
    </div>
  )
}
