import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from '../components/Dashboard'
import { Analysis } from '../components/Analysis'
import { ServiceHealth } from '../components/ServiceHealth'
import type { ClassroomController } from '../hooks/useClassroom'
import { defaultSettings } from '../platform'

afterEach(cleanup)
describe('课堂准备与数据边界', () => {
  it('首次打开显示准备流程，不展示零值统计', () => {
    const navigate = vi.fn()
    const classroom = { monitoringStatus: 'idle', teacher: null, logs: [], sampleCount: 0 } as unknown as ClassroomController
    const { container } = render(<Dashboard classroom={classroom} history={[]} settings={defaultSettings} navigate={navigate} service="online" vision="configured" refresh={vi.fn()} />)
    expect(screen.getByText('首次使用准备')).toBeInTheDocument()
    expect(container.querySelector('.metrics-grid')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /设置课堂信息/ }))
    expect(navigate).toHaveBeenCalledWith('settings')
  })
  it('暂无分析时提供进入课堂的操作而非空图表', () => {
    const goLive = vi.fn()
    const { container } = render(<Analysis events={[]} report={null} loading={false} samples={0} goLive={goLive} />)
    expect(container.querySelector('.metrics-grid')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '前往实时课堂' }))
    expect(goLive).toHaveBeenCalledOnce()
  })
  it('后端在线但模型未配置时不显示模型可用', () => {
    render(<ServiceHealth status="online" vision="unavailable" refresh={vi.fn()} />)
    expect(screen.getByText('课堂服务：已连接')).toBeInTheDocument()
    expect(screen.getByText('视觉模型：暂不可用')).toBeInTheDocument()
    expect(screen.queryByText('视觉模型：已配置')).not.toBeInTheDocument()
  })
})
