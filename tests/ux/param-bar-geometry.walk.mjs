// R13 几何实测：D2 参数栏在「多供应商 Seedance」下是否截断（供应商下拉 + 多参数 pill 超 880px）。
// 用法: node tests/ux/param-bar-geometry.walk.mjs
// 隔离复制真 catalog(含 seedance 多供应商=D2 触发条件) + 一个真实 Seedance 项目的 project.json，
// 不碰用户真实数据。选中视频节点后量 composer 卡 / 参数栏 / 生成钮的几何，判断是否裁切。
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/parambar')
fs.mkdirSync(shotsDir, { recursive: true })

const base = '/tmp/nomi-parambar'
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

// 复制真 catalog（含 seedance 4 供应商 → 供应商下拉出现）
const realCatalog = '/Users/aoqimin/Library/Application Support/nomi/model-catalog.json'
if (fs.existsSync(realCatalog)) fs.copyFileSync(realCatalog, path.join(settingsDir, 'model-catalog.json'))

// 复制一个真实 Seedance 多视频节点项目的 project.json（只 project.json，不要 assets——量参数栏不需要真图）
const srcProj = '/Users/aoqimin/Documents/Nomi Projects/未命名项目 06_18 11_56-mqiyx4om-5e071915/.nomi/project.json'
const dstDir = path.join(projectsDir, 'parambar-walk')
fs.mkdirSync(path.join(dstDir, '.nomi'), { recursive: true })
const proj = JSON.parse(fs.readFileSync(srcProj, 'utf8'))
proj.name = '参数栏几何实测'
fs.writeFileSync(path.join(dstDir, '.nomi', 'project.json'), JSON.stringify(proj))

let n = 0
const snap = async (win, name) => { n += 1; await win.screenshot({ path: path.join(shotsDir, `${String(n).padStart(2,'0')}-${name}.png`) }); console.log(`  · shot ${name}`) }

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${settingsDir}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_SETTINGS_DIR: settingsDir, NOMI_PROJECTS_DIR: projectsDir },
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)
await win.evaluate(() => { for (const k of ['nomi:splash:v1','nomi:journey-tour:v1','nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k,'seen') })
await win.reload(); await win.waitForTimeout(1500)
for (let i=0;i<6;i++){ const s=win.locator('button,[role="button"],a',{hasText:/跳过|开始创作|进入|完成/}).first(); if(await s.count()) await s.click({timeout:1200}).catch(()=>{}); await win.keyboard.press('Escape').catch(()=>{}); await win.waitForTimeout(300) }

// 开项目
const card = win.getByText('参数栏几何实测',{exact:false}).first()
if (await card.count()) { await card.click({timeout:4000}).catch(()=>{}); await win.waitForTimeout(400); const ok=win.getByText('继续创作',{exact:false}).first(); if(await ok.count()) await ok.click({timeout:3000}).catch(()=>{}) }
await win.waitForTimeout(3000)
const inCanvas = await win.evaluate(()=>/生成方式|全能参考|导出|时间轴/.test(document.body.innerText)&&!/Nomi 项目库/.test(document.body.innerText))
console.log('  inCanvas=', inCanvas)
await snap(win, 'canvas')

// 缩小画布把更多节点（含视频节点）带进视口：在画布中央 Ctrl+滚轮缩小几次。
for (let i=0;i<6;i++){ await win.mouse.move(700,380); await win.keyboard.down('Control'); await win.mouse.wheel(0,120); await win.keyboard.up('Control'); await win.waitForTimeout(120) }
await win.waitForTimeout(500)
await snap(win, 'zoomed-out')
// 遍历所有可见节点：逐个选中，记录每个 composer 卡的几何 + 是否视频节点 + 供应商下拉，报最大值。
const nodeBoxes = await win.evaluate(() => Array.from(document.querySelectorAll('.generation-canvas-v2-node')).map(el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+12)}}).filter(b=>b.y>60&&b.y<700&&b.x>200&&b.x<1180))
console.log('  node candidates:', nodeBoxes.length)
const measures = []
for (const b of nodeBoxes.slice(0, 18)) {
  await win.mouse.click(b.x, b.y).catch(()=>{})
  await win.waitForTimeout(350)
  const m = await win.evaluate(() => {
    const card = document.querySelector('.generation-canvas-v2-node__composer-card')
    const bar = document.querySelector('.generation-canvas-v2-node__params--parameters')
    if (!card) return null
    const txt = card.textContent || ''
    return {
      cardW: card.getBoundingClientRect().width,
      cardClip: card.scrollWidth > card.clientWidth + 1,
      barW: bar ? bar.getBoundingClientRect().width : 0,
      barOverflow: bar ? bar.scrollWidth > bar.clientWidth + 1 : false,
      isVideo: /全能参考|首尾帧|图生视频|时长|生成音频/.test(txt),
      hasProvider: /供应商/.test(txt),
      hasNegPrompt: /负向|negative/i.test(txt),
    }
  })
  if (m) measures.push(m)
}
const videoM = measures.filter(m=>m.isVideo)
const maxCard = measures.reduce((a,m)=>Math.max(a,m.cardW),0)
const anyClip = measures.some(m=>m.cardClip||m.barOverflow)
console.log('  measured nodes:', measures.length, '| video nodes:', videoM.length)
console.log('  max card width:', Math.round(maxCard), 'px (cap=880)')
console.log('  any clip/overflow:', anyClip)
console.log('  any provider dropdown:', measures.some(m=>m.hasProvider), '| any negative_prompt:', measures.some(m=>m.hasNegPrompt))
console.log('  video samples:', JSON.stringify(videoM.slice(0,4).map(m=>({cardW:Math.round(m.cardW),clip:m.cardClip,provider:m.hasProvider}))))
await snap(win, 'node-selected')
const geo = { maxCard: Math.round(maxCard), anyClip }
console.log('  GEO=', JSON.stringify(geo))

// 方案 B：点「更多」弹层，截图看收纳的参数
const moreBtn = win.locator('button[aria-label="更多参数"]').first()
console.log('  更多按钮数:', await moreBtn.count())
if (await moreBtn.count()) {
  await moreBtn.click({ timeout: 3000 }).catch(() => {})
  await win.waitForTimeout(500)
  await snap(win, 'more-popover')
}
await app.close()
console.log(`\n截图在 ${shotsDir}`)
