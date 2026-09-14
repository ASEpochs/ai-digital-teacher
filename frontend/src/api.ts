import type {
  AudioResponse,
  BehaviorEvent,
  ClassroomAnalysisTask,
  ClassroomReport,
  LiveFrameAnalysis,
  LiveSession,
  TeacherAsset,
} from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, options)
  } catch {
    throw new Error('无法连接后端服务，请确认服务已启动并检查网络')
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: '请求失败' }))
    throw new Error(data.detail ?? `请求失败（${response.status}）`)
  }
  return response.json() as Promise<T>
}

export const api = {
  getEvents: () => request<BehaviorEvent[]>('/api/events'),

  analyzeClassroom: (duration: number, force = false) =>
    request<ClassroomAnalysisTask>('/api/classroom-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration, force }),
    }),

  getClassroomAnalysis: (taskId: string) =>
    request<ClassroomAnalysisTask>(`/api/classroom-analysis/${encodeURIComponent(taskId)}`),

  startLiveSession: () =>
    request<LiveSession>('/api/live-sessions', { method: 'POST' }),

  analyzeLiveFrame: (sessionId: string, frame: Blob, elapsed: number) => {
    const form = new FormData()
    form.append('frame', frame, 'classroom-frame.jpg')
    form.append('elapsed', elapsed.toFixed(1))
    return request<LiveFrameAnalysis>(`/api/live-sessions/${encodeURIComponent(sessionId)}/frames`, {
      method: 'POST',
      body: form,
    })
  },

  finishLiveSession: (sessionId: string) =>
    request<ClassroomReport>(`/api/live-sessions/${encodeURIComponent(sessionId)}/finish`, {
      method: 'POST',
    }),

  uploadTeacher: (file: File, analysisTaskId?: string, mode: 'static' | 'dynamic' = 'dynamic') => {
    const form = new FormData()
    form.append('photo', file)
    if (analysisTaskId) form.append('analysis_task_id', analysisTaskId)
    form.append('mode', mode)
    return request<TeacherAsset>('/api/teacher', { method: 'POST', body: form })
  },

  getTeacherTask: (taskId: string) =>
    request<TeacherAsset>(`/api/digital-human/tasks/${encodeURIComponent(taskId)}`),

  synthesize: (text: string) =>
    request<AudioResponse>('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }),

  generateReport: (triggeredEventIds: string[], analysisTaskId?: string) =>
    request<ClassroomReport>('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        triggered_event_ids: triggeredEventIds,
        analysis_task_id: analysisTaskId ?? null,
      }),
    }),
}
