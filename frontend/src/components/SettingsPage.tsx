import { Check, Save } from 'lucide-react'
import { useState } from 'react'
import type { WorkspaceSettings } from '../platform'
import { Panel } from './ui'
import { ServiceHealth, type VisionStatus } from './ServiceHealth'
export type ServiceStatus = 'loading' | 'online' | 'offline'

export function SettingsPage({ settings, save, status, vision, refresh }: {
  settings: WorkspaceSettings; save: (s: WorkspaceSettings) => boolean
  status: ServiceStatus; vision: VisionStatus; refresh: () => void
}) {
  const [draft, setDraft] = useState(settings)
  const [saved, setSaved] = useState(false)
  return <div className="settings-grid">
    <Panel title="学校与课堂信息" subtitle="保存后用于下一次课堂观察及报告归档">
      <form className="settings-form" onSubmit={e => {
        e.preventDefault()
        setSaved(save(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim()])) as unknown as WorkspaceSettings))
      }}>
        {([['school', '学校 / 机构名称', '例如：实验中学'], ['classroom', '教学楼 / 教室', '例如：教学楼 A · 301'], ['course', '课程名称', '例如：七年级语文'], ['observer', '课堂观察员', '例如：教学督导']] as const).map(([key, label, placeholder]) =>
          <label key={key}>{label}<input required maxLength={60} value={draft[key]} placeholder={placeholder} onChange={e => { setSaved(false); setDraft({ ...draft, [key]: e.target.value }) }} /></label>)}
        <p className="muted">信息仅保存在当前浏览器。观察员名称用于记录，不代表登录账户。</p>
        <div className="form-actions"><button className="button primary" type="submit"><Save size={16} />保存工作区信息</button>{saved && <span className="saved-message" role="status"><Check size={16} />已保存</span>}</div>
      </form>
    </Panel>
    <div className="settings-aside">
      <Panel title="连接与设备"><ServiceHealth status={status} vision={vision} refresh={refresh} /><dl className="service-details">
        <div><dt>画面来源</dt><dd>本机摄像头</dd></div><div><dt>异常提醒</dt><dd>语音与画面字幕</dd></div><div><dt>历史报告</dt><dd>本机保存，支持导出</dd></div>
      </dl><p className="metric-footnote">模型已配置表示服务已选择视觉模型，实际识别结果以课堂分析为准。</p></Panel>
      <section className="operating-notes"><h2>设备使用说明</h2><ol className="help-steps">
        <li><strong>允许访问摄像头</strong><p>手机优先后置，电脑使用可用摄像头。摄像头被占用时请先退出其他相机应用。</p></li>
        <li><strong>测试语音提醒</strong><p>上传照片后点击测试语音，调高媒体音量，观察期间保持页面在前台。</p></li>
        <li><strong>固定拍摄位置</strong><p>保持光线充足，让学生上半身与桌面清晰可见。</p></li>
      </ol></section>
    </div>
  </div>
}
