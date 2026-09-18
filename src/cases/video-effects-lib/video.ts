export const VIDEO_URL = '/videos/demo.mp4'

export function createVideoElement(): HTMLVideoElement {
  const video = document.createElement('video')
  video.src = VIDEO_URL
  video.muted = true
  video.loop = true
  video.playsInline = true
  video.crossOrigin = 'anonymous'
  video.preload = 'auto'
  video.autoplay = true
  video.play().catch(() => undefined)
  return video
}

export function disposeVideoElement(video: HTMLVideoElement | undefined): void {
  if (!video) return
  video.pause()
  video.removeAttribute('src')
  video.load()
}
