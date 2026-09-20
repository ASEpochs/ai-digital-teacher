import { RefreshCw } from 'lucide-react'
import type { ServiceStatus } from './SettingsPage'

export type VisionStatus = 'unknown' | 'configured' | 'unavailable'

export function ServiceHealth({ status, vision, refresh }: {
  status: ServiceStatus; vision: VisionStatus; refresh: () => void
}) {
  return <div className="service-strip" role="status">
    <span><i className={status === 'online' ? 'status-dot online' : 'status-dot'} />课堂服务：{status === 'online' ? '已连接' : status === 'offline' ? '连接失败' : '连接中'}</span>
    <span><i className={vision === 'configured' ? 'status-dot online' : 'status-dot'} />视觉模型：{status !== 'online' ? '等待检查' : vision === 'configured' ? '已配置' : '暂不可用'}</span>
    <button className="text-button" disabled={status === 'loading'} onClick={refresh}><RefreshCw size={14} className={status === 'loading' ? 'spin' : ''} />重新检查</button>
    {status === 'offline' && <p>服务暂未响应，请稍后重试。首次连接可能需要等待唤醒。</p>}
    {status === 'online' && vision === 'unavailable' && <p>摄像头可以预览，行为分析需要管理员配置视觉模型。</p>}
  </div>
}
