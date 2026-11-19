export type AttendanceRequest = { id: string; employee_id?: string; work_date: string; kind: 'SHIFT' | 'OUT'; check_in_at: string | null; check_out_at: string; reason: string; status: 'pending' | 'approved' | 'rejected'; review_note: string | null }
export const requestLabels = { pending: 'Menunggu Owner', approved: 'Disetujui', rejected: 'Ditolak' }
