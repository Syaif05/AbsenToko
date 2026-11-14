import { PageSkeleton } from '../components/ui/PageSkeleton'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router'
import { Header } from '../components/ui/shared'
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
    <ErrorBoundary><BrowserRouter>
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/" element={<AttendancePage key="attendance" />} />
          <Route path="/aktivasi" element={<AttendancePage key="old-activation-url" />} />
          <Route path="/owner/*" element={<OwnerRoutes />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter></ErrorBoundary>
  )
}
