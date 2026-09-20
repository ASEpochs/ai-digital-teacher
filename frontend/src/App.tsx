import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, CircleAlert, RefreshCw } from 'lucide-react'
import { useClassroom } from './hooks/useClassroom'
import { Shell } from './components/Shell'
import { Dashboard } from './components/Dashboard'
import { LiveClassroom } from './components/LiveClassroom'
import { Analysis } from './components/Analysis'
import { EventsPage } from './components/EventList'
import { HistoryPage } from './components/HistoryPage'
import { SettingsPage, type ServiceStatus } from './components/SettingsPage'
import { Badge } from './components/ui'
import type { VisionStatus } from './components/ServiceHealth'
import { HISTORY_KEY, SETTINGS_KEY, pageNames, pages, readHistory, readSettings, type ArchivedClass, type Page, type WorkspaceSettings } from './platform'

const descriptions: Record<Page, string> = {
  overview: '准备课堂、检查设备，并查看最近的观察记录。',
  live: '正常行为仅记录，异常行为触发语音提醒。',
  analysis: '查看当前课堂的行为分布与逐人记录。',
  events: '按行为或座位检索本次课堂记录。',
  history: '查看与导出当前浏览器保存的课堂报告。',
  settings: '设置课堂上下文，检查服务连接，为下一次观察做好准备。',
}
function pageFromHash(): Page {
  const key = window.location.hash.slice(1)
  return pages.includes(key as Page) ? key as Page : 'overview'
}
export default function App() {
  const classroom = useClassroom()
  const [page, setPage] = useState<Page>(pageFromHash)
  const [settings, setSettings] = useState(readSettings)
  const [context, setContext] = useState(settings)
  const [history, setHistory] = useState(readHistory)
  const [storageNotice, setStorageNotice] = useState('')
  const [service, setService] = useState<ServiceStatus>('loading')
  const [vision, setVision] = useState<VisionStatus>('unknown')
  const savedSession = useRef('')
  const healthAbort = useRef<AbortController | null>(null)
  const active = ['requesting', 'monitoring', 'paused', 'finishing'].includes(classroom.monitoringStatus)
  const navigate = useCallback((target: Page) => { window.location.hash = target }, [])
  const checkService = useCallback(async () => {
    healthAbort.current?.abort()
    const controller = new AbortController(); healthAbort.current = controller
    setService('loading')
    setVision('unknown')
    const timeout = window.setTimeout(() => controller.abort(), 60000)
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/health`, { signal: controller.signal })
      const result = await response.json()
      if (healthAbort.current === controller) {
        const online = response.ok && result.status === 'ok'
        setService(online ? 'online' : 'offline')
        setVision(online ? result.classroom_analysis_provider === 'doubao-video-understanding' ? 'configured' : 'unavailable' : 'unknown')
      }
    } catch { if (healthAbort.current === controller) setService('offline') }
    finally { window.clearTimeout(timeout) }
  }, [])
  useEffect(() => { void checkService(); return () => { healthAbort.current?.abort(); healthAbort.current = null } }, [checkService])
  useEffect(() => {
    const change = () => { setPage(pageFromHash()); window.scrollTo({ top: 0 }); document.getElementById('page-heading')?.focus() }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  useEffect(() => { document.title = `${pageNames[page]} · AI 数字教师` }, [page])
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (active) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect)
  }, [active])
  useEffect(() => {
    if (!classroom.report || !classroom.sessionId || savedSession.current === classroom.sessionId || classroom.monitoringStatus !== 'finished') return
    savedSession.current = classroom.sessionId
    const entry: ArchivedClass = { id: classroom.sessionId, startedAt: classroom.startedAt, endedAt: new Date().toISOString(), elapsed: classroom.elapsed, sampleCount: classroom.sampleCount, context, report: classroom.report }
    const next = [entry, ...history.filter(h => h.id !== entry.id)].slice(0, 30)
    setHistory(next)
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { setStorageNotice('浏览器存储空间不足或不可用，本次报告仅保留在当前页面。请在离开前导出。') }
    if (page === 'live') navigate('analysis')
  }, [classroom.report, classroom.sessionId, classroom.monitoringStatus, classroom.startedAt, classroom.elapsed, classroom.sampleCount, context, history, page, navigate])
  const saveSettings = (value: WorkspaceSettings) => {
    if (Object.values(value).some(v => !v.trim())) return false
    setSettings(value)
    if (!active) setContext(value)
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(value)); return true }
    catch { setStorageNotice('浏览器存储不可用，设置仅对本次打开有效。'); return false }
  }
  const start = () => { setContext({ ...settings }); void classroom.startMonitoring() }
  const finish = () => {
    if (window.confirm('结束本次课堂观察并生成报告？摄像头将关闭，课堂记录会保存到本机历史。')) void classroom.finishMonitoring()
  }
  return <Shell page={page} navigate={navigate} settings={settings} alerts={classroom.alertCount} monitoring={classroom.monitoringStatus === 'monitoring'}>
    <div className="page-heading"><div><h1 id="page-heading" tabIndex={-1}>{page === 'overview' ? '课堂观察工作台' : pageNames[page]}</h1><p>{descriptions[page]}</p></div><div className="page-actions"><Badge tone={service === 'online' ? 'success' : service === 'offline' ? 'warning' : 'neutral'}>{service === 'online' ? '服务已连接' : service === 'offline' ? '服务待连接' : '正在连接服务'}</Badge></div></div>
    {storageNotice && <div className="notice warning" role="status"><CircleAlert size={18} />{storageNotice}</div>}
    {classroom.errorMessage && <div className="notice error" role="alert"><CircleAlert size={18} />{classroom.errorMessage}</div>}
    {active && page !== 'live' && <button className="ongoing-banner" onClick={() => navigate('live')}><RefreshCw size={16} className={classroom.isAnalyzing ? 'spin' : ''} /><span>{context.classroom} · 课堂会话保持中，切换页面不会结束观察</span><strong>返回课堂</strong><ArrowRight size={16} /></button>}
    {page === 'overview' && <Dashboard classroom={classroom} history={history} settings={active ? context : settings} navigate={navigate} service={service} vision={vision} refresh={() => void checkService()} />}
    <div hidden={page !== 'live'}><LiveClassroom classroom={classroom} context={context} onStart={start} onFinish={finish} /></div>
    {page === 'analysis' && <Analysis events={classroom.logs.map(l => l.event)} report={classroom.report} loading={classroom.reportLoading} samples={classroom.sampleCount} goLive={() => navigate('live')} />}
    {page === 'events' && <EventsPage events={classroom.logs.map(l => l.event)} context={context} goLive={() => navigate('live')} />}
    {page === 'history' && <HistoryPage records={history} goLive={() => navigate('live')} />}
    {page === 'settings' && <SettingsPage settings={settings} save={saveSettings} status={service} vision={vision} refresh={() => void checkService()} />}
  </Shell>
}
