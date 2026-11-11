import type { ReactNode } from 'react'
import icedTea from '../../assets/iced-tea.svg?no-inline'

export function TeaHero({ children, variant = 'entry' }: {
  children: ReactNode
  variant?: 'entry' | 'owner' | 'dashboard'
}) {
  return (
    <div className={'tea-hero tea-hero-' + variant}>
      <div className="tea-hero-copy">{children}</div>
      <img className="tea-hero-art" src={icedTea} width={380} height={320} alt="" aria-hidden="true" />
    </div>
  )
}
