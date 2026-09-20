import { Check, Search, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { BehaviorEvent } from '../types'
import { formatTime, type WorkspaceSettings } from '../platform'
import { Badge, EmptyState } from './ui'

export function EventList({ events, compact = false }: { events: BehaviorEvent[]; compact?: boolean }) {
  if (!events.length) return <EmptyState compact={compact} title="暂时没有行为记录" text="开始观察后，识别到的行为会按时间记录在这里。" />
  return <div className={`event-list ${compact ? 'compact' : ''}`}>{events.map(event => <article className={`event-row ${event.severity}`} key={event.id}>
    <span className="event-indicator">{event.severity === 'info' ? <Check size={16} /> : <TriangleAlert size={16} />}</span>
    <div className="event-copy"><div><strong>{event.behavior}</strong><time>{formatTime(event.time)}</time></div><p>{event.students.map(s => s.label).join('、') || '课堂画面'}</p>{!compact && event.speech && <blockquote>{event.speech}</blockquote>}<small>持续约 {Math.round(event.duration)} 秒 · {event.severity === 'info' ? '正常状态，仅记录' : '异常状态，进入提醒流程'}</small></div>
  </article>)}</div>
}

export function EventsPage({ events, context, goLive }: { events: BehaviorEvent[]; context?: WorkspaceSettings; goLive?: () => void }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const filtered = events.filter(e => (filter === 'all' || (filter === 'attention' ? e.severity !== 'info' : e.severity === 'info')) && `${e.behavior} ${e.students.map(s => s.label).join(' ')}`.includes(query.trim())).sort((a, b) => b.time - a.time)
  return <section className="panel">
    <div className="list-toolbar"><div className="tabs" aria-label="事件筛选">{[['all', '全部记录'], ['attention', '异常行为'], ['info', '正常状态']].map(([id, label]) => <button key={id} aria-pressed={filter === id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div><label className="search-field"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索行为、座位标签" aria-label="搜索行为记录" /></label></div>
    <div className="list-summary"><span>{context ? `${context.classroom} · ${context.course}` : '当前课堂'} · 按发生时间倒序</span><span>{filtered.length} 条记录</span></div>
    {filtered.length ? <div className="table-scroll" role="region" aria-label="课堂事件记录" tabIndex={0}><table className="events-table">
      <thead><tr><th>发生时间</th><th>学生 / 座位</th><th>行为</th><th>持续时间</th><th>风险级别</th><th>提醒方式</th></tr></thead>
      <tbody>{filtered.map(event => <tr key={event.id}><td className="mono">{formatTime(event.time)}</td><td>{event.students.map(s => s.label).join('、') || '课堂画面'}</td><td><strong>{event.behavior}</strong>{event.speech && <small>{event.speech}</small>}</td><td>约 {Math.round(event.duration)} 秒</td><td><Badge tone={event.severity === 'info' ? 'success' : event.severity === 'alert' ? 'error' : 'warning'}>{event.severity === 'info' ? '正常' : event.severity === 'alert' ? '高关注' : '需关注'}</Badge></td><td>{event.severity === 'info' ? '仅记录' : '进入语音流程'}</td></tr>)}</tbody>
    </table></div> : <EmptyState title={events.length ? '没有匹配的记录' : '等待第一条课堂记录'} text={events.length ? '试试其他关键词，或切换筛选条件。' : '开始课堂观察后，记录将显示在这里。已结束的历史会话可在历史课堂中查看。'} action={!events.length && goLive && <button className="button primary" onClick={goLive}>前往实时课堂</button>} />}
    {events.length > 0 && <p className="metric-footnote">时间为课堂内的相对时间。异常记录进入提醒流程，不代表语音已成功播放或人工已完成处理。</p>}
  </section>
}
