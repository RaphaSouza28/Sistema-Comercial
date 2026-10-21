/**
 * Contrato entre o renderer (React) e o processo principal.
 * O preload expõe exatamente a interface AppApi em window.api; cada método
 * corresponde a um canal IPC listado em IPC_CHANNELS.
 */
import type {
  CategoryInput,
  CategoryPricingApplyInput,
  CategoryPricingPreviewInput,
  CategoryUpdateInput,
  ImportApplyInput,
  PricingSettingsInput,
  ProductCreateInput,
  ProductListInput,
  ProductQuickCreateInput,
  ProductUpdateInput,
  SupplierInput,
  SupplierListInput,
  SupplierUpdateInput
} from './catalogSchemas'
import type {
  PayableInput,
  PayableListInput,
  PayablePayInput,
  PayableUpdateInput,
  ReceivableInput,
  ReceivableListInput,
  ReceivableReceiveInput,
  ReceivableUpdateInput,
  ReportExportInput,
  ReportInput,
  ReportKey
} from './financeSchemas'
import type { BackupPasswordInput, BackupSettings, BackupSettingsInput, RestoreInput, SecuritySettings } from './backupSchemas'
import type { DevicesInput, DevicesSettings, LabelPrintInput } from './deviceSchemas'
import type {
  FiscalListInput,
  FiscalPrepareInput,
  FiscalSettings,
  FiscalSettingsInput,
  PaymentReferenceUpdateInput,
  ReconciliationListInput,
  TefSettings
} from './integrationSchemas'
import type { Permission } from './permissions'
import type {
  InventoryCountsInput,
  InventoryCreateInput,
  StockAdjustInput,
  StockEntryInput,
  StockExitInput,
  StockMovementsInput,
  StockOverviewInput,
  StockSearchInput
} from './stockSchemas'
import type {
  CashOpenInput,
  CustomerQuickInput,
  SaleCancelInput,
  SaleFinalizeInput,
  SaleListInput,
  SalePreviewInput,
  SaleReturnInput
} from './salesSchemas'
import type { CashCloseInput, CashHistoryInput, CashMovementInput } from './cashSchemas'
import type {
  CatalogInput,
  CustomerInput,
  CustomerListInput,
  CustomerUpdateInput,
  DocumentItemInput,
  OrderInput,
  OrderListInput,
  OrderUpdateInput,
  QuoteInput,
  QuoteListInput,
  QuoteUpdateInput
} from './commerceSchemas'
import type {
  ChangePasswordInput,
  CompanyInput,
  LoginInput,
  RoleUpdatePermissionsInput,
  SetupInput,
  UserCreateInput,
  UserResetPasswordInput,
  UserUpdateInput
} from './schemas'

export interface ApiErrorPayload {
  code: 'VALIDATION' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'LOCKED' | 'INTERNAL'
  message: string
  /** Erros por campo, no formato "caminho.do.campo" -> mensagem. */
  fields?: Record<string, string>
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorPayload }

// ───────────── DTOs ─────────────

export interface AppInfo {
  name: string
  version: string
  isPackaged: boolean
  dataDirectory: string
  databasePath: string
  electron: string
  node: string
  platform: string
}

export interface SessionUser {
  id: number
  name: string
  username: string
  role: { id: number; key: string; name: string }
  permissions: Permission[]
  maxDiscountBps: number
  mustChangePassword: boolean
  /** Bloqueio por inatividade configurado (minutos; 0 = desligado). */
  idleMinutes?: number
}

export interface SetupStatus {
  needsSetup: boolean
}

export interface CompanyDto {
  id: number
  legalName: string
  tradeName: string | null
  document: string | null
  stateRegistration: string | null
  taxRegime: string | null
  phone: string | null
  email: string | null
  zipCode: string | null
  street: string | null
  number: string | null
  complement: string | null
  district: string | null
  city: string | null
  state: string | null
}

export interface UserDto {
  id: number
  name: string
  username: string
  active: boolean
  maxDiscountBps: number
  mustChangePassword: boolean
  lockedUntil: string | null
  lastLoginAt: string | null
  createdAt: string
  role: { id: number; key: string; name: string }
}

export interface RoleDto {
  id: number
  key: string
  name: string
  description: string | null
  isSystem: boolean
  editable: boolean
  permissions: Permission[]
  userCount: number
}

export interface PermissionDto {
  key: Permission
  module: string
  description: string
}

export interface DashboardSummary {
  generatedAt: string
  revenue: { todayCents: number; weekCents: number; monthCents: number }
  month: { salesCount: number; averageTicketCents: number; grossProfitCents: number }
  productsCount: number
  lowStockCount: number
  pendingOrders: number
  pendingQuotes: number
  payables: { openCount: number; openCents: number; overdueCount: number }
  receivables: { openCount: number; openCents: number; overdueCount: number }
  cash: { openSessions: number; balanceCents: number }
  /** Último backup bem-sucedido e se a tentativa mais recente falhou. */
  backup: { lastAt: string | null; lastFailed: boolean }
  charts: {
    daily: { date: string; totalCents: number; count: number }[]
    monthly: { month: string; totalCents: number; grossProfitCents: number }[]
    topProducts: { productId: number; name: string; quantityMilli: number; totalCents: number }[]
    paymentMethods: { method: string; totalCents: number; count: number }[]
    operators: { userId: number; name: string; totalCents: number; count: number }[]
  }
}

// ───────────── Fase 2: catálogo de produtos ─────────────

export interface CategoryDto {
  id: number
  name: string
  parentId: number | null
  parentName: string | null
  defaultMarginBps: number | null
  active: boolean
  productCount: number
}

export interface SupplierDto {
  id: number
  name: string
  tradeName: string | null
  document: string | null
  phone: string | null
  email: string | null
  contactName: string | null
  zipCode: string | null
  street: string | null
  number: string | null
  complement: string | null
  district: string | null
  city: string | null
  state: string | null
  notes: string | null
  active: boolean
  productCount: number
  createdAt: string
}

export type StockStatus = 'ok' | 'low' | 'out'

export interface ProductListItem {
  id: number
  internalCode: string
  sku: string | null
  barcode: string | null
  name: string
  categoryName: string | null
  subcategoryName: string | null
  brand: string | null
  unit: string
  salePriceCents: number
  promoPriceCents: number | null
  promoActive: boolean
  effectivePriceCents: number
  /** null quando o usuário não tem permissão para ver custos. */
  totalCostCents: number | null
  grossMarginBps: number | null
  lowMargin: boolean
  stockMilli: number
  minStockMilli: number
  stockStatus: StockStatus
  active: boolean
  hasVariants: boolean
  variantCount: number
  imageUrl: string | null
  pricingMode: 'MANUAL' | 'AUTOMATIC'
  isService: boolean
}

