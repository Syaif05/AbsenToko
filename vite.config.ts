import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (key && !key.startsWith('sb_publishable_')) {
    let role: unknown
    try {
      role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role
    } catch {
      // The public legacy key must be a JWT with an anon role.
    }
    if (role !== 'anon') throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY harus memakai publishable key atau anon key.')
  }

  const url = env.VITE_SUPABASE_URL?.trim()
  const backendOrigin = url ? new URL(url).origin : ''
  const csp = [
    "default-src 'self'", "script-src 'self'", "style-src 'self'",
    "img-src 'self' blob:" + (backendOrigin ? ' ' + backendOrigin : ''),
    "media-src 'self' blob:", "connect-src 'self'" + (backendOrigin ? ' ' + backendOrigin : ''),
    "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
  ].join('; ')

  return {
    plugins: [react(), tailwindcss()],
    preview: {
      headers: {
        'Content-Security-Policy': csp,
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=()',
      },
    },
  }
})
