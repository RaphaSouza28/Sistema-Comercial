import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save } from 'lucide-react'
import type { CategoryDto, PricingSettings, ProductDetail, SupplierDto } from '@shared/api'
import { formatQuantity } from '@shared/format'
import { suggestPrice, totalUnitCost } from '@shared/pricing'
import { UNITS } from '@shared/units'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Checkbox, SelectField, TextField } from '@/components/ui/Field'
import { ErrorState, Spinner } from '@/components/ui/Feedback'
import { MoneyField, PercentField, QuantityField } from '@/components/ui/NumberFields'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call, errorMessage, fieldErrors } from '@/services/api'
import { PricingPanel } from './PricingPanel'
import { PriceHistoryCard, ProductImageCard } from './ProductSideCards'
import { optionValues, VariantsEditor, type OptionRow, type VariantRow } from './VariantsEditor'

const TAX_ORIGINS = [
  { value: '', label: 'Não informado' },
  { value: '0', label: '0 — Nacional' },
  { value: '1', label: '1 — Estrangeira (importação direta)' },
  { value: '2', label: '2 — Estrangeira (mercado interno)' },
  { value: '3', label: '3 — Nacional, conteúdo importado > 40% e ≤ 70%' },
  { value: '4', label: '4 — Nacional, processos produtivos básicos' },
  { value: '5', label: '5 — Nacional, conteúdo importado ≤ 40%' },
  { value: '6', label: '6 — Estrangeira, importação direta sem similar' },
  { value: '7', label: '7 — Estrangeira, mercado interno sem similar' },
  { value: '8', label: '8 — Nacional, conteúdo importado > 70%' }
]

type FormState = ReturnType<typeof toForm>

function toForm(p: ProductDetail | null, defaults: PricingSettings) {
  return {
    internalCode: p?.internalCode ?? '',
    sku: p?.sku ?? '',
    barcode: p?.barcode ?? '',
    name: p?.name ?? '',
    description: p?.description ?? '',
    categoryId: p?.categoryId ?? null,
    subcategoryId: p?.subcategoryId ?? null,
    brand: p?.brand ?? '',
    supplierId: p?.supplierId ?? null,
    unit: p?.unit ?? 'UN',
    costCents: p?.costCents ?? 0,
    freightCents: p?.freightCents ?? 0,
    packagingCents: p?.packagingCents ?? 0,
    otherCostsCents: p?.otherCostsCents ?? 0,
    taxBps: p ? p.taxBps : defaults.defaultTaxBps || null,
    cardFeeBps: p ? p.cardFeeBps : defaults.defaultCardFeeBps || null,
    commissionBps: p ? p.commissionBps : defaults.defaultCommissionBps || null,
    targetMarginBps: p ? p.targetMarginBps : defaults.defaultTargetMarginBps,
    pricingMode: p?.pricingMode ?? ('MANUAL' as 'MANUAL' | 'AUTOMATIC'),
    salePriceCents: p?.salePriceCents ?? 0,
    promoPriceCents: p?.promoPriceCents ?? null,
    promoStartsAt: p?.promoStartsAt ?? '',
    promoEndsAt: p?.promoEndsAt ?? '',
    wholesalePriceCents: p?.wholesalePriceCents ?? null,
    wholesaleMinMilli: p?.wholesaleMinMilli ?? null,
    minStockMilli: p?.minStockMilli ?? 0,
    allowNegativeStock: p?.allowNegativeStock ?? false,
    initialStockMilli: 0,
    ncm: p?.ncm ?? '',
    cest: p?.cest ?? '',
    cfop: p?.cfop ?? '',
    taxOrigin: p?.taxOrigin ?? '',
    taxCode: p?.taxCode ?? '',
    active: p?.active ?? true,
    hasVariants: p?.hasVariants ?? false,
    isService: p?.isService ?? false,
    options: (p?.variantOptions ?? []).map<OptionRow>((o) => ({ name: o.name, valuesText: o.values.join(', ') })),
    variants: (p?.variants ?? []).map<VariantRow>((v) => ({
      key: `v${v.id}`,
      id: v.id,
      attributes: v.attributes,
      sku: v.sku ?? '',
      barcode: v.barcode ?? '',
      costCents: v.costCents,
      salePriceCents: v.salePriceCents,
      minStockMilli: v.minStockMilli,
      initialStockMilli: 0,
      stockMilli: v.stockMilli,
      active: v.active
    })),
    priceChangeReason: ''
  }
}

