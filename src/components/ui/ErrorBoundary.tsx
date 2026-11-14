import { Component } from 'react'
import type { ReactNode } from 'react'
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <main className="narrow-shell panel stack" role="alert"><h1>Halaman belum bisa ditampilkan</h1><p>Muat ulang halaman untuk mencoba kembali. Jika baru mengirim absensi, periksa status sebelum mengirim ulang.</p><button className="button button-primary" onClick={() => window.location.reload()}>Muat ulang</button></main>
  }
}
