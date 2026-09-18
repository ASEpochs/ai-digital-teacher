import { Check, Search, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { BehaviorEvent } from '../types'
import { formatTime } from '../platform'
import { Badge, EmptyState } from './ui'

export function EventList({ events, compact = false }: { events: BehaviorEvent[]; compact?: boolean }) {
  if (!events.length) return <EmptyState compact={compact} title="暂时没有行为记录" text="开始课堂观察后，AI 识别到的行为将在这里形成时间轴。" />
  return <div className={`event-list ${compact ? 'compact' : ''}`}>{events.map(event => <article className={`event-row ${event.severity}`} key={event.id}>
    <span className="event-indicator">{event.severity === 'info' ? <Check size={16} /> : <TriangleAlert size={16} />}</span>
    <div className="event-copy"><div><strong>{event.behavior}</strong><time>{formatTime(event.time)}</time></div><p>{event.students.map(s => s.label).join('、') || '课堂画面'}</p>{!compact && event.speech && <blockquote>{event.speech}</blockquote>}<small>持续约 {Math.round(event.duration)} 秒 · {event.severity === 'info' ? '正常状态，仅记录' : '异常状态，进入提醒流程'}</small></div>
  </article>)}</div>
}

export function EventsPage({ events }: { events: BehaviorEvent[] }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const filtered = events.filter(e => (filter === 'all' || (filter === 'attention' ? e.severity !== 'info' : e.severity === 'info')) && `${e.behavior} ${e.students.map(s => s.label).join(' ')}`.includes(query.trim()))
  return <section className="panel"><div className="list-toolbar"><div className="tabs" aria-label="事件筛选">{[['all', '全部记录'], ['attention', '异常行为'], ['info', '正常状态']].map(([id, label]) => <button key={id} aria-pressed={filter === id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div><label className="search-field"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索行为、座位标签" aria-label="搜索行为记录" /></label></div><div className="list-summary"><span>当前课堂 · 按发生时间倒序</span><Badge>{filtered.length} 条记录</Badge></div>{filtered.length ? <EventList events={filtered} /> : <EmptyState title={events.length ? '没有匹配的记录' : '等待第一条课堂记录'} text={events.length ? '试试其他关键词，或切换筛选条件。' : '正常行为仅记录，异常行为触发语音提醒。历史会话请在历史课堂中查看。'} />}</section>
}
