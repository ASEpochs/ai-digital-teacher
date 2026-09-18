import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EventsPage } from '../components/EventList'
import type { BehaviorEvent } from '../types'
afterEach(cleanup)
const events: BehaviorEvent[] = [{ id: '1', time: 0, duration: 3, students: [], behavior: '专注学习', speech: '', severity: 'info' }, { id: '2', time: 4, duration: 3, students: [], behavior: '课堂交谈', speech: '请安静', severity: 'warning' }]
describe('事件中心', () => {
  it('只在异常筛选中展示需关注事件', () => {
    render(<EventsPage events={events} />)
    fireEvent.click(screen.getByRole('button', { name: '异常行为' }))
    expect(screen.getByText('课堂交谈')).toBeInTheDocument()
    expect(screen.queryByText('专注学习')).not.toBeInTheDocument()
  })
  it('关键词搜索无结果时显示可操作提示', () => {
    render(<EventsPage events={events} />)
    fireEvent.change(screen.getByRole('textbox', { name: '搜索行为记录' }), { target: { value: '不存在' } })
    expect(screen.getByText('没有匹配的记录')).toBeInTheDocument()
  })
})
