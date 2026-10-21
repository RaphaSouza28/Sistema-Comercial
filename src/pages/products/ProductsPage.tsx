import { useState } from 'react'
import { Calculator, FolderTree, Package } from 'lucide-react'
import { PageHeader } from '@/components/ui/Card'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/contexts/AuthContext'
import { CategoriesTab } from './CategoriesTab'
import { CategoryPricingTab } from './CategoryPricingTab'
import { ProductList } from './ProductList'

type Tab = 'products' | 'categories' | 'pricing'

export function ProductsPage() {
  const { can } = useAuth()
  const [tab, setTab] = useState<Tab>('products')
  const tabs = [
    { key: 'products' as const, label: 'Produtos', icon: Package },
    { key: 'categories' as const, label: 'Categorias', icon: FolderTree },
    ...(can('products.price') && can('products.cost')
      ? [{ key: 'pricing' as const, label: 'Precificação por categoria', icon: Calculator }]
      : [])
  ]
  return (
    <div className="animate-in">
      <PageHeader title="Produtos" description="Cadastro, preços, variações e categorias." />
      <Tabs tabs={tabs} value={tab} onChange={(k) => setTab(k as Tab)} />
      {tab === 'products' && <ProductList />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'pricing' && <CategoryPricingTab />}
    </div>
  )
}
