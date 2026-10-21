import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * Hash de senhas com scrypt (crypto nativo do Node, sem dependências nativas extras).
 * Formato armazenado: scrypt$<log2N>$<r>$<p>$<salt base64>$<hash base64>
 */

const KEY_LENGTH = 64
const DEFAULT_PARAMS = { log2N: 15, r: 8, p: 1 }

function scryptAsync(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

function options(log2N: number, r: number, p: number): ScryptOptions {
  const N = 2 ** log2N
  return { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }
}

export async function hashPassword(password: string): Promise<string> {
  const { log2N, r, p } = DEFAULT_PARAMS
  const salt = randomBytes(16)
  const key = await scryptAsync(password, salt, options(log2N, r, p))
  return ['scrypt', log2N, r, p, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, log2N, r, p, saltB64, hashB64] = parts
  const expected = Buffer.from(hashB64, 'base64')
  const params = [Number(log2N), Number(r), Number(p)]
  if (params.some((n) => !Number.isInteger(n) || n <= 0) || params[0] > 20) return false
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'), options(params[0], params[1], params[2]))
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** Hash válido usado para igualar o tempo de resposta quando o usuário não existe. */
let dummyHash: Promise<string> | null = null
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'))
  return dummyHash
}
