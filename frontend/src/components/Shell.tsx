import { Activity, Bell, BookOpenCheck, Building2, ChevronRight, CircleHelp, ClipboardList, History, LayoutDashboard, Menu, MonitorPlay, Settings2, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { pageNames, type Page, type WorkspaceSettings } from '../platform'
const navigation = [
  { id: 'overview', icon: LayoutDashboard }, { id: 'live', icon: MonitorPlay }, { id: 'analysis', icon: Activity },
  { id: 'events', icon: ClipboardList }, { id: 'history', icon: History }, { id: 'settings', icon: Settings2 },
] as const

export function Shell({ page, navigate, settings, alerts, monitoring, children }: { page: Page; navigate: (page: Page) => void; settings: WorkspaceSettings; alerts: number; monitoring: boolean; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [now, setNow] = useState(new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id) }, [])
  useEffect(() => { setMenuOpen(false) }, [page])
  useEffect(() => { const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [])
  return <div className="app-shell">
    <a href="#main-content" className="skip-link" onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus() }}>跳转到内容</a>
    {menuOpen && <button className="nav-overlay" aria-label="关闭导航" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <a className="brand" href="#overview"><span className="brand-symbol"><BookOpenCheck size={25} /></span><span>数字教师<small>SMART CLASSROOM</small></span></a>
      <div className="workspace-switch"><span className="school-icon"><Building2 size={18} /></span><div><strong title={settings.school}>{settings.school}</strong><small>课堂观察工作区</small></div></div>
      <p className="nav-label">教学管理</p>
      <nav aria-label="主导航">{navigation.map(({ id, icon: Icon }) => <a key={id} href={`#${id}`} aria-current={page === id ? 'page' : undefined} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => setMenuOpen(false)}><Icon size={19} /><span>{pageNames[id]}</span>{id === 'events' && alerts > 0 && <span className="nav-count">{alerts}</span>}{id === 'live' && monitoring && <i className="live-dot" />}</a>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><ShieldCheck size={20} /><strong>让观察更有依据</strong><p>关注课堂中的每一个成长瞬间</p></div><button className="help-link" onClick={() => navigate('settings')}><CircleHelp size={17} />使用说明与工作区设置<ChevronRight size={14} /></button><small>AI 数字教师 · 摄像头版</small></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="topbar-left"><button className="icon-button menu-toggle" aria-label={menuOpen ? '关闭导航' : '打开导航'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21} /> : <Menu size={21} />}</button><span className="breadcrumb-root">教学管理</span><ChevronRight size={14} /><strong>{pageNames[page]}</strong></div><div className="topbar-right"><time>{now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}<span>{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span></time><button className="icon-button notification" aria-label={`查看课堂事件，${alerts} 项异常`} onClick={() => navigate('events')}><Bell size={19} />{alerts > 0 && <i />}</button><button className="profile" onClick={() => navigate('settings')} title="编辑观察员信息"><span className="avatar">{settings.observer.slice(0, 1)}</span><span><strong>{settings.observer}</strong><small>本机工作区</small></span></button></div></header>
      <main id="main-content" tabIndex={-1} className="main-content">{children}<footer className="page-footer"><span>AI 数字教师课堂监督系统</span><span>辅助观察 · 客观记录 · 人工复核</span></footer></main>
    </div>
  </div>
}
