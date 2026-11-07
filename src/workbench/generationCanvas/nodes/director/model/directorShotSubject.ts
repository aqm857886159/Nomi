/**
 * [INPUT]: persisted DirectorProject camera subject, FrameSample projections.
 * [OUTPUT]: subjectAt and sampleForSubject, shared by product summaries and offline scorer.
 * [POS]: One owner for shot identity; invalid explicit intent stays unmeasurable, never manual/body fallback.
 */
import type { DirectorProject } from './directorTypes'
import type { FrameSample } from './directorEvalMeasurement'

/** Resolve a bound subject or anchor without substituting another object when it is absent. */
export function sampleForSubject(frame: FrameSample, subject: string | undefined, actorMap: Record<string, string | undefined> = {}) {
  if (!subject) return undefined
  const [root, part] = subject.split('.')
  const sample = frame.objects[actorMap[root] ?? root]
  return part ? sample?.anchors?.[part] : sample
}

/** Compiled cameras name their subject. Manual cameras prefer people, then props; scenery never competes. */
export function subjectAt(project: DirectorProject, frame: FrameSample | undefined): string | null {
  if (!frame) return null
  const scene = project.scenes.find((item) => item.id === project.activeSceneId) ?? project.scenes[0]
  const recorded = scene?.cameras.find((camera) => camera.id === frame.cameraId)?.measurementSubject
  if (recorded === null || recorded?.anchor === null) return null
  if (recorded) return recorded.anchor ? `${recorded.objectId}.${recorded.anchor.name}` : recorded.objectId
  // Auxiliary helpers are physically excluded from output; this guard does not infer actor identity.
  const objects = (scene?.objects ?? []).filter((object) => object.visible && !object.isAuxiliary && object.framingRole !== 'background' && object.type !== 'group' && object.type !== 'plane')
  const people = objects.filter((object) => object.type === 'character')
  const candidates = people.length ? people : objects
  const pick = (accept: (box: NonNullable<FrameSample['objects'][string]['projection']>) => boolean) => {
    let best: { id: string; ratio: number } | null = null
    for (const object of candidates) {
      const sample = sampleForSubject(frame, object.id)
      if (!sample?.projection || !sample.shotSize || !accept(sample.projection)) continue
      if (!best || sample.projection.heightRatio > best.ratio) best = { id: object.id, ratio: sample.projection.heightRatio }
    }
    return best?.id ?? null
  }
  return pick((box) => box.inFrame) ?? pick((box) => box.depth > 0 && box.x < 1 && box.x + box.width > 0 && box.y < 1 && box.y + box.height > 0)
}
