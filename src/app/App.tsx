import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router'
import { Header, Loading } from '../components/ui/shared'
import { TeaHero } from '../components/ui/TeaHero'
import AttendancePage from '../pages/AttendancePage'

const OwnerRoutes = lazy(() => import('../features/owner/OwnerRoutes'))

function NotFound() {
  return (
    <>
      <Header />
      <main className="tea-shell">
        <TeaHero>
          <p className="tea-eyebrow"><span aria-hidden="true" />404</p>
          <h1>Halaman tidak ditemukan</h1>
        </TeaHero>
        <div className="tea-workspace">
          <section className="panel stack">
            <h2>Kembali ke kedai</h2>
            <p className="muted">Halaman ini mungkin sudah pindah. Absensi tetap bisa dibuka dari halaman utama.</p>
            <Link to="/" className="button button-primary">Kembali ke Absensi</Link>
          </section>
        </div>
      </main>
    </>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<><Header /><main className="narrow-shell"><Loading label="Memuat halaman…" /></main></>}>
        <Routes>
          <Route path="/" element={<AttendancePage key="attendance" />} />
          <Route path="/aktivasi" element={<AttendancePage key="activation" />} />
          <Route path="/owner/*" element={<OwnerRoutes />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
