import {
  AlertCircle, BarChart3, BookOpenCheck, Camera, CheckCircle2, Clock3,
  ImageUp, Pause, Play, RefreshCw, ShieldCheck, Square, SwitchCamera, UserRound, Volume2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { countVideoInputs, requestCamera, type CameraFacingMode, type CameraRequestResult } from './camera'
import { buildLocalReport } from './reportFallback'
import type { BehaviorEvent, ClassroomReport, LiveFrameAnalysis, LiveSession, TeacherAsset, TeacherStatus } from './types'

type MonitoringStatus = 'idle' | 'requesting' | 'monitoring' | 'paused' | 'finishing' | 'finished' | 'error'
interface LogEntry { key: string; event: BehaviorEvent }

function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(Math.floor(safe % 60)).padStart(2, '0')}`
}

const teacherStatusText = (status: TeacherStatus) => ({
  empty: '未上传照片', preparing: '正在上传', idle: '待机', speaking: '提醒中', failed: '上传失败',
})[status]

const monitoringStatusText = (status: MonitoringStatus) => ({
  idle: '准备中', requesting: '正在连接摄像头', monitoring: '监督中', paused: '已暂停',
  finishing: '正在生成报告', finished: '已结束', error: '连接异常',
})[status]

function frameToBlob(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) return Promise.reject(new Error('摄像头画面尚未准备完成'))
  canvas.width = Math.min(960, video.videoWidth)
  canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth)
  const context = canvas.getContext('2d')
  if (!context) return Promise.reject(new Error('浏览器无法截取摄像头画面'))
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('摄像头画面压缩失败')),
    'image/jpeg', 0.78,
  ))
}

function App() {
  const cameraRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const captureTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const statusRef = useRef<MonitoringStatus>('idle')
  const sessionRef = useRef<LiveSession | null>(null)
  const analysisBusyRef = useRef(false)
  const intervalSecondsRef = useRef(3)
  const accumulatedSecondsRef = useRef(0)
  const activeSegmentStartedRef = useRef(0)
  const knownEventIdsRef = useRef(new Set<string>())
  const allEventsRef = useRef(new Map<string, BehaviorEvent>())
  const speechBusyRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const [monitoringStatus, setMonitoringStatus] = useState<MonitoringStatus>('idle')
  const [teacher, setTeacher] = useState<TeacherAsset | null>(null)
  const [teacherStatus, setTeacherStatus] = useState<TeacherStatus>('empty')
  const [teacherMessage, setTeacherMessage] = useState('请上传一张教师正面照片作为课堂监督员')
  const [errorMessage, setErrorMessage] = useState('')
  const [analysisMessage, setAnalysisMessage] = useState('上传教师照片后，即可开启摄像头课堂监督')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [cameraAspect, setCameraAspect] = useState(16 / 9)
  const [activeEvents, setActiveEvents] = useState<BehaviorEvent[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [speechQueue, setSpeechQueue] = useState<BehaviorEvent[]>([])
  const [currentSpeech, setCurrentSpeech] = useState<BehaviorEvent | null>(null)
  const [speechNotice, setSpeechNotice] = useState('')
  const [report, setReport] = useState<ClassroomReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [sampleCount, setSampleCount] = useState(0)
  const [cameraPreference, setCameraPreference] = useState<CameraFacingMode>('environment')
  const [activeCameraFacing, setActiveCameraFacing] = useState<CameraFacingMode | null>(null)
  const [availableCameraCount, setAvailableCameraCount] = useState(0)
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false)

  const currentElapsed = useCallback(() => {
    if (statusRef.current !== 'monitoring' || !activeSegmentStartedRef.current) return accumulatedSecondsRef.current
    return accumulatedSecondsRef.current + (performance.now() - activeSegmentStartedRef.current) / 1000
  }, [])

  const clearCaptureTimer = () => {
    if (captureTimerRef.current !== null) globalThis.clearTimeout(captureTimerRef.current)
    captureTimerRef.current = null
  }

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (cameraRef.current) cameraRef.current.srcObject = null
    setActiveCameraFacing(null)
    setAvailableCameraCount(0)
  }

  const attachCamera = async (result: CameraRequestResult, requestedFacing: CameraFacingMode) => {
    const video = cameraRef.current
    if (!video) {
      result.stream.getTracks().forEach((track) => track.stop())
      throw new Error('摄像头预览区域尚未准备完成')
    }
    streamRef.current = result.stream
    video.srcObject = result.stream
    await video.play()
    if (video.videoWidth && video.videoHeight) setCameraAspect(video.videoWidth / video.videoHeight)
    const resolvedFacing = result.facingMode ?? requestedFacing
    setActiveCameraFacing(resolvedFacing)
    setAvailableCameraCount(await countVideoInputs(navigator.mediaDevices))
    return resolvedFacing
  }

  const stopSpeech = useCallback(() => {
    window.speechSynthesis?.cancel()
    audioRef.current?.pause()
    audioRef.current = null
    speechBusyRef.current = false
    setSpeechQueue([])
    setCurrentSpeech(null)
    setTeacherStatus(teacher ? 'idle' : 'empty')
  }, [teacher])

  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      if (statusRef.current === 'monitoring') setElapsed(currentElapsed())
    }, 250)
    return () => globalThis.clearInterval(timer)
  }, [currentElapsed])

  useEffect(() => () => {
    clearCaptureTimer()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    window.speechSynthesis?.cancel()
    audioRef.current?.pause()
  }, [])

  const speakWithBrowser = useCallback((text: string) => new Promise<void>((resolve) => {
    if (typeof window.speechSynthesis?.speak !== 'function' || typeof SpeechSynthesisUtterance === 'undefined') {
      globalThis.setTimeout(resolve, Math.max(1600, text.length * 190)); return
    }
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'zh-CN'; utterance.rate = 0.95
    utterance.onend = () => resolve(); utterance.onerror = () => resolve()
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance)
  }), [])

  const playAudioUrl = useCallback((url: string) => new Promise<boolean>((resolve) => {
    const audio = new Audio(url); audioRef.current = audio
    audio.onended = () => resolve(true); audio.onerror = () => resolve(false)
    audio.play().catch(() => resolve(false))
  }), [])

  const playReminder = useCallback(async (event: BehaviorEvent) => {
    speechBusyRef.current = true; setCurrentSpeech(event); setTeacherStatus('speaking')
    setSpeechNotice('正在生成中文语音提醒…')
    try {
      const audio = await api.synthesize(event.speech)
      setSpeechNotice(audio.message || '正在播放课堂提醒')
      if (audio.audio_url) {
        const played = await playAudioUrl(audio.audio_url)
        if (!played) await speakWithBrowser(event.speech)
      } else await speakWithBrowser(event.speech)
    } catch (error) {
      setSpeechNotice(`云端语音暂不可用，已使用浏览器语音：${(error as Error).message}`)
      await speakWithBrowser(event.speech)
    } finally {
      audioRef.current = null; speechBusyRef.current = false; setCurrentSpeech(null)
      setTeacherStatus(teacher ? 'idle' : 'empty')
    }
  }, [playAudioUrl, speakWithBrowser, teacher])

  useEffect(() => {
    if (speechBusyRef.current || speechQueue.length === 0) return
    const [next, ...rest] = speechQueue; setSpeechQueue(rest); void playReminder(next)
  }, [playReminder, speechQueue])

  const applyFrameAnalysis = (result: LiveFrameAnalysis) => {
    setSampleCount(result.sample_count); setAnalysisMessage(result.message); setActiveEvents(result.events)
    const newEvents: BehaviorEvent[] = []
    result.events.forEach((event) => {
      allEventsRef.current.set(event.id, event)
      if (!knownEventIdsRef.current.has(event.id)) {
        knownEventIdsRef.current.add(event.id); newEvents.push(event)
      }
    })
    setLogs((previous) => {
      const incoming = new Map(result.events.map((event) => [event.id, event]))
      const updated = previous.map((entry) => ({ ...entry, event: incoming.get(entry.event.id) ?? entry.event }))
      return [...newEvents.map((event) => ({ key: event.id, event })).reverse(), ...updated]
    })
    const spoken = new Set<string>()
    const reminders = newEvents.filter((event) => {
      if (event.severity === 'info' || !event.speech.trim() || spoken.has(event.speech)) return false
      spoken.add(event.speech); return true
    })
    if (reminders.length) setSpeechQueue((previous) => [...previous, ...reminders])
  }

  const scheduleNextAnalysis = (delay: number) => {
    clearCaptureTimer()
    captureTimerRef.current = globalThis.setTimeout(() => void analyzeCurrentFrame(), delay)
  }

  async function analyzeCurrentFrame() {
    if (statusRef.current !== 'monitoring' || analysisBusyRef.current) return
    const currentSession = sessionRef.current; const video = cameraRef.current; const canvas = canvasRef.current
    if (!currentSession || !video || !canvas) return
    analysisBusyRef.current = true; setIsAnalyzing(true)
    try {
      const image = await frameToBlob(video, canvas)
      const result = await api.analyzeLiveFrame(currentSession.session_id, image, currentElapsed())
      if (statusRef.current === 'monitoring') applyFrameAnalysis(result)
    } catch (error) {
      setAnalysisMessage(`本次画面分析未完成，将自动继续：${(error as Error).message}`)
    } finally {
      analysisBusyRef.current = false; setIsAnalyzing(false)
      if (statusRef.current === 'monitoring') scheduleNextAnalysis(intervalSecondsRef.current * 1000)
    }
  }

  const resetClassroomState = () => {
    stopSpeech(); clearCaptureTimer(); closeCamera()
    knownEventIdsRef.current = new Set(); allEventsRef.current = new Map()
    accumulatedSecondsRef.current = 0; activeSegmentStartedRef.current = 0
    setElapsed(0); setActiveEvents([]); setLogs([]); setReport(null); setSampleCount(0); setErrorMessage('')
  }

  const startMonitoring = async () => {
    if (teacherStatus !== 'idle' || statusRef.current === 'requesting') return
    resetClassroomState(); statusRef.current = 'requesting'; setMonitoringStatus('requesting')
    setAnalysisMessage('正在请求摄像头权限…')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持摄像头访问，请使用最新版 Chrome 或 Edge')
      const camera = await requestCamera(navigator.mediaDevices, cameraPreference)
      await attachCamera(camera, cameraPreference)
      const created = await api.startLiveSession()
      sessionRef.current = created; intervalSecondsRef.current = created.analysis_interval_seconds
      statusRef.current = 'monitoring'; setMonitoringStatus('monitoring')
      activeSegmentStartedRef.current = performance.now(); setAnalysisMessage(created.message)
      scheduleNextAnalysis(350)
    } catch (error) {
      closeCamera(); sessionRef.current = null; statusRef.current = 'error'; setMonitoringStatus('error')
      setErrorMessage(`无法开启课堂监督：${(error as Error).message}`)
      setAnalysisMessage('请检查摄像头权限、设备占用情况和后端服务')
    }
  }

  const switchCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !streamRef.current || isSwitchingCamera) return
    const previousFacing = activeCameraFacing ?? cameraPreference
    const nextFacing: CameraFacingMode = previousFacing === 'environment' ? 'user' : 'environment'
    const wasMonitoring = statusRef.current === 'monitoring'
    clearCaptureTimer(); setIsSwitchingCamera(true); setErrorMessage('')
    setAnalysisMessage(`正在切换到${nextFacing === 'environment' ? '后置' : '前置'}摄像头…`)

    streamRef.current.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (cameraRef.current) cameraRef.current.srcObject = null

    try {
      const camera = await requestCamera(navigator.mediaDevices, nextFacing)
      const resolvedFacing = await attachCamera(camera, nextFacing)
      setCameraPreference(nextFacing)
      setAnalysisMessage(resolvedFacing === nextFacing
        ? `已切换到${nextFacing === 'environment' ? '后置' : '前置'}摄像头，课堂监督继续运行`
        : `设备没有${nextFacing === 'environment' ? '后置' : '前置'}摄像头，已继续使用当前可用摄像头`)
    } catch (switchError) {
      try {
        const restored = await requestCamera(navigator.mediaDevices, previousFacing)
        await attachCamera(restored, previousFacing)
        setAnalysisMessage(`无法切换摄像头，已恢复原摄像头：${(switchError as Error).message}`)
      } catch {
        closeCamera(); statusRef.current = 'error'; setMonitoringStatus('error')
        setErrorMessage(`摄像头切换失败：${(switchError as Error).message}`)
        setAnalysisMessage('请重新开启课堂监督并检查摄像头权限')
      }
    } finally {
      setIsSwitchingCamera(false)
      if (wasMonitoring && streamRef.current && statusRef.current === 'monitoring') scheduleNextAnalysis(250)
    }
  }

  const pauseMonitoring = () => {
    if (statusRef.current !== 'monitoring') return
    accumulatedSecondsRef.current = currentElapsed(); activeSegmentStartedRef.current = 0
    statusRef.current = 'paused'; setMonitoringStatus('paused'); setElapsed(accumulatedSecondsRef.current)
    setActiveEvents([]); clearCaptureTimer(); setAnalysisMessage('课堂监督已暂停，摄像头预览仍保持开启')
  }

  const resumeMonitoring = () => {
    if (statusRef.current !== 'paused') return
    statusRef.current = 'monitoring'; setMonitoringStatus('monitoring'); activeSegmentStartedRef.current = performance.now()
    setAnalysisMessage('课堂监督已继续，数字教师正在观察课堂画面'); scheduleNextAnalysis(200)
  }

  const finishMonitoring = async () => {
    const currentSession = sessionRef.current
    if (!currentSession || !['monitoring', 'paused'].includes(statusRef.current)) return
    if (statusRef.current === 'monitoring') accumulatedSecondsRef.current = currentElapsed()
    activeSegmentStartedRef.current = 0; statusRef.current = 'finishing'; setMonitoringStatus('finishing')
    setElapsed(accumulatedSecondsRef.current); clearCaptureTimer(); stopSpeech(); setActiveEvents([]); closeCamera()
    setReportLoading(true); setAnalysisMessage('课堂监督已结束，正在生成逐人行为报告…')
    try {
      setReport(await api.finishLiveSession(currentSession.session_id))
      setAnalysisMessage('课堂监督已结束，课堂行为报告已生成')
    } catch {
      const events = [...allEventsRef.current.values()]
      setReport(buildLocalReport(events, new Set(events.map((event) => event.id)), '课堂报告已根据本次摄像头监督记录生成。'))
      setAnalysisMessage('网络中断，已使用浏览器中的课堂记录生成报告')
    } finally {
      setReportLoading(false); statusRef.current = 'finished'; setMonitoringStatus('finished')
    }
  }

  const handleUpload = async (file?: File) => {
    if (!file) return
    setErrorMessage('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setErrorMessage('仅支持 JPG、PNG 或 WebP 图片'); return }
    if (file.size > 8 * 1024 * 1024) { setErrorMessage('教师照片不能超过 8MB'); return }
    setTeacherStatus('preparing'); setTeacherMessage('正在上传课堂监督员照片…')
    try {
      const asset = await api.uploadTeacher(file, undefined, 'static')
      setTeacher(asset); setTeacherStatus('idle'); setTeacherMessage('课堂监督员照片已就绪，可开启摄像头监督')
    } catch (error) {
      setTeacher(null); setTeacherStatus('failed'); setTeacherMessage('课堂监督员照片上传失败')
      setErrorMessage((error as Error).message)
    }
  }

  const testTeacherVoice = () => {
    if (!teacher || teacherStatus !== 'idle' || speechBusyRef.current) return
    void playReminder({ id: 'voice-preview', time: elapsed, duration: 3, students: [], behavior: '语音测试',
      speech: '同学们，请保持安静，集中注意力，认真完成学习任务。', severity: 'warning' })
  }

  const visibleStudents = new Set(activeEvents.flatMap((event) => event.students.map((student) => student.id))).size
  const alertCount = logs.filter((entry) => entry.event.severity !== 'info').length

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark"><BookOpenCheck size={25} /></div>
      <div><h1>AI 数字教师课堂监督系统</h1><p>摄像头监督 · 行为记录 · 智能语音提醒</p></div>
      <div className="system-badge"><ShieldCheck size={16} /> 摄像头智能监督</div>
    </header>
    <main className="workspace">
      {errorMessage && <div className="error-banner"><AlertCircle size={18} />{errorMessage}</div>}
      <div className={`analysis-banner ${isAnalyzing ? 'analyzing' : ''}`}>
        {isAnalyzing ? <RefreshCw className="spin" size={17} /> : <ShieldCheck size={17} />}
        <span>{analysisMessage}</span>{isAnalyzing && <strong>正在分析当前画面</strong>}
      </div>
      <section className="overview-strip">
        <div><span>课堂状态</span><strong className={monitoringStatus === 'monitoring' ? 'online' : ''}>{monitoringStatusText(monitoringStatus)}</strong></div>
        <div><span>画面分析</span><strong>{sampleCount} 次</strong></div>
        <div><span>当前可见学生</span><strong>{visibleStudents} 人</strong></div>
        <div><span>监督时长</span><strong>{formatTime(elapsed)}</strong></div>
      </section>
      <div className="classroom-grid">
        <section className="video-card panel">
          <div className="panel-heading"><div><span className="eyebrow">实时课堂画面</span><h2>{activeCameraFacing === 'environment' ? '后置摄像头' : activeCameraFacing === 'user' ? '前置摄像头' : '课堂摄像头'}</h2></div>
            <span className="live-status"><i className={monitoringStatus === 'monitoring' ? 'active' : ''} /> {monitoringStatusText(monitoringStatus)}</span></div>
          <div className="video-stage camera-stage"><div className="camera-frame" style={{ aspectRatio: cameraAspect }}>
            <video ref={cameraRef} autoPlay muted playsInline onLoadedMetadata={(event) => {
              const video = event.currentTarget; if (video.videoWidth && video.videoHeight) setCameraAspect(video.videoWidth / video.videoHeight)
            }} />
            {activeEvents.flatMap((event) => event.students.map((student) => <div key={`${event.id}-${student.id}`}
              className={`student-marker ${event.severity}`} style={{ left: `${student.rect.x * 100}%`, top: `${student.rect.y * 100}%`, width: `${student.rect.width * 100}%`, height: `${student.rect.height * 100}%` }}>
              <span>{student.label} · {event.behavior}</span></div>))}
            {!streamRef.current && <div className="video-placeholder"><Camera size={42} /><strong>摄像头尚未开启</strong>
              <span>手机默认使用后置摄像头，电脑自动使用可用摄像头<br />授权后可随时切换前后摄像头</span></div>}
            {isAnalyzing && <div className="frame-scanner"><i /></div>}
            {currentSpeech && <div className="subtitle"><Volume2 size={18} />{currentSpeech.speech}</div>}
          </div><canvas ref={canvasRef} hidden /></div>
          <div className="class-controls">
            {['idle', 'finished', 'error'].includes(monitoringStatus) && <button className="primary-button" disabled={teacherStatus !== 'idle'} onClick={() => void startMonitoring()}>
              <Camera size={17} />{monitoringStatus === 'finished' ? '开始新的课堂监督' : '开启课堂监督'}</button>}
            {['idle', 'finished', 'error'].includes(monitoringStatus) && <button className="camera-preference" onClick={() => setCameraPreference((current) => current === 'environment' ? 'user' : 'environment')}>
              <SwitchCamera size={17} />{cameraPreference === 'environment' ? '后置优先' : '前置优先'}</button>}
            {monitoringStatus === 'requesting' && <button disabled><RefreshCw className="spin" size={17} />连接中</button>}
            {monitoringStatus === 'monitoring' && <button onClick={pauseMonitoring}><Pause size={17} />暂停监督</button>}
            {monitoringStatus === 'paused' && <button className="primary-button" onClick={resumeMonitoring}><Play size={17} />继续监督</button>}
            {['monitoring', 'paused'].includes(monitoringStatus) && availableCameraCount > 1 && <button disabled={isSwitchingCamera} onClick={() => void switchCamera()}>
              {isSwitchingCamera ? <RefreshCw className="spin" size={17} /> : <SwitchCamera size={17} />}{isSwitchingCamera ? '切换中' : '切换摄像头'}</button>}
            {['monitoring', 'paused'].includes(monitoringStatus) && <button className="danger-button" onClick={() => void finishMonitoring()}><Square size={15} fill="currentColor" />结束并生成报告</button>}
            {monitoringStatus === 'finishing' && <button disabled><RefreshCw className="spin" size={17} />生成报告中</button>}
            {teacherStatus !== 'idle' && <span className="control-hint">请先上传教师照片</span>}
            <span className="privacy-hint"><ShieldCheck size={13} />按间隔截取画面进行分析</span>
          </div>
        </section>
        <aside className="teacher-card panel">
          <div className="panel-heading compact"><div><span className="eyebrow">数字教师</span><h2>课堂监督员</h2></div>
            <span className={`teacher-state ${teacherStatus}`}>{teacherStatusText(teacherStatus)}</span></div>
          <div className={`avatar-stage static-avatar ${teacherStatus}`}>
            {teacher ? <img className="avatar-media idle-image media-visible" src={teacher.image_url} alt="课堂监督员" /> :
              <div className="avatar-empty"><UserRound size={60} /><span>上传教师正面照片后将在此持续显示</span></div>}
            {teacherStatus === 'speaking' && <div className="voice-indicator"><Volume2 size={18} />正在提醒</div>}
            {teacherStatus === 'preparing' && <div className="preparing-overlay"><RefreshCw className="spin" />正在上传监督员照片</div>}
          </div>
          <div className="teacher-info"><strong>{teacherStatus === 'speaking' ? '正在进行课堂语音提醒' : teacher ? '课堂监督员照片已就绪' : '设置课堂监督员照片'}</strong>
            <p>{currentSpeech?.speech ?? teacherMessage}</p>{speechNotice && currentSpeech && <small>{speechNotice}</small>}</div>
          <button className="preview-button" disabled={!teacher || teacherStatus !== 'idle'} onClick={testTeacherVoice}><Volume2 size={17} />测试语音提醒</button>
          <label className={`upload-button ${teacherStatus === 'preparing' ? 'disabled' : ''}`}><ImageUp size={18} />{teacher ? '更换教师照片' : '上传教师照片'}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={teacherStatus === 'preparing'} onChange={(event) => void handleUpload(event.target.files?.[0])} /></label>
          <p className="upload-tip">支持 JPG / PNG / WebP，文件不超过 8MB</p>
        </aside>
        <section className="log-card panel">
          <div className="panel-heading compact"><div><span className="eyebrow">实时记录</span><h2>课堂行为</h2></div><span className="count-badge">{logs.length}</span></div>
          <div className="event-list">{logs.length === 0 ? <div className="empty-list"><Clock3 size={28} /><span>开始监督后，学生行为记录将在此显示</span></div> :
            logs.map(({ key, event }) => <article className={`event-item ${event.severity}`} key={key}><div className="event-icon">{event.severity === 'info' ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}</div>
              <div><div className="event-line"><strong>{event.behavior}</strong><time>{formatTime(event.time)}</time></div><p>{event.students.map((student) => student.label).join('、')}</p>
                <small>持续约 {Math.round(event.duration)} 秒 · {event.severity === 'info' ? '学习状态已记录' : '已触发语音提醒'}</small></div></article>)}</div>
          <div className="log-summary"><span>异常行为</span><strong>{alertCount} 项</strong></div>
        </section>
      </div>
      {(reportLoading || report) && <section className="report-panel panel">
        <div className="report-heading"><div className="report-icon"><BarChart3 /></div><div><span className="eyebrow">课堂结束</span><h2>学生课堂行为报告</h2></div>
          {report && <span><CheckCircle2 size={16} /> 基于摄像头监督记录生成</span>}</div>
        {reportLoading ? <div className="report-loading"><RefreshCw className="spin" />正在生成逐人报告…</div> : <div className="report-grid">
          {report?.classroom_summary && <div className="classroom-summary"><strong>课堂整体总结</strong><p>{report.classroom_summary}</p></div>}
          {report?.students.map((student) => { const remainedFocused = student.timeline.length > 0 && student.timeline.every((item) => item.severity === 'info'); return <article className="student-report" key={student.student_id}>
            <div className="student-report-title"><UserRound size={20} /><strong>{student.label}</strong><span>提醒 {student.reminder_count} 次</span></div>
            <div className="behavior-stats">{Object.entries(student.behaviors).map(([name, stat]) => <div key={name}><span>{name}</span><strong>{remainedFocused ? '持续' : `${stat.count} 次`}</strong><small>共约 {Math.round(stat.duration)} 秒</small></div>)}</div>
            <div className="timeline-row">{student.timeline.map((item) => <span key={item.event_id}>{formatTime(item.time)} · {item.behavior}</span>)}</div><p><b>总结：</b>{student.summary}</p></article> })}
          {report?.students.length === 0 && <div className="empty-report">本次监督未获得可用的学生行为记录。</div>}
        </div>}
      </section>}
    </main>
  </div>
}

export default App
