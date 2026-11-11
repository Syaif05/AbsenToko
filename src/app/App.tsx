import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router'
import { Header, Loading } from '../components/ui/shared'
import AttendancePage from '../pages/AttendancePage'

const OwnerRoutes = lazy(() => import('../features/owner/OwnerRoutes'))

function NotFound() {
  return (
    <>
      <Header />
      <main className="narrow-shell">
        <div className="page-intro"><h1>Halaman tidak ditemukan</h1></div>
        <Link to="/" className="button button-primary">Kembali ke Absensi</Link>
      </main>
    </>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<><Header /><main className="narrow-shell"><Loading label="Memuat halaman…" /></main></>}>
        <Routes>
          <Route path="/" element={<AttendancePage />} />
          <Route path="/owner/*" element={<OwnerRoutes />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
