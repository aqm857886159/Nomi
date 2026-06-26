// 一次性脚本：用真 Nomi(headless host + 真 key)生成引导示例片「修好一个小机器人」的 10 张成图。
// 2 角色参考(kid/robot) → 8 镜头(用参考图锁跨镜一致)。下载进仓库 assets。NOMI_LOOP_SPEND_OK=1=已授权。
import { invoke } from './lib/nomiClient.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ENV = { NOMI_LOOP_SPEND_OK: '1' }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'src/workbench/onboarding/assets/robot')
fs.mkdirSync(OUT, { recursive: true })

const STYLE = 'warm cinematic 3D animated movie still, Pixar-like, soft golden dusk lighting, cozy heartwarming, shallow depth of field, high detail, 16:9 aspect ratio.'
const KID = 'a 10-year-old boy, short black hair, round friendly face, big curious warm eyes, wearing a mustard-yellow hooded sweatshirt and a small grey backpack'
const ROBOT = 'a small palm-sized round-headed retro robot, scuffed matte-silver body, a single warm glowing amber light on its chest, big round eyes, clumsy and adorable'
const MODEL = { vendor: 'apimart', modelKey: 'gemini-2.5-flash-image-preview', intent: 'image' }

async function gen(projectId, prompt, references) {
  const r = await invoke('generate', { projectId, ...MODEL, prompt, ...(references && references.length ? { references } : {}) }, { spawnEnv: ENV })
  const a = (r.assets || [])[0]
  const u = a?.providerUrl || a?.url
  if (!u) throw new Error('no asset url: ' + JSON.stringify(r))
  return u
}

async function download(url, file) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download ${file} HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(path.join(OUT, file), buf)
  console.log('SAVED', file, buf.length, 'bytes')
}

const proj = (await invoke('project.create', { name: '_robot-demo-stills' })).id
console.log('PROJECT', proj)

const kid = await gen(proj, `Character reference sheet, single character centered on a soft neutral cream background, ${STYLE} The character: ${KID}. Full body, three-quarter front view, gentle hopeful expression.`)
console.log('kid', kid); await download(kid, 'kid.png')
const robot = await gen(proj, `Character reference sheet, single object centered on a soft neutral cream background, ${STYLE} The object: ${ROBOT}. Three-quarter view.`)
console.log('robot', robot); await download(robot, 'robot.png')

const refs = [kid, robot]
const shots = [
  ['shot-1', `Wide establishing shot of a dim dusk alley. ${ROBOT}, lying tilted and broken against a brick wall, scattered parts on the ground, warm rim light. ${STYLE}`, [robot]],
  ['shot-2', `Medium shot. ${KID}, crouching down curiously looking at the small broken robot in the alley. ${STYLE}`, refs],
  ['shot-3', `Tracking shot from behind. ${KID}, carrying the small robot home through the quiet dusk street. ${STYLE}`, refs],
  ['shot-4', `Close-up of small hands under a warm desk lamp. ${KID}, repairing the small robot with a tiny screwdriver, focused. ${STYLE}`, refs],
  ['shot-5', `Extreme close-up. ${ROBOT} — its chest amber light flicking on and its round eyes lighting up. ${STYLE}`, [robot]],
  ['shot-6', `Cozy two-shot in a warm room. ${KID} and the small robot looking at each other, the robot tilting its head. ${STYLE}`, refs],
  ['shot-7', `Medium shot on a city rooftop at dusk. ${KID} and the small robot sitting side by side, seen from behind, distant skyline glowing orange. ${STYLE}`, refs],
  ['shot-8', `Wide cinematic shot. Silhouettes of ${KID} and the small robot on a rooftop at sunset, camera pulling far back, vast orange-gold sky. ${STYLE}`, refs],
]
const manifest = { kid: 'kid.png', robot: 'robot.png' }
for (const [id, prompt, r] of shots) {
  const u = await gen(proj, prompt, r)
  console.log(id, u)
  await download(u, id + '.png')
  manifest[id] = id + '.png'
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log('ALL DONE', JSON.stringify(manifest))
