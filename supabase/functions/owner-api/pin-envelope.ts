const encoder = new TextEncoder()

export async function importPinKey(secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error('Invalid PIN encryption key')
  const bytes = Uint8Array.from(secret.match(/../g)!, pair => Number.parseInt(pair, 16))
  return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function parameters(id: string, iv: Uint8Array<ArrayBuffer>) {
  return { name: 'AES-GCM', iv, additionalData: encoder.encode('absentoko:employee-pin:v1:' + id.toLowerCase()) }
}

export async function sealPin(key: CryptoKey, id: string, pin: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(parameters(id, iv), key, encoder.encode(pin))
  return 'v1.' + btoa(String.fromCharCode(...iv, ...new Uint8Array(encrypted)))
}

export async function openPin(key: CryptoKey, id: string, envelope: string) {
  if (!envelope.startsWith('v1.')) throw new Error('Unknown PIN format')
  const bytes = Uint8Array.from(atob(envelope.slice(3)), char => char.charCodeAt(0))
  const decrypted = await crypto.subtle.decrypt(parameters(id, bytes.slice(0, 12)), key, bytes.slice(12))
  const pin = new TextDecoder().decode(decrypted)
  if (!/^\d{6,12}$/.test(pin)) throw new Error('Invalid PIN format')
  return pin
}
