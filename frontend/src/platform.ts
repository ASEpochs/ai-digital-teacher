import type { BehaviorEvent, ClassroomReport } from './types'

export const pages = ['overview', 'live', 'analysis', 'events', 'history', 'settings'] as const
export type Page = typeof pages[number]
export const pageNames: Record<Page, string> = { overview: '工作台', live: '实时课堂', analysis: 'AI 课堂分析', events: '事件中心', history: '历史课堂', settings: '工作区设置' }
export interface WorkspaceSettings { school: string; classroom: string; course: string; observer: string }
export const defaultSettings: WorkspaceSettings = { school: '我的学校', classroom: '本机课堂', course: '课堂观察', observer: '课堂观察员' }
export interface ArchivedClass { id: string; startedAt: string; endedAt: string; elapsed: number; sampleCount: number; context: WorkspaceSettings; report: ClassroomReport }
export const HISTORY_KEY = 'digital-teacher.classrooms.v1'
export const SETTINGS_KEY = 'digital-teacher.workspace.v1'

function isReport(value: unknown): value is ClassroomReport {
  if (!value || typeof value !== 'object') return false
  const r = value as ClassroomReport
  return Number.isFinite(r.total_events) && typeof r.classroom_summary === 'string' && Array.isArray(r.students) && r.students.every(s =>
    s && typeof s.student_id === 'string' && typeof s.label === 'string' && typeof s.summary === 'string' && Number.isFinite(s.reminder_count) &&
    s.behaviors && typeof s.behaviors === 'object' && Object.values(s.behaviors).every(b => b && Number.isFinite(b.count) && Number.isFinite(b.duration)) &&
    Array.isArray(s.timeline) && s.timeline.every(t => t && typeof t.event_id === 'string' && typeof t.behavior === 'string' && Number.isFinite(t.time) && Number.isFinite(t.duration) && ['info', 'warning', 'alert'].includes(t.severity)))
}

export function readSettings(): WorkspaceSettings {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return Object.fromEntries(Object.entries(defaultSettings).map(([key, fallback]) => [key, typeof value?.[key] === 'string' && value[key].trim() ? value[key].slice(0, 60) : fallback])) as unknown as WorkspaceSettings
  } catch { return defaultSettings }
}

export function readHistory(): ArchivedClass[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    if (!Array.isArray(rows)) return []
    return rows.filter((row): row is ArchivedClass => Boolean(row && typeof row.id === 'string' && typeof row.startedAt === 'string' && Number.isFinite(Date.parse(row.startedAt)) && Number.isFinite(row.elapsed) && Number.isFinite(row.sampleCount) && row.context && Object.keys(defaultSettings).every(key => typeof row.context[key] === 'string') && isReport(row.report))).slice(0, 30)
  } catch { return [] }
}

export function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(Math.floor(safe % 60)).padStart(2, '0')}`
}
export function formatDate(value: string) { return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) }
export function statusText(status: string) { return ({ idle: '待开始', requesting: '连接中', monitoring: '观察中', paused: '已暂停', finishing: '生成报告中', finished: '已结束', error: '连接异常' } as Record<string, string>)[status] || status }
export function reportEvents(report: ClassroomReport): BehaviorEvent[] {
  const events = new Map<string, BehaviorEvent>()
  report.students.forEach(student => student.timeline.forEach(item => {
    const event = events.get(item.event_id) ?? { id: item.event_id, time: item.time, duration: item.duration, behavior: item.behavior, severity: item.severity, speech: '', students: [] }
    event.students.push({ id: student.student_id, label: student.label, rect: { x: 0, y: 0, width: 0, height: 0 } })
    events.set(item.event_id, event)
  }))
  return [...events.values()].sort((a, b) => b.time - a.time)
}
export function downloadJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function normalRatio(events: BehaviorEvent[]): number | null {
  return events.length ? Math.round(events.filter(e => e.severity === 'info').length / events.length * 100) : null
}