/** Rota /produtos/novo e /produtos/:id */
export function ProductFormPage() {
  const { id } = useParams()
  const productId = id && id !== 'novo' ? Number(id) : null
  const { can } = useAuth()
  const detail = useAsync(() => (productId ? call(api.products.get({ id: productId })) : Promise.resolve(null)), [productId])
  const pricing = useAsync(() => call(api.settings.pricing()))
  const categories = useAsync(() => call(api.categories.list()))
  const suppliers = useAsync(() => (can('products.manage') ? call(api.suppliers.list({})) : Promise.resolve([])))

  if (detail.error) return <ErrorState message={detail.error} />
  if (detail.loading || pricing.loading || categories.loading || !pricing.data) return <Spinner />
  return (
    <ProductEditor
      key={`${productId ?? 'new'}:${detail.data?.updatedAt ?? ''}`}
      product={detail.data}
      pricing={pricing.data}
      categories={categories.data ?? []}
      suppliers={suppliers.data ?? []}
      onSaved={(p) => detail.setData(p)}
    />
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="px-5 pb-5">{children}</div>
    </Card>
  )
}

function ProductEditor({
  product,
  pricing,
  categories,
  suppliers,
  onSaved
}: {
  product: ProductDetail | null
  pricing: PricingSettings
  categories: CategoryDto[]
  suppliers: SupplierDto[]
  onSaved(p: ProductDetail): void
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useAuth()
  const canManage = can('products.manage')
  const canPrice = can('products.price')
  const costVisible = product ? product.costVisible : can('products.cost')
  const readOnly = !canManage

  const initial = useMemo(() => toForm(product, pricing), [product, pricing])
  const [form, setForm] = useState<FormState>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? null)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))
  const text = (key: 'internalCode' | 'sku' | 'barcode' | 'name' | 'description' | 'brand' | 'ncm' | 'cest' | 'cfop' | 'taxCode' | 'priceChangeReason') => ({
    value: form[key],
    error: errors[key],
    disabled: readOnly,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value)
  })

  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const roots = categories.filter((c) => c.parentId === null && (c.active || c.id === form.categoryId))
  const subs = categories.filter((c) => c.parentId !== null && c.parentId === form.categoryId && (c.active || c.id === form.subcategoryId))
  const rates = { taxBps: form.taxBps, cardFeeBps: form.cardFeeBps, commissionBps: form.commissionBps }
  const automatic = form.pricingMode === 'AUTOMATIC'
  const autoPrice = automatic && form.targetMarginBps !== null ? suggestPrice(totalUnitCost(form), form.targetMarginBps, rates) : null
  const effectiveSalePrice = autoPrice?.ok ? autoPrice.priceCents : form.salePriceCents
  const priceChanged =
    !!product &&
    (effectiveSalePrice !== product.salePriceCents ||
      form.promoPriceCents !== product.promoPriceCents ||
      form.wholesalePriceCents !== product.wholesalePriceCents ||
      (costVisible && form.costCents !== product.costCents))

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    const payload = {
      internalCode: form.internalCode,
      sku: form.sku,
      barcode: form.barcode,
      name: form.name,
      description: form.description,
      categoryId: form.categoryId,
      subcategoryId: form.subcategoryId,
      brand: form.brand,
      supplierId: form.supplierId,
      unit: form.unit as 'UN',
      minStockMilli: form.minStockMilli,
      allowNegativeStock: form.allowNegativeStock,
      ncm: form.ncm,
      cest: form.cest,
      cfop: form.cfop,
      taxOrigin: form.taxOrigin,
      taxCode: form.taxCode,
      active: form.active,
      hasVariants: form.hasVariants,
      isService: form.isService,
      variantOptions: form.hasVariants
        ? form.options.filter((o) => o.name.trim()).map((o) => ({ name: o.name.trim(), values: optionValues(o) }))
        : [],
      variants: form.hasVariants
        ? form.variants.map((v) => ({
            id: v.id,
            attributes: v.attributes,
            sku: v.sku,
            barcode: v.barcode,
            costCents: v.costCents,
            salePriceCents: v.salePriceCents,
            minStockMilli: v.minStockMilli,
            initialStockMilli: v.initialStockMilli,
            active: v.active
          }))
        : [],
      priceChangeReason: form.priceChangeReason,
      ...(costVisible
        ? {
            costCents: form.costCents,
            freightCents: form.freightCents,
            packagingCents: form.packagingCents,
            otherCostsCents: form.otherCostsCents,
            taxBps: form.taxBps,
            cardFeeBps: form.cardFeeBps,
            commissionBps: form.commissionBps,
            targetMarginBps: form.targetMarginBps
          }
        : {}),
      ...(canPrice
        ? {
            pricingMode: form.pricingMode,
            salePriceCents: form.salePriceCents,
            promoPriceCents: form.promoPriceCents,
            promoStartsAt: form.promoStartsAt || null,
            promoEndsAt: form.promoEndsAt || null,
            wholesalePriceCents: form.wholesalePriceCents,
            wholesaleMinMilli: form.wholesaleMinMilli
          }
        : {})
    }
    try {
      if (product) {
        const saved = await call(api.products.update({ ...payload, id: product.id }))
        toast.success('Produto salvo.')
        onSaved(saved)
      } else {
        const saved = await call(api.products.create({ ...payload, initialStockMilli: form.initialStockMilli }))
        toast.success(`Produto cadastrado com o código ${saved.internalCode}.`)
        navigate(`/produtos/${saved.id}`, { replace: true })
      }
    } catch (err) {
      setErrors(fieldErrors(err))
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} noValidate className="animate-in">
      <div className="sticky -top-6 z-20 -mx-6 mb-4 flex items-center gap-3 border-b border-line bg-bg/95 px-6 py-3 backdrop-blur">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => (dirty && !readOnly ? setLeaving(true) : navigate('/produtos'))}>
          Produtos
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-ink">{product ? product.name : 'Novo produto'}</h1>
          {product && <p className="text-xs text-muted">Código {product.internalCode}</p>}
        </div>
        {!readOnly && (
          <Button type="submit" loading={saving} icon={<Save className="size-4" />} disabled={!dirty && !!product}>
            {product ? 'Salvar alterações' : 'Cadastrar produto'}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <Section title="Identificação">
            <div className="grid grid-cols-6 gap-4">
              <TextField label="Nome do produto" required containerClassName="col-span-6 md:col-span-4" {...text('name')} />
              <SelectField
                label="Unidade"
                containerClassName="col-span-3 md:col-span-2"
                disabled={readOnly}
                value={form.unit}
                error={errors.unit}
                onChange={(e) => set('unit', e.target.value)}
                options={UNITS.map((u) => ({ value: u.code, label: `${u.code} — ${u.label}` }))}
              />
              <TextField label="Código interno" placeholder="Automático" containerClassName="col-span-3 md:col-span-2" {...text('internalCode')} />
              <TextField label="SKU" containerClassName="col-span-3 md:col-span-2" {...text('sku')} />
              <TextField label="Código de barras" inputMode="numeric" containerClassName="col-span-3 md:col-span-2" hint="Leitores USB preenchem este campo." {...text('barcode')} />
              <SelectField
                label="Categoria"
                containerClassName="col-span-3 md:col-span-2"
                disabled={readOnly}
                value={form.categoryId ?? ''}
                error={errors.categoryId}
                onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value ? Number(e.target.value) : null, subcategoryId: null }))}
                options={[{ value: '', label: 'Sem categoria' }, ...roots.map((c) => ({ value: c.id, label: c.name }))]}
              />
              <SelectField
                label="Subcategoria"
                containerClassName="col-span-3 md:col-span-2"
                disabled={readOnly || subs.length === 0}
                value={form.subcategoryId ?? ''}
                error={errors.subcategoryId}
                onChange={(e) => set('subcategoryId', e.target.value ? Number(e.target.value) : null)}
                options={[{ value: '', label: subs.length ? 'Nenhuma' : 'Sem subcategorias' }, ...subs.map((c) => ({ value: c.id, label: c.name }))]}
              />
              <TextField label="Marca" containerClassName="col-span-3 md:col-span-2" {...text('brand')} />
              {canManage && (
                <SelectField
                  label="Fornecedor"
                  containerClassName="col-span-6 md:col-span-3"
                  value={form.supplierId ?? ''}
                  error={errors.supplierId}
                  onChange={(e) => set('supplierId', e.target.value ? Number(e.target.value) : null)}
                  options={[{ value: '', label: 'Nenhum' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
                />
              )}
              <div className="col-span-6 flex flex-col gap-1.5">
                <label htmlFor="description" className="text-[13px] font-medium text-ink-2">
                  Descrição
                </label>
                <textarea
                  id="description"
                  rows={3}
                  disabled={readOnly}
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
                />
              </div>
              <div className="col-span-6">
                <Checkbox label="Produto ativo" description="Produtos inativos não aparecem para venda." disabled={readOnly} checked={form.active} onChange={(v) => set('active', v)} />
              </div>
            </div>
          </Section>

          <Section title="Preços e custos" description={canPrice ? undefined : 'Seu perfil não pode alterar preços.'}>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
              <div className="flex flex-col gap-5">
                {costVisible && (
                  <div>
                    <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Custos unitários</p>
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                      <MoneyField label="Custo de aquisição" value={form.costCents} onChange={(v) => set('costCents', v ?? 0)} error={errors.costCents} disabled={readOnly} />
                      <MoneyField label="Frete" value={form.freightCents} onChange={(v) => set('freightCents', v ?? 0)} disabled={readOnly} />
                      <MoneyField label="Embalagem" value={form.packagingCents} onChange={(v) => set('packagingCents', v ?? 0)} disabled={readOnly} />
                      <MoneyField label="Outros custos" value={form.otherCostsCents} onChange={(v) => set('otherCostsCents', v ?? 0)} disabled={readOnly} />
                    </div>
                    <p className="mt-4 mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Percentuais sobre o preço de venda</p>
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                      <PercentField label="Impostos estimados" nullable value={form.taxBps} onChange={(v) => set('taxBps', v)} disabled={readOnly} />
                      <PercentField label="Taxa de cartão" nullable value={form.cardFeeBps} onChange={(v) => set('cardFeeBps', v)} disabled={readOnly} />
                      <PercentField label="Comissão" nullable value={form.commissionBps} onChange={(v) => set('commissionBps', v)} disabled={readOnly} />
                      <PercentField label="Margem desejada" nullable value={form.targetMarginBps} onChange={(v) => set('targetMarginBps', v)} error={errors.targetMarginBps} disabled={readOnly} />
                    </div>
                  </div>
                )}

                <div>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Preços de venda</p>
                  {costVisible && (
                    <div className="mb-3 flex gap-2" role="radiogroup" aria-label="Modo de precificação">
                      {(['MANUAL', 'AUTOMATIC'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={form.pricingMode === m}
                          disabled={readOnly || !canPrice}
                          onClick={() => set('pricingMode', m)}
                          className={`rounded-md border px-3 py-1.5 text-[13px] disabled:opacity-60 ${
                            form.pricingMode === m ? 'border-primary bg-primary-soft text-ink' : 'border-line text-ink-2 hover:bg-surface-hover'
                          }`}
                        >
                          {m === 'MANUAL' ? 'Preço manual' : 'Preço automático (pela margem)'}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <MoneyField
                      label="Preço de venda (varejo)"
                      required
                      value={effectiveSalePrice}
                      onChange={(v) => set('salePriceCents', v ?? 0)}
                      error={errors.salePriceCents}
                      disabled={readOnly || !canPrice || automatic}
                      hint={automatic ? 'Calculado pela margem desejada' : undefined}
                    />
                    <MoneyField label="Preço promocional" nullable value={form.promoPriceCents} onChange={(v) => set('promoPriceCents', v)} error={errors.promoPriceCents} disabled={readOnly || !canPrice} />
                    <TextField label="Promoção de" type="date" value={form.promoStartsAt} error={errors.promoStartsAt} disabled={readOnly || !canPrice} onChange={(e) => set('promoStartsAt', e.target.value)} />
                    <TextField label="Promoção até" type="date" value={form.promoEndsAt} error={errors.promoEndsAt} disabled={readOnly || !canPrice} onChange={(e) => set('promoEndsAt', e.target.value)} />
                    <MoneyField label="Preço de atacado" nullable value={form.wholesalePriceCents} onChange={(v) => set('wholesalePriceCents', v)} error={errors.wholesalePriceCents} disabled={readOnly || !canPrice} />
                    <QuantityField
                      label="Atacado a partir de"
                      nullable
                      unit={form.unit}
                      value={form.wholesaleMinMilli}
                      onChange={(v) => set('wholesaleMinMilli', v)}
                      error={errors.wholesaleMinMilli}
                      disabled={readOnly || !canPrice}
                    />
                    {product && priceChanged && !readOnly && (
                      <TextField label="Motivo da alteração de preço" placeholder="Ex.: reajuste do fornecedor" containerClassName="col-span-2" {...text('priceChangeReason')} />
                    )}
                  </div>
                </div>
              </div>
              {costVisible && (
                <PricingPanel
                  cost={form}
                  rates={rates}
                  targetMarginBps={form.targetMarginBps}
                  priceCents={effectiveSalePrice}
                  minMarginBps={pricing.minMarginBps}
                  automatic={automatic}
                  canApply={canPrice && !readOnly}
                  onApplySuggested={(v) => set('salePriceCents', v)}
                />
              )}
            </div>
          </Section>

          <Section title="Estoque" description={product && !form.isService ? 'Entradas, saídas, ajustes e inventário são feitos no módulo Estoque.' : undefined}>
            <Checkbox
              label="É um serviço (sem controle de estoque)"
              description={
                product && !product.isService && product.stockMilli !== 0
                  ? 'Disponível apenas com o estoque atual zerado.'
                  : 'Mão de obra, instalação, frete etc. Pode ser vendido no PDV e incluído em pedidos e orçamentos.'
              }
              disabled={readOnly || (!!product && !product.isService && product.stockMilli !== 0)}
              checked={form.isService}
              onChange={(v) => setForm((f) => ({ ...f, isService: v, ...(v ? { hasVariants: false, minStockMilli: 0, initialStockMilli: 0, allowNegativeStock: false } : {}) }))}
            />
            {errors.isService && <p className="mt-2 text-xs text-danger">{errors.isService}</p>}
            {!form.isService && (
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
              {product ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-ink-2">Estoque atual</span>
                  <span className="tabular flex h-9 items-center text-base font-semibold text-ink">
                    {formatQuantity(product.stockMilli)} {product.unit}
                  </span>
                </div>
              ) : (
                !form.hasVariants && (
                  <QuantityField
                    label="Estoque inicial"
                    unit={form.unit}
                    value={form.initialStockMilli}
                    onChange={(v) => set('initialStockMilli', v ?? 0)}
                    error={errors.initialStockMilli}
                    hint="Gera movimentação de entrada inicial."
                  />
                )
              )}
              {!form.hasVariants && (
                <QuantityField label="Estoque mínimo" unit={form.unit} value={form.minStockMilli} onChange={(v) => set('minStockMilli', v ?? 0)} error={errors.minStockMilli} disabled={readOnly} hint="Alerta de reposição." />
              )}
              <div className="col-span-2 flex items-center">
                <Checkbox
                  label="Permitir venda com estoque negativo"
                  description="Use apenas para itens sob encomenda."
                  disabled={readOnly}
                  checked={form.allowNegativeStock}
                  onChange={(v) => set('allowNegativeStock', v)}
                />
              </div>
            </div>
            )}
          </Section>

          {!form.isService && (
          <Section title="Variações" description="Cores, tamanhos, modelos ou outras variações com SKU, código de barras, preço e estoque próprios.">
            <Checkbox
              label="Este produto possui variações"
              disabled={readOnly || (!!product && !product.hasVariants && product.stockMilli !== 0)}
              description={product && !product.hasVariants && product.stockMilli !== 0 ? 'Disponível apenas com o estoque atual zerado.' : undefined}
              checked={form.hasVariants}
              onChange={(v) => setForm((f) => ({ ...f, hasVariants: v, options: v && f.options.length === 0 ? [{ name: 'Cor', valuesText: '' }] : f.options }))}
            />
            {errors.variants && <p className="mt-2 text-xs text-danger">{errors.variants}</p>}
            {form.hasVariants && (
              <div className="mt-4">
                <VariantsEditor
                  options={form.options}
                  variants={form.variants}
                  unit={form.unit}
                  costVisible={costVisible}
                  canPrice={canPrice}
                  productPriceCents={effectiveSalePrice}
                  onOptions={(o) => set('options', o)}
                  onVariants={(v) => set('variants', v)}
                />
              </div>
            )}
          </Section>
          )}

          <Section title="Dados fiscais" description="Preparação para NF-e/NFC-e. Confirme os códigos com o responsável fiscal da empresa.">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <TextField label="NCM" inputMode="numeric" maxLength={10} hint="8 dígitos" {...text('ncm')} />
              <TextField label="CEST" inputMode="numeric" maxLength={9} hint="7 dígitos" {...text('cest')} />
              <TextField label="CFOP" inputMode="numeric" maxLength={5} hint="4 dígitos" {...text('cfop')} />
              <SelectField label="Origem da mercadoria" disabled={readOnly} value={form.taxOrigin} error={errors.taxOrigin} onChange={(e) => set('taxOrigin', e.target.value)} options={TAX_ORIGINS} />
              <TextField label="CST / CSOSN (ICMS)" inputMode="numeric" maxLength={3} hint="CST: 2 dígitos · CSOSN: 3 dígitos" {...text('taxCode')} />
            </div>
          </Section>

          {product && <PriceHistoryCard productId={product.id} refreshKey={product.updatedAt} />}
        </div>

        <div className="flex flex-col gap-4">
          <ProductImageCard productId={product?.id ?? null} imageUrl={imageUrl} canEdit={canManage} onChanged={setImageUrl} />
        </div>
      </div>

      <ConfirmModal open={leaving} title="Descartar alterações?" confirmLabel="Descartar" danger onClose={() => setLeaving(false)} onConfirm={() => navigate('/produtos')}>
        As alterações feitas neste produto ainda não foram salvas.
      </ConfirmModal>
    </form>
  )
}
