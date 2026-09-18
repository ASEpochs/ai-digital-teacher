import { beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings, HISTORY_KEY, normalRatio, readHistory, readSettings, reportEvents, SETTINGS_KEY } from '../platform'
import type { ClassroomReport } from '../types'

const report: ClassroomReport = { generated_by: 'test', classroom_summary: '测试', total_events: 1, students: ['s1', 's2'].map(id => ({ student_id: id, label: id, reminder_count: 1, summary: '测试', behaviors: { 交谈: { count: 1, duration: 3 } }, timeline: [{ event_id: 'shared-event', time: 3, duration: 3, behavior: '交谈', severity: 'warning' }] })) }
beforeEach(() => localStorage.clear())
describe('课堂工作区与报告', () => {
  it('多人关联同一事件时，统计异常次数不重复', () => {
    const events = reportEvents(report)
    expect(events).toHaveLength(1)
    expect(events[0].students).toHaveLength(2)
  })
  it('没有观察数据时，不生成虚假的正常率', () => { expect(normalRatio([])).toBeNull() })
  it('正常记录占比以事件数计算', () => {
    const events = reportEvents(report)
    expect(normalRatio([...events, { ...events[0], id: 'normal', severity: 'info' }])).toBe(50)
  })
  it('损坏的存储内容不会导致页面崩溃', () => {
    localStorage.setItem(HISTORY_KEY, '{bad')
    localStorage.setItem(SETTINGS_KEY, 'null')
    expect(readHistory()).toEqual([])
    expect(readSettings()).toEqual(defaultSettings)
  })
  it('忽略结构不完整的历史报告', () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([{ id: 'bad', startedAt: new Date().toISOString(), elapsed: 5, sampleCount: 1, context: defaultSettings, report: { ...report, students: [{ timeline: [] }] } }]))
    expect(readHistory()).toEqual([])
  })
  it('保留有效报告并限制本机历史为30条', () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(Array.from({ length: 35 }, (_, id) => ({ id: String(id), startedAt: new Date().toISOString(), elapsed: 5, sampleCount: 1, context: defaultSettings, report }))))
    expect(readHistory()).toHaveLength(30)
    expect(readHistory()[0].report).toEqual(report)
  })
})
