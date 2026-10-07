import type { HeadlessCaptureFrameReadback } from '../../../src/workbench/generationCanvas/nodes/director/agent/DirectorHeadlessCapture'
import type { DirectorProject, Vec3 } from '../../../src/workbench/generationCanvas/nodes/director/model/directorTypes'
import { sampleDirectorProject } from '../../../src/workbench/generationCanvas/nodes/director/model/directorEvalMeasurement'

export type ReadbackMismatch = {
  time: number
  subject?: string
  field: string
  expected: number | string
  actual: number | string
  delta?: number
}

export type MeasurementSideGap = { time: number; cameraId: string; reasons: string[] }

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const angleDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}
const mismatch = (
  time: number,
  field: string,
  expected: number | string,
  actual: number | string,
  delta?: number,
  subject?: string,
): ReadbackMismatch => ({
  time,
  field,
  expected,
  actual,
  ...(delta === undefined ? {} : { delta }),
  ...(subject ? { subject } : {}),
})

function measurementGapReasons(_project: DirectorProject, _cameraId: string): string[] {
  // Camera pose measurement calls the same pure evaluator as product playback, so no supported camera feature is opaque here.
  return []
}

/** Compare product capture readback against the permitted pure measurement oracle. */
export function compareCaptureReadback(
  project: DirectorProject,
  times: number[],
  frames: HeadlessCaptureFrameReadback[],
  width: number,
  height: number,
  subjectIds?: ReadonlySet<string>,
): { mismatches: ReadbackMismatch[]; measurementSideGaps: MeasurementSideGap[] } {
  const duration = Math.max(0, ...times)
  const measurements = sampleDirectorProject(project, { duration, fps: 30, aspectRatio: width / Math.max(1, height) })
  const mismatches: ReadbackMismatch[] = []
  const measurementSideGaps: MeasurementSideGap[] = []
  const sceneObjects = project.scenes.find((item) => item.id === project.activeSceneId)?.objects ?? []
  // The judge supplies the card binding for production runs. The type-based
  // fallback keeps this low-level helper useful in focused tests without
  // treating isAuxiliary as a subject classification.
  const requiredSubjectIds =
    subjectIds ??
    new Set(
      sceneObjects
        .filter((object) => object.type === 'character' || object.type === 'cylinder')
        .map((object) => object.id),
    )
  for (const [index, time] of times.entries()) {
    const actual = frames[index]
    const expected = measurements.frames.reduce(
      (best, frame) => (Math.abs(frame.time - time) < Math.abs(best.time - time) ? frame : best),
      measurements.frames[0],
    )
    if (!actual || !expected) {
      mismatches.push(mismatch(time, 'frame', 'present', actual ? 'present' : 'missing'))
      continue
    }
    const gapReasons = actual.cameraId ? measurementGapReasons(project, actual.cameraId) : []
    if (actual.cameraId && gapReasons.length)
      measurementSideGaps.push({ time, cameraId: actual.cameraId, reasons: gapReasons })
    if (actual.cameraId !== expected.cameraId)
      mismatches.push(mismatch(time, 'cameraId', expected.cameraId ?? 'null', actual.cameraId ?? 'null'))
    if (!actual.camera || !expected.camera) {
      if (!gapReasons.length && Boolean(expected.camera) !== Boolean(actual.camera))
        mismatches.push(
          mismatch(time, 'camera', expected.camera ? 'present' : 'null', actual.camera ? 'present' : 'null'),
        )
    } else if (!gapReasons.length) {
      const fields: Array<[string, number, number]> = [
        ['position.x', expected.camera.position.x, actual.camera.position.x],
        ['position.y', expected.camera.position.y, actual.camera.position.y],
        ['position.z', expected.camera.position.z, actual.camera.position.z],
      ]
      for (const [field, expectedValue, actualValue] of fields)
        if (Math.abs(expectedValue - actualValue) > 0.01)
          mismatches.push(mismatch(time, field, expectedValue, actualValue, Math.abs(expectedValue - actualValue)))
      for (const [field, expectedValue, actualValue] of [
        ['yaw', expected.camera.yaw, actual.camera.yaw],
        ['pitch', expected.camera.pitch, actual.camera.pitch],
        ['roll', expected.camera.roll, actual.camera.roll],
      ] as const) {
        const delta = angleDistance(expectedValue, actualValue)
        if (delta > 0.5) mismatches.push(mismatch(time, field, expectedValue, actualValue, delta))
      }
      if (expected.camera.fov !== actual.camera.fov)
        mismatches.push(mismatch(time, 'fov', expected.camera.fov, actual.camera.fov))
    }
    for (const object of sceneObjects) {
      // Binding decides which objects are card subjects. Other scene geometry
      // remains renderable and is intentionally reported separately by the
      // capture image, rather than being hidden through isAuxiliary.
      if (!requiredSubjectIds.has(object.id)) continue
      const expectedObject = expected.objects[object.id]
      const actualPosition = actual.subjectPositions[object.id]
      if (!expectedObject) continue
      if (!actualPosition) {
        mismatches.push(
          mismatch(time, 'subject.position', JSON.stringify(expectedObject.position), 'missing', undefined, object.id),
        )
        continue
      }
      const delta = distance(expectedObject.position, actualPosition)
      if (delta > 0.01)
        mismatches.push(
          mismatch(
            time,
            'subject.position',
            JSON.stringify(expectedObject.position),
            JSON.stringify(actualPosition),
            delta,
            object.id,
          ),
        )
    }
  }
  return { mismatches, measurementSideGaps }
}
