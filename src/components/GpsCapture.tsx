import { Notice } from './ui/shared'
import type { Location } from '../features/attendance/types'

export type GpsState =
  | { kind: 'idle' | 'loading' }
  | { kind: 'ready'; location: Location; capturedAt: number }
  | { kind: 'error'; message: string }

export function GpsCapture({ state, retry, disabled }: {
  state: GpsState; retry: () => void; disabled: boolean
}) {
  return (
    <section className="gps" aria-label="Lokasi absensi">
      <div className="gps-heading">
        <span className="location-dot" aria-hidden="true" />
        <div role="status">
          <strong>{state.kind === 'ready' ? 'Lokasi terdeteksi' : 'Lokasi perangkat'}</strong>
          <p className="muted">
            {state.kind === 'idle' && 'Diminta saat kamera diaktifkan.'}
            {state.kind === 'loading' && 'Mencari lokasi…'}
            {state.kind === 'ready' && 'Akurasi ±' + Math.round(state.location.accuracy) + ' m'}
            {state.kind === 'error' && 'Lokasi belum tersedia.'}
          </p>
        </div>
      </div>
      {state.kind === 'error' && <Notice tone="error">{state.message}</Notice>}
      {state.kind === 'ready' && state.location.accuracy > 100 && (
        <Notice tone="warning">Lokasi kurang akurat. Coba di area terbuka atau ulangi.</Notice>
      )}
      {(state.kind === 'error' || state.kind === 'ready') && (
        <button className="button button-quiet gps-retry" type="button" disabled={disabled} onClick={retry}>
          {state.kind === 'error' ? 'Coba Lagi Lokasi' : 'Perbarui Lokasi'}
        </button>
      )}
    </section>
  )
}
