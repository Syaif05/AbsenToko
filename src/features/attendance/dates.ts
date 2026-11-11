const zone = 'Asia/Jakarta'
const dateKey = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, dateStyle: 'short' })
const longDate = new Intl.DateTimeFormat('id-ID', { timeZone: zone, dateStyle: 'full' })
const time = new Intl.DateTimeFormat('id-ID', {
  timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

export function todayWib(now = new Date()) {
  return dateKey.format(now)
}

export function displayDate(date: string) {
  return longDate.format(new Date(date + 'T12:00:00+07:00'))
}

export function displayTime(instant: string) {
  return time.format(new Date(instant)).replace('.', ':')
}
