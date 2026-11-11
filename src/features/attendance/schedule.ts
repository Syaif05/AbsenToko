export const shifts = {
  P: 'Pagi · 08:00–17:00',
  M: 'Midel · 11:00–19:00',
  S: 'Siang · 13:00–21:30',
  O: 'Libur',
} as const

export const validMonth = (month: string) => /^20\d\d-(0[1-9]|1[0-2])$/.test(month)

export function monthDays(month: string) {
  const [year, number] = month.split('-').map(Number)
  return Array.from({ length: new Date(Date.UTC(year, number, 0)).getUTCDate() }, (_, i) => i + 1)
}

