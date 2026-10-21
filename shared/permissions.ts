/**
 * Catálogo de permissões do sistema.
 * A verificação acontece nos serviços do processo principal; a interface apenas
 * esconde o que o usuário não pode usar.
 */
export const PERMISSIONS = {
  'dashboard.view': { module: 'Dashboard', description: 'Visualizar o dashboard e indicadores' },

  'pdv.sell': { module: 'PDV', description: 'Registrar vendas no PDV' },
  'pdv.discount': { module: 'PDV', description: 'Aplicar descontos dentro do limite do usuário' },
  'pdv.cancel': { module: 'PDV', description: 'Autorizar cancelamento de vendas' },
  'pdv.return': { module: 'PDV', description: 'Registrar trocas e devoluções' },

  'products.view': { module: 'Produtos', description: 'Consultar produtos e preços de venda' },
  'products.manage': { module: 'Produtos', description: 'Cadastrar e editar produtos' },
  'products.price': { module: 'Produtos', description: 'Alterar preços de venda e promoções' },
  'products.cost': { module: 'Produtos', description: 'Ver e alterar custos, margens e markup' },

  'stock.view': { module: 'Estoque', description: 'Consultar estoque e disponibilidade' },
  'stock.manage': { module: 'Estoque', description: 'Entradas, saídas, ajustes e inventário' },

  'cash.operate': { module: 'Caixa', description: 'Abrir, movimentar e fechar o próprio caixa' },
  'cash.manage': { module: 'Caixa', description: 'Gerenciar e fechar caixas de outros operadores' },

  'customers.view': { module: 'Clientes', description: 'Consultar clientes' },
  'customers.manage': { module: 'Clientes', description: 'Cadastrar e editar clientes' },
  'suppliers.manage': { module: 'Fornecedores', description: 'Cadastrar e editar fornecedores' },

  'orders.manage': { module: 'Pedidos', description: 'Criar e gerenciar pedidos' },
  'quotes.manage': { module: 'Orçamentos', description: 'Criar e gerenciar orçamentos' },
  'catalog.view': { module: 'Catálogo', description: 'Visualizar e exportar o catálogo' },

  'finance.payables': { module: 'Financeiro', description: 'Gerenciar contas a pagar' },
  'finance.receivables': { module: 'Financeiro', description: 'Gerenciar contas a receber' },

  'reports.view': { module: 'Relatórios', description: 'Consultar e exportar relatórios gerenciais' },

  'fiscal.manage': { module: 'Notas Fiscais', description: 'Gerenciar documentos fiscais' },
  'tef.manage': { module: 'TEF', description: 'Gerenciar transações TEF' },

  'users.manage': { module: 'Usuários', description: 'Cadastrar funcionários e gerenciar permissões' },
  'settings.manage': { module: 'Configurações', description: 'Alterar dados da empresa e configurações' },
  'backup.manage': { module: 'Configurações', description: 'Criar e restaurar backups' },
  'audit.view': { module: 'Configurações', description: 'Consultar o log de auditoria' }
} as const satisfies Record<string, { module: string; description: string }>

export type Permission = keyof typeof PERMISSIONS

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

export const ROLE_KEYS = { ADMIN: 'ADMIN', MANAGER: 'MANAGER', OPERATOR: 'OPERATOR' } as const
export type SystemRoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS]

export interface SystemRoleDefinition {
  key: SystemRoleKey
  name: string
  description: string
  /** Permissões concedidas na criação do perfil. O administrador sempre recebe todas. */
  defaults: Permission[]
}

export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    key: 'ADMIN',
    name: 'Administrador',
    description: 'Acesso completo ao sistema',
    defaults: ALL_PERMISSIONS
  },
  {
    key: 'MANAGER',
    name: 'Gerente',
    description: 'Vendas, estoque, pedidos, orçamentos, relatórios e financeiro autorizado',
    defaults: [
      'dashboard.view',
      'pdv.sell',
      'pdv.discount',
      'pdv.cancel',
      'pdv.return',
      'products.view',
      'products.manage',
      'products.price',
      'stock.view',
      'stock.manage',
      'cash.operate',
      'cash.manage',
      'customers.view',
      'customers.manage',
      'suppliers.manage',
      'orders.manage',
      'quotes.manage',
      'catalog.view',
      'finance.payables',
      'finance.receivables',
      'reports.view'
    ]
  },
  {
    key: 'OPERATOR',
    name: 'Operador de caixa',
    description: 'Abrir caixa, registrar vendas, consultar produtos e fechar o próprio caixa',
    defaults: [
      'pdv.sell',
      'products.view',
      'stock.view',
      'cash.operate',
      'customers.view',
      'customers.manage',
      'catalog.view'
    ]
  }
]

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value)
}
