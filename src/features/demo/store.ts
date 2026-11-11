import { todayWib } from '../attendance/dates'
import { validLocation } from '../attendance/types'
import type { Action, Attendance, AttendanceStatus, Employee, Evidence, Location } from '../attendance/types'

const sessionWindowMs = 24 * 60 * 60 * 1000
const employees: Employee[] = [
  { id: 'alya', name: 'Alya Pratama', active: true },
  { id: 'bima', name: 'Bima Saputra', active: true },
  { id: 'citra', name: 'Citra Lestari', active: true },
  { id: 'dimas', name: 'Dimas Ramadhan', active: true },
  { id: 'nisa', name: 'Nisa Wulandari', active: true },
]
const submissions = new Map<string, Evidence>()
const seededToday = todayWib()
const seededYesterday = todayWib(new Date(Date.now() - sessionWindowMs))
const records: Attendance[] = []

function sampleEvidence(date: string, hour: string): Evidence {
  return {
    at: new Date(date + 'T' + hour + ':00+07:00').toISOString(),
    location: { latitude: -6.1754, longitude: 106.8272, accuracy: 18 },
    photo: null,
  }
}

// Keep today's examples chronological even when the demo opens before morning.
const sampleEnd = Math.max(new Date(seededToday + 'T00:00:00+07:00').getTime(), Date.now() - 60_000)
const sampleStart = Math.max(new Date(seededToday + 'T00:00:00+07:00').getTime(), sampleEnd - 60 * 60_000)
const todayEvidence = (timestamp: number) => ({
  ...sampleEvidence(seededToday, '00:00'),
  at: new Date(timestamp).toISOString(),
})

records.push(
  { employeeId: 'bima', workDate: seededToday, checkIn: todayEvidence(sampleStart) },
  { employeeId: 'citra', workDate: seededToday, checkIn: todayEvidence(sampleStart), checkOut: todayEvidence(sampleEnd) },
  { employeeId: 'alya', workDate: seededYesterday, checkIn: sampleEvidence(seededYesterday, '08:07'), checkOut: sampleEvidence(seededYesterday, '16:03') },
  { employeeId: 'citra', workDate: seededYesterday, checkIn: sampleEvidence(seededYesterday, '08:01'), checkOut: sampleEvidence(seededYesterday, '16:12') },
)

async function waitForDemo(ms = 320) {
  await new Promise((resolve) => window.setTimeout(resolve, ms))
  if (!navigator.onLine) throw new Error('Koneksi internet diperlukan untuk melanjutkan demo.')
}

function listEmployees() {
  return employees.map((employee) => ({ ...employee }))
}

export function listActiveEmployees() {
  return listEmployees().filter((employee) => employee.active)
}

export function statusFor(employeeId: string, now = new Date()): Extract<AttendanceStatus, { kind: 'NOT_CHECKED_IN' }> | { kind: 'CHECKED_IN' | 'COMPLETED' | 'EXPIRED'; record: Attendance } {
  const open = records.find((record) => record.employeeId === employeeId && !record.checkOut)
  if (open) {
    const expired = now.getTime() - Date.parse(open.checkIn.at) >= sessionWindowMs
    return { kind: expired ? 'EXPIRED' : 'CHECKED_IN', record: open }
  }
  const complete = records.find((record) => record.employeeId === employeeId && record.workDate === todayWib(now))
  return complete ? { kind: 'COMPLETED', record: complete } : { kind: 'NOT_CHECKED_IN' }
}

export async function submitAttendance(input: {
  employeeId: string; action: Action; attemptId: string; photo: Blob; location: Location
}) {
  await waitForDemo(550)
  const { employeeId, action, attemptId, photo, location } = input
  const key = employeeId + ':' + action + ':' + attemptId
  const previous = submissions.get(key)
  if (previous) return previous
  if (!employees.some((employee) => employee.id === employeeId && employee.active)) {
    throw new Error('Karyawan sudah tidak aktif. Pilih nama lagi.')
  }
  if (!validLocation(location) || photo.type !== 'image/jpeg' || photo.size === 0 || photo.size > 1_000_000) {
    throw new Error('Foto atau lokasi belum valid. Ambil bukti kembali.')
  }
  const now = new Date()
  const status = statusFor(employeeId, now)
  const evidence: Evidence = { at: now.toISOString(), photo, location }
  if (action === 'IN' && status.kind === 'NOT_CHECKED_IN') {
    records.push({ employeeId, workDate: todayWib(now), checkIn: evidence })
  } else if (action === 'OUT' && status.kind === 'CHECKED_IN') {
    status.record.checkOut = evidence
  } else {
    throw new Error('Status absensi berubah. Kembali dan periksa status terbaru.')
  }
  submissions.set(key, evidence)
  return evidence
}