export interface ProductListResult {
  items: ProductListItem[]
  total: number
  page: number
  pageSize: number
}

export interface VariantDto {
  id: number
  name: string
  attributes: Record<string, string>
  sku: string | null
  barcode: string | null
  costCents: number | null
  salePriceCents: number | null
  stockMilli: number
  minStockMilli: number
  active: boolean
}

export interface ProductDetail {
  id: number
  internalCode: string
  sku: string | null
  barcode: string | null
  name: string
  description: string | null
  categoryId: number | null
  subcategoryId: number | null
  brand: string | null
  supplierId: number | null
  unit: string
  imageUrl: string | null
  /** Campos de custo: null quando o usuário não tem a permissão products.cost. */
  costCents: number | null
  freightCents: number | null
  packagingCents: number | null
  otherCostsCents: number | null
  taxBps: number | null
  cardFeeBps: number | null
  commissionBps: number | null
  targetMarginBps: number | null
  costVisible: boolean
  pricingMode: 'MANUAL' | 'AUTOMATIC'
  salePriceCents: number
  promoPriceCents: number | null
  promoStartsAt: string | null
  promoEndsAt: string | null
  wholesalePriceCents: number | null
  wholesaleMinMilli: number | null
  stockMilli: number
  minStockMilli: number
  allowNegativeStock: boolean
  isService: boolean
  ncm: string | null
  cest: string | null
  cfop: string | null
  taxOrigin: string | null
  taxCode: string | null
  active: boolean
  hasVariants: boolean
  variantOptions: { name: string; values: string[] }[]
  variants: VariantDto[]
  createdAt: string
  updatedAt: string
}

export interface PriceHistoryEntry {
  id: number
  field: 'COST' | 'SALE' | 'PROMO' | 'WHOLESALE'
  variantName: string | null
  oldCents: number | null
  newCents: number | null
  reason: string | null
  userName: string | null
  createdAt: string
}

export interface ProductLookupResult {
  product: ProductListItem
  variant: VariantDto | null
}

export interface PricingSettings {
  minMarginBps: number
  defaultTargetMarginBps: number
  defaultTaxBps: number
  defaultCardFeeBps: number
  defaultCommissionBps: number
}

export interface CategoryPricingPreview {
  categoryId: number
  categoryName: string
  marginBps: number
  items: {
    productId: number
    internalCode: string
    name: string
    totalCostCents: number
    currentPriceCents: number
    currentMarginBps: number | null
    suggestedPriceCents: number | null
    problem: string | null
  }[]
}

export interface ImportPreview {
  token: string
  fileName: string
  total: number
  createCount: number
  updateCount: number
  errorCount: number
  rows: { line: number; action: 'create' | 'update' | 'error'; code: string | null; name: string | null; messages: string[] }[]
}

export interface ImportResult {
  created: number
  updated: number
  skipped: number
  errors: { line: number; message: string }[]
}

export interface FileResult {
  path: string
  count?: number
}

// ───────────── Fase 3: estoque ─────────────

export type StockItemStatus = 'ok' | 'low' | 'out' | 'negative'

/** Posição de estoque de um produto (sem variações) ou de uma variação. */
export interface StockItem {
  productId: number
  variantId: number | null
  internalCode: string
  name: string
  variantName: string | null
  sku: string | null
  barcode: string | null
  unit: string
  categoryName: string | null
  stockMilli: number
  minStockMilli: number
  status: StockItemStatus
  /** Custo unitário e valor em estoque: null sem a permissão products.cost. */
  unitCostCents: number | null
  stockValueCents: number | null
  lastMovementAt: string | null
  active: boolean
  allowNegativeStock: boolean
}

export interface StockOverviewResult {
  items: StockItem[]
  total: number
  page: number
  pageSize: number
}

export interface StockSummary {
  positions: number
  stockValueCents: number | null
  lowCount: number
  outCount: number
  negativeCount: number
  staleCount: number
  staleDays: number
  lowStockAlerts: boolean
}

export interface StockMovementDto {
  id: number
  createdAt: string
  type: 'INITIAL' | 'ENTRY' | 'EXIT' | 'SALE' | 'SALE_CANCEL' | 'RETURN' | 'ADJUSTMENT' | 'INVENTORY'
  productId: number
  internalCode: string
  productName: string
  variantName: string | null
  unit: string
  quantityMilli: number
  balanceAfterMilli: number
  unitCostCents: number | null
  reason: string | null
  referenceType: string | null
  referenceId: string | null
  documentNumber: string | null
  supplierName: string | null
  userName: string | null
}

export interface StockMovementsResult {
  items: StockMovementDto[]
  total: number
  page: number
  pageSize: number
}

export interface StockOperationResult {
  movements: number
  /** Avisos que não impedem a operação (ex.: preço automático desatualizado pelo novo custo). */
  warnings: string[]
}

export interface InventorySummaryDto {
  id: number
  name: string
  status: 'OPEN' | 'APPLIED' | 'CANCELLED'
  categoryName: string | null
  itemCount: number
  countedCount: number
  createdAt: string
  createdByName: string
  appliedAt: string | null
  appliedByName: string | null
}

export interface InventoryItemDto {
  id: number
  productId: number
  variantId: number | null
  internalCode: string
  name: string
  variantName: string | null
  barcode: string | null
  unit: string
  expectedMilli: number
  currentMilli: number
  countedMilli: number | null
  /** Contado − estoque atual (o que será lançado ao aplicar). */
  differenceMilli: number | null
  appliedDeltaMilli: number | null
}

export interface InventoryDetail extends InventorySummaryDto {
  notes: string | null
  items: InventoryItemDto[]
}

// ───────────── Fase 4: PDV ─────────────

export interface CashSessionDto {
  id: number
  status: 'OPEN' | 'CLOSED'
  userId: number
  userName: string
  openingCents: number
  openedAt: string
  /** Dinheiro esperado na gaveta: abertura + movimentações em dinheiro. */
  cashBalanceCents: number
  salesCount: number
  salesTotalCents: number
}

export interface CustomerLite {
  id: number
  name: string
  document: string | null
  phone: string | null
  /** Crediário: limite (null = não liberado) e quanto ainda está disponível. Só na busca do PDV. */
  creditLimitCents?: number | null
  creditAvailableCents?: number | null
}

