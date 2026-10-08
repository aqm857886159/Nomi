import { directorPlanSchema, normalizeDirectorPlan, type DirectorPlan } from '../../../../../../../electron/shared/director/directorPlanSchema'
import { PLANNER_ACTION_IDS } from '../actionLibrary'

export type PlannerUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number; estimatedUsd?: number }
export type PlannerResult =
  | {
      ok: true
      plan: DirectorPlan
      attempts: number
      usage: PlannerUsage
      raw: string
      rawSchemaPasses: number
      normalizedSchemaPasses: number
      responseCount: number
    }
  | {
      ok: false
      attempts: number
      errors: string[]
      usage: PlannerUsage
      rawSchemaPasses: number
      normalizedSchemaPasses: number
      responseCount: number
    }

const SYSTEM = `You are a deterministic film director planner. Return exactly one JSON object matching the Director Plan v2 schema. Never emit xyz coordinates, positions, rotations, distances, or camera coordinates: the compiler owns geometry. Express intent only with relations, blocking, shot size, angle, height, and camera move. Use seconds for every window and cover the whole brief with non-empty shots. If the brief has multiple beats but no explicit durations, use a 12-second total and divide beats in sequence; use 4 seconds for one simple beat.
Entity contract (must hold for every brief): copy each user-mentioned actor or important scene object into an actor.desc, scene.tags, or setPieces.kind verbatim (preserve the original noun, including Chinese); use a readable stable ASCII id derived from that noun (for example police_car for “警车”), never generic ids such as subject, actor, person, item, or object when a concrete noun is present. If the brief truly contains no entity noun and only describes camera action, use the single fallback id actor with kind person (or object with kind prop when the brief clearly frames a thing), and reuse that id everywhere. Reuse those exact ids in blocking, shot.subject, shot.subjects, and anchor references. Choose actor kind from the noun: person for a human, vehicle for a car/bike/train, product for the item being presented, prop for a handheld or inert object. Put named background items in setPieces with an object relation, never as strings. Every concrete location or prop noun in the brief must appear in scene.tags or setPieces.kind, even when it is also represented by a fixed template object.
Shot contract (must hold for every shot): every shot has a subject that resolves to an actor id (or actor.anchor), and subjects lists every simultaneously framed actor when the brief calls for a group. Add enough shots to cover the requested time and requested coverage; do not omit the establishing view or the close detail explicitly requested. Map the user's words to legal values instead of inventing enums: push/dolly -> push_in, pull -> pull_out, truck/track -> track_left or track_right with direction, follow/tracking a moving subject -> follow, pan/whip/tilt -> the matching move with direction when stated, orbit/arc -> orbit_left or orbit_right. A moving vehicle chase normally needs drive_along/chase blocking plus a follow, track, pan, or push shot. Static is valid only when the brief asks for stillness or when it is the deliberate coverage between moves.
Scene and schema contract: scene.environment is only day|night|studio; scene.template is required and is only street|room|courtyard|product_stage. Choose the closest legal template from spatial structure, never a new location label. If a location is ambiguous, keep it in tags and choose room or street without inventing a template; if no location is stated, choose room. Template anchor ids are fixed: street=s1-street-ground|s1-street-road-left|s1-street-road-right|s1-street-building-left|s1-street-building-right; room=s1-room-floor|s1-room-back|s1-room-left; courtyard=s1-courtyard-ground|s1-courtyard-wall-north|s1-courtyard-wall-east|s1-courtyard-gate|s1-courtyard-tree; product_stage=s1-product-ground|s1-product-backdrop|s1-product-pedestal. Use one of these ids for every placement ref. If dressing is present it must be an AiSceneSpec object with groups and elements; omit dressing when unsure. Legal placement relations are near|in_front_of|behind|left_of|right_of|on|between|along|at. Legal blocking verbs are walk_to|run_to|stop|sidestep|turn_to|hold_pose|drive_along|chase|static; action ids are ${PLANNER_ACTION_IDS.join('|')}. transitionIn is cut or continuous. Shot size is exactly 远景|全景|中景|中近景|近景|特写|大特写. Angle is front|three_quarter|side|side_rear|back or {over_shoulder:actor}/{pov:actor}; height is eye|low|high|overhead. Move kind is orbit_left|orbit_right|push_in|pull_out|crane_up|crane_down|track_left|track_right|arc_left|arc_right|zoom_in|zoom_out|dolly_zoom|pan|tilt|whip|rack_focus|follow|static. Do not return explanations or markdown. Preserve the 180 degree axis and keep movement, blocking, and focus causally related.`

