import { Construction } from 'lucide-react'
import type { ModuleDefinition } from '@shared/modules'
import { Card, PageHeader } from '@/components/ui/Card'
import { MODULE_ICONS } from '@/lib/moduleIcons'

const EXTERNAL_DEPENDENCY: Record<string, string> = {
  fiscal:
    'A emissão de NF-e/NFC-e depende de um provedor fiscal homologado, certificado digital da empresa e configuração tributária validada por um contador. O sistema não simula autorizações fiscais.',
  tef: 'Pagamentos TEF dependem de um provedor compatível, credenciais e homologação. O sistema não simula aprovações de cartão.'
}

/** Página exibida para módulos ainda não entregues: deixa claro que estão em desenvolvimento. */
export function ModulePlaceholder({ module }: { module: ModuleDefinition }) {
  const Icon = MODULE_ICONS[module.key]
  return (
    <div className="animate-in">
      <PageHeader title={module.label} description={module.description} />
      <Card className="flex flex-col items-center px-6 py-16 text-center">
        <div className="relative">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Icon className="size-8" aria-hidden />
          </span>
          <span className="absolute -right-2 -bottom-2 flex size-7 items-center justify-center rounded-full border-2 border-surface bg-warning-soft text-warning">
            <Construction className="size-3.5" aria-hidden />
          </span>
        </div>
        <h2 className="mt-6 text-lg font-semibold text-ink">Módulo em desenvolvimento</h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          O módulo <strong className="text-ink-2">{module.label}</strong> será entregue na <strong className="text-ink-2">Fase {module.phase}</strong> do
          projeto. Nenhuma operação deste módulo está disponível ainda.
        </p>
        {EXTERNAL_DEPENDENCY[module.key] && (
          <p className="mt-4 max-w-lg rounded-lg bg-surface-2 px-4 py-3 text-[13px] text-ink-2">{EXTERNAL_DEPENDENCY[module.key]}</p>
        )}
      </Card>
    </div>
  )
}
