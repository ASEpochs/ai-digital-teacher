import { ImageUp, UserRound, Volume2 } from 'lucide-react'
import type { ClassroomController } from '../hooks/useClassroom'
import { Badge } from './ui'

export function TeacherControls({ classroom: c }: { classroom: ClassroomController }) {
  const busy = ['monitoring', 'paused', 'requesting', 'finishing'].includes(c.monitoringStatus)
  const status = { empty: '待设置', preparing: '上传中', idle: '已就绪', speaking: '提醒中', failed: '上传失败' }[c.teacherStatus]
  return <section className="teacher-panel" aria-labelledby="teacher-title">
    <div className="section-heading"><h2 id="teacher-title">监督员与语音</h2><Badge tone={c.teacher ? 'success' : 'neutral'}>{status}</Badge></div>
    <div className="teacher-profile">
      <div className={`teacher-photo ${c.teacherStatus === 'speaking' ? 'speaking' : ''}`}>{c.teacher ? <img src={c.teacher.image_url} alt="课堂监督员照片" /> : <UserRound size={28} />}</div>
      <div><strong>{c.teacher ? '监督员形象已设置' : '上传监督员照片'}</strong><p>JPG / PNG / WebP，最大 8MB</p>
        <label className="text-button upload-label"><ImageUp size={15} />{c.teacherStatus === 'preparing' ? '上传中…' : c.teacher ? '更换照片' : '选择照片'}<input type="file" aria-label="上传教师照片" accept="image/jpeg,image/png,image/webp" disabled={c.teacherStatus === 'preparing' || busy} onChange={e => { void c.handleUpload(e.target.files?.[0]); e.target.value = '' }} /></label>
      </div>
    </div>
    <button className="button full-width" disabled={!c.teacher || c.teacherStatus !== 'idle'} onClick={c.testTeacherVoice}><Volume2 size={16} />测试语音提醒</button>
    <p className="speech-feedback" role="status">{c.currentSpeech?.speech || c.speechNotice || '开始前请测试声音，并保持页面在前台。'}</p>
    {c.manualSpeech && <button className="button amber full-width" onClick={c.playManualSpeech}><Volume2 size={16} />播放当前提醒</button>}
  </section>
}
