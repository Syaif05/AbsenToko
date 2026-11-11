import { hashPin, verifyPin } from '../functions/_shared/pin.ts'
Deno.test('Argon2id memakai salt unik dan menolak PIN salah', async () => {
  const first = await hashPin('246810')
  const second = await hashPin('246810')
  if (first === second || !await verifyPin('246810', first) || await verifyPin('000000', first)) throw new Error('PIN verification failed')
})

Deno.test('Salinan PIN aktif hanya dapat dibuka dengan kunci dan ID karyawan yang sesuai', async () => {
  const { importPinKey, openPin, sealPin } = await import('../functions/owner-api/pin-envelope.ts')
  const key = await importPinKey('ab'.repeat(32))
  const otherKey = await importPinKey('cd'.repeat(32))
  const id = crypto.randomUUID()
  for (const pin of ['012345', '001234567890']) {
    const envelope = await sealPin(key, id, pin)
    if (await openPin(key, id, envelope) !== pin) throw new Error('PIN changed')
    if (!/^v1\.[A-Za-z0-9+/]{46,54}={0,2}$/.test(envelope)) throw new Error('Invalid database envelope')
    if (await sealPin(key, id, pin) === envelope) throw new Error('Repeated envelope')
    for (const [candidateKey, candidateId] of [[otherKey, id], [key, crypto.randomUUID()]] as const) {
      const result = await openPin(candidateKey, candidateId, envelope).catch(() => null)
      if (result !== null) throw new Error('Unexpected PIN disclosure')
    }
  }
})