/** Item vendável no PDV (produto sem variações ou variação), com dados de preço. */
export interface PdvItem {
  productId: number
  variantId: number | null
  internalCode: string
  name: string
  variantName: string | null
  barcode: string | null
  unit: string
  stockMilli: number
  allowNegativeStock: boolean
  salePriceCents: number
  promoPriceCents: number | null
  promoStartsAt: string | null
  promoEndsAt: string | null
  wholesalePriceCents: number | null
  wholesaleMinMilli: number | null
  variantPriceCents: number | null
  imageUrl: string | null
}

export interface SalePreview {
  lines: {
    index: number
    description: string
    unitPriceCents: number
    priceKind: 'retail' | 'promo' | 'wholesale' | 'variant'
    grossCents: number
    discountCents: number
    totalCents: number
  }[]
  subtotalCents: number
  itemsDiscountCents: number
  saleDiscountCents: number
  totalCents: number
  /** Desconto total sobre o subtotal, em bps. */
  discountBps: number
  /** Limite de desconto do usuário logado. */
  maxDiscountBps: number
  requiresAuthorization: boolean
}

export interface SaleItemDto {
  id: number
  productId: number
  variantId: number | null
  description: string
  unit: string
  quantityMilli: number
  unitPriceCents: number
  discountCents: number
  totalCents: number
  returnedMilli: number
}

export interface SaleDetail {
  id: number
  status: 'COMPLETED' | 'CANCELLED'
  createdAt: string
  operatorName: string
  sellerName: string | null
  customer: CustomerLite | null
  customerDocument: string | null
  items: SaleItemDto[]
  payments: { method: string; label: string | null; amountCents: number; installments: number; status: string; voucherCode: string | null }[]
  subtotalCents: number
  discountCents: number
  totalCents: number
  paidCents: number
  changeCents: number
  notes: string | null
  discountAuthorizedByName: string | null
  cancelledAt: string | null
  cancelledByName: string | null
  cancelReason: string | null
  returns: { id: number; createdAt: string; refundMethod: string; refundCents: number; voucherCode: string | null; userName: string; reason: string }[]
  /** Parcelas do crediário (Contas a receber). */
  installments: { id: number; number: number; dueDate: string; amountCents: number; receivedCents: number; status: string }[]
  cashSessionId: number | null
  /** true quando a finalização foi reenviada e a venda já existia. */
  duplicate?: boolean
  /** Aviso de dispositivo (ex.: gaveta não abriu); a venda foi registrada normalmente. */
  deviceWarning?: string
}

export interface SaleListItem {
  id: number
  createdAt: string
  status: 'COMPLETED' | 'CANCELLED'
  totalCents: number
  itemCount: number
  operatorName: string
  customerName: string | null
  paymentMethods: string[]
  hasReturns: boolean
}

export interface SaleListResult {
  items: SaleListItem[]
  total: number
  page: number
  pageSize: number
}

export interface SaleReturnResult {
  returnId: number
  refundMethod: string
  refundCents: number
  voucherCode: string | null
  duplicate: boolean
}

export interface VoucherDto {
  code: string
  balanceCents: number
  saleId: number
  createdAt: string
}

export interface SellerDto {
  id: number
  name: string
}

// ───────────── Fase 5: caixa ─────────────

export interface CashMethodSummary {
  method: 'CASH' | 'PIX' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'OTHER'
  openingCents: number
  salesCents: number
  cancelsCents: number
  refundsCents: number
  suppliesCents: number
  withdrawalsCents: number
  otherInCents: number
  otherOutCents: number
  expectedCents: number
  countedCents: number | null
  differenceCents: number | null
}

export interface CashSummary {
  sessionId: number
  byMethod: CashMethodSummary[]
  expectedCashCents: number
  salesCount: number
  salesTotalCents: number
  cancelledCount: number
  returnsCount: number
}

export interface CashMovementDto {
  id: number
  createdAt: string
  type: string
  method: string
  amountCents: number
  description: string | null
  userName: string
  referenceType: string | null
  referenceId: string | null
}

export interface CashSessionListItem {
  id: number
  userId: number
  userName: string
  status: 'OPEN' | 'CLOSED'
  openedAt: string
  closedAt: string | null
  closedByName: string | null
  openingCents: number
  salesTotalCents: number
  expectedCents: number | null
  countedCents: number | null
  differenceCents: number | null
}

export interface CashSessionDetail extends CashSessionListItem {
  notes: string | null
  summary: CashSummary
  movements: CashMovementDto[]
}

export interface CashHistoryResult {
  items: CashSessionListItem[]
  total: number
  page: number
  pageSize: number
}

export interface CashDailyReport {
  date: string
  sessions: CashSessionListItem[]
  byMethod: { method: string; netCents: number }[]
  salesCount: number
  salesTotalCents: number
  cancelledCount: number
  cancelledTotalCents: number
  refundsCents: number
  suppliesCents: number
  withdrawalsCents: number
  differenceTotalCents: number
}

// ───────────── Fase 6: clientes, pedidos, orçamentos e catálogo ─────────────

export interface CustomerDto {
  id: number
  name: string
  document: string | null
  phone: string | null
  email: string | null
  zipCode: string | null
  street: string | null
  number: string | null
  complement: string | null
  district: string | null
  city: string | null
  state: string | null
  notes: string | null
  consentAt: string | null
  anonymizedAt: string | null
  creditLimitCents: number | null
  active: boolean
  createdAt: string
}

export interface CustomerListItem {
  id: number
  name: string
  document: string | null
  phone: string | null
  email: string | null
  city: string | null
  state: string | null
  active: boolean
  anonymized: boolean
  salesCount: number
  salesTotalCents: number
  lastPurchaseAt: string | null
  openBalanceCents: number
}

export interface CustomerListResult {
  items: CustomerListItem[]
  total: number
  page: number
  pageSize: number
}

export interface DocumentLineDto {
  id: number
  productId: number | null
  variantId: number | null
  description: string
  unit: string
  isService: boolean
  freeText: boolean
  quantityMilli: number
  unitPriceCents: number
  discountCents: number
  totalCents: number
}

export interface OrderListItem {
  id: number
  createdAt: string
  status: 'PENDING' | 'CONFIRMED' | 'PICKING' | 'READY' | 'DELIVERED' | 'CANCELLED'
  customerName: string | null
  totalCents: number
  itemCount: number
  expectedDeliveryAt: string | null
  userName: string
  saleId: number | null
  quoteId: number | null
}

export interface OrderDetail extends OrderListItem {
  customer: CustomerLite | null
  items: DocumentLineDto[]
  subtotalCents: number
  discountCents: number
  notes: string | null
  discountAuthorizedByName: string | null
  deliveredAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
}

