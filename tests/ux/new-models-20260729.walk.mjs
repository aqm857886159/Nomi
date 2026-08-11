// R13：2026-07-29 新接 5 个 apimart 模型的真机走查——每个节点选中后截图，人眼验：
//   模型名/模式段（Vidu 参考生 · HH1.1 三模式 · Wan 角色参考）/变体段（Vidu 标准|Mix）/参数条/参考槽。
// 用法: node tests/ux/new-models-20260729.walk.mjs（先 pnpm build，走 dist 产物）
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
const shotsDir = path.join(repoRoot, 'tests/ux/shots/new-models-20260729')
fs.mkdirSync(shotsDir, { recursive: true })

const base = '/tmp/nomi-new-models-20260729'
const settingsDir = path.join(base, 'settings'); const projectsDir = path.join(base, 'projects')
fs.rmSync(base, { recursive: true, force: true }); fs.mkdirSync(settingsDir, { recursive: true }); fs.mkdirSync(projectsDir, { recursive: true })
const realCatalog = '/Users/aoqimin/Library/Application Support/nomi/model-catalog.json'
if (fs.existsSync(realCatalog)) fs.copyFileSync(realCatalog, path.join(settingsDir, 'model-catalog.json'))

const mk = (id, kind, x, y, meta) => ({ id, kind, title: id, position: { x, y }, size: { width: 340, height: 270 }, prompt: '镜头', references: [], history: [], status: 'idle', categoryId: 'shots', shotIndex: 1, renderKind: 'shot-frame', meta })
const nodes = [
  mk('n-vidu', 'video', 120, 120, { modelKey: 'viduq3', modelLabel: 'Vidu Q3', modelVendor: 'apimart', archetype: { id: 'vidu-q3', modeId: 'ref', variantId: 'standard' } }),
  mk('n-klingturbo', 'video', 520, 120, { modelKey: 'kling-3.0-turbo', modelLabel: '可灵 3.0 Turbo', modelVendor: 'apimart', archetype: { id: 'kling-3.0-turbo', modeId: 't2v' } }),
  mk('n-hh11', 'video', 920, 120, { modelKey: 'happyhorse-1.1', modelLabel: 'HappyHorse 1.1', modelVendor: 'apimart', archetype: { id: 'happyhorse-1.1', modeId: 'ref' } }),
  mk('n-s5pro', 'image', 120, 480, { modelKey: 'doubao-seedream-5-0-pro', modelLabel: 'Seedream 5.0 Pro', modelVendor: 'apimart', archetype: { id: 'seedream-5-pro', modeId: 'edit' } }),
  mk('n-wanref', 'video', 520, 480, { modelKey: 'wan2.7', modelLabel: 'Wan 2.7', modelVendor: 'apimart', archetype: { id: 'wan-2.7', modeId: 'ref' } }),
]
const projectId = 'new-models-0001'
const projDir = path.join(projectsDir, `new-models-${projectId}`)
fs.mkdirSync(path.join(projDir, '.nomi'), { recursive: true })
const tmpl = JSON.parse(fs.readFileSync('/Users/aoqimin/Documents/Nomi Projects/未命名项目 06_18 11_56-mqiyx4om-5e071915/.nomi/project.json', 'utf8'))
tmpl.id = projectId; tmpl.name = '新模型走查'; tmpl.lastKnownRootPath = projDir
tmpl.payload.generationCanvas = { nodes, edges: [], selectedNodeIds: [], groups: [] }
fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(tmpl))
fs.writeFileSync(path.join(projDir, '.nomi', 'project.json'), JSON.stringify(tmpl))

let n = 0
const snap = async (win, name) => { n += 1; await win.screenshot({ path: path.join(shotsDir, `${String(n).padStart(2,'0')}-${name}.png`) }); console.log(`  · shot ${name}`) }

const { app, win } = await launchNomiApp({ name: 'new-models-20260729', userDataDir: settingsDir, settingsDir, projectsDir })
await win.evaluate(() => { for (const k of ['nomi:splash:v1','nomi:journey-tour:v1','nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k,'seen') })
await win.reload(); await win.waitForTimeout(1500)
for (let i=0;i<6;i++){ const s=win.locator('button,[role="button"],a',{hasText:/跳过|开始创作|进入|完成/}).first(); if(await s.count()) await s.click({timeout:1200}).catch(()=>{}); await win.keyboard.press('Escape').catch(()=>{}); await win.waitForTimeout(300) }
const card = win.getByText('新模型走查',{exact:false}).first()
if (await card.count()) { await card.click({timeout:4000}).catch(()=>{}); await win.waitForTimeout(400); const ok=win.getByText('继续创作',{exact:false}).first(); if(await ok.count()) await ok.click({timeout:3000}).catch(()=>{}) }
await win.waitForTimeout(3000)
await snap(win, 'canvas-overview')

// 逐节点点标题选中 → 截图（composer card 含模式段/变体段/参数条/槽）。
const boxes = await win.evaluate(() => Array.from(document.querySelectorAll('.generation-canvas-v2-node')).map(el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+14)}}))
console.log('  nodes found:', boxes.length)
const names = ['vidu-q3-ref','kling-turbo-t2v','hh11-ref','seedream5pro-edit','wan27-ref']
for (let i = 0; i < boxes.length && i < names.length; i += 1) {
  const b = boxes[i]
  await win.mouse.click(b.x, b.y).catch(()=>{}); await win.waitForTimeout(600)
  await snap(win, names[i])
}
await app.close()
console.log('done · shots →', shotsDir)
