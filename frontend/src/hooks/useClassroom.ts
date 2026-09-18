import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { countVideoInputs, requestCamera, type CameraFacingMode, type CameraRequestResult } from '../camera'
import { playAudioSource, primeAudioElement, primeSpeechSynthesis } from '../mobileAudio'
import { buildLocalReport } from '../reportFallback'
import type { BehaviorEvent, ClassroomReport, LiveFrameAnalysis, LiveSession, TeacherAsset, TeacherStatus } from '../types'

export type MonitoringStatus = 'idle' | 'requesting' | 'monitoring' | 'paused' | 'finishing' | 'finished' | 'error'
export interface LogEntry { key: string; event: BehaviorEvent }

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

export function useClassroom() {
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
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

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
  const [manualSpeech, setManualSpeech] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [startedAt, setStartedAt] = useState('')
  const cameraSwitchRef = useRef(false)

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
    speechUtteranceRef.current = null
    speechBusyRef.current = false
    setSpeechQueue([])
    setCurrentSpeech(null)
    setManualSpeech('')
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
    audioRef.current = null
    speechUtteranceRef.current = null
  }, [])

  const unlockAudioPlayback = useCallback(() => {
    const audio = audioRef.current ?? new Audio()
    audioRef.current = audio
    void primeAudioElement(audio)

    const synthesis = window.speechSynthesis
    if (typeof synthesis?.speak === 'function' && typeof SpeechSynthesisUtterance !== 'undefined') {
      const primer = new SpeechSynthesisUtterance('\u00a0')
      speechUtteranceRef.current = primer
      const release = () => { if (speechUtteranceRef.current === primer) speechUtteranceRef.current = null }
      primer.onend = release; primer.onerror = release
      primeSpeechSynthesis(synthesis, primer)
    }
  }, [])

  const speakWithBrowser = useCallback((text: string) => new Promise<boolean>((resolve) => {
    const synthesis = window.speechSynthesis
    if (typeof synthesis?.speak !== 'function' || typeof SpeechSynthesisUtterance === 'undefined') {
      resolve(false); return
    }

    let settled = false; let started = false
    let resumeTimer: ReturnType<typeof globalThis.setTimeout>
    let startTimer: ReturnType<typeof globalThis.setTimeout>
    let endTimer: ReturnType<typeof globalThis.setTimeout>
    const utterance = new SpeechSynthesisUtterance(text)
    speechUtteranceRef.current = utterance
    utterance.lang = 'zh-CN'; utterance.rate = 0.95; utterance.volume = 1
    const chineseVoice = synthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith('zh'))
    if (chineseVoice) utterance.voice = chineseVoice

    const finish = (played: boolean) => {
      if (settled) return
      settled = true; globalThis.clearTimeout(startTimer); globalThis.clearTimeout(endTimer); globalThis.clearTimeout(resumeTimer)
      if (speechUtteranceRef.current === utterance) speechUtteranceRef.current = null
      resolve(played)
    }
    utterance.onstart = () => { started = true }
    utterance.onend = () => finish(true)
    utterance.onerror = () => finish(false)

    synthesis.cancel(); synthesis.resume(); synthesis.speak(utterance)
    resumeTimer = globalThis.setTimeout(() => synthesis.resume(), 250)
    startTimer = globalThis.setTimeout(() => {
      if (!started && !synthesis.speaking) finish(false)
    }, 2200)
    endTimer = globalThis.setTimeout(() => finish(started), Math.max(9000, text.length * 650))
  }), [])

  const playAudioUrl = useCallback((url: string) => {
    const audio = audioRef.current ?? new Audio()
    audioRef.current = audio
    return playAudioSource(audio, url)
  }, [])

  const playReminder = useCallback(async (event: BehaviorEvent) => {
    speechBusyRef.current = true; setCurrentSpeech(event); setTeacherStatus('speaking')
    setSpeechNotice('正在生成中文语音提醒…')
    try {
      const audio = await api.synthesize(event.speech)
      setSpeechNotice(audio.message || '正在播放课堂提醒')
      if (audio.audio_url) {
        const played = await playAudioUrl(audio.audio_url)
        if (!played && !await speakWithBrowser(event.speech)) {
          setManualSpeech(event.speech); setSpeechNotice('手机浏览器阻止了自动语音，请点击“播放当前提醒”')
        }
      } else if (!await speakWithBrowser(event.speech)) {
        setManualSpeech(event.speech); setSpeechNotice('手机浏览器阻止了自动语音，请点击“播放当前提醒”')
      }
    } catch (error) {
      setSpeechNotice(`云端语音暂不可用，已使用浏览器语音：${(error as Error).message}`)
      if (!await speakWithBrowser(event.speech)) {
        setManualSpeech(event.speech); setSpeechNotice('手机浏览器阻止了自动语音，请点击“播放当前提醒”')
      }
    } finally {
      speechBusyRef.current = false; setCurrentSpeech(null)
      setTeacherStatus(teacher ? 'idle' : 'empty')
    }
  }, [playAudioUrl, speakWithBrowser, teacher])

  useEffect(() => {
    if (speechBusyRef.current || speechQueue.length === 0) return
    const [next, ...rest] = speechQueue; setSpeechQueue(rest); void playReminder(next)
  }, [playReminder, speechQueue, currentSpeech])

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
    if (statusRef.current !== 'monitoring' || analysisBusyRef.current || cameraSwitchRef.current) return
    const currentSession = sessionRef.current; const video = cameraRef.current; const canvas = canvasRef.current
    if (!currentSession || !video || !canvas) return
    analysisBusyRef.current = true; setIsAnalyzing(true)
    try {
      const image = await frameToBlob(video, canvas)
      const result = await api.analyzeLiveFrame(currentSession.session_id, image, currentElapsed())
      if (statusRef.current === 'monitoring' && sessionRef.current === currentSession && !cameraSwitchRef.current) applyFrameAnalysis(result)
    } catch (error) {
      setAnalysisMessage(`本次画面分析未完成，将自动继续：${(error as Error).message}`)
    } finally {
      analysisBusyRef.current = false; setIsAnalyzing(false)
      if (statusRef.current === 'monitoring' && !cameraSwitchRef.current) scheduleNextAnalysis(intervalSecondsRef.current * 1000)
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
    resetClassroomState(); unlockAudioPlayback(); statusRef.current = 'requesting'; setMonitoringStatus('requesting')
    setAnalysisMessage('正在请求摄像头权限…')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持摄像头访问，请使用最新版 Chrome 或 Edge')
      const camera = await requestCamera(navigator.mediaDevices, cameraPreference)
      await attachCamera(camera, cameraPreference)
      const created = await api.startLiveSession()
      setSessionId(created.session_id); setStartedAt(new Date().toISOString())
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
    cameraSwitchRef.current = true
    clearCaptureTimer(); setActiveEvents([]); setIsSwitchingCamera(true); setErrorMessage('')
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
      cameraSwitchRef.current = false; setIsSwitchingCamera(false)
      if (wasMonitoring && streamRef.current && statusRef.current === 'monitoring') scheduleNextAnalysis(250)
    }
  }

  const pauseMonitoring = () => {
    if (statusRef.current !== 'monitoring' || cameraSwitchRef.current) return
    accumulatedSecondsRef.current = currentElapsed(); activeSegmentStartedRef.current = 0
    statusRef.current = 'paused'; setMonitoringStatus('paused'); setElapsed(accumulatedSecondsRef.current)
    setActiveEvents([]); clearCaptureTimer(); setAnalysisMessage('课堂监督已暂停，摄像头预览仍保持开启')
  }

  const resumeMonitoring = () => {
    if (statusRef.current !== 'paused' || cameraSwitchRef.current) return
    unlockAudioPlayback()
    statusRef.current = 'monitoring'; setMonitoringStatus('monitoring'); activeSegmentStartedRef.current = performance.now()
    setAnalysisMessage('课堂监督已继续，数字教师正在观察课堂画面'); scheduleNextAnalysis(200)
  }

  const finishMonitoring = async () => {
    const currentSession = sessionRef.current
    if (!currentSession || cameraSwitchRef.current || !['monitoring', 'paused'].includes(statusRef.current)) return
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
    unlockAudioPlayback()
    void playReminder({ id: 'voice-preview', time: elapsed, duration: 3, students: [], behavior: '语音测试',
      speech: '同学们，请保持安静，集中注意力，认真完成学习任务。', severity: 'warning' })
  }

  const playManualSpeech = () => {
    if (!manualSpeech) return
    const text = manualSpeech
    unlockAudioPlayback(); setManualSpeech(''); setSpeechNotice('正在播放课堂提醒…')
    void speakWithBrowser(text).then((played) => {
      setSpeechNotice(played ? '课堂提醒播放完成' : '仍无法播放，请检查手机媒体音量和浏览器语音设置')
      if (!played) setManualSpeech(text)
    })
  }

  const visibleStudents = new Set(activeEvents.flatMap((event) => event.students.map((student) => student.id))).size
  const alertCount = logs.filter((entry) => entry.event.severity !== 'info').length

  return {
    cameraRef, canvasRef, streamRef, monitoringStatus, teacher, teacherStatus, teacherMessage,
    errorMessage, analysisMessage, isAnalyzing, elapsed, cameraAspect, setCameraAspect,
    activeEvents, logs, currentSpeech, speechNotice, report, reportLoading, sampleCount,
    cameraPreference, setCameraPreference, activeCameraFacing, availableCameraCount,
    isSwitchingCamera, manualSpeech, visibleStudents, alertCount, sessionId, startedAt,
    startMonitoring, switchCamera, pauseMonitoring, resumeMonitoring, finishMonitoring,
    handleUpload, testTeacherVoice, playManualSpeech,
  }
}

export type ClassroomController = ReturnType<typeof useClassroom>
