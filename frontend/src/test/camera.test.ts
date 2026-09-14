import { describe, expect, it, vi } from 'vitest'
import { requestCamera } from '../camera'

function mockStream(facingMode?: string) {
  return {
    getVideoTracks: () => [{ getSettings: () => ({ facingMode }) }],
  } as unknown as MediaStream
}

describe('摄像头选择', () => {
  it('默认请求指定方向的摄像头', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(mockStream('environment'))
    const result = await requestCamera({ getUserMedia } as unknown as MediaDevices, 'environment')

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia.mock.calls[0][0].video.facingMode).toEqual({ exact: 'environment' })
    expect(result.facingMode).toBe('environment')
  })

  it('电脑没有后置摄像头时自动回退到可用摄像头', async () => {
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException('没有后置摄像头', 'OverconstrainedError'))
      .mockResolvedValueOnce(mockStream('user'))

    const result = await requestCamera({ getUserMedia } as unknown as MediaDevices, 'environment')

    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(getUserMedia.mock.calls[1][0].video.facingMode).toEqual({ ideal: 'environment' })
    expect(result.facingMode).toBe('user')
  })

  it('用户拒绝权限时不重复请求', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('拒绝', 'NotAllowedError'))

    await expect(requestCamera({ getUserMedia } as unknown as MediaDevices, 'environment')).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })
})
