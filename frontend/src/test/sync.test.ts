import { describe, expect, it } from 'vitest'
import {
  activeEventsAt,
  findCrossedEvents,
  resetEventsAfterRewind,
} from '../sync'
import type { BehaviorEvent } from '../types'

const events: BehaviorEvent[] = [
  {
    id: 'e1', time: 10, duration: 5, behavior: '低头', speech: '提醒', severity: 'warning',
    students: [{ id: 's1', label: '一号', rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }],
  },
  {
    id: 'e2', time: 20, duration: 4, behavior: '交谈', speech: '提醒', severity: 'alert',
    students: [{ id: 's2', label: '二号', rect: { x: 0.4, y: 0.2, width: 0.2, height: 0.2 } }],
  },
]

describe('时间窗口同步', () => {
  it('即使一次 RAF 跨过事件时刻也不会漏触发', () => {
    expect(findCrossedEvents(events, 9.7, 10.3, new Set()).map((event) => event.id)).toEqual(['e1'])
  })

  it('已触发事件在正常播放中不会重复', () => {
    expect(findCrossedEvents(events, 9, 11, new Set(['e1']))).toEqual([])
  })

  it('向前拖动跨过多个事件时依次返回', () => {
    expect(findCrossedEvents(events, 5, 21, new Set()).map((event) => event.id)).toEqual(['e1', 'e2'])
  })

  it('拖回事件前只重置位于目标时间之后的事件', () => {
    expect([...resetEventsAfterRewind(events, 15, new Set(['e1', 'e2']))]).toEqual(['e1'])
  })

  it('按持续时间计算当前标记', () => {
    expect(activeEventsAt(events, 14).map((event) => event.id)).toEqual(['e1'])
    expect(activeEventsAt(events, 16)).toEqual([])
  })

})
