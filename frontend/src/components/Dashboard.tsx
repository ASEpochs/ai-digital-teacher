import { ArrowRight, Camera, Check, ClipboardList, MonitorPlay } from 'lucide-react'
import type { ClassroomController } from '../hooks/useClassroom'
import { formatDate, formatTime, normalRatio, reportEvents, statusText, type ArchivedClass, type Page, type WorkspaceSettings } from '../platform'
import { Badge, Metric, Panel, TextAction } from './ui'
import { ServiceHealth, type VisionStatus } from './ServiceHealth'
import type { ServiceStatus } from './SettingsPage'

interface DashboardProps {
  classroom: ClassroomController
  history: ArchivedClass[]
  settings: WorkspaceSettings
  navigate: (p: Page) => void
  service: ServiceStatus
  vision: VisionStatus
  refresh: () => void
}

export function Dashboard({ classroom: c, history, settings, navigate, service, vision, refresh }: DashboardProps) {
  const active = ['monitoring', 'paused', 'requesting', 'finishing'].includes(c.monitoringStatus)
  const today = new Date().toDateString()
  const records = history.filter(row => new Date(row.startedAt).toDateString() === today)
  const events = c.logs.map(l => l.event)
  const ratio = normalRatio(events)
  const latest = history[0]
  const distribution = active ? events : latest ? reportEvents(latest.report) : []
  const normalCount = distribution.filter(event => event.severity === 'info').length
  const steps = [
    { title: '设置课堂信息', text: '学校、教室、课程与观察员', done: settings.school !== '我的学校', target: 'settings' as Page },
    { title: '上传监督员照片', text: '在实时课堂设置提醒形象', done: Boolean(c.teacher), target: 'live' as Page },
    { title: '检查摄像头和声音', text: '选择镜头，测试语音提醒', done: false, target: 'live' as Page },
    { title: '开始课堂观察', text: '允许摄像头访问后开始记录', done: active, target: 'live' as Page },
  ]

  return <div className="dashboard">
    <section className="classroom-brief" aria-label="当前课堂">
      <div className="brief-heading"><div><span className="field-label">{settings.school}</span><h2>{settings.classroom}<span>{settings.course}</span></h2><p>观察员：{settings.observer}</p></div>
        <Badge tone={active ? 'success' : 'neutral'}>{active ? statusText(c.monitoringStatus) : '尚未开始观察'}</Badge>
      </div>
      <div className="brief-actions">
        <button className="button primary" onClick={() => navigate('live')}><MonitorPlay size={17} />{active ? '返回实时课堂' : '开始课堂观察'}<ArrowRight size={16} /></button>
        <button className="text-button" onClick={() => navigate('settings')}>编辑课堂信息</button>
        {active && <span className="session-duration">已观察 <strong className="mono">{formatTime(c.elapsed)}</strong></span>}
        {!active && <span className="brief-hint">进入实时课堂后检查设备并开始</span>}
      </div>
      <ServiceHealth status={service} vision={vision} refresh={refresh} />
    </section>

    {!history.length && !active && <section className="preparation" aria-labelledby="preparation-title">
      <div className="section-caption"><h2 id="preparation-title">首次使用准备</h2><span>完成准备后即可开始记录</span></div>
      <ol className="preparation-steps">{steps.map((step, i) => <li key={step.title}>
        <button onClick={() => navigate(step.target)}><span className={step.done ? 'step-number done' : 'step-number'}>{step.done ? <Check size={17} /> : i + 1}</span><span><strong>{step.title}</strong><small>{step.text}</small></span><ArrowRight size={15} /></button>
      </li>)}</ol>
    </section>}

    {(history.length > 0 || active) && <>
      <div className="section-caption"><h2>今日观察记录</h2><span>仅统计本机课堂</span></div>
      <div className="metrics-grid">
        <Metric label="课堂会话" value={records.length + (active ? 1 : 0)} unit="节" note="已结束课堂与当前会话" />
        <Metric label="分析画面" value={records.reduce((sum, row) => sum + row.sampleCount, 0) + (active ? c.sampleCount : 0)} unit="次" note="包含成功与未完成的分析尝试" />
        <Metric label="异常记录" value={records.reduce((sum, row) => sum + reportEvents(row.report).filter(e => e.severity !== 'info').length, 0) + (active ? c.alertCount : 0)} unit="项" note="等待人工结合课堂情况复核" accent="amber" />
      </div>
    </>}

    <div className="dashboard-columns">
      <Panel title={active ? '当前课堂记录' : '最近一次课堂'} action={<TextAction onClick={() => navigate(active ? 'events' : 'history')}>{active ? '查看事件' : '查看历史'}</TextAction>}>
        {active ? <div className="current-session"><div className="record-title"><Camera size={20} /><strong>{settings.classroom}</strong><Badge tone="success">{statusText(c.monitoringStatus)}</Badge></div>
          <dl className="record-facts"><div><dt>观察时长</dt><dd className="mono">{formatTime(c.elapsed)}</dd></div><div><dt>行为记录</dt><dd>{events.length} 条</dd></div><div><dt>正常记录占比</dt><dd>{ratio === null ? '尚无记录' : ratio + '%'}</dd></div></dl>
          <p className="muted">{c.analysisMessage}</p>
        </div> : latest ? <div className="recent-record"><div className="record-title"><ClipboardList size={20} /><strong>{latest.context.classroom} · {latest.context.course}</strong><Badge>已结束</Badge></div><p>{formatDate(latest.startedAt)} · {latest.context.observer}</p><dl className="record-facts"><div><dt>观察时长</dt><dd className="mono">{formatTime(latest.elapsed)}</dd></div><div><dt>分析画面</dt><dd>{latest.sampleCount} 次</dd></div><div><dt>行为记录</dt><dd>{latest.report.total_events} 条</dd></div></dl></div>
        : <div className="record-empty"><ClipboardList size={24} /><div><strong>还没有已结束的课堂</strong><p>完成一次观察后，这里会显示最近的课堂和报告入口。</p></div></div>}
        {distribution.length > 0 && <div className="behavior-summary">
          <div><span>正常状态 {normalCount} 条</span><span>异常记录 {distribution.length - normalCount} 条</span></div>
          <div className="behavior-meter" role="img" aria-label={`正常 ${normalCount} 条，异常 ${distribution.length - normalCount} 条`}><i style={{ width: `${normalCount / distribution.length * 100}%` }} /></div>
          <small>{active ? '当前课堂' : '最近课堂'} · 按事件条数统计</small>
        </div>}
      </Panel>
      <section className="operating-notes"><h2>观察与记录说明</h2><dl>
        <div><dt>正常学习</dt><dd>记录在时间轴中，不进行语音播报。</dd></div>
        <div><dt>需要关注</dt><dd>进入语音提醒流程，可在事件中心回看。</dd></div>
        <div><dt>结束课堂</dt><dd>关闭摄像头并生成报告，保存到本机历史。</dd></div>
      </dl><p>正常记录占比按事件条数计算，不代表学生专注度评分。</p></section>
    </div>
  </div>
}
