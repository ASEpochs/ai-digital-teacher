export const SILENT_AUDIO_URL = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA=='

export function primeSpeechSynthesis(synthesis: SpeechSynthesis, utterance: SpeechSynthesisUtterance) {
  utterance.lang = 'zh-CN'
  utterance.volume = 0
  synthesis.resume()
  synthesis.speak(utterance)
}

/** Call this directly inside a click handler so iOS/WebKit authorizes this element. */
export function primeAudioElement(audio: HTMLAudioElement): Promise<boolean> {
  audio.preload = 'auto'
  audio.setAttribute('playsinline', '')
  audio.src = SILENT_AUDIO_URL
  audio.volume = 0.01
  audio.currentTime = 0

  try {
    const playback = audio.play()
    if (!playback) {
      audio.volume = 1
      return Promise.resolve(true)
    }
    return playback.then(() => {
      audio.pause()
      audio.currentTime = 0
      audio.volume = 1
      return true
    }).catch(() => {
      audio.volume = 1
      return false
    })
  } catch {
    audio.volume = 1
    return Promise.resolve(false)
  }
}

/** Reuse the element authorized by primeAudioElement instead of creating a new one. */
export function playAudioSource(audio: HTMLAudioElement, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    audio.pause()
    audio.volume = 1
    audio.src = url
    audio.load()
    let settled = false
    const finish = (played: boolean) => {
      if (settled) return
      settled = true
      audio.onended = null
      audio.onerror = null
      resolve(played)
    }
    audio.onended = () => finish(true)
    audio.onerror = () => finish(false)
    try {
      audio.play().catch(() => finish(false))
    } catch {
      finish(false)
    }
  })
}
