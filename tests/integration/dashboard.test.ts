import { afterEach, describe, expect, it } from 'vitest'
import { createServices } from '../../electron/services'
import { DashboardService } from '../../electron/services/dashboard.service'
import { createTestDatabase, setupAdmin, type TestDatabase } from '../helpers/db'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})

// Terça-feira, 20/10/2026 15:00 (horário local)
const NOW = new Date(2026, 9, 20, 15, 0, 0)

describe('dashboard', () => {
  it('retorna zeros e séries vazias quando não há registros (sem dados inventados)', async () => {
    t = await createTestDatabase()
    const admin = await setupAdmin(t.db)
    const d = await new DashboardService(t.db, () => NOW).summary(admin)
    expect(d.revenue).toEqual({ todayCents: 0, weekCents: 0, monthCents: 0 })
    expect(d.month).toEqual({ salesCount: 0, averageTicketCents: 0, grossProfitCents: 0 })
    expect(d.productsCount).toBe(0)
    expect(d.lowStockCount).toBe(0)
    expect(d.cash).toEqual({ openSessions: 0, balanceCents: 0 })
    expect(d.charts.daily).toHaveLength(30)
    expect(d.charts.daily.every((p) => p.totalCents === 0)).toBe(true)
    expect(d.charts.daily.at(-1)?.date).toBe('2026-10-20')
    expect(d.charts.monthly).toHaveLength(12)
    expect(d.charts.monthly.at(-1)?.month).toBe('2026-10')
    expect(d.charts.topProducts).toEqual([])
    expect(d.charts.paymentMethods).toEqual([])
    expect(d.charts.operators).toEqual([])
  })

  it('calcula indicadores a partir das vendas, ignorando canceladas', async () => {
    t = await createTestDatabase()
    const admin = await setupAdmin(t.db)
    const db = t.db
    const camiseta = await db.product.create({
      data: { internalCode: 'C1', name: 'Camiseta', costCents: 4700, salePriceCents: 6714, stockMilli: 2000, minStockMilli: 5000 }
    })
    await db.product.create({ data: { internalCode: 'B1', name: 'Boné', stockMilli: 10000, minStockMilli: 1000 } })

    let seq = 0
    const sale = async (createdAt: Date, totalCents: number, costCents: number, status: 'COMPLETED' | 'CANCELLED' = 'COMPLETED') => {
      seq++
      return db.sale.create({
        data: {
          status,
          userId: admin.userId,
          subtotalCents: totalCents,
          totalCents,
          paidCents: totalCents,
          costTotalCents: costCents,
          idempotencyKey: `t-${seq}`,
          createdAt,
          items: {
            create: {
              productId: camiseta.id,
              description: 'Camiseta',
              quantityMilli: 1000,
              unitPriceCents: totalCents,
              unitCostCents: costCents,
              totalCents
            }
          },
          payments: { create: { method: seq % 2 ? 'CASH' : 'PIX', amountCents: totalCents } }
        }
      })
    }
    await sale(new Date(2026, 9, 20, 10), 6714, 4700) // hoje
    await sale(new Date(2026, 9, 19, 18), 10000, 6000) // segunda (mesma semana)
    await sale(new Date(2026, 9, 5, 12), 5000, 3000) // mês atual, semana anterior
    await sale(new Date(2026, 8, 15, 12), 9900, 5000) // mês anterior
    await sale(new Date(2026, 9, 20, 11), 99999, 1, 'CANCELLED') // cancelada: ignorada

    const d = await new DashboardService(db, () => NOW).summary(admin)
    expect(d.revenue.todayCents).toBe(6714)
    expect(d.revenue.weekCents).toBe(16714)
    expect(d.revenue.monthCents).toBe(21714)
    expect(d.month.salesCount).toBe(3)
    expect(d.month.averageTicketCents).toBe(7238)
    expect(d.month.grossProfitCents).toBe(21714 - 13700)
    expect(d.productsCount).toBe(2)
    expect(d.lowStockCount).toBe(1)

    // Mesma regra da tela de Estoque: esgotados e negativos também precisam de reposição,
    // inclusive sem estoque mínimo definido, e variações contam individualmente.
    await db.product.create({ data: { internalCode: 'Z1', name: 'Esgotado sem mínimo', stockMilli: 0 } })
    await db.product.create({ data: { internalCode: 'N1', name: 'Negativo', stockMilli: -1000, allowNegativeStock: true } })
    await db.product.create({
      data: {
        internalCode: 'V1',
        name: 'Com variações',
        hasVariants: true,
        stockMilli: 3000,
        variants: { create: [{ name: 'P', attributes: '{}', stockMilli: 3000 }, { name: 'M', attributes: '{}', stockMilli: 0 }] }
      }
    })
    await db.product.create({ data: { internalCode: 'I1', name: 'Inativo', stockMilli: 0, active: false } })
    const d2 = await new DashboardService(db, () => NOW).summary(admin)
    const stock = await createServices(db).stock.summary(admin)
    expect(d2.lowStockCount).toBe(4) // Camiseta (baixo) + esgotado + negativo + variação M
    expect(d2.lowStockCount).toBe(stock.lowCount + stock.outCount + stock.negativeCount)
    expect(d.charts.daily.find((p) => p.date === '2026-10-20')).toEqual({ date: '2026-10-20', totalCents: 6714, count: 1 })
    expect(d.charts.monthly.find((m) => m.month === '2026-09')?.totalCents).toBe(9900)
    expect(d.charts.topProducts[0]).toMatchObject({ name: 'Camiseta', quantityMilli: 3000, totalCents: 21714 })
    expect(d.charts.paymentMethods.reduce((a, p) => a + p.totalCents, 0)).toBe(21714)
    expect(d.charts.operators).toEqual([{ userId: admin.userId, name: 'Administrador', totalCents: 21714, count: 3 }])
  })
})
