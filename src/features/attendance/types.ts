export type Employee = { id: string; name: string; active: boolean }
export type Action = 'IN' | 'OUT'
export type Location = { latitude: number; longitude: number; accuracy: number }
export type Evidence = { id?: string; at: string; location?: Location; photo: Blob | null }
export type Attendance = {
  employeeId: string
  workDate: string
  checkIn: Evidence
  checkOut?: Evidence
}

export type AttendanceStatus =
  | { kind: 'NOT_CHECKED_IN' }
  | { kind: 'CHECKED_IN' | 'COMPLETED' | 'EXPIRED'; record: Pick<Attendance, 'employeeId' | 'workDate'> & { checkIn: Pick<Evidence, 'at'>; checkOut?: Pick<Evidence, 'at'> } }

export const actionLabels = { IN: 'Absen Masuk', OUT: 'Absen Pulang' } satisfies Record<Action, string>

export function validLocation({ latitude, longitude, accuracy }: Location) {
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    && Number.isFinite(accuracy) && accuracy >= 0
}
