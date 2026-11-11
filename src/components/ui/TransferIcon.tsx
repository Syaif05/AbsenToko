export function TransferIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={direction === 'up' ? 'M12 15V4m-4 4 4-4 4 4' : 'M12 4v11m-4-4 4 4 4-4'} />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  )
}