export interface OrderListResult {
  items: OrderListItem[]
  total: number
  page: number
  pageSize: number
}

export interface QuoteListItem {
  id: number
  createdAt: string
  /** Situação efetiva: rascunho/enviado com validade vencida aparece como EXPIRED. */
  status: 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
  validUntil: string
  customerName: string | null
  totalCents: number
  itemCount: number
  userName: string
  orderId: number | null
  saleId: number | null
}

export interface QuoteDetail extends QuoteListItem {
  customer: CustomerLite | null
  contactName: string | null
  contactPhone: string | null
  items: DocumentLineDto[]
  subtotalCents: number
  discountCents: number
  notes: string | null
  discountAuthorizedByName: string | null
  sentAt: string | null
  decidedAt: string | null
  /** Linhas de texto livre impedem a conversão em pedido/venda. */
  hasFreeLines: boolean
}

export interface QuoteListResult {
  items: QuoteListItem[]
  total: number
  page: number
  pageSize: number
}

export interface CustomerDetail extends CustomerDto {
  salesCount: number
  salesTotalCents: number
  lastPurchaseAt: string | null
  openBalanceCents: number
  sales: SaleListItem[]
  orders: OrderListItem[]
  quotes: QuoteListItem[]
}

export interface DocumentPreview {
  lines: { index: number; description: string; unitPriceCents: number; grossCents: number; discountCents: number; totalCents: number }[]
  subtotalCents: number
  itemsDiscountCents: number
  documentDiscountCents: number
  totalCents: number
  discountBps: number
  maxDiscountBps: number
  requiresAuthorization: boolean
}

/** Venda a partir de pedido/orçamento: itens e preços combinados, somente leitura no PDV. */
export interface SaleSource {
  type: 'ORDER' | 'QUOTE'
  id: number
  customer: CustomerLite | null
  lines: { description: string; unit: string; quantityMilli: number; unitPriceCents: number; discountCents: number; totalCents: number }[]
  subtotalCents: number
  discountCents: number
  totalCents: number
}

export interface CatalogProduct {
  id: number
  name: string
  description: string | null
  imageUrl: string | null
  unit: string
  priceCents: number
  regularPriceCents: number
  promo: boolean
  inStock: boolean
  variants: string[]
}

export interface CatalogData {
  generatedAt: string
  title: string
  showPrices: boolean
  categories: { name: string; products: CatalogProduct[] }[]
  productCount: number
}

// ───────────── Fase 7: financeiro e relatórios ─────────────

export interface PayableDto {
  id: number
  description: string
  supplierId: number | null
  supplierName: string | null
  category: string | null
  documentNumber: string | null
  amountCents: number
  dueDate: string
  /** Situação efetiva: em aberto com vencimento passado = OVERDUE. */
  status: 'OPEN' | 'OVERDUE' | 'PAID' | 'CANCELLED'
  daysOverdue: number
  paidAt: string | null
  paidCents: number | null
  paymentMethod: string | null
  paidFromCash: boolean
  paidByName: string | null
  receiptName: string | null
  recurrence: 'NONE' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  recurrenceSourceId: number | null
  recurrenceNextId: number | null
  notes: string | null
  createdAt: string
  createdByName: string | null
  cancelledAt: string | null
  cancelReason: string | null
}

export interface PayableListResult {
  items: PayableDto[]
  total: number
  page: number
  pageSize: number
  /** Soma dos valores filtrados (todas as páginas). */
  amountCents: number
  paidCents: number
}

export interface DueSummary {
  overdueCount: number
  overdueCents: number
  dueTodayCount: number
  dueTodayCents: number
  next7Count: number
  next7Cents: number
  openCents: number
  /** Pago (contas a pagar) ou recebido (contas a receber) no mês atual. */
  settledMonthCents: number
}

export interface ReceivablePaymentDto {
  id: number
  amountCents: number
  interestCents: number
  discountCents: number
  method: string
  paidAt: string
  userName: string
  cashSessionId: number | null
  reversedAt: string | null
  reversedByName: string | null
  reverseReason: string | null
}

export interface ReceivableDto {
  id: number
  description: string
  customerId: number | null
  customerName: string | null
  saleId: number | null
  installmentNumber: number
  installmentCount: number
  amountCents: number
  receivedCents: number
  remainingCents: number
  dueDate: string
  status: 'OPEN' | 'PARTIAL' | 'OVERDUE' | 'PAID' | 'CANCELLED'
  daysOverdue: number
  notes: string | null
  createdAt: string
  cancelledAt: string | null
  cancelReason: string | null
}

export interface ReceivableDetail extends ReceivableDto {
  payments: ReceivablePaymentDto[]
  createdByName: string | null
}

export interface ReceivableListResult {
  items: ReceivableDto[]
  total: number
  page: number
  pageSize: number
  amountCents: number
  remainingCents: number
}

export type ReportFormat = 'text' | 'money' | 'int' | 'qty' | 'percent' | 'date' | 'datetime'
export interface ReportColumn {
  key: string
  label: string
  format: ReportFormat
}
export type ReportRow = Record<string, string | number | null>

export interface ReportResult {
  key: ReportKey
  title: string
  /** Período e filtros aplicados, em texto. */
  subtitle: string
  generatedAt: string
  columns: ReportColumn[]
  rows: ReportRow[]
  totals: ReportRow | null
  /** Gráfico sugerido (coluna do eixo X e séries numéricas). */
  chart: { type: 'bar' | 'line'; x: string; series: { key: string; label: string }[] } | null
  notes: string[]
}

// ───────────── Fase 8: integrações ─────────────

export interface PrinterInfo {
  name: string
  displayName: string
  isDefault: boolean
}

export interface FiscalPayloadItem {
  productId: number
  code: string
  barcode: string | null
  description: string
  ncm: string | null
  cest: string | null
  cfop: string | null
  origin: string | null
  taxCode: string | null
  unit: string
  quantityMilli: number
  unitPriceCents: number
  discountCents: number
  totalCents: number
}

/** Dados da venda organizados para o provedor fiscal (o provedor monta e assina o XML). */
export interface FiscalPayload {
  type: 'NFE' | 'NFCE'
  environment: string
  series: number
  emitter: { legalName: string; tradeName: string | null; document: string | null; stateRegistration: string | null; taxRegime: string | null; street: string | null; number: string | null; district: string | null; city: string | null; state: string | null; zipCode: string | null }
  recipient: { name: string | null; document: string | null; street: string | null; number: string | null; district: string | null; city: string | null; state: string | null; zipCode: string | null } | null
  items: FiscalPayloadItem[]
  payments: { code: string; method: string; amountCents: number }[]
  totals: { productsCents: number; discountCents: number; totalCents: number; changeCents: number }
}

