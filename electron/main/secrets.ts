import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { SecretStore } from '../services/backup.service'

/**
 * Segredos locais (ex.: senha dos backups criptografados) protegidos pelo Windows (DPAPI, via
 * safeStorage): só o mesmo usuário do Windows, neste computador, consegue decifrá-los. Nunca vão
 * para o banco de dados, para os backups ou para os logs.
 */
export function createSecretStore(userData: string): SecretStore {
  const dir = path.join(userData, 'segredos')
  const file = (name: string) => path.join(dir, `${name.replace(/[^a-z0-9-]/gi, '')}.bin`)
  return {
    get(name) {
      try {
        if (!fs.existsSync(file(name)) || !safeStorage.isEncryptionAvailable()) return null
        return safeStorage.decryptString(fs.readFileSync(file(name)))
      } catch {
        return null
      }
    },
    set(name, value) {
      if (value === null) {
        fs.rmSync(file(name), { force: true })
        return
      }
      if (!safeStorage.isEncryptionAvailable()) throw new Error('A proteção de dados do Windows não está disponível neste computador.')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(file(name), safeStorage.encryptString(value))
    }
  }
}
