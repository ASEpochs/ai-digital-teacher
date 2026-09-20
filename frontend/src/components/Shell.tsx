import { Activity, BookOpenCheck, ChevronRight, ClipboardList, History, LayoutDashboard, Menu, MonitorPlay, Settings2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { pageNames, type Page, type WorkspaceSettings } from '../platform'

const navigation = [
  { id: 'overview', icon: LayoutDashboard }, { id: 'live', icon: MonitorPlay },
  { id: 'events', icon: ClipboardList }, { id: 'analysis', icon: Activity },
  { id: 'history', icon: History }, { id: 'settings', icon: Settings2 },
] as const

export function Shell({ page, navigate, settings, alerts, monitoring, children }: {
  page: Page; navigate: (page: Page) => void; settings: WorkspaceSettings
  alerts: number; monitoring: boolean; children: ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [now, setNow] = useState(new Date())
  const sidebar = useRef<HTMLElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id) }, [])
  useEffect(() => { setMenuOpen(false) }, [page])
  useEffect(() => {
    if (!menuOpen) return
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Wait until the mobile drawer is visible before moving keyboard focus.
    const focusTimer = window.setTimeout(() => sidebar.current?.querySelector<HTMLButtonElement>('.close-menu')?.focus(), 200)
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); toggle.current?.focus() }
      if (event.key !== 'Tab') return
      const controls = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a, button') ?? []).filter(el => el.getClientRects().length)
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', trap)
    const desktop = window.matchMedia('(min-width: 761px)')
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false) }
    desktop.addEventListener('change', closeOnDesktop)
    return () => { window.clearTimeout(focusTimer); document.body.style.overflow = oldOverflow; window.removeEventListener('keydown', trap); desktop.removeEventListener('change', closeOnDesktop) }
  }, [menuOpen])

  return <div className="app-shell">
    <a href="#main-content" className="skip-link" onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus() }}>跳转到内容</a>
    {menuOpen && <button className="nav-overlay" tabIndex={-1} aria-label="关闭导航遮罩" onClick={() => { setMenuOpen(false); toggle.current?.focus() }} />}
    <aside ref={sidebar} id="sidebar" className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="工作区导航">
      <div className="brand-row"><a className="brand" href="#overview"><BookOpenCheck size={28} /><span>数字教师<small>课堂观察系统</small></span></a><button className="icon-button close-menu" aria-label="关闭导航" onClick={() => { setMenuOpen(false); toggle.current?.focus() }}><X size={20} /></button></div>
      <div className="workspace-name"><span>当前工作区</span><strong title={settings.school}>{settings.school}</strong></div>
      <nav aria-label="主导航">{navigation.map(({ id, icon: Icon }, i) => <a key={id} href={`#${id}`} aria-current={page === id ? 'page' : undefined} className={`nav-item ${page === id ? 'active' : ''} ${i === 4 ? 'nav-separator' : ''}`} onClick={() => setMenuOpen(false)}><Icon size={18} /><span>{pageNames[id]}</span>{id === 'events' && alerts > 0 && <span className="nav-count">{alerts}</span>}{id === 'live' && monitoring && <i className="status-dot online" />}</a>)}</nav>
      <div className="sidebar-bottom"><span>本机工作区</span><p>课堂报告保存在当前浏览器。</p><button className="text-button" onClick={() => navigate('settings')}>设备与使用说明<ChevronRight size={14} /></button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="topbar-left"><button ref={toggle} className="icon-button menu-toggle" aria-label="打开导航" aria-controls="sidebar" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={21} /></button><span className="breadcrumb-root">课堂观察</span><ChevronRight size={14} /><strong>{pageNames[page]}</strong></div><div className="topbar-right"><time dateTime={now.toISOString()}>{now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</time><span className="observer-label">观察员：{settings.observer}</span></div></header>
      <main id="main-content" tabIndex={-1} className="main-content">{children}<footer className="page-footer"><span>数字教师 · 课堂观察系统</span><span>辅助观察，人工复核</span></footer></main>
    </div>
  </div>
}