export interface FiscalDocumentDto {
  id: number
  type: 'NFE' | 'NFCE'
  saleId: number | null
  status: 'PENDING' | 'PROCESSING' | 'AUTHORIZED' | 'REJECTED' | 'CANCELLED' | 'ERROR' | 'DISCARDED'
  provider: string | null
  environment: string
  series: number | null
  number: number | null
  accessKey: string | null
  protocol: string | null
  message: string | null
  totalCents: number
  customerName: string | null
  issues: string[]
  hasXml: boolean
  hasDanfe: boolean
  createdAt: string
  authorizedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
}

export interface FiscalDocumentDetail extends FiscalDocumentDto {
  payload: FiscalPayload | null
}

export interface FiscalListResult {
  items: FiscalDocumentDto[]
  total: number
  page: number
  pageSize: number
}

export interface FiscalChecklist {
  company: string[]
  products: { id: number; internalCode: string; name: string; missing: string[] }[]
  productsWithIssues: number
  providerConfigured: boolean
}

export interface ReconciliationRow {
  paymentId: number
  saleId: number
  createdAt: string
  saleStatus: 'COMPLETED' | 'CANCELLED'
  operatorName: string
  method: string
  installments: number
  amountCents: number
  nsu: string | null
  authorizationCode: string | null
  cardBrand: string | null
  reconciledAt: string | null
}

export interface ReconciliationResult {
  rows: ReconciliationRow[]
  byMethod: { method: string; count: number; amountCents: number; reconciledCount: number; reconciledCents: number }[]
}

export interface IntegrationStatus {
  fiscal: { provider: string; label: string; enabled: boolean; environment: string }
  tef: { provider: string; label: string; enabled: boolean }
}

// ───────────── Fase 9: backup e segurança ─────────────

export interface BackupDto {
  id: number
  kind: 'MANUAL' | 'AUTOMATIC' | 'PRE_MIGRATION' | 'PRE_RESTORE'
  status: 'OK' | 'FAILED' | 'REMOVED'
  path: string
  fileName: string
  sizeBytes: number
  encrypted: boolean
  verifiedAt: string | null
  message: string | null
  createdAt: string
  userName: string | null
  /** O arquivo ainda está no local (pendrive desconectado = false). */
  exists: boolean
}

export interface BackupOverview {
  settings: BackupSettings
  defaultDirectory: string
  directory: string
  directoryAvailable: boolean
  freeBytes: number | null
  databaseBytes: number
  passwordConfigured: boolean
  lastSuccess: BackupDto | null
  lastFailure: BackupDto | null
  nextAutomaticAt: string | null
  restorePending: boolean
}

export interface BackupInspection {
  token: string
  fileName: string
  sizeBytes: number
  encrypted: boolean
  modifiedAt: string
  schemaVersion: string | null
  /** Backup de versão anterior do sistema: será atualizado automaticamente após restaurar. */
  needsUpgrade: boolean
  companyName: string | null
  counts: { products: number; customers: number; sales: number; users: number }
  lastSaleAt: string | null
}

// ───────────── API exposta ao renderer ─────────────

