export type DetectionClass = 'vehicle' | 'person' | 'vessel' | 'aircraft'

export type Detection = {
  id: number
  cls: DetectionClass
  lat: number
  lon: number
  heightM: number
  widthM: number
  heightSizeM: number
  confidence: number
  headingDeg: number
  speedMps: number
  lastSeenMs: number
}

export const DETECTION_STYLES: Record<DetectionClass, { label: string; color: string }> = {
  vehicle: { label: '车辆', color: '#ffb454' },
  person: { label: '人员', color: '#6ce5a8' },
  vessel: { label: '舰船', color: '#6cb8ff' },
  aircraft: { label: '飞行器', color: '#ff6b9d' }
}

export function detectionBoxSizeM(det: Detection, cameraHeightM: number, fovDeg: number): { width: number; height: number } {
  const apparent = Math.max(0.6, Math.min(6, (det.widthM / Math.max(cameraHeightM, 1)) * fovDeg * 9))
  return { width: apparent, height: apparent * (det.heightSizeM / Math.max(det.widthM, 0.1)) }
}

export function confidenceBucket(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.8) return 'high'
  if (confidence >= 0.55) return 'medium'
  return 'low'
}

export function advanceDetection(det: Detection, dtSec: number): Detection {
  const dist = det.speedMps * dtSec
  const rad = (det.headingDeg * Math.PI) / 180
  const dLat = (dist * Math.cos(rad)) / 111320
  const dLon = (dist * Math.sin(rad)) / (111320 * Math.cos((det.lat * Math.PI) / 180))
  return {
    ...det,
    lat: det.lat + dLat,
    lon: det.lon + dLon,
    headingDeg: (det.headingDeg + (Math.random() - 0.5) * 4 + 360) % 360,
    confidence: Math.max(0.3, Math.min(0.99, det.confidence + (Math.random() - 0.5) * 0.05)),
    lastSeenMs: det.lastSeenMs + dtSec * 1000
  }
}
