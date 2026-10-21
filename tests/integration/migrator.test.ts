import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../../electron/database'
import { migrate, readMigrations } from '../../electron/database/migrator'
import { createClient } from '@libsql/client'
import { sqliteUrl } from '../../electron/database/connection'
import { createTestDatabase, MIGRATIONS_DIR, setupAdmin, type TestDatabase } from '../helpers/db'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})

function copyMigrationsWith(name: string, sql: string): string {
  const dir = path.join(t.dir, 'migrations')
  fs.cpSync(MIGRATIONS_DIR, dir, { recursive: true })
  fs.mkdirSync(path.join(dir, name))
  fs.writeFileSync(path.join(dir, name, 'migration.sql'), sql)
  return dir
}

// Formato gerado pelo Prisma ao alterar uma tabela no SQLite ("redefine table").
const REDEFINE_ROLE = `
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Role" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Role" ("createdAt", "description", "id", "isSystem", "key", "name", "updatedAt") SELECT "createdAt", "description", "id", "isSystem", "key", "name", "updatedAt" FROM "Role";
DROP TABLE "Role";
ALTER TABLE "new_Role" RENAME TO "Role";
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
`

describe('migrator', () => {
  it('recria tabela (padrão do Prisma) sem disparar CASCADE/SET NULL nas tabelas relacionadas', async () => {
    t = await createTestDatabase()
    const admin = await setupAdmin(t.db)
    const permissionsBefore = await t.db.rolePermission.count()
    const auditBefore = await t.db.auditLog.count({ where: { userId: admin.userId } })
    expect(permissionsBefore).toBeGreaterThan(0)
    expect(auditBefore).toBeGreaterThan(0)

    const dir = copyMigrationsWith('99999999999999_role_color', REDEFINE_ROLE)
    await t.db.$disconnect()
    t.db = await initializeDatabase({ databasePath: t.databasePath, migrationsDir: dir, backupsDir: t.backupsDir })

    expect(await t.db.rolePermission.count()).toBe(permissionsBefore)
    expect(await t.db.auditLog.count({ where: { userId: admin.userId } })).toBe(auditBefore)
    const fk = await t.db.$queryRawUnsafe<{ foreign_keys: number | bigint }[]>('PRAGMA foreign_keys')
    expect(Number(fk[0].foreign_keys)).toBe(1)
  })

  it('atualiza um banco da versão 0.1.0 (Fase 1) com dados para o schema atual sem perder nada', async () => {
    // Banco no estado da versão 0.1.0: só a primeira migration, dados gravados por SQL daquela versão
    t = await createTestDatabase()
    const phase1 = path.join(t.dir, 'phase1')
    fs.mkdirSync(phase1)
    const first = fs.readdirSync(MIGRATIONS_DIR).filter((d) => /^\d+_/.test(d)).sort()[0]
    fs.cpSync(path.join(MIGRATIONS_DIR, first), path.join(phase1, first), { recursive: true })
    const dbPath = path.join(t.dir, 'versao-0.1.0.db')
    await migrate(dbPath, phase1)
    const old = createClient({ url: sqliteUrl(dbPath) })
    const now = `'2026-10-20T00:00:00.000Z'`
    await old.executeMultiple(`
      INSERT INTO "Role" ("id","key","name","isSystem","createdAt","updatedAt") VALUES (1,'ADMIN','Administrador',1,${now},${now}),(2,'MANAGER','Gerente',1,${now},${now});
      INSERT INTO "Permission" ("key","module","description") VALUES ('pdv.sell','PDV','Vender');
      INSERT INTO "RolePermission" ("roleId","permissionKey") VALUES (2,'pdv.sell');
      INSERT INTO "User" ("id","name","username","passwordHash","roleId","updatedAt") VALUES (1,'Admin','admin','x',1,${now});
      INSERT INTO "Customer" ("id","name","document","updatedAt") VALUES (1,'José da Silva','52998224725',${now});
      INSERT INTO "Product" ("internalCode","name","salePriceCents","stockMilli","updatedAt") VALUES ('P1','Caneca',2500,3000,${now});
      INSERT INTO "StockMovement" ("productId","type","quantityMilli","balanceAfterMilli","userId","createdAt") VALUES (1,'INITIAL',3000,3000,1,${now});
    `)
    old.close()

    await t.db.$disconnect()
    t.db = await initializeDatabase({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR, backupsDir: t.backupsDir })
    const product = await t.db.product.findFirstOrThrow()
    expect(product).toMatchObject({ name: 'Caneca', salePriceCents: 2500, stockMilli: 3000, pricingMode: 'MANUAL', isService: false })
    expect(await t.db.stockMovement.count()).toBe(1)
    // permissões configuradas do gerente preservadas (não reiniciadas para o padrão)
    expect((await t.db.rolePermission.findMany({ where: { roleId: 2 } })).map((r) => r.permissionKey)).toEqual(['pdv.sell'])
    // cliente antigo ganha texto de busca sem acentos
    expect((await t.db.customer.findFirstOrThrow()).searchText).toContain('jose da silva')
    expect(fs.readdirSync(t.backupsDir).some((f) => f.startsWith('pre-atualizacao-'))).toBe(true)
  })

  it('desfaz migration que deixaria chaves estrangeiras inválidas', async () => {
    t = await createTestDatabase()
    await setupAdmin(t.db)
    const dir = copyMigrationsWith(
      '99999999999999_quebra_fk',
      'PRAGMA foreign_keys=OFF;\nDELETE FROM "Role";\nPRAGMA foreign_keys=ON;'
    )
    await t.db.$disconnect()
    await expect(migrate(t.databasePath, dir)).rejects.toThrow(/chave estrangeira/)
    t.db = await initializeDatabase({ databasePath: t.databasePath, migrationsDir: MIGRATIONS_DIR, backupsDir: t.backupsDir })
    expect(await t.db.role.count()).toBe(3)
  })

  it('checksum independe de quebras de linha CRLF/LF', () => {
    t = undefined as unknown as TestDatabase
    const base = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sc-crlf-'))
    for (const [name, eol] of [['a', '\n'], ['b', '\r\n']]) {
      fs.mkdirSync(path.join(base, name, 'm'), { recursive: true })
      fs.writeFileSync(path.join(base, name, 'm', 'migration.sql'), ['CREATE TABLE x (id INT);', 'SELECT 1;'].join(eol))
    }
    expect(readMigrations(path.join(base, 'a'))[0].checksum).toBe(readMigrations(path.join(base, 'b'))[0].checksum)
    fs.rmSync(base, { recursive: true, force: true })
  })
})
