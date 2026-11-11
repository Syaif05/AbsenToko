import { useEffect, useState, useSyncExternalStore } from 'react'
import { validLocation } from './types'
import type { Location } from './types'

function subscribeOnline(change: () => void) {
  window.addEventListener('online', change)
  window.addEventListener('offline', change)
  return () => {
    window.removeEventListener('online', change)
    window.removeEventListener('offline', change)
  }
}

export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine)
}

export function usePhotoUrl(photo: Blob | null) {
  const [preview, setPreview] = useState<{ photo: Blob; url: string } | null>(null)
  useEffect(() => {
    if (!photo) return
    const url = URL.createObjectURL(photo)
    // The browser URL is created outside render and revoked with its evidence.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview({ photo, url })
    return () => URL.revokeObjectURL(url)
  }, [photo])
  return photo && preview?.photo === photo ? preview.url : undefined
}

export function getLocation() {
  return new Promise<Location>((resolve, reject) => {
    if (!navigator.geolocation || !window.isSecureContext) {
      reject(new Error('Lokasi tidak tersedia. Buka halaman ini melalui HTTPS atau localhost.'))
      return
    }
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const location = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }
      if (validLocation(location)) resolve(location)
      else reject(new Error('Lokasi perangkat tidak valid. Coba lagi.'))
    }, ({ code }) => {
      if (code === 1) reject(new Error('Izin lokasi diperlukan untuk absensi. Aktifkan lokasi, lalu coba lagi.'))
      else if (code === 3) reject(new Error('Pencarian lokasi terlalu lama. Pindah ke area terbuka, lalu coba lagi.'))
      else reject(new Error('Lokasi belum ditemukan. Periksa pengaturan lokasi, lalu coba lagi.'))
    }, { maximumAge: 0, timeout: 12_000, enableHighAccuracy: true })
  })
}
