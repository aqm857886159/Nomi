import type { DirectorCard } from '../cardSchema'
import { scoreCard } from '../scorer'
import { recognizeCameraMotion } from '../../../src/workbench/generationCanvas/nodes/director/model/directorEvalMeasurement'
import type { AdaptedProject } from '../adapters'
import type { VisualReview } from './schema'

export type CrossCheck = {
  checked: number
  consistent: number
  consistency: number | null
  disagreements: Array<{ claim: string; expected: string; observed: string }>
}

function parseWindow(timecode: string, duration: number): { start: number; end: number } {
  const values = [...timecode.matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]))
  if (values.length >= 2) return { start: values[0], end: values[1] }
  return { start: 0, end: duration }
}

function normaliseDirection(value: string): string {
  const lower = value.toLowerCase()
  if (/push[_ -]?in|推近|推进|推镜/.test(lower)) return 'push_in'
  if (/pull[_ -]?out|拉远|拉镜|退远/.test(lower)) return 'pull_out'
  if (/orbit|环绕|旋转/.test(lower)) return 'orbit'
  if (/follow|跟拍|跟随/.test(lower)) return 'follow'
  if (/pan|摇摄|横摇|摇镜/.test(lower)) return 'pan'
  if (/tilt|俯仰|摇臂/.test(lower)) return 'tilt'
  if (/zoom|变焦/.test(lower)) return 'zoom'
  if (/static|静止|固定/.test(lower)) return 'static'
  return lower
}

export function directionMatches(claim: string, expected: string): boolean {
  const claimDirection = normaliseDirection(claim)
  const expectedDirection = normaliseDirection(expected)
  return claimDirection === expectedDirection || (expectedDirection === 'orbit_right' && claimDirection === 'orbit')
}

export function crossCheck(card: DirectorCard, adapted: AdaptedProject, review: VisualReview | undefined): CrossCheck {
  if (!review) return { checked: 0, consistent: 0, consistency: null, disagreements: [] }
  const measured = scoreCard(card, adapted.project, adapted.actorMap).measurements
  const disagreements: CrossCheck['disagreements'] = []
  let checked = 0
  let consistent = 0
  const actorIds = Object.values(adapted.actorMap ?? {})
  const subjectId = actorIds[0] ?? Object.keys(measured.frames[0]?.objects ?? {})[0]
  for (const claim of review.measurableClaims) {
    checked += 1
    const window = parseWindow(claim.timecode, measured.duration)
    if (claim.kind === 'cut_count') {
      const expected = String(measured.cuts.filter((cut) => cut >= window.start && cut <= window.end).length)
      if (claim.value.match(/\d+/)?.[0] === expected) consistent += 1
      else disagreements.push({ claim: claim.value, expected, observed: claim.timecode })
    } else if (claim.kind === 'direction') {
      const expected = subjectId ? recognizeCameraMotion(measured, subjectId, window).move : 'unknown'
      if (directionMatches(claim.value, expected)) consistent += 1
      else disagreements.push({ claim: claim.value, expected, observed: claim.timecode })
    } else {
      disagreements.push({ claim: claim.value, expected: 'manual review', observed: claim.timecode })
    }
  }
  return { checked, consistent, consistency: checked ? consistent / checked : null, disagreements }
}
