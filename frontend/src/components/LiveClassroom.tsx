import { Camera, CheckCircle2, Expand, ImageUp, Pause, Play, RefreshCw, ScanLine, ShieldCheck, Square, SwitchCamera, UserRound, Volume2 } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ClassroomController } from '../hooks/useClassroom'
import { formatTime, statusText, type WorkspaceSettings } from '../platform'
import { Badge, Panel } from './ui'
import { EventList } from './EventList'

export function LiveClassroom({ classroom: c, context, onStart, onFinish }: { classroom: ClassroomController; context: WorkspaceSettings; onStart: () => void; onFinish: () => void }) {
  const stage = useRef<HTMLDivElement>(null)
  const [displayNotice, setDisplayNotice] = useState('')
  const canStart = ['idle', 'finished', 'error'].includes(c.monitoringStatus)
  const ongoing = ['monitoring', 'paused'].includes(c.monitoringStatus)
  const teacherStatus = { empty: '待设置', preparing: '上传中', idle: '已就绪', speaking: '提醒中', failed: '上传失败' }[c.teacherStatus]
  const normalStudents = new Set(c.activeEvents.filter(e => e.severity === 'info').flatMap(e => e.students.map(s => s.id)))
  const attentionStudents = new Set(c.activeEvents.filter(e => e.severity !== 'info').flatMap(e => e.students.map(s => s.id)))
  return <>
    <div className="live-context"><div><span className="room-icon small"><MonitorIcon /></span><strong>{context.classroom}</strong><span className="context-divider" />{context.course}</div><span>{context.observer} · 本机摄像头</span></div>
    <div className={`live-layout ${!c.teacher ? 'needs-setup' : ''}`}><div className="live-primary"><section className="panel video-panel"><header className="panel-header"><div className="inline-heading"><h2>实时课堂画面</h2><Badge tone={c.monitoringStatus === 'monitoring' ? 'success' : 'neutral'}>{statusText(c.monitoringStatus)}</Badge></div><span className="mono timer"><i className={c.monitoringStatus === 'monitoring' ? 'live-dot' : ''} />{formatTime(c.elapsed)}</span></header>
      <div ref={stage} className="video-stage"><div className="camera-frame" style={{ aspectRatio: c.cameraAspect, maxWidth: `min(100%, ${560 * c.cameraAspect}px)` }}>
        <video ref={c.cameraRef} autoPlay muted playsInline onResize={e => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) c.setCameraAspect(v.videoWidth / v.videoHeight) }} onLoadedMetadata={e => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) c.setCameraAspect(v.videoWidth / v.videoHeight) }} aria-label="课堂摄像头实时画面" />
        {c.activeEvents.flatMap(event => event.students.map(student => <div key={`${event.id}-${student.id}`} className={`student-marker ${event.severity}`} style={{ left: `${student.rect.x * 100}%`, top: `${student.rect.y * 100}%`, width: `${student.rect.width * 100}%`, height: `${student.rect.height * 100}%` }}><span>{student.label} · {event.behavior}</span></div>))}
        {!c.streamRef.current && <div className="video-placeholder"><div className="viewfinder"><Camera size={35} strokeWidth={1.3} /></div><h3>{c.monitoringStatus === 'finished' ? '本次课堂观察已结束' : '准备好，观察课堂的每一个瞬间'}</h3><p>{c.monitoringStatus === 'finished' ? '前往 AI 课堂分析查看本次报告，或开启新的课堂。' : '上传监督员照片，允许摄像头访问，即可开始。'}</p><div className="camera-capabilities"><span><CheckCircle2 size={14} />手机后置 / 电脑摄像头</span><span><ShieldCheck size={14} />仅按间隔分析画面</span></div></div>}
        {c.currentSpeech && <div className="subtitle"><Volume2 size={17} />{c.currentSpeech.speech}</div>}
      </div><canvas ref={c.canvasRef} hidden />{c.streamRef.current && <div className="video-overlay-bar"><span><Camera size={13} />{c.activeCameraFacing === 'environment' ? '后置摄像头' : c.activeCameraFacing === 'user' ? '前置摄像头' : '已连接摄像头'}</span><button aria-label="全屏查看摄像头" onClick={() => { if (stage.current?.requestFullscreen) void stage.current.requestFullscreen().catch(() => setDisplayNotice('当前浏览器暂不支持全屏，请横屏查看。')); else setDisplayNotice('当前浏览器暂不支持全屏，请横屏查看。') }}><Expand size={16} /></button></div>}</div>
      <div className="class-controls">{canStart && <><button className="button primary" disabled={c.teacherStatus !== 'idle'} onClick={onStart}><Play size={16} />{c.monitoringStatus === 'finished' ? '开启新的课堂' : '开启课堂监督'}</button><button className="button subtle" onClick={() => c.setCameraPreference(p => p === 'environment' ? 'user' : 'environment')}><SwitchCamera size={16} />{c.cameraPreference === 'environment' ? '后置优先' : '前置优先'}</button></>}
        {c.monitoringStatus === 'requesting' && <button className="button" disabled><RefreshCw className="spin" size={16} />正在连接摄像头</button>}
        {c.monitoringStatus === 'monitoring' && <button className="button" disabled={c.isSwitchingCamera} onClick={c.pauseMonitoring}><Pause size={16} />暂停观察</button>}
        {c.monitoringStatus === 'paused' && <button className="button primary" disabled={c.isSwitchingCamera} onClick={c.resumeMonitoring}><Play size={16} />继续观察</button>}
        {ongoing && c.availableCameraCount > 1 && <button className="button" disabled={c.isSwitchingCamera} onClick={() => void c.switchCamera()}><SwitchCamera size={16} />{c.isSwitchingCamera ? '切换中…' : '切换摄像头'}</button>}
        {ongoing && <button className="button danger" disabled={c.isSwitchingCamera} onClick={onFinish}><Square size={14} />结束并生成报告</button>}
        {c.monitoringStatus === 'finishing' && <button className="button" disabled><RefreshCw size={16} className="spin" />生成报告中</button>}
        {canStart && !c.teacher && <span className="control-hint">请先上传监督员照片</span>}
      </div>{displayNotice && <p className="inline-notice">{displayNotice}</p>}
      <div className="analysis-status" role="status">{c.isAnalyzing ? <RefreshCw className="spin" size={16} /> : <ScanLine size={16} />}<span>{c.analysisMessage}</span><strong>{c.sampleCount} 次分析</strong></div>
    </section>
    <Panel title="课堂事件时间轴" subtitle="正常行为记录 · 异常行为提醒" action={<Badge>{c.logs.length} 条</Badge>} className="live-timeline"><EventList events={c.logs.map(l => l.event)} compact /></Panel></div>
    <aside className="live-aside"><Panel className="observation-panel" title="AI 实时观察" action={<Badge tone={c.isAnalyzing ? 'success' : 'neutral'}>{c.isAnalyzing ? '分析中' : '画面识别'}</Badge>}><div className="live-stats"><div><span>当前可见学生</span><strong>{c.sampleCount ? c.visibleStudents : '—'}<small>人</small></strong></div><div><span>需关注学生</span><strong className="amber-text">{c.sampleCount ? attentionStudents.size : '—'}<small>人</small></strong></div></div><div className="observation-row"><span className="legend-dot mint-dot" /><span>正常学习状态</span><strong>{[...normalStudents].filter(id => !attentionStudents.has(id)).length} 人</strong></div><div className="observation-row"><span className="legend-dot amber-dot" /><span>本次累计异常</span><strong>{c.alertCount} 项</strong></div><div className="ai-note"><ScanLine size={18} /><div><strong>观察提示</strong><p>{c.activeEvents.length ? [...new Set(c.activeEvents.map(e => e.behavior))].join('；') : '等待可用画面，AI 识别后将在此展示行为观察结果。'}</p></div></div><p className="metric-footnote">画面内识别人数不等于到课人数。当前版本不提供考勤、教师行为评分或教学质量评分。</p></Panel>
      <Panel className="teacher-panel" title="数字课堂监督员" action={<Badge tone={c.teacher ? 'success' : 'neutral'}>{teacherStatus}</Badge>}><div className="teacher-profile"><div className={`teacher-photo ${c.teacherStatus === 'speaking' ? 'speaking' : ''}`}>{c.teacher ? <img src={c.teacher.image_url} alt="课堂监督员照片" /> : <UserRound size={35} strokeWidth={1.4} />}</div><div><h3>{c.teacher ? '监督员已就绪' : '设置课堂监督员'}</h3><p>以照片展示，异常时语音提醒</p><label className="text-button upload-label"><ImageUp size={14} />{c.teacherStatus === 'preparing' ? '上传中…' : c.teacher ? '更换照片' : '上传教师照片'}<input type="file" aria-label="上传教师照片" accept="image/jpeg,image/png,image/webp" disabled={c.teacherStatus === 'preparing' || ongoing || c.monitoringStatus === 'requesting' || c.monitoringStatus === 'finishing'} onChange={e => { void c.handleUpload(e.target.files?.[0]); e.target.value = '' }} /></label></div></div><p className="upload-tip">JPG / PNG / WebP · 最大 8MB</p><button className="button full-width" disabled={!c.teacher || c.teacherStatus !== 'idle'} onClick={c.testTeacherVoice}><Volume2 size={16} />测试语音提醒</button><div className="speech-feedback" role="status">{c.currentSpeech?.speech || c.speechNotice || '正常学习不播报，仅对异常行为进行提醒。'}</div>{c.manualSpeech && <button className="button amber full-width" onClick={c.playManualSpeech}><Volume2 size={16} />播放当前提醒</button>}</Panel>
      <div className="quiet-note"><ShieldCheck size={18} /><p>请在获得课堂拍摄授权后使用。AI 记录用于教学辅助，请结合现场情况进行复核。</p></div>
    </aside></div>
  </>
}
function MonitorIcon() { return <Camera size={18} /> }
