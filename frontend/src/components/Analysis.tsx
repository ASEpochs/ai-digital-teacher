import { Download, ScanLine, UserRound } from 'lucide-react'
import type { BehaviorEvent, ClassroomReport } from '../types'
import { downloadJson, formatTime, normalRatio } from '../platform'
import { Badge, EmptyState, Metric, Panel } from './ui'

export function ReportView({ report }: { report: ClassroomReport }) {
  return <>
    <section className="report-summary"><div><h2>课堂摘要</h2><p>{report.classroom_summary || '根据本次课堂记录生成逐人统计。'}</p></div><button className="button" onClick={() => downloadJson('课堂行为报告.json', report)}><Download size={15} />导出报告</button></section>
    <div className="section-caption"><h2>逐人行为记录</h2><span>{report.students.length} 位已识别学生 · 按座位记录</span></div>
    <div className="student-report-grid">{report.students.map(s => <article className="student-report" key={s.student_id}>
      <header><UserRound size={20} /><h3>{s.label}</h3><Badge tone={s.reminder_count ? 'warning' : 'success'}>{s.reminder_count ? `${s.reminder_count} 次异常记录` : '正常状态'}</Badge></header>
      <div className="behavior-tags">{Object.entries(s.behaviors).map(([name, stat]) => <div key={name}><span>{name}</span><strong>{stat.count} 次</strong><small>约 {Math.round(stat.duration)} 秒</small></div>)}</div>
      <p className="student-summary">{s.summary}</p>
      <details><summary>行为时间轴 · {s.timeline.length} 条</summary><ul className="report-timeline">{s.timeline.map(t => <li key={t.event_id}><time>{formatTime(t.time)}</time><span>{t.behavior}</span><Badge tone={t.severity === 'info' ? 'success' : 'warning'}>{t.severity === 'info' ? '正常' : '关注'}</Badge></li>)}</ul></details>
    </article>)}</div>
    {!report.students.length && <EmptyState title="本次没有可统计的学生记录" text="请确认学生处于画面内、光线充足，并等待至少一次分析完成。" />}
  </>
}

export function Analysis({ events, report, loading, samples, goLive }: {
  events: BehaviorEvent[]; report: ClassroomReport | null; loading: boolean; samples: number; goLive: () => void
}) {
  const ratio = normalRatio(events)
  const grouped = Object.entries(events.reduce<Record<string, number>>((all, e) => { all[e.behavior] = (all[e.behavior] ?? 0) + 1; return all }, {})).sort((a, b) => b[1] - a[1])
  if (!events.length && !report && !loading) return <section className="panel"><EmptyState title="当前课堂还没有分析记录" text="进入实时课堂并开始观察，识别到的行为会在这里汇总。结束后生成逐人报告。" action={<button className="button primary" onClick={goLive}>前往实时课堂</button>} /></section>
  return <>
    {loading && <div className="notice" role="status"><ScanLine size={18} />正在汇总课堂记录并生成报告…</div>}
    {report && <ReportView report={report} />}
    <div className="section-caption"><h2>行为统计</h2><span>当前课堂 · 按事件条数汇总</span></div>
    <div className="metrics-grid three"><Metric label="分析画面" value={samples} unit="次" note="包含成功与未完成的分析尝试" /><Metric label="正常记录占比" value={ratio === null ? '—' : ratio} unit={ratio === null ? '' : '%'} note="正常事件数 / 全部事件数" /><Metric label="已识别学生" value={new Set(events.flatMap(e => e.students.map(s => s.id))).size} unit="人" note="根据座位位置匹配，非身份识别" /></div>
    {grouped.length > 0 && <Panel title="行为分布"><div className="horizontal-chart">{grouped.map(([name, count]) => <div key={name}><span>{name}</span><div><i style={{ width: `${count / events.length * 100}%` }} /></div><strong>{count} 次</strong></div>)}</div></Panel>}
    <p className="analysis-disclaimer">以上是已识别事件的分布，不构成学生专注度或教学质量评分。请结合课堂实际复核。</p>
    {!report && !loading && <div className="report-pending"><ScanLine size={20} /><p>结束课堂后生成完整报告，包含课堂摘要、逐人统计与事件时间轴。</p></div>}
  </>
}
