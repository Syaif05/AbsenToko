import type { Attendance, Employee } from '../attendance/types'

export function dashboardRows(employees: Employee[], records: Attendance[], store: string) {
  const allRecords = new Map(records.map((record) => [record.employeeId, record]))
  return employees.flatMap((employee) => {
    const record = allRecords.get(employee.id)
    const placement = record ? record.storeId : employee.storeId
    const matchesStore =
      !store || (store === 'unassigned' ? Boolean(record) && !record?.storeId : placement === store)
    if (!matchesStore || (!record && (!employee.active || employee.archivedAt))) return []
    return [
      { employee, record, status: record?.checkOut ? 'done' : record ? 'working' : 'waiting' },
    ]
  })
}
