import { useState } from 'react'
import StockMaster from '../features/stock/StockMaster'
import StockReports from '../features/stock/StockReports'

export default function OwnerStockPage() {
  const [view, setView] = useState<'reports' | 'master'>('reports')
  return <div className="stack">
    <h1>Manajemen & Laporan SO</h1>
    <nav className="stock-actions" aria-label="Stock Opname">
      <button className={'button ' + (view === 'reports' ? 'button-primary' : 'button-secondary')}
        aria-pressed={view === 'reports'} onClick={() => setView('reports')}>Laporan harian</button>
      <button className={'button ' + (view === 'master' ? 'button-primary' : 'button-secondary')}
        aria-pressed={view === 'master'} onClick={() => setView('master')}>Pengaturan SO</button>
    </nav>
    {view === 'reports' ? <StockReports /> : <StockMaster />}
  </div>
}
