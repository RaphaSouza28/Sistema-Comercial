import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'
import fs from 'node:fs'

/**
 * Arquivo de backup criptografado (.scbak): AES-256-GCM com chave derivada da senha por scrypt.
 * Formato: "SCBAK1" (6 bytes) + sal (16) + IV (12) + dados cifrados + tag de autenticação (16).
 * A tag GCM garante que um arquivo alterado ou a senha errada sejam detectados na leitura.
 */
const MAGIC = Buffer.from('SCBAK1', 'ascii')
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password.normalize('NFC'), salt, 32, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))))
}

export function isEncryptedBackup(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r')
  try {
    const head = Buffer.alloc(MAGIC.length)
    fs.readSync(fd, head, 0, MAGIC.length, 0)
    return head.equals(MAGIC)
  } finally {
    fs.closeSync(fd)
  }
}

export async function encryptFile(sourcePath: string, targetPath: string, password: string): Promise<void> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', await deriveKey(password, salt), iv)
  const body = Buffer.concat([cipher.update(fs.readFileSync(sourcePath)), cipher.final()])
  fs.writeFileSync(targetPath, Buffer.concat([MAGIC, salt, iv, body, cipher.getAuthTag()]), { flag: 'wx' })
}

export class WrongBackupPasswordError extends Error {
  constructor() {
    super('Senha do backup incorreta ou arquivo alterado.')
  }
}

export async function decryptFile(sourcePath: string, targetPath: string, password: string): Promise<void> {
  const data = fs.readFileSync(sourcePath)
  if (data.length < MAGIC.length + 16 + 12 + 16 || !data.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Arquivo não é um backup criptografado válido.')
  const salt = data.subarray(6, 22)
  const iv = data.subarray(22, 34)
  const tag = data.subarray(data.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', await deriveKey(password, salt), iv)
  decipher.setAuthTag(tag)
  let plain: Buffer
  try {
    plain = Buffer.concat([decipher.update(data.subarray(34, data.length - 16)), decipher.final()])
  } catch {
    throw new WrongBackupPasswordError()
  }
  fs.writeFileSync(targetPath, plain, { flag: 'wx' })
}
