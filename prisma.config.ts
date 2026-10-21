import { defineConfig } from 'prisma/config'

// Usado apenas pela CLI do Prisma (geração do client e criação de migrations em desenvolvimento).
// Em execução, o aplicativo abre o banco no diretório userData do Electron
// e aplica as migrations por conta própria (electron/database/migrator.ts).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations'
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db'
  }
})
