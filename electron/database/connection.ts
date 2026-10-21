import path from 'node:path'
import { createClient, type Client, type Config, type InStatement, type TransactionMode } from '@libsql/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaClient, type Prisma } from './generated/client'

export type Db = PrismaClient
/** Cliente dentro de uma transação interativa. */
export type DbTx = Prisma.TransactionClient
/** Repositórios aceitam tanto o cliente quanto uma transação. */
export type DbClient = Db | DbTx

/** Converte um caminho do sistema de arquivos para a URL aceita pelo libSQL. */
export function sqliteUrl(filePath: string): string {
  return `file:${path.resolve(filePath).split(path.sep).join('/')}`
}

const BEGIN: Record<TransactionMode, string> = {
  write: 'BEGIN IMMEDIATE',
  read: 'BEGIN DEFERRED',
  deferred: 'BEGIN DEFERRED'
}

/**
 * Cliente libSQL que executa transações na própria conexão.
 *
 * O @libsql/client, ao iniciar uma transação local, entrega a conexão atual à
 * transação e abre outra — e nunca fecha a conexão entregue. Em um aplicativo
 * que roda o dia todo isso acumula handles do arquivo (e impede restaurar
 * backups no Windows). Como o adapter do Prisma já serializa as operações com
 * um mutex (a conexão principal fica bloqueada enquanto a transação está
 * aberta), é seguro usar uma única conexão com BEGIN/COMMIT explícitos.
 */
export class SingleConnectionClient {
  constructor(private readonly inner: Client) {}

  get closed(): boolean {
    return this.inner.closed
  }

  get protocol(): string {
    return this.inner.protocol
  }

  execute(stmt: InStatement) {
    return this.inner.execute(stmt)
  }

  batch(stmts: InStatement[], mode?: TransactionMode) {
    return this.inner.batch(stmts, mode)
  }

  executeMultiple(sql: string) {
    return this.inner.executeMultiple(sql)
  }

  async transaction(mode: TransactionMode = 'write') {
    const inner = this.inner
    await inner.execute(BEGIN[mode])
    let open = true
    const finish = async (sql: 'COMMIT' | 'ROLLBACK') => {
      if (!open) return
      open = false
      await inner.execute(sql)
    }
    // Depois do COMMIT/ROLLBACK (ex.: transação encerrada por tempo esgotado), nenhum comando
    // desta transação pode rodar na conexão compartilhada — ele ficaria fora da transação.
    const run = (stmt: InStatement) => {
      if (!open) return Promise.reject(new Error('A transação já foi encerrada.'))
      return inner.execute(stmt)
    }
    return {
      get closed() {
        return !open
      },
      execute: run,
      batch: async (stmts: InStatement[]) => {
        const results = []
        for (const stmt of stmts) results.push(await run(stmt))
        return results
      },
      executeMultiple: async (sql: string) => {
        // Executa comando a comando para não acionar o ROLLBACK automático do executeMultiple.
        for (const part of sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) {
          await run(part)
        }
      },
      commit: () => finish('COMMIT'),
      rollback: () => finish('ROLLBACK').catch(() => undefined),
      close: () => {
        void finish('ROLLBACK').catch(() => undefined)
      }
    }
  }

  close(): void {
    this.inner.close()
  }
}

class SingleConnectionLibSql extends PrismaLibSql {
  override createClient(config: Config): Client {
    return new SingleConnectionClient(createClient(config)) as unknown as Client
  }
}

export function createPrismaClient(databasePath: string): PrismaClient {
  const adapter = new SingleConnectionLibSql({ url: sqliteUrl(databasePath) })
  return new PrismaClient({ adapter })
}
