import type { BehaviorEvent } from './types'

/**
 * 返回从 previousTime 到 currentTime 跨过的、尚未触发的事件。
 * RAF 与 timeupdate 共用此函数，Set 保证同一轮正常播放不重复触发。
 */
export function findCrossedEvents(
  events: BehaviorEvent[],
  previousTime: number,
  currentTime: number,
  triggeredIds: ReadonlySet<string>,
): BehaviorEvent[] {
  if (currentTime < previousTime) return []
  return events.filter(
    (event) =>
      !triggeredIds.has(event.id) &&
      previousTime <= event.time &&
      currentTime >= event.time,
  )
}

/** 拖回事件时间之前时，移除该事件的本轮触发标记，使其可再次触发。 */
export function resetEventsAfterRewind(
  events: BehaviorEvent[],
  targetTime: number,
  triggeredIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set(triggeredIds)
  events.forEach((event) => {
    if (targetTime < event.time) next.delete(event.id)
  })
  return next
}

export function activeEventsAt(events: BehaviorEvent[], time: number): BehaviorEvent[] {
  return events.filter((event) => time >= event.time && time <= event.time + event.duration)
}
