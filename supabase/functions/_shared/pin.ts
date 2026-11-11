import { argon2id, argon2Verify } from 'npm:hash-wasm@4.12.0'

export function hashPin(pin: string) {
  if (!/^\d{6,12}$/.test(pin)) throw new Error('PIN harus 6–12 digit.')
  return argon2id({ password: pin, salt: crypto.getRandomValues(new Uint8Array(16)),
    parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32, outputType: 'encoded' })
}
export function verifyPin(pin: string, hash: string) {
  return argon2Verify({ password: pin, hash })
}
