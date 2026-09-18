import { Activity, ArrowUpRight, Inbox } from 'lucide-react'
import type { ReactNode, ComponentType } from 'react'

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) { return <span className={`badge ${tone}`}><i />{children}</span> }
export function Panel({ title, subtitle, action, children, className = '' }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><header className="panel-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>{children}</section>
}
export function EmptyState({ title, text, action, compact = false }: { title: string; text: string; action?: ReactNode; compact?: boolean }) {
  return <div className={`empty-state ${compact ? 'compact' : ''}`}><div className="empty-icon"><Inbox size={25} strokeWidth={1.5} /></div><strong>{title}</strong><p>{text}</p>{action}</div>
}
export function Metric({ label, value, unit, note, icon: Icon = Activity, accent = '' }: { label: string; value: ReactNode; unit?: string; note: string; icon?: ComponentType<{ size?: number }>; accent?: string }) {
  return <article className={`metric ${accent}`}><div className="metric-top"><span>{label}</span><Icon size={19} /></div><div className="metric-value">{value}<small>{unit}</small></div><p>{note}</p></article>
}
export function TextAction({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button className="text-button" onClick={onClick}>{children}<ArrowUpRight size={15} /></button> }
