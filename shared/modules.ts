import type { Permission } from './permissions'

export interface ModuleDefinition {
  key: string
  label: string
  path: string
  /** Basta uma das permissões para acessar o módulo. */
  permissions: Permission[]
  /** Fase do roadmap em que o módulo é entregue. */
  phase: number
  implemented: boolean
  description: string
}

/** Menu principal, na ordem exibida na barra lateral. */
export const MODULES: ModuleDefinition[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/', permissions: ['dashboard.view'], phase: 1, implemented: true, description: 'Indicadores e gráficos do negócio' },
  { key: 'pdv', label: 'PDV', path: '/pdv', permissions: ['pdv.sell'], phase: 4, implemented: true, description: 'Ponto de venda: carrinho, pagamentos e comprovantes' },
  { key: 'orders', label: 'Pedidos', path: '/pedidos', permissions: ['orders.manage'], phase: 6, implemented: true, description: 'Registro e acompanhamento de pedidos' },
  { key: 'catalog', label: 'Catálogo', path: '/catalogo', permissions: ['catalog.view'], phase: 6, implemented: true, description: 'Catálogo digital com imagens, preços e promoções' },
  { key: 'stock', label: 'Estoque', path: '/estoque', permissions: ['stock.view', 'stock.manage'], phase: 3, implemented: true, description: 'Entradas, saídas, inventário e alertas de reposição' },
  { key: 'cash', label: 'Caixa', path: '/caixa', permissions: ['cash.operate', 'cash.manage'], phase: 5, implemented: true, description: 'Abertura, sangrias, suprimentos e fechamento de caixa' },
  { key: 'payables', label: 'Contas a pagar', path: '/contas-a-pagar', permissions: ['finance.payables'], phase: 7, implemented: true, description: 'Despesas, vencimentos e pagamentos' },
  { key: 'receivables', label: 'Contas a receber', path: '/contas-a-receber', permissions: ['finance.receivables'], phase: 7, implemented: true, description: 'Recebíveis, parcelas e baixas' },
  { key: 'customers', label: 'Clientes', path: '/clientes', permissions: ['customers.view', 'customers.manage'], phase: 6, implemented: true, description: 'Cadastro e histórico de clientes' },
  { key: 'quotes', label: 'Orçamentos', path: '/orcamentos', permissions: ['quotes.manage'], phase: 6, implemented: true, description: 'Orçamentos com validade, PDF e conversão' },
  { key: 'products', label: 'Produtos', path: '/produtos', permissions: ['products.view', 'products.manage'], phase: 2, implemented: true, description: 'Cadastro, variações e precificação inteligente' },
  { key: 'reports', label: 'Relatórios', path: '/relatorios', permissions: ['reports.view'], phase: 7, implemented: true, description: 'Relatórios gerenciais com exportação' },
  { key: 'fiscal', label: 'Notas Fiscais', path: '/notas-fiscais', permissions: ['fiscal.manage'], phase: 8, implemented: true, description: 'Estrutura para NF-e/NFC-e via provedor fiscal homologado' },
  { key: 'tef', label: 'TEF', path: '/tef', permissions: ['tef.manage'], phase: 8, implemented: true, description: 'Estrutura para integração com provedor TEF homologado' },
  { key: 'suppliers', label: 'Fornecedores', path: '/fornecedores', permissions: ['suppliers.manage'], phase: 2, implemented: true, description: 'Cadastro de fornecedores' },
  { key: 'users', label: 'Usuários', path: '/usuarios', permissions: ['users.manage'], phase: 1, implemented: true, description: 'Funcionários, perfis e permissões' },
  { key: 'settings', label: 'Configurações', path: '/configuracoes', permissions: ['settings.manage'], phase: 1, implemented: true, description: 'Empresa, impressoras e dispositivos, backup, segurança e aparência' }
]

export function canAccessModule(module: ModuleDefinition, granted: readonly string[]): boolean {
  return module.permissions.some((p) => granted.includes(p))
}
