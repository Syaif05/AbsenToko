import { hashPin, verifyPin } from '../functions/_shared/pin.ts'
Deno.test('Argon2id memakai salt unik dan menolak PIN salah', async () => {
  const first = await hashPin('246810')
  const second = await hashPin('246810')
  if (first === second || !await verifyPin('246810', first) || await verifyPin('000000', first)) throw new Error('PIN verification failed')
})
