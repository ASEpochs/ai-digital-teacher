export type CameraFacingMode = 'environment' | 'user'

export interface CameraRequestResult {
  stream: MediaStream
  facingMode: CameraFacingMode | null
}

const videoQuality: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 15, max: 24 },
}

function constraintsFor(facingMode?: CameraFacingMode, exact = false): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      ...videoQuality,
      ...(facingMode ? { facingMode: exact ? { exact: facingMode } : { ideal: facingMode } } : {}),
    },
  }
}

function isPermissionError(error: unknown) {
  return error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)
}

export function streamFacingMode(stream: MediaStream): CameraFacingMode | null {
  const facingMode = stream.getVideoTracks()[0]?.getSettings().facingMode
  return facingMode === 'environment' || facingMode === 'user' ? facingMode : null
}

/**
 * First request the selected camera explicitly. Mobile browsers therefore open
 * the rear camera by default. Browsers without facingMode support can still
 * fall back to their normal (usually built-in/front) camera.
 */
export async function requestCamera(
  mediaDevices: MediaDevices,
  facingMode: CameraFacingMode,
): Promise<CameraRequestResult> {
  const attempts = [
    constraintsFor(facingMode, true),
    constraintsFor(facingMode),
    constraintsFor(),
  ]
  let lastError: unknown

  for (const constraints of attempts) {
    try {
      const stream = await mediaDevices.getUserMedia(constraints)
      return { stream, facingMode: streamFacingMode(stream) }
    } catch (error) {
      if (isPermissionError(error)) throw error
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('未找到可用摄像头')
}

export async function countVideoInputs(mediaDevices: MediaDevices) {
  if (typeof mediaDevices.enumerateDevices !== 'function') return 0
  try {
    const devices = await mediaDevices.enumerateDevices()
    return devices.filter((device) => device.kind === 'videoinput').length
  } catch {
    return 0
  }
}
