import type { DirectorPlan } from '../../src/workbench/generationCanvas/nodes/director/model/plan/directorPlanSchema'

const shot = (id: string, window: [number, number], subject: string, size: DirectorPlan['shots'][number]['size'], angle: DirectorPlan['shots'][number]['angle'], kind: DirectorPlan['shots'][number]['move']['kind'], amount?: number): DirectorPlan['shots'][number] => ({ id, window, transitionIn: 'cut', subject, size, angle, height: 'eye', move: { kind, amount: amount ?? (kind === 'orbit_right' ? 90 : undefined), speed: 'medium', easing: 'linear' } })

export const S1_ORACLE_PLANS: Record<string, DirectorPlan> = {
  'courtyard-standoff': {
    version: 2, scene: { tags: ['courtyard'], environment: 'day', template: 'courtyard', setPieces: [] },
    actors: [{ id: 'woman', kind: 'person', desc: '青衣女子', placement: { relation: 'at', ref: 's1-courtyard-ground' } }, { id: 'guard', kind: 'person', desc: '黑衣侍卫', placement: { relation: 'right_of', ref: 'woman' } }],
    blocking: [{ actor: 'woman', verb: 'walk_to', target: 'guard', window: [0, 4] }, { actor: 'guard', verb: 'sidestep', target: 'woman', window: [4, 8] }, { actor: 'woman', verb: 'hold_pose', window: [4, 8], action: 'hide_object_behind_back' }],
    shots: [shot('wide', [0, 4], 'woman', '全景', 'side_rear', 'follow'), shot('medium', [4, 8], 'guard', '中景', 'three_quarter', 'static'), shot('hand', [8, 10], 'woman', '特写', 'front', 'static'), { ...shot('over-shoulder', [10, 12], 'woman', '中近景', { over_shoulder: 'guard' }, 'push_in') }],
  },
  'perfume-orbit': {
    version: 2, scene: { tags: ['product'], environment: 'studio', template: 'product_stage', setPieces: [] },
    actors: [{ id: 'bottle', kind: 'product', desc: 'bottle', placement: { relation: 'on', ref: 's1-product-pedestal' } }], blocking: [],
    shots: [shot('orbit', [0, 8], 'bottle', '特写', 'front', 'orbit_right', 360), { ...shot('push', [8, 11], 'bottle.cap', '特写', 'front', 'push_in'), transitionIn: 'continuous' }],
  },
  'police-chase': {
    version: 2, scene: { tags: ['street', 'chase'], environment: 'night', template: 'street', setPieces: [] },
    actors: [{ id: 'police_car', kind: 'vehicle', desc: 'police', placement: { relation: 'at', ref: 's1-street-ground' } }, { id: 'suspect_car', kind: 'vehicle', desc: 'suspect', placement: { relation: 'in_front_of', ref: 'police_car' } }],
    blocking: [{ actor: 'suspect_car', verb: 'drive_along', target: 'police_car', window: [0, 4] }, { actor: 'police_car', verb: 'chase', target: 'suspect_car', window: [0, 4] }],
    shots: [shot('establish', [0, 4], 'suspect_car', '全景', 'back', 'follow'), { ...shot('follow', [4, 7], 'police_car', '中景', 'three_quarter', 'track_right'), transitionIn: 'cut' }, { ...shot('close', [7, 9], 'police_car', '特写', 'front', 'push_in'), transitionIn: 'cut' }],
  },
}
