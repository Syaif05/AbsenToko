export function periodRange(period: string, day: string) {
  const date = new Date(day + 'T12:00:00Z')
  const key = (value: Date) => value.toISOString().slice(0, 10)
  if (period === 'week') {
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
    const start = key(date)
    date.setUTCDate(date.getUTCDate() + 6)
    return [start, key(date)]
  }
  if (period === 'month') return [day.slice(0, 7) + '-01', key(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)))]
  if (period === 'year') return [day.slice(0, 4) + '-01-01', day.slice(0, 4) + '-12-31']
  return [day, day]
}
export function validRange(start: string, end: string) {
  const valid = (day: string) => /^20\d\d-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day
  return valid(start) && valid(end) && start <= end && (Date.parse(end) - Date.parse(start)) / 86400000 <= 365
}
