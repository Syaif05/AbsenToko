import type { Employee } from '../features/attendance/types'

export function EmployeeSelector({ employees, value, onChange, disabled }: {
  employees: Employee[]; value: string; onChange: (value: string) => void; disabled: boolean
}) {
  return (
    <label className="field">
      <span>Pilih nama</span>
      <select required value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        <option value="">Pilih nama Anda</option>
        {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
      </select>
    </label>
  )
}
