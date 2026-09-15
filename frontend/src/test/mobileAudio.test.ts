import { describe, expect, it, vi } from 'vitest'
import { playAudioSource, primeAudioElement, primeSpeechSynthesis, SILENT_AUDIO_URL } from '../mobileAudio'

function mockAudio(playResult: Promise<void> = Promise.resolve()) {
  return {
    preload: '', src: '', volume: 1, currentTime: 0, onended: null, onerror: null,
    play: vi.fn(() => playResult), pause: vi.fn(), load: vi.fn(), setAttribute: vi.fn(),
  } as unknown as HTMLAudioElement
}

describe('移动端音频解锁', () => {
  it('在调用期间立即播放静音音频并完成解锁', async () => {
    const audio = mockAudio()
    const unlocking = primeAudioElement(audio)

    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.src).toBe(SILENT_AUDIO_URL)
    expect(audio.setAttribute).toHaveBeenCalledWith('playsinline', '')
    await expect(unlocking).resolves.toBe(true)
    expect(audio.volume).toBe(1)
  })

  it('识别浏览器阻止播放的情况', async () => {
    const audio = mockAudio(Promise.reject(new DOMException('blocked', 'NotAllowedError')))
    await expect(primeAudioElement(audio)).resolves.toBe(false)
  })

  it('后续提醒复用已解锁的播放器', async () => {
    const audio = mockAudio()
    const playing = playAudioSource(audio, 'data:audio/mp3;base64,AAAA')
    expect(audio.src).toBe('data:audio/mp3;base64,AAAA')
    expect(audio.load).toHaveBeenCalledTimes(1)
    expect(audio.play).toHaveBeenCalledTimes(1)
    audio.onended?.(new Event('ended'))
    await expect(playing).resolves.toBe(true)
  })

  it('在用户点击期间预先激活浏览器语音合成', () => {
    const synthesis = { resume: vi.fn(), speak: vi.fn() } as unknown as SpeechSynthesis
    const utterance = { lang: '', volume: 1 } as SpeechSynthesisUtterance

    primeSpeechSynthesis(synthesis, utterance)

    expect(synthesis.resume).toHaveBeenCalledTimes(1)
    expect(synthesis.speak).toHaveBeenCalledWith(utterance)
    expect(utterance.lang).toBe('zh-CN')
    expect(utterance.volume).toBe(0)
  })
})