const EXAMPLES = [
  {
    scene: {
      tags: ['coastal observatory', 'night'],
      environment: 'night',
      template: 'room',
      setPieces: [{ id: 'telescope_dome', kind: 'telescope dome', relation: { type: 'at', ref: 's1-room-floor' } }],
    },
    actors: [
      { id: 'astronomer', kind: 'person', desc: 'astronomer', placement: { relation: 'at', ref: 's1-room-floor' } },
      { id: 'telescope', kind: 'prop', desc: 'telescope', placement: { relation: 'right_of', ref: 'astronomer' } },
    ],
    blocking: [
      { actor: 'astronomer', verb: 'walk_to', target: 'telescope', window: [0, 3] },
      { actor: 'astronomer', verb: 'hold_pose', window: [3, 6], action: 'Idle_Loop' },
    ],
    shots: [
      {
        id: 'room_start',
        window: [0, 2],
        transitionIn: 'cut',
        subject: 'astronomer',
        subjects: ['astronomer', 'telescope'],
        size: '全景',
        angle: 'side',
        height: 'eye',
        move: { kind: 'static', speed: 'slow', easing: 'linear' },
      },
      {
        id: 'instrument',
        window: [2, 6],
        transitionIn: 'cut',
        subject: 'telescope',
        size: '近景',
        angle: 'three_quarter',
        height: 'eye',
        move: { kind: 'push_in', amount: 1, speed: 'slow', easing: 'ease_out' },
      },
    ],
  },
  {
    scene: {
      tags: ['subway service tunnel'],
      environment: 'studio',
      template: 'street',
      setPieces: [{ id: 'signal_panel', kind: 'signal panel', relation: { type: 'along', ref: 's1-street-ground' } }],
    },
    actors: [
      { id: 'engineer', kind: 'person', desc: 'engineer', placement: { relation: 'at', ref: 's1-street-ground' } },
      {
        id: 'maintenance_cart',
        kind: 'vehicle',
        desc: 'maintenance cart',
        placement: { relation: 'in_front_of', ref: 'engineer' },
      },
    ],
    blocking: [
      { actor: 'maintenance_cart', verb: 'drive_along', window: [0, 5] },
      { actor: 'engineer', verb: 'run_to', target: 'maintenance_cart', window: [1, 5] },
    ],
    shots: [
      {
        id: 'cart_follow',
        window: [0, 5],
        transitionIn: 'cut',
        subject: 'maintenance_cart',
        size: '中景',
        angle: 'back',
        height: 'eye',
        move: { kind: 'follow', speed: 'fast', easing: 'ease_in_out' },
      },
    ],
  },
  {
    scene: {
      tags: ['snowy greenhouse', 'day'],
      environment: 'day',
      template: 'room',
      setPieces: [{ id: 'fern_bench', kind: 'fern bench', relation: { type: 'at', ref: 's1-room-floor' } }],
    },
    actors: [
      { id: 'botanist', kind: 'person', desc: 'botanist', placement: { relation: 'at', ref: 's1-room-floor' } },
      { id: 'fern', kind: 'prop', desc: 'fern', placement: { relation: 'on', ref: 'fern_bench' } },
    ],
    blocking: [{ actor: 'botanist', verb: 'hold_pose', window: [0, 4], action: 'Fixing_Kneeling' }],
    shots: [
      {
        id: 'greenhouse',
        window: [0, 2],
        transitionIn: 'cut',
        subject: 'botanist',
        size: '全景',
        angle: 'front',
        height: 'high',
        move: { kind: 'static', speed: 'slow', easing: 'linear' },
      },
      {
        id: 'fern_detail',
        window: [2, 4],
        transitionIn: 'cut',
        subject: 'fern',
        size: '特写',
        angle: 'side',
        height: 'eye',
        move: { kind: 'rack_focus', speed: 'slow', easing: 'ease_in_out' },
      },
    ],
  },
]

function prompt(description: string): string {
  return `${SYSTEM}\nThree valid examples:\n${EXAMPLES.map((example) => JSON.stringify(example)).join('\n')}\nUser brief:\n${description.trim()}\nReturn JSON only.`
}

async function callModel(system: string, user: string): Promise<{ content: string; usage: PlannerUsage }> {
  const key = process.env.NOMI_LOOP_LLM_KEY
  if (!key) throw new Error('NOMI_LOOP_LLM_KEY is not set')
  const base = (process.env.NOMI_LOOP_LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
  const model = process.env.NOMI_LOOP_LLM_MODEL || 'deepseek-flash'
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!response.ok) throw new Error(`LLM ${response.status}: ${(await response.text()).slice(0, 240)}`)
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  }
  return {
    content: json.choices?.[0]?.message?.content ?? '',
    usage: {
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
      totalTokens: json.usage?.total_tokens,
    },
  }
}

export async function planDirector(description: string): Promise<PlannerResult> {
  const errors: string[] = [],
    usage: PlannerUsage = {}
  let rawSchemaPasses = 0
  let normalizedSchemaPasses = 0
  let responseCount = 0
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const retryHint =
        attempt > 1 && errors.length
          ? `\nYour previous JSON failed validation. Correct these exact errors and return the complete JSON again: ${errors.join(' | ')}`
          : ''
      const response = await callModel(SYSTEM, prompt(description) + retryHint)
      responseCount += 1
      usage.inputTokens = (usage.inputTokens ?? 0) + (response.usage.inputTokens ?? 0)
      usage.outputTokens = (usage.outputTokens ?? 0) + (response.usage.outputTokens ?? 0)
      usage.totalTokens = (usage.totalTokens ?? 0) + (response.usage.totalTokens ?? 0)
      const decoded = JSON.parse(response.content)
      if (directorPlanSchema.safeParse(decoded).success) rawSchemaPasses += 1
      const parsed = directorPlanSchema.safeParse(normalizeDirectorPlan(decoded))
      if (parsed.success) {
        normalizedSchemaPasses += 1
        return {
          ok: true,
          plan: parsed.data,
          attempts: attempt,
          usage,
          raw: response.content,
          rawSchemaPasses,
          normalizedSchemaPasses,
          responseCount,
        }
      }
      errors.push(...parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`))
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { ok: false, attempts: 2, errors, usage, rawSchemaPasses, normalizedSchemaPasses, responseCount }
}

export const directorPlannerPrompt = prompt
