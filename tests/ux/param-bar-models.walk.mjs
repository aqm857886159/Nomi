// R13：验证「主次分层」底栏对其它参数多的模型同样统一生效（seedream 7参数 / wan 含负向提示 / kling）。
// 用法: node tests/ux/param-bar-models.walk.mjs
// 隔离真 catalog + 构造含 3 个参数多模型节点的项目,逐个选中量底栏宽度+点「更多」截图。
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/parambar-models')
fs.mkdirSync(shotsDir, { recursive: true })

const base = '/tmp/nomi-parambar-models'
const settingsDir = path.join(base, 'settings'); const projectsDir = path.join(base, 'projects')
fs.rmSync(base, { recursive: true, force: true }); fs.mkdirSync(settingsDir, { recursive: true }); fs.mkdirSync(projectsDir, { recursive: true })
const realCatalog = '/Users/aoqimin/Library/Application Support/nomi/model-catalog.json'
if (fs.existsSync(realCatalog)) fs.copyFileSync(realCatalog, path.join(settingsDir, 'model-catalog.json'))

const mk = (id, kind, x, y, meta) => ({ id, kind, title: id, position: { x, y }, size: { width: 340, height: 270 }, prompt: '镜头', references: [], history: [], status: 'idle', categoryId: 'shots', shotIndex: 1, renderKind: 'shot-frame', meta })
const nodes = [
  mk('n-seedream', 'image', 120, 120, { modelKey: 'doubao-seedream-4.5', modelLabel: 'Seedream 4.5', modelVendor: 'apimart', archetype: { id: 'seedream', modeId: 't2i' } }),
  mk('n-wan', 'video', 520, 120, { modelKey: 'wan2.7', modelLabel: 'Wan 2.7', modelVendor: 'apimart', archetype: { id: 'wan-2.7', modeId: 't2v' } }),
  mk('n-kling', 'video', 920, 120, { modelKey: 'kling-3.0', modelLabel: 'Kling 3.0', modelVendor: 'kie', archetype: { id: 'kling-3.0', modeId: 't2v' } }),
]
// 用真实项目当模板(完整合法 payload 才能 hydrate 进画布),只替换 generationCanvas.nodes 为我的 3 个节点。
const projectId = 'parambar-models-0001'
const projDir = path.join(projectsDir, `parambar-models-${projectId}`)
fs.mkdirSync(path.join(projDir, '.nomi'), { recursive: true })
const tmpl = JSON.parse(fs.readFileSync('/Users/aoqimin/Documents/Nomi Projects/未命名项目 06_18 11_56-mqiyx4om-5e071915/.nomi/project.json', 'utf8'))
tmpl.id = projectId; tmpl.name = '多模型参数栏验证'; tmpl.lastKnownRootPath = projDir
tmpl.payload.generationCanvas = { nodes, edges: [], selectedNodeIds: [], groups: [] }
fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(tmpl))
fs.writeFileSync(path.join(projDir, '.nomi', 'project.json'), JSON.stringify(tmpl))

let n = 0
const snap = async (win, name) => { n += 1; await win.screenshot({ path: path.join(shotsDir, `${String(n).padStart(2,'0')}-${name}.png`) }); console.log(`  · shot ${name}`) }

const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${settingsDir}`], cwd: repoRoot, env: { ...process.env, NOMI_SETTINGS_DIR: settingsDir, NOMI_PROJECTS_DIR: projectsDir } })
const win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded'); await win.waitForTimeout(1500)
await win.evaluate(() => { for (const k of ['nomi:splash:v1','nomi:journey-tour:v1','nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k,'seen') })
await win.reload(); await win.waitForTimeout(1500)
for (let i=0;i<6;i++){ const s=win.locator('button,[role="button"],a',{hasText:/跳过|开始创作|进入|完成/}).first(); if(await s.count()) await s.click({timeout:1200}).catch(()=>{}); await win.keyboard.press('Escape').catch(()=>{}); await win.waitForTimeout(300) }
const card = win.getByText('多模型参数栏验证',{exact:false}).first()
if (await card.count()) { await card.click({timeout:4000}).catch(()=>{}); await win.waitForTimeout(400); const ok=win.getByText('继续创作',{exact:false}).first(); if(await ok.count()) await ok.click({timeout:3000}).catch(()=>{}) }
await win.waitForTimeout(3000)
await snap(win, 'canvas')

const nodeBoxes = await win.evaluate(() => Array.from(document.querySelectorAll('.generation-canvas-v2-node')).map(el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+14)}}).filter(b=>b.y>60&&b.y<560))
console.log('  nodes:', nodeBoxes.length)
const results = []
for (const b of nodeBoxes.slice(0,5)) {
  await win.mouse.click(b.x, b.y).catch(()=>{}); await win.waitForTimeout(500)
  const m = await win.evaluate(() => {
    const card = document.querySelector('.generation-canvas-v2-node__composer-card')
    if (!card) return null
    const txt = card.textContent || ''
    const model = (txt.match(/Seedream|Wan|Kling|Seedance/) || ['?'])[0]
    return { model, cardW: Math.round(card.getBoundingClientRect().width), clip: card.scrollWidth > card.clientWidth + 1, hasMore: /更多/.test(txt) }
  })
  if (!m) continue
  results.push(m)
  console.log(`  ${m.model}: cardW=${m.cardW} clip=${m.clip} 更多=${m.hasMore}`)
  await snap(win, `bar-${m.model}`)
  if (m.hasMore) { const mb=win.locator('button[aria-label="更多参数"]').first(); if(await mb.count()){ await mb.click({timeout:2000}).catch(()=>{}); await win.waitForTimeout(400); await snap(win, `more-${m.model}`); await win.keyboard.press('Escape').catch(()=>{}) } }
}
console.log('  RESULT anyClip=', results.some(r=>r.clip), '| maxCardW=', Math.max(0,...results.map(r=>r.cardW)))
await app.close()
console.log(`\n截图在 ${shotsDir}`)