export interface AppApi {
  app: {
    info(): Promise<ApiResult<AppInfo>>
  }
  setup: {
    status(): Promise<ApiResult<SetupStatus>>
    complete(input: SetupInput): Promise<ApiResult<SessionUser>>
  }
  auth: {
    login(input: LoginInput): Promise<ApiResult<SessionUser>>
    logout(): Promise<ApiResult<null>>
    session(): Promise<ApiResult<SessionUser | null>>
    changePassword(input: ChangePasswordInput): Promise<ApiResult<null>>
  }
  dashboard: {
    summary(): Promise<ApiResult<DashboardSummary>>
  }
  company: {
    get(): Promise<ApiResult<CompanyDto | null>>
    update(input: CompanyInput): Promise<ApiResult<CompanyDto>>
  }
  users: {
    list(): Promise<ApiResult<UserDto[]>>
    create(input: UserCreateInput): Promise<ApiResult<UserDto>>
    update(input: UserUpdateInput): Promise<ApiResult<UserDto>>
    resetPassword(input: UserResetPasswordInput): Promise<ApiResult<null>>
  }
  roles: {
    list(): Promise<ApiResult<RoleDto[]>>
    permissions(): Promise<ApiResult<PermissionDto[]>>
    updatePermissions(input: RoleUpdatePermissionsInput): Promise<ApiResult<RoleDto>>
  }
  products: {
    list(input: ProductListInput): Promise<ApiResult<ProductListResult>>
    get(input: { id: number }): Promise<ApiResult<ProductDetail>>
    create(input: ProductCreateInput): Promise<ApiResult<ProductDetail>>
    update(input: ProductUpdateInput): Promise<ApiResult<ProductDetail>>
    quickCreate(input: ProductQuickCreateInput): Promise<ApiResult<ProductDetail>>
    setActive(input: { id: number; active: boolean }): Promise<ApiResult<null>>
    remove(input: { id: number }): Promise<ApiResult<null>>
    priceHistory(input: { id: number }): Promise<ApiResult<PriceHistoryEntry[]>>
    lookup(input: { code: string }): Promise<ApiResult<ProductLookupResult | null>>
    /** Abre o seletor de arquivos e define a imagem do produto. null = cancelado. */
    pickImage(input: { id: number }): Promise<ApiResult<{ imageUrl: string } | null>>
    removeImage(input: { id: number }): Promise<ApiResult<null>>
    /** Abre "Salvar como" e grava um CSV. null = cancelado. */
    exportCsv(): Promise<ApiResult<FileResult | null>>
    saveImportTemplate(): Promise<ApiResult<FileResult | null>>
    /** Abre o seletor de arquivos e valida o CSV sem gravar nada. null = cancelado. */
    importPreview(): Promise<ApiResult<ImportPreview | null>>
    importApply(input: ImportApplyInput): Promise<ApiResult<ImportResult>>
    categoryPricingPreview(input: CategoryPricingPreviewInput): Promise<ApiResult<CategoryPricingPreview>>
    categoryPricingApply(input: CategoryPricingApplyInput): Promise<ApiResult<{ updated: number }>>
  }
  categories: {
    list(): Promise<ApiResult<CategoryDto[]>>
    create(input: CategoryInput): Promise<ApiResult<CategoryDto>>
    update(input: CategoryUpdateInput): Promise<ApiResult<CategoryDto>>
    remove(input: { id: number }): Promise<ApiResult<null>>
  }
  suppliers: {
    list(input: SupplierListInput): Promise<ApiResult<SupplierDto[]>>
    create(input: SupplierInput): Promise<ApiResult<SupplierDto>>
    update(input: SupplierUpdateInput): Promise<ApiResult<SupplierDto>>
    remove(input: { id: number }): Promise<ApiResult<null>>
  }
  settings: {
    pricing(): Promise<ApiResult<PricingSettings>>
    updatePricing(input: PricingSettingsInput): Promise<ApiResult<PricingSettings>>
  }
  stock: {
    overview(input: StockOverviewInput): Promise<ApiResult<StockOverviewResult>>
    summary(): Promise<ApiResult<StockSummary>>
    /** Busca rápida de produtos/variações por nome ou código (leitor de código de barras). */
    search(input: StockSearchInput): Promise<ApiResult<StockItem[]>>
    movements(input: StockMovementsInput): Promise<ApiResult<StockMovementsResult>>
    exportMovements(input: StockMovementsInput): Promise<ApiResult<FileResult | null>>
    entry(input: StockEntryInput): Promise<ApiResult<StockOperationResult>>
    exit(input: StockExitInput): Promise<ApiResult<StockOperationResult>>
    adjust(input: StockAdjustInput): Promise<ApiResult<StockOperationResult>>
  }
  cash: {
    /** Sessão de caixa aberta do usuário logado (null se não houver). */
    current(): Promise<ApiResult<CashSessionDto | null>>
    open(input: CashOpenInput): Promise<ApiResult<CashSessionDto>>
    addMovement(input: CashMovementInput): Promise<ApiResult<CashMovementDto>>
    summary(input: { sessionId: number }): Promise<ApiResult<CashSummary>>
    close(input: CashCloseInput): Promise<ApiResult<CashSessionDetail>>
    get(input: { sessionId: number }): Promise<ApiResult<CashSessionDetail>>
    history(input: CashHistoryInput): Promise<ApiResult<CashHistoryResult>>
    daily(input: { date: string }): Promise<ApiResult<CashDailyReport>>
    printReport(input: { sessionId: number }): Promise<ApiResult<null>>
    saveReportPdf(input: { sessionId: number }): Promise<ApiResult<FileResult | null>>
  }
  customers: {
    search(input: { query: string }): Promise<ApiResult<CustomerLite[]>>
    quickCreate(input: CustomerQuickInput): Promise<ApiResult<CustomerLite>>
    list(input: CustomerListInput): Promise<ApiResult<CustomerListResult>>
    get(input: { id: number }): Promise<ApiResult<CustomerDetail>>
    create(input: CustomerInput): Promise<ApiResult<CustomerDto>>
    update(input: CustomerUpdateInput): Promise<ApiResult<CustomerDto>>
    remove(input: { id: number }): Promise<ApiResult<null>>
    /** LGPD: remove os dados pessoais e mantém o histórico de vendas. */
    anonymize(input: { id: number }): Promise<ApiResult<null>>
    /** LGPD: exporta os dados do cliente (portabilidade) para um arquivo JSON. */
    exportData(input: { id: number }): Promise<ApiResult<FileResult | null>>
  }
  documents: {
    /** Cálculo de itens e descontos de pedido/orçamento. */
    preview(input: { items: DocumentItemInput[]; discountCents?: number }): Promise<ApiResult<DocumentPreview>>
  }
  orders: {
    list(input: OrderListInput): Promise<ApiResult<OrderListResult>>
    get(input: { id: number }): Promise<ApiResult<OrderDetail>>
    create(input: OrderInput): Promise<ApiResult<OrderDetail>>
    update(input: OrderUpdateInput): Promise<ApiResult<OrderDetail>>
    setStatus(input: { id: number; status: 'PENDING' | 'CONFIRMED' | 'PICKING' | 'READY' | 'DELIVERED' }): Promise<ApiResult<OrderDetail>>
    cancel(input: { id: number; reason: string }): Promise<ApiResult<OrderDetail>>
    print(input: { id: number }): Promise<ApiResult<null>>
    savePdf(input: { id: number }): Promise<ApiResult<FileResult | null>>
  }
  quotes: {
    list(input: QuoteListInput): Promise<ApiResult<QuoteListResult>>
    get(input: { id: number }): Promise<ApiResult<QuoteDetail>>
    create(input: QuoteInput): Promise<ApiResult<QuoteDetail>>
    update(input: QuoteUpdateInput): Promise<ApiResult<QuoteDetail>>
    setStatus(input: { id: number; status: 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED' }): Promise<ApiResult<QuoteDetail>>
    toOrder(input: { id: number; expectedDeliveryAt?: string | null }): Promise<ApiResult<OrderDetail>>
    print(input: { id: number }): Promise<ApiResult<null>>
    savePdf(input: { id: number }): Promise<ApiResult<FileResult | null>>
  }
  catalog: {
    data(input: CatalogInput): Promise<ApiResult<CatalogData>>
    print(input: CatalogInput): Promise<ApiResult<null>>
    savePdf(input: CatalogInput): Promise<ApiResult<FileResult | null>>
  }
  sales: {
    searchItems(input: { query: string; limit?: number }): Promise<ApiResult<PdvItem[]>>
    sellers(): Promise<ApiResult<SellerDto[]>>
    preview(input: SalePreviewInput): Promise<ApiResult<SalePreview>>
    finalize(input: SaleFinalizeInput): Promise<ApiResult<SaleDetail>>
    list(input: SaleListInput): Promise<ApiResult<SaleListResult>>
    get(input: { id: number }): Promise<ApiResult<SaleDetail>>
    cancel(input: SaleCancelInput): Promise<ApiResult<SaleDetail>>
    returnItems(input: SaleReturnInput): Promise<ApiResult<SaleReturnResult>>
    voucher(input: { code: string }): Promise<ApiResult<VoucherDto | null>>
    /** Carrega um pedido ou orçamento para ser vendido no PDV. */
    source(input: { orderId?: number; quoteId?: number }): Promise<ApiResult<SaleSource>>
    /** Abre a caixa de diálogo de impressão com o comprovante não fiscal. */
    printReceipt(input: { id: number; returnId?: number }): Promise<ApiResult<null>>
    saveReceiptPdf(input: { id: number; returnId?: number }): Promise<ApiResult<FileResult | null>>
  }
  payables: {
    list(input: PayableListInput): Promise<ApiResult<PayableListResult>>
    get(input: { id: number }): Promise<ApiResult<PayableDto>>
    create(input: PayableInput): Promise<ApiResult<PayableDto>>
    update(input: PayableUpdateInput): Promise<ApiResult<PayableDto>>
    pay(input: PayablePayInput): Promise<ApiResult<PayableDto>>
    reverse(input: { id: number; reason: string }): Promise<ApiResult<PayableDto>>
    cancel(input: { id: number; reason: string }): Promise<ApiResult<PayableDto>>
    summary(): Promise<ApiResult<DueSummary>>
    categories(): Promise<ApiResult<string[]>>
    /** Abre o seletor de arquivos e anexa o comprovante. null = cancelado. */
    attachReceipt(input: { id: number }): Promise<ApiResult<PayableDto | null>>
    openReceipt(input: { id: number }): Promise<ApiResult<null>>
    removeReceipt(input: { id: number }): Promise<ApiResult<PayableDto>>
  }
  receivables: {
    list(input: ReceivableListInput): Promise<ApiResult<ReceivableListResult>>
    get(input: { id: number }): Promise<ApiResult<ReceivableDetail>>
    create(input: ReceivableInput): Promise<ApiResult<ReceivableDto[]>>
    update(input: ReceivableUpdateInput): Promise<ApiResult<ReceivableDetail>>
    receive(input: ReceivableReceiveInput): Promise<ApiResult<ReceivableDetail>>
    reverse(input: { paymentId: number; reason: string }): Promise<ApiResult<ReceivableDetail>>
    cancel(input: { id: number; reason: string }): Promise<ApiResult<ReceivableDetail>>
    summary(): Promise<ApiResult<DueSummary>>
    /** Recibo do recebimento (impressão). */
    printReceipt(input: { paymentId: number }): Promise<ApiResult<null>>
  }
  reports: {
    run(input: ReportInput): Promise<ApiResult<ReportResult>>
    /** CSV, Excel (.xlsx) ou PDF via "Salvar como". null = cancelado. */
    export(input: ReportExportInput): Promise<ApiResult<FileResult | null>>
    print(input: ReportInput): Promise<ApiResult<null>>
  }
  devices: {
    settings(): Promise<ApiResult<DevicesSettings>>
    update(input: DevicesInput): Promise<ApiResult<DevicesSettings>>
    /** Impressoras instaladas no Windows. */
    printers(): Promise<ApiResult<PrinterInfo[]>>
    testPrint(input: { target: 'receipt' | 'document' | 'label' }): Promise<ApiResult<null>>
    /** Abre a gaveta de dinheiro (registrado na auditoria). */
    openDrawer(): Promise<ApiResult<null>>
    testDrawer(): Promise<ApiResult<null>>
    /** Etiquetas com código de barras: impressão ou PDF (null = cancelado). */
    printLabels(input: LabelPrintInput): Promise<ApiResult<FileResult | null>>
  }
  integrations: {
    status(): Promise<ApiResult<IntegrationStatus>>
  }
  fiscal: {
    settings(): Promise<ApiResult<FiscalSettings>>
    updateSettings(input: FiscalSettingsInput): Promise<ApiResult<FiscalSettings>>
    checklist(): Promise<ApiResult<FiscalChecklist>>
    list(input: FiscalListInput): Promise<ApiResult<FiscalListResult>>
    get(input: { id: number }): Promise<ApiResult<FiscalDocumentDetail>>
    prepare(input: FiscalPrepareInput): Promise<ApiResult<FiscalDocumentDetail>>
    transmit(input: { id: number }): Promise<ApiResult<FiscalDocumentDetail>>
    query(input: { id: number }): Promise<ApiResult<FiscalDocumentDetail>>
    cancel(input: { id: number; reason: string }): Promise<ApiResult<FiscalDocumentDetail>>
    discard(input: { id: number }): Promise<ApiResult<FiscalDocumentDetail>>
    saveXml(input: { id: number }): Promise<ApiResult<FileResult | null>>
    saveDanfe(input: { id: number }): Promise<ApiResult<FileResult | null>>
  }
  tef: {
    settings(): Promise<ApiResult<TefSettings>>
    updateSettings(input: TefSettings): Promise<ApiResult<TefSettings>>
    reconciliation(input: ReconciliationListInput): Promise<ApiResult<ReconciliationResult>>
    updateReference(input: PaymentReferenceUpdateInput): Promise<ApiResult<ReconciliationRow>>
    reconcile(input: { paymentIds: number[]; reconciled: boolean }): Promise<ApiResult<{ updated: number }>>
  }
  backup: {
    overview(): Promise<ApiResult<BackupOverview>>
    history(): Promise<ApiResult<BackupDto[]>>
    updateSettings(input: BackupSettingsInput): Promise<ApiResult<BackupOverview>>
    setPassword(input: BackupPasswordInput): Promise<ApiResult<null>>
    /** Escolhe a pasta de destino (ex.: pendrive). null = cancelado. */
    chooseDirectory(): Promise<ApiResult<string | null>>
    create(): Promise<ApiResult<BackupDto>>
    verify(input: { id: number }): Promise<ApiResult<BackupDto>>
    inspect(input: { id: number; backupPassword?: string }): Promise<ApiResult<BackupInspection>>
    /** Escolhe um arquivo de backup no computador e o valida. null = cancelado. */
    inspectFile(input: { backupPassword?: string }): Promise<ApiResult<BackupInspection | null>>
    /** Agenda a restauração e reinicia o sistema. */
    restore(input: RestoreInput): Promise<ApiResult<{ restarting: boolean }>>
    showInFolder(input: { id: number }): Promise<ApiResult<null>>
  }
  security: {
    settings(): Promise<ApiResult<SecuritySettings>>
    update(input: SecuritySettings): Promise<ApiResult<SecuritySettings>>
  }
  inventories: {
    list(): Promise<ApiResult<InventorySummaryDto[]>>
    create(input: InventoryCreateInput): Promise<ApiResult<InventoryDetail>>
    get(input: { inventoryId: number }): Promise<ApiResult<InventoryDetail>>
    saveCounts(input: InventoryCountsInput): Promise<ApiResult<InventoryDetail>>
    apply(input: { inventoryId: number }): Promise<ApiResult<InventoryDetail>>
    cancel(input: { inventoryId: number }): Promise<ApiResult<null>>
  }
}

/** Mapa método -> canal IPC. O preload só encaminha canais desta lista. */
export const IPC_CHANNELS = {
  app: { info: 'app:info' },
  setup: { status: 'setup:status', complete: 'setup:complete' },
  auth: {
    login: 'auth:login',
    logout: 'auth:logout',
    session: 'auth:session',
    changePassword: 'auth:change-password'
  },
  dashboard: { summary: 'dashboard:summary' },
  company: { get: 'company:get', update: 'company:update' },
  users: {
    list: 'users:list',
    create: 'users:create',
    update: 'users:update',
    resetPassword: 'users:reset-password'
  },
  roles: {
    list: 'roles:list',
    permissions: 'roles:permissions',
    updatePermissions: 'roles:update-permissions'
  },
  products: {
    list: 'products:list',
    get: 'products:get',
    create: 'products:create',
    update: 'products:update',
    quickCreate: 'products:quick-create',
    setActive: 'products:set-active',
    remove: 'products:remove',
    priceHistory: 'products:price-history',
    lookup: 'products:lookup',
    pickImage: 'products:pick-image',
    removeImage: 'products:remove-image',
    exportCsv: 'products:export-csv',
    saveImportTemplate: 'products:save-import-template',
    importPreview: 'products:import-preview',
    importApply: 'products:import-apply',
    categoryPricingPreview: 'products:category-pricing-preview',
    categoryPricingApply: 'products:category-pricing-apply'
  },
  categories: {
    list: 'categories:list',
    create: 'categories:create',
    update: 'categories:update',
    remove: 'categories:remove'
  },
  suppliers: {
    list: 'suppliers:list',
    create: 'suppliers:create',
    update: 'suppliers:update',
    remove: 'suppliers:remove'
  },
  settings: {
    pricing: 'settings:pricing',
    updatePricing: 'settings:update-pricing'
  },
  stock: {
    overview: 'stock:overview',
    summary: 'stock:summary',
    search: 'stock:search',
    movements: 'stock:movements',
    exportMovements: 'stock:export-movements',
    entry: 'stock:entry',
    exit: 'stock:exit',
    adjust: 'stock:adjust'
  },
  cash: {
    current: 'cash:current',
    open: 'cash:open',
    addMovement: 'cash:add-movement',
    summary: 'cash:summary',
    close: 'cash:close',
    get: 'cash:get',
    history: 'cash:history',
    daily: 'cash:daily',
    printReport: 'cash:print-report',
    saveReportPdf: 'cash:save-report-pdf'
  },
  customers: {
    search: 'customers:search',
    quickCreate: 'customers:quick-create',
    list: 'customers:list',
    get: 'customers:get',
    create: 'customers:create',
    update: 'customers:update',
    remove: 'customers:remove',
    anonymize: 'customers:anonymize',
    exportData: 'customers:export-data'
  },
  documents: { preview: 'documents:preview' },
  orders: {
    list: 'orders:list',
    get: 'orders:get',
    create: 'orders:create',
    update: 'orders:update',
    setStatus: 'orders:set-status',
    cancel: 'orders:cancel',
    print: 'orders:print',
    savePdf: 'orders:save-pdf'
  },
  quotes: {
    list: 'quotes:list',
    get: 'quotes:get',
    create: 'quotes:create',
    update: 'quotes:update',
    setStatus: 'quotes:set-status',
    toOrder: 'quotes:to-order',
    print: 'quotes:print',
    savePdf: 'quotes:save-pdf'
  },
  catalog: { data: 'catalog:data', print: 'catalog:print', savePdf: 'catalog:save-pdf' },
  sales: {
    searchItems: 'sales:search-items',
    sellers: 'sales:sellers',
    preview: 'sales:preview',
    finalize: 'sales:finalize',
    list: 'sales:list',
    get: 'sales:get',
    cancel: 'sales:cancel',
    returnItems: 'sales:return-items',
    voucher: 'sales:voucher',
    source: 'sales:source',
    printReceipt: 'sales:print-receipt',
    saveReceiptPdf: 'sales:save-receipt-pdf'
  },
  payables: {
    list: 'payables:list',
    get: 'payables:get',
    create: 'payables:create',
    update: 'payables:update',
    pay: 'payables:pay',
    reverse: 'payables:reverse',
    cancel: 'payables:cancel',
    summary: 'payables:summary',
    categories: 'payables:categories',
    attachReceipt: 'payables:attach-receipt',
    openReceipt: 'payables:open-receipt',
    removeReceipt: 'payables:remove-receipt'
  },
  receivables: {
    list: 'receivables:list',
    get: 'receivables:get',
    create: 'receivables:create',
    update: 'receivables:update',
    receive: 'receivables:receive',
    reverse: 'receivables:reverse',
    cancel: 'receivables:cancel',
    summary: 'receivables:summary',
    printReceipt: 'receivables:print-receipt'
  },
  reports: { run: 'reports:run', export: 'reports:export', print: 'reports:print' },
  devices: {
    settings: 'devices:settings',
    update: 'devices:update',
    printers: 'devices:printers',
    testPrint: 'devices:test-print',
    openDrawer: 'devices:open-drawer',
    testDrawer: 'devices:test-drawer',
    printLabels: 'devices:print-labels'
  },
  integrations: { status: 'integrations:status' },
  fiscal: {
    settings: 'fiscal:settings',
    updateSettings: 'fiscal:update-settings',
    checklist: 'fiscal:checklist',
    list: 'fiscal:list',
    get: 'fiscal:get',
    prepare: 'fiscal:prepare',
    transmit: 'fiscal:transmit',
    query: 'fiscal:query',
    cancel: 'fiscal:cancel',
    discard: 'fiscal:discard',
    saveXml: 'fiscal:save-xml',
    saveDanfe: 'fiscal:save-danfe'
  },
  tef: {
    settings: 'tef:settings',
    updateSettings: 'tef:update-settings',
    reconciliation: 'tef:reconciliation',
    updateReference: 'tef:update-reference',
    reconcile: 'tef:reconcile'
  },
  backup: {
    overview: 'backup:overview',
    history: 'backup:history',
    updateSettings: 'backup:update-settings',
    setPassword: 'backup:set-password',
    chooseDirectory: 'backup:choose-directory',
    create: 'backup:create',
    verify: 'backup:verify',
    inspect: 'backup:inspect',
    inspectFile: 'backup:inspect-file',
    restore: 'backup:restore',
    showInFolder: 'backup:show-in-folder'
  },
  security: { settings: 'security:settings', update: 'security:update' },
  inventories: {
    list: 'inventories:list',
    create: 'inventories:create',
    get: 'inventories:get',
    saveCounts: 'inventories:save-counts',
    apply: 'inventories:apply',
    cancel: 'inventories:cancel'
  }
} as const satisfies { [K in keyof AppApi]: { [M in keyof AppApi[K]]: string } }
