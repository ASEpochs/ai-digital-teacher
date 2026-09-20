import { Camera, Expand, Pause, Play, RefreshCw, ScanLine, Square, SwitchCamera, Volume2 } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ClassroomController } from '../hooks/useClassroom'
import { formatTime, statusText, type WorkspaceSettings } from '../platform'
import { Badge } from './ui'
import { EventList } from './EventList'
import { TeacherControls } from './TeacherControls'

export function LiveClassroom({ classroom: c, context, onStart, onFinish }: {
  classroom: ClassroomController; context: WorkspaceSettings; onStart: () => void; onFinish: () => void
}) {
  const stage = useRef<HTMLDivElement>(null)
  const [displayNotice, setDisplayNotice] = useState('')
  const canStart = ['idle', 'finished', 'error'].includes(c.monitoringStatus)
  const ongoing = ['monitoring', 'paused'].includes(c.monitoringStatus)
  const normalStudents = new Set(c.activeEvents.filter(e => e.severity === 'info').flatMap(e => e.students.map(s => s.id)))
  const attentionStudents = new Set(c.activeEvents.filter(e => e.severity !== 'info').flatMap(e => e.students.map(s => s.id)))
  const currentAlerts = c.activeEvents.filter(e => e.severity !== 'info')
  return <>
    <div className="live-context"><div><strong>{context.classroom}</strong><span>{context.course}</span></div><span>观察员：{context.observer}</span></div>
    <div className={`live-layout ${!c.teacher ? 'needs-setup' : ''}`}>
      <section className="video-panel">
        <header className="panel-header"><div className="inline-heading"><h2>课堂画面</h2><Badge tone={c.monitoringStatus === 'monitoring' ? 'success' : 'neutral'}>{statusText(c.monitoringStatus)}</Badge></div><span className="mono timer">{formatTime(c.elapsed)}</span></header>
        <div ref={stage} className="video-stage">
          <div className="camera-frame" style={{ aspectRatio: c.cameraAspect, maxWidth: `min(100%, ${560 * c.cameraAspect}px)` }}>
            <video ref={c.cameraRef} autoPlay muted playsInline
              onResize={e => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) c.setCameraAspect(v.videoWidth / v.videoHeight) }}
              onLoadedMetadata={e => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) c.setCameraAspect(v.videoWidth / v.videoHeight) }}
              aria-label="课堂摄像头实时画面" />
            {c.activeEvents.flatMap(event => event.students.map(student => <div key={`${event.id}-${student.id}`} className={`student-marker ${event.severity}`} style={{ left: `${student.rect.x * 100}%`, top: `${student.rect.y * 100}%`, width: `${student.rect.width * 100}%`, height: `${student.rect.height * 100}%` }}><span>{student.label} · {event.behavior}</span></div>))}
            {!c.streamRef.current && <div className="video-placeholder"><Camera size={34} strokeWidth={1.5} /><h3>{c.monitoringStatus === 'finished' ? '本次课堂已结束' : '摄像头尚未开启'}</h3><p>{c.monitoringStatus === 'finished' ? '课堂报告已保存，可查看分析或开始新的课堂。' : c.teacher ? '检查镜头方向和语音，点击下方按钮开始观察。' : '请先上传监督员照片，再开启课堂观察。'}</p><span>手机支持后置镜头 · 不采集麦克风声音</span></div>}
            {c.currentSpeech && <div className="subtitle"><Volume2 size={17} />{c.currentSpeech.speech}</div>}
          </div>
          <canvas ref={c.canvasRef} hidden />
          {c.streamRef.current && <div className="video-overlay-bar"><span><Camera size={14} />{c.activeCameraFacing === 'environment' ? '后置摄像头' : c.activeCameraFacing === 'user' ? '前置摄像头' : '已连接摄像头'}</span><button aria-label="全屏查看摄像头" onClick={() => {
            if (stage.current?.requestFullscreen) void stage.current.requestFullscreen().catch(() => setDisplayNotice('当前浏览器暂不支持全屏，请横屏查看。'))
            else setDisplayNotice('当前浏览器暂不支持全屏，请横屏查看。')
          }}><Expand size={18} /></button></div>}
        </div>
        <div className="class-controls">
          {canStart && <><button className="button primary" disabled={c.teacherStatus !== 'idle'} onClick={onStart}><Play size={16} />{c.monitoringStatus === 'finished' ? '开始新的课堂' : '开始课堂观察'}</button><button className="button" onClick={() => c.setCameraPreference(p => p === 'environment' ? 'user' : 'environment')}><SwitchCamera size={16} />{c.cameraPreference === 'environment' ? '后置优先' : '前置优先'}</button></>}
          {c.monitoringStatus === 'requesting' && <button className="button" disabled><RefreshCw className="spin" size={16} />正在连接摄像头</button>}
          {c.monitoringStatus === 'monitoring' && <button className="button" disabled={c.isSwitchingCamera} onClick={c.pauseMonitoring}><Pause size={16} />暂停观察</button>}
          {c.monitoringStatus === 'paused' && <button className="button primary" disabled={c.isSwitchingCamera} onClick={c.resumeMonitoring}><Play size={16} />继续观察</button>}
          {ongoing && c.availableCameraCount > 1 && <button className="button" disabled={c.isSwitchingCamera} onClick={() => void c.switchCamera()}><SwitchCamera size={16} />{c.isSwitchingCamera ? '切换中…' : '切换摄像头'}</button>}
          {ongoing && <button className="button danger finish-button" disabled={c.isSwitchingCamera} onClick={onFinish}><Square size={14} />结束并生成报告</button>}
          {c.monitoringStatus === 'finishing' && <button className="button" disabled><RefreshCw size={16} className="spin" />生成报告中</button>}
          {canStart && !c.teacher && <span className="control-hint">请先设置监督员照片</span>}
        </div>
        {displayNotice && <p className="inline-notice">{displayNotice}</p>}
        <div className="analysis-status" role="status">{c.isAnalyzing ? <RefreshCw className="spin" size={16} /> : <ScanLine size={16} />}<span>{c.analysisMessage}</span><strong>{c.sampleCount} 次分析</strong></div>
      </section>
      <aside className="live-aside">
        <TeacherControls classroom={c} />
        <section className="observation-panel" aria-labelledby="observation-title">
          <div className="section-heading"><h2 id="observation-title">当前画面观察</h2><Badge>{c.isAnalyzing ? '分析中' : ongoing ? '已开启' : '待开始'}</Badge></div>
          {c.sampleCount ? <>
            <div className="live-stats"><div><span>可见学生</span><strong>{c.visibleStudents}<small>人</small></strong></div><div><span>需关注</span><strong className="amber-text">{attentionStudents.size}<small>人</small></strong></div></div>
            <div className="observation-row"><span>正常学习状态</span><strong>{[...normalStudents].filter(id => !attentionStudents.has(id)).length} 人</strong></div>
            <div className="observation-row"><span>累计异常记录</span><strong>{c.alertCount} 项</strong></div>
            {currentAlerts.length ? <div className="current-alerts">{currentAlerts.map(event => <div key={event.id}><strong>{event.behavior}</strong><p>{event.students.map(s => s.label).join('、')}</p></div>)}</div> : <p className="muted">{c.activeEvents.length ? '当前画面未识别到需关注的行为。' : '当前暂无可用识别结果，等待下一次分析。'}</p>}
          </> : <p className="observation-empty">开始观察并完成首次分析后，显示当前画面的学生状态。</p>}
          <p className="metric-footnote">识别人数不等于到课人数。行为结果需结合现场情况复核。</p>
        </section>
      </aside>
      <details className="live-timeline">
        <summary><span>课堂事件时间轴</span><span>{c.logs.length} 条记录</span></summary>
        <EventList events={c.logs.map(l => l.event)} compact />
      </details>
    </div>
  </>
}
