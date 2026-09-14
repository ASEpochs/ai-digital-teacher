export type Severity = 'info' | 'warning' | 'alert'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface StudentRef {
  id: string
  label: string
  rect: Rect
}

export interface BehaviorEvent {
  id: string
  time: number
  duration: number
  students: StudentRef[]
  behavior: string
  speech: string
  severity: Severity
}

export type TeacherStatus = 'empty' | 'preparing' | 'idle' | 'speaking' | 'failed'

export interface TeacherAsset {
  task_id: string
  status: 'preparing' | 'ready' | 'failed'
  provider: string
  image_url: string
  message: string
  progress: number
  idle_video_url: string | null
  idle_provider: string
  talking_videos: Record<string, string>
  speech_audio_urls: Record<string, string>
  analysis_task_id: string | null
}

export interface ClassroomAnalysisTask {
  task_id: string
  status: 'preparing' | 'ready' | 'failed'
  provider: string
  message: string
  progress: number
  events: BehaviorEvent[]
  classroom_summary: string
  used_fallback: boolean
}

export interface LiveSession {
  session_id: string
  status: 'ready' | 'monitoring' | 'paused' | 'finished'
  provider: string
  message: string
  analysis_interval_seconds: number
  sample_count: number
  total_events: number
}

export interface LiveFrameAnalysis {
  session_id: string
  status: 'ready' | 'degraded'
  provider: string
  message: string
  elapsed: number
  events: BehaviorEvent[]
  sample_count: number
  total_events: number
}

export interface AudioResponse {
  provider: string
  audio_url: string | null
  browser_fallback: boolean
  message: string
}

export interface BehaviorStat {
  count: number
  duration: number
}

export interface StudentReport {
  student_id: string
  label: string
  behaviors: Record<string, BehaviorStat>
  reminder_count: number
  timeline: Array<{
    event_id: string
    time: number
    duration: number
    behavior: string
    severity: Severity
  }>
  summary: string
}

export interface ClassroomReport {
  generated_by: string
  students: StudentReport[]
  total_events: number
  classroom_summary: string
}
