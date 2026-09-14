import type { BehaviorEvent, ClassroomReport, StudentReport } from './types'

export function buildLocalReport(
  events: BehaviorEvent[],
  triggeredIds: Set<string>,
  classroomSummary = '课堂报告已根据本次视频分析生成；当前使用浏览器本地统计作为网络降级。',
): ClassroomReport {
  const rows = new Map<string, StudentReport>()
  events
    .filter((event) => triggeredIds.has(event.id))
    .forEach((event) => {
      event.students.forEach((student) => {
        const row = rows.get(student.id) ?? {
          student_id: student.id,
          label: student.label,
          behaviors: {},
          reminder_count: 0,
          timeline: [],
          summary: '',
        }
        const stat = row.behaviors[event.behavior] ?? { count: 0, duration: 0 }
        stat.count += 1
        stat.duration += event.duration
        row.behaviors[event.behavior] = stat
        if (event.severity !== 'info') row.reminder_count += 1
        row.timeline.push({
          event_id: event.id,
          time: event.time,
          duration: event.duration,
          behavior: event.behavior,
          severity: event.severity,
        })
        rows.set(student.id, row)
      })
    })
  rows.forEach((row) => {
    const positive = row.timeline.filter((item) => item.severity === 'info')
    const attention = row.timeline.filter((item) => item.severity !== 'info')
    const positiveNames = [...new Set(positive.map((item) => item.behavior))]
    const attentionNames = [...new Set(attention.map((item) => item.behavior))]
    row.summary = attentionNames.length
      ? `本次自习过程中记录到${attentionNames.join('、')}，已在相应时刻进行语音提醒。${positiveNames.length ? `其他时段可见${positiveNames.join('、')}。` : ''}`
      : '本次学习过程中一直保持专注学习。无其他分心行为。'
  })
  return {
    generated_by: '浏览器本地规则（网络降级）',
    students: [...rows.values()].sort((a, b) => a.student_id.localeCompare(b.student_id)),
    total_events: triggeredIds.size,
    classroom_summary: classroomSummary,
  }
}
