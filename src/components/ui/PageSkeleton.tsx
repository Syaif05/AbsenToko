import { Loading, appName } from './shared'

export function PageSkeleton() {
  return <div className="page-skeleton" aria-busy="true">
    <aside aria-hidden="true"><strong>{appName}</strong><p>Ruang Owner</p><Loading label="" variant="form" /></aside>
    <main><header><strong>{appName}</strong><span>Memuat ruang kerja…</span></header>
      <section><Loading label="Memuat halaman…" variant="cards" /><Loading label="Menyiapkan data…" /></section>
    </main>
  </div>
}
