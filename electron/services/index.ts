import type { Db } from '../database/connection'
import { AuthService } from './auth.service'
import { CashService } from './cash.service'
import { BackupService, type BackupPaths, type SecretStore } from './backup.service'
import { CatalogService } from './catalog.service'
import { CategoryService } from './category.service'
import { CompanyService } from './company.service'
import { CustomerService } from './customer.service'
import { DashboardService } from './dashboard.service'
import { DeviceService } from './device.service'
import { createFiscalProviders } from '../integrations/fiscal/provider'
import { FiscalService, type FiscalFileStore } from './fiscal/fiscal.service'
import { InventoryService } from './inventory.service'
import { OrderService } from './order.service'
import { PayableService } from './payable.service'
import { ProductService } from './product.service'
import { ProductTransferService } from './productTransfer.service'
import { QuoteService } from './quote.service'
import { ReceivableService } from './receivable.service'
import { ReportService } from './report.service'
import { SaleService } from './sale.service'
import { SettingsService } from './settings.service'
import { SetupService } from './setup.service'
import { StockService } from './stock.service'
import { SupplierService } from './supplier.service'
import { createTefProviders, TefService } from './tef.service'
import { UserService } from './user.service'

export function createServices(db: Db, opts: { fiscalFiles?: FiscalFileStore; backup?: { paths: BackupPaths; secrets: SecretStore } } = {}) {
  const products = new ProductService(db)
  const auth = new AuthService(db)
  const orders = new OrderService(db, auth)
  const stock = new StockService(db)
  return {
    auth,
    setup: new SetupService(db),
    users: new UserService(db),
    company: new CompanyService(db),
    dashboard: new DashboardService(db),
    settings: new SettingsService(db),
    categories: new CategoryService(db),
    suppliers: new SupplierService(db),
    products,
    productTransfer: new ProductTransferService(db, products),
    stock,
    inventories: new InventoryService(db),
    cash: new CashService(db),
    customers: new CustomerService(db),
    sales: new SaleService(db, auth),
    orders,
    quotes: new QuoteService(db, auth, orders),
    catalog: new CatalogService(db),
    payables: new PayableService(db),
    receivables: new ReceivableService(db),
    reports: new ReportService(db, stock),
    devices: new DeviceService(db),
    fiscal: new FiscalService(db, createFiscalProviders(), opts.fiscalFiles ?? null),
    tef: new TefService(db, createTefProviders()),
    /** Ausente nos testes que não exercitam backup (exige caminhos e o cofre de segredos). */
    backup: opts.backup ? new BackupService(db, opts.backup.paths, opts.backup.secrets) : null
  }
}

export type Services = ReturnType<typeof createServices>
