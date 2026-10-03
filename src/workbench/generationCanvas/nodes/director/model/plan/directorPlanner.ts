import { directorPlanSchema, type DirectorPlan } from './directorPlanSchema'

export type PlannerUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number; estimatedUsd?: number }
export type PlannerResult = { ok: true; plan: DirectorPlan; attempts: number; usage: PlannerUsage; raw: string } | { ok: false; attempts: number; errors: string[]; usage: PlannerUsage }

const SYSTEM = `You are a deterministic film director planner. Return one JSON object matching the Director Plan v2 schema. Never emit xyz coordinates, positions, rotations, distances, or camera coordinates. Express spatial intent with actor placement relations, blocking verbs, shot size, angle, height and camera move. Follow cinematography principles: a shot serves narrative or emotion, static is valid, dialogue defaults to medium, and preserve the 180 degree axis. Use windows in seconds.\nSchema keys: scene(tags,environment,template?,dressing?,setPieces), actors(id,kind,desc,anchors?,placement), blocking(actor,verb,target?,window,action?), shots(id,window,transitionIn,subject,subjects?,size,angle,height,move(kind,direction?,amount?,speed,easing)). If dressing is present it must be an AiSceneSpec object with groups, each group containing elements; omit dressing when unsure. setPieces must be objects like {id,kind,relation:{type,ref}}, never strings. Valid placement relations are near,in_front_of,behind,left_of,right_of,on,between,along,at.\nCinematography skill points: framing is psychological distance; movement needs a narrative/emotional reason; blocking, camera and focus form one causal chain; over-shoulder keeps 20-30% foreground shoulder; POV binds camera to the actor eye; ease-in/ease-out changes attention.`

const EXAMPLES = [
  { scene: { tags: ['courtyard', 'standoff'], environment: 'day', template: 'courtyard', setPieces: [] }, actors: [{ id: 'a', kind: 'person', desc: 'detective', placement: { relation: 'at', ref: 's1-courtyard-ground' } }, { id: 'b', kind: 'person', desc: 'suspect', placement: { relation: 'right_of', ref: 'a' } }], blocking: [{ actor: 'a', verb: 'walk_to', target: 'b', window: [0, 3] }], shots: [{ id: 'establish', window: [0, 2], transitionIn: 'cut', subject: 'a', size: '全景', angle: 'front', height: 'eye', move: { kind: 'static', speed: 'slow', easing: 'linear' } }, { id: 'push', window: [2, 5], transitionIn: 'cut', subject: 'b', size: '近景', angle: { over_shoulder: 'a' }, height: 'eye', move: { kind: 'push_in', amount: 1, speed: 'slow', easing: 'ease_out' } }] },
  { scene: { tags: ['product'], environment: 'studio', template: 'product_stage', setPieces: [] }, actors: [{ id: 'bottle', kind: 'product', desc: 'glass perfume bottle', placement: { relation: 'at', ref: 's1-product-pedestal' } }], blocking: [], shots: [{ id: 'orbit', window: [0, 5], transitionIn: 'cut', subject: 'bottle', size: '特写', angle: 'front', height: 'eye', move: { kind: 'orbit_right', amount: 270, speed: 'medium', easing: 'linear' } }] },
  { scene: { tags: ['ambiguous', 'night'], environment: 'night', template: 'street', setPieces: [] }, actors: [{ id: 'lead', kind: 'person', desc: 'a lone traveler', placement: { relation: 'at', ref: 's1-street-ground' } }], blocking: [{ actor: 'lead', verb: 'hold_pose', window: [0, 4], action: 'standing_idle' }], shots: [{ id: 'mood', window: [0, 4], transitionIn: 'cut', subject: 'lead', size: '中景', angle: 'three_quarter', height: 'low', move: { kind: 'static', speed: 'slow', easing: 'ease_in_out' } }] },
]

function prompt(description: string): string {
  return `${SYSTEM}\nThree valid examples:\n${EXAMPLES.map(example => JSON.stringify(example)).join('\n')}\nUser brief:\n${description.trim()}\nReturn JSON only.`
}

async function callModel(system: string, user: string): Promise<{ content: string; usage: PlannerUsage }> {
  const key = process.env.NOMI_LOOP_LLM_KEY
  if (!key) throw new Error('NOMI_LOOP_LLM_KEY is not set')
  const base = (process.env.NOMI_LOOP_LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
  const model = process.env.NOMI_LOOP_LLM_MODEL || 'deepseek-flash'
  const response = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) })
  if (!response.ok) throw new Error(`LLM ${response.status}: ${(await response.text()).slice(0, 240)}`)
  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }
  return { content: json.choices?.[0]?.message?.content ?? '', usage: { inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens, totalTokens: json.usage?.total_tokens } }
}

export async function planDirector(description: string): Promise<PlannerResult> {
  const errors: string[] = [], usage: PlannerUsage = {}
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const retryHint = attempt > 1 && errors.length ? `\nYour previous JSON failed validation. Correct these exact errors and return the complete JSON again: ${errors.join(' | ')}` : ''
      const response = await callModel(SYSTEM, prompt(description) + retryHint);
      usage.inputTokens = (usage.inputTokens ?? 0) + (response.usage.inputTokens ?? 0); usage.outputTokens = (usage.outputTokens ?? 0) + (response.usage.outputTokens ?? 0); usage.totalTokens = (usage.totalTokens ?? 0) + (response.usage.totalTokens ?? 0)
      const parsed = directorPlanSchema.safeParse(JSON.parse(response.content))
      if (parsed.success) return { ok: true, plan: parsed.data, attempts: attempt, usage, raw: response.content }
      errors.push(...parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`))
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
  }
  return { ok: false, attempts: 2, errors, usage }
}

export const directorPlannerPrompt = prompt
