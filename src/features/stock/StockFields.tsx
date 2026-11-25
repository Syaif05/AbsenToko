import { useEffect, useId, useState } from 'react'
import { Notice } from '../../components/ui/shared'
import { displayStockQuantity, groupStockItems, statusLabels, whatsappStock } from './model'
import type { Quantity, StockItem, StockReceipt } from './model'
import { displayTime } from '../attendance/dates'
import './stock.css'

export function CompactStockInput({ item, value, onChange, onCommit, invalid, issue, credit }: {
  item: StockItem; value: Quantity; onChange: (value: Quantity) => void; invalid: boolean
  onCommit?: () => void; issue?: string; credit?: string | null
}) {
  const errorId = useId()
  const combined = item.unit_type === 'combined'
  const error = issue || (invalid ? (combined
    ? 'Isi kedua kolom dengan bilangan bulat atau tanda -.'
    : 'Gunakan angka, pecahan, atau tanda -.') : '')
  return <div className={'stock-compact-row' + (combined ? ' stock-compact-combined' : '')}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onCommit?.() }}>
    <div className="stock-compact-name"><strong>{item.name}</strong>
      {!combined && <small className="muted">{item.unit_label}</small>}
      {credit && <small className="muted">Terakhir: {credit}</small>}
    </div>
    {error && <small id={errorId} className="stock-invalid stock-item-error" role="alert">{error}</small>}
    <div className={'stock-compact-values' + (combined ? ' stock-pair' : '')}>
      <label>
        <input type="text" autoComplete="off" maxLength={24} aria-label={item.name + ' dalam ' + (combined ? 'kardus' : item.unit_label)}
          aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
          value={value[0]} placeholder="—" onChange={e => onChange([e.target.value, value[1]])} />
        {combined && <small className="muted">kardus</small>}
      </label>
      {combined && <label>
        <input type="text" autoComplete="off" maxLength={24} aria-label={item.name + ' dalam pcs'}
          aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
          value={value[1]} placeholder="—" onChange={e => onChange([value[0], e.target.value])} />
        <small className="muted">pcs</small>
      </label>}
    </div>
  </div>
}

export function StockSummary({ receipt }: { receipt: StockReceipt }) {
  return <div className="stack">
    {groupStockItems(receipt.items, item => item.category_id_snapshot).map(group =>
      <section className="stock-group stack" key={group[0].category_id_snapshot}>
        <h3>{group[0].category_name_snapshot}</h3>
        {group.map(item => <div className="stock-row stock-result" key={item.id}>
          <span>{item.item_name_snapshot}</span>
          <div className="stock-quantity">
            <strong>{displayStockQuantity(item)}</strong>
            {(item.status_flag === 'empty' || item.status_flag === 'low') &&
              <span className={'stock-badge stock-' + item.status_flag}>{statusLabels[item.status_flag]}</span>}
            {item.last_editor && item.last_edit_at && <small className="muted stock-item-credit">
              {item.last_editor} · {displayTime(item.last_edit_at)} WIB
            </small>}
          </div>
        </div>)}
      </section>)}
    {receipt.report.notes && <p className="stock-lines">Catatan: {receipt.report.notes}</p>}
  </div>
}

export function CopyStock({ stock }: { stock: Parameters<typeof whatsappStock>[0] }) {
  const [message, setMessage] = useState('')
  const [showText, setShowText] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(whatsappStock(stock))
      setShowText(false)
      setMessage('Format WhatsApp sudah disalin.')
    } catch {
      setShowText(true)
      setMessage('Pilih dan salin teks dari kotak di bawah.')
    }
  }

  return <div className="stack">
    <button className="button button-secondary" type="button" onClick={() => void copy()}>Salin Format WhatsApp</button>
    {message && <Notice tone={showText ? 'warning' : 'success'}>{message}</Notice>}
    {showText && <textarea aria-label="Format WhatsApp" readOnly rows={9} value={whatsappStock(stock)} onFocus={e => e.target.select()} />}
  </div>
}

export function StockToast({ message }: { message: string }) {
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setDismissed(true), 6000)
    return () => window.clearTimeout(timer)
  }, [])
  return dismissed ? null : <div className="stock-toast">
    <Notice tone="success">{message}</Notice>
    <button className="button button-quiet" type="button" aria-label="Tutup notifikasi" onClick={() => setDismissed(true)}>×</button>
  </div>
}
