// 悬空 Tailwind 类修复的 R13 走查 —— 亮/暗各走一遍，证明「类名 → 真有 CSS → 真上色」。
//
// 背景：Tailwind 对 config 里不存在的 token 键**不报错也不生成 CSS**，声明静默失效、元素掉回继承色。
// main 上有 51 处这样的悬空类，最值钱的是 `text-workbench-success-ink` ×10 —— CSS 变量
// --workbench-success-ink（明 #248a3d / 暗 #7ee8aa）一直都在，只是漏了 theme.extend.colors 的映射，
// 于是全 App「已完成」绿字/绿勾一直是继承色（近黑）。
//
// 核心断言比截图更硬：**同一个颜色，用 Tailwind 类渲染 与 用 var() 直写，必须落在同一个 RGB**。
//   · 映射缺失：类不生成 CSS → 探针 = 继承色 ≠ var() 色 → 分叉，红。
//   · 映射就位：两者同色（差 ≤2/255，tokenColor() 的 color-mix 包装有极小舍入）。
// 不依赖「肉眼看着像绿的」，也绕开 oklch/oklab 序列化格式坑（一律画到 canvas 取 RGB）。
//
// ⚠️ 探针类名必须是**源码里真实出现过的字面量**：Tailwind JIT 只生成 content 扫得到的类，
// 拼接出来的 `text-${key}` 它没见过 → 不生成 → 探针恒等于继承色，会把「修好了」误判成「仍悬空」。
// 所以下面的待测清单从 src 现扫（derive，不手抄），扫不到消费者的键单独列为「已映射待用」。
//
// 用法: NOMI_E2E=1 node tests/ux/dangling-tailwind-tokens.walk.mjs
// 产出: tests/ux/shots/dangling-tailwind/*.png + 控制台逐类的 类色/var色/继承色 三方对比。
//       截图必须人眼 Read 确认（R13 眼见链），控制台数字是佐证。
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/dangling-tailwind')
fs.mkdirSync(shotsDir, { recursive: true })

const userData = process.env.NOMI_UI_USER_DATA || path.join(repoRoot, '.tmp', 'nomi-dangling-tailwind-userdata')
fs.mkdirSync(userData, { recursive: true })

/** 本次补进 theme.extend.colors 的键 → 背后 CSS 变量。断言从运行时现算，这里不写死任何颜色值。 */
const FIXED_KEYS = [
  ['workbench-success-ink', '--workbench-success-ink', '「已完成」绿字/绿勾'],
  ['workbench-video', '--workbench-video', 'ClipNode 时间轴段描边'],
  ['workbench-video-soft', '--workbench-video-soft', 'ClipNode 时间轴段底色'],
  ['workbench-audio', '--workbench-audio', '音频轨（同族补映射）'],
  ['workbench-audio-soft', '--workbench-audio-soft', '音频轨底（同族补映射）'],
  ['workbench-text', '--workbench-text', '文字轨（同族补映射）'],
  ['workbench-text-soft', '--workbench-text-soft', '文字轨底（同族补映射）'],
  ['nomi-danger-soft', '--nomi-danger-soft', '错误行浅底（新增 token）'],
  ['nomi-warning-soft', '--nomi-warning-soft', '警示横幅浅底（新增 token）'],
  ['nomi-track-video', '--nomi-track-video', 'ComfyUI 在线点 / 拆解面板'],
  ['nomi-track-image', '--nomi-track-image', '图片轨（同族补映射）'],
  ['nomi-track-text', '--nomi-track-text', '文本轨（同族补映射）'],
]

/** ink 阶梯：站点原本写了不存在的 35/45/50/55/65/70，掉回继承色 = 层级被压平。 */
const INK_STEPS = ['nomi-ink', 'nomi-ink-80', 'nomi-ink-60', 'nomi-ink-40', 'nomi-ink-30', 'nomi-ink-20']

// css=写进 style 文本用的属性名（必须 kebab），js=读 getComputedStyle 用的属性名（必须 camel）。
// 混用会静默失败：`backgroundColor:var(--x)` 塞进 cssText 是无效声明，探针恒为透明 → 假红。
const UTIL_PROP = {
  text: { css: 'color', js: 'color' },
  bg: { css: 'background-color', js: 'backgroundColor' },
  border: { css: 'border-color', js: 'borderColor' },
  fill: { css: 'fill', js: 'fill' },
  stroke: { css: 'stroke', js: 'stroke' },
}

/** 从 src 现扫出每个键的真实字面类名（JIT 只认这些，**连 `/60` 透明度修饰符一起**）。 */
function discoverUsages() {
  const files = []
  ;(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx|css)$/.test(e.name)) files.push(p)
    }
  })(path.join(repoRoot, 'src'))

  const found = new Map() // "util-key" -> { util, key, cssVar, note, sites:[] }
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    text.split('\n').forEach((line, i) => {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
      for (const [key, cssVar, note] of FIXED_KEYS) {
        const re = new RegExp(`(?<![\\w-])(${Object.keys(UTIL_PROP).join('|')})-${key}(/[0-9]+)?(?![\\w-])`, 'g')
        let m
        while ((m = re.exec(line))) {
          const alpha = m[2] ? Number(m[2].slice(1)) : 100
          const cls = `${m[1]}-${key}${m[2] ?? ''}`
          if (!found.has(cls)) found.set(cls, { util: m[1], key, cssVar, note, alpha, sites: [] })
          found.get(cls).sites.push(`${path.relative(repoRoot, file)}:${i + 1}`)
        }
      }
    })
  }
  return found
}

const usages = discoverUsages()
const probes = [...usages.entries()].map(([cls, v]) => ({ cls, ...v })).sort((a, b) => a.cls.localeCompare(b.cls))
const unusedKeys = FIXED_KEYS.filter(([k]) => ![...usages.values()].some((v) => v.key === k)).map(([k]) => k)

let n = 0
async function snap(win, name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await screenshotSettled(win, { path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
}

/**
 * 对每个真实类名，在同一父容器里放两个探针：A) 挂类名 B) 直写 var()。
 * 父容器显式染成 body 默认文字色 —— 即映射缺失时会掉回的继承色。
 */
async function measure(win, list) {
  return win.evaluate((items) => {
    const toRgb = (css) => {
      const c = document.createElement('canvas')
      c.width = c.height = 1
      const x = c.getContext('2d')
      x.fillStyle = '#000'
      x.fillStyle = css
      x.fillRect(0, 0, 1, 1)
      return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }
    const inheritedCss = getComputedStyle(document.body).color
    const host = document.createElement('div')
    host.style.cssText = `position:fixed;left:-9999px;top:0;color:${inheritedCss};border-color:${inheritedCss}`
    document.body.appendChild(host)

    const out = []
    for (const it of items) {
      const viaClass = document.createElement('span')
      viaClass.className = it.cls
      viaClass.style.cssText = 'display:inline-block;width:20px;height:20px;border-style:solid;border-width:2px'
      viaClass.textContent = 'x'
      const viaVar = document.createElement('span')
      // 参照值必须复刻 tokenColor() 在 config 里的写法（color-mix 包 <alpha-value>），
      // 带 `/60` 修饰的类才对得上；不带修饰时 100% 与原色恒等。
      const ref = `color-mix(in oklch, var(${it.cssVar}) ${it.alpha}%, transparent)`
      viaVar.style.cssText = `display:inline-block;width:20px;height:20px;border-style:solid;border-width:2px;${it.cssProp}:${ref}`
      viaVar.textContent = 'x'
      host.append(viaClass, viaVar)
      const classRgb = toRgb(getComputedStyle(viaClass)[it.jsProp])
      const varRgb = toRgb(getComputedStyle(viaVar)[it.jsProp])
      viaClass.remove()
      viaVar.remove()
      out.push({ ...it, classRgb, varRgb, inheritedRgb: toRgb(inheritedCss) })
    }
    host.remove()
    return { scheme: document.documentElement.getAttribute('data-mantine-color-scheme'), rows: out }
  }, list)
}

/** 真 App 里画「修复前(继承色) vs 修复后(类名生效)」对照带。 */
async function paintProof(win, list, inkSteps) {
  await win.evaluate(
    ({ items, steps }) => {
      document.getElementById('nomi-dangling-proof')?.remove()
      const box = document.createElement('div')
      box.id = 'nomi-dangling-proof'
      box.style.cssText =
        'position:fixed;z-index:2147483647;left:50%;top:20px;transform:translateX(-50%);width:780px;' +
        'max-height:90vh;overflow:auto;padding:16px;border-radius:12px;background:var(--nomi-paper);' +
        'border:1px solid var(--nomi-line);box-shadow:0 12px 40px rgba(0,0,0,.35);' +
        'font:12px/1.45 system-ui;color:var(--nomi-ink)'
      const scheme = document.documentElement.getAttribute('data-mantine-color-scheme')
      const title = document.createElement('div')
      title.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:4px'
      title.textContent = `悬空 Tailwind 类修复对照（${scheme}）`
      const sub = document.createElement('div')
      sub.style.cssText = 'color:var(--nomi-ink-60);margin-bottom:10px'
      sub.textContent = '左列=修复前（类名无 CSS，掉回继承色） 右列=修复后（类名生效）'
      box.append(title, sub)

      for (const it of items) {
        const row = document.createElement('div')
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:3px 0'
        const name = document.createElement('code')
        name.style.cssText = 'flex:0 0 220px;font:11px ui-monospace,monospace;color:var(--nomi-ink-60)'
        name.textContent = it.cls
        const mk = (withClass) => {
          const s = document.createElement('span')
          if (withClass) s.className = it.cls
          if (it.util === 'text') {
            s.style.cssText = 'flex:0 0 110px;font-weight:600'
            s.textContent = '✓ 已完成'
          } else {
            s.style.cssText = 'flex:0 0 110px;height:20px;border-radius:4px;border-style:solid;border-width:2px'
            if (!withClass) s.style.border = '2px solid currentColor'
          }
          return s
        }
        const desc = document.createElement('span')
        desc.style.cssText = 'flex:1;color:var(--nomi-ink-40)'
        desc.textContent = it.note
        row.append(name, mk(false), mk(true), desc)
        box.appendChild(row)
      }

      const sep = document.createElement('div')
      sep.style.cssText = 'margin:12px 0 6px;font-weight:600;font-size:13px'
      sep.textContent = 'ink 阶梯（悬空的 35/45/50/55/65/70 已按层级归位到这些真实档位）'
      box.appendChild(sep)
      const ladder = document.createElement('div')
      ladder.style.cssText = 'display:flex;gap:8px'
      for (const s of steps) {
        const cell = document.createElement('div')
        cell.style.cssText = 'flex:1;text-align:center'
        const sw = document.createElement('div')
        sw.className = `bg-${s}`
        sw.style.cssText = 'height:34px;border-radius:6px;border:1px solid var(--nomi-line)'
        const lb = document.createElement('div')
        lb.className = `text-${s}`
        lb.style.cssText = 'margin-top:3px;font:10px ui-monospace,monospace'
        lb.textContent = s.replace('nomi-', '')
        cell.append(sw, lb)
        ladder.appendChild(cell)
      }
      box.appendChild(ladder)
      document.body.appendChild(box)
    },
    { items: list, steps: inkSteps },
  )
  await win.waitForTimeout(350)
}

async function setScheme(win, scheme) {
  await win.evaluate((s) => {
    window.localStorage.setItem('nomi-color-scheme', s)
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      window.localStorage.setItem(k, 'seen')
    }
  }, scheme)
  await win.reload()
  await win.waitForTimeout(1200)
}

/**
 * 停在项目工作台而不是库页 —— 画布/时间轴才是这批 token 的真实消费面。库里没项目就先建一个。
 * 每步都等**真实条件**（目标控件可见）而不是睡一个"应该够长"的觉：建项目/首启耗时随磁盘波动，
 * 固定 sleep 短了就读到空、长了白等，两头都不对。
 */
async function ensureInProject(win) {
  const enterBtn = () => win.getByRole('button', { name: /^继续创作/ }).first()
  if (!(await enterBtn().count())) {
    // 库页那张卡的字面是「新建空白项目」——写成 /新建项目/ 匹配不到（中间夹了「空白」），别再收窄。
    const create = win.locator('button, [role="button"]', { hasText: /新建|创建|开始创作/ }).first()
    if (await create.count()) {
      await create.click({ timeout: 4000 }).catch(() => {})
      await enterBtn().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
    }
  }
  if (await enterBtn().count()) await enterBtn().click({ timeout: 4000 }).catch(() => {})
  const genTab = win.locator('button, [role="tab"]', { hasText: /^生成$/ }).first()
  await genTab.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
  const inWorkbench = await genTab.count()
  // 进不去不判红：对照带是注入到当前页的，与所处面无关，核心断言照常成立；
  // 只是天然消费点扫不到，如实说明而不是假装验过。
  console.log(`  进入项目：${inWorkbench > 0 ? '已在工作台' : '⚠️ 仍在库页（对照带仍有效，天然消费点扫不到）'}`)
  return inWorkbench > 0
}

/** 扫真实 DOM 里天然出现的修复类，证明不只是探针里能上色。 */
async function scanLive(win, list) {
  return win.evaluate((items) => {
    const found = []
    for (const it of items) {
      const els = document.querySelectorAll(`.${CSS.escape(it.cls)}`)
      if (els.length) found.push({ cls: it.cls, count: els.length, value: getComputedStyle(els[0])[it.jsProp] })
    }
    return found
  }, list)
}

console.log(`待测类名（从 src 现扫）：${probes.length} 个`)
for (const p of probes) console.log(`  ${p.cls.padEnd(28)} ${p.sites.length} 处  e.g. ${p.sites[0]}`)
if (unusedKeys.length) console.log(`已映射但暂无字面消费者（JIT 不生成，真机无法验，仅防同族再漏）：${unusedKeys.join(', ')}`)

// 前置断言之一：扫不到任何消费者就等于这一趟什么都没验。这是「死选择器假绿」的入口——
// 键改名、正则退化、或 src 结构变了，都会让 probes 变空，而后面每一条断言都会"通过"。
if (!probes.length) {
  throw new Error('从 src 扫不到任何本次修复的 token 类名——扫描逻辑或键名已失效，这一趟不会验到任何东西')
}
// 前置断言之二：把头牌钉死。text-workbench-success-ink 是本次修复的核心（10 处「已完成」绿字），
// 它要是从待测集合里消失了，这条走查就失去了存在意义，必须炸而不是安静地少验一项。
if (!probes.some((p) => p.cls === 'text-workbench-success-ink')) {
  throw new Error('待测集合里没有 text-workbench-success-ink——本次修复的头牌不见了，拒绝假绿通过')
}

const probeInput = probes.map((p) => ({
  cls: p.cls,
  util: p.util,
  cssVar: p.cssVar,
  note: p.note,
  alpha: p.alpha,
  cssProp: UTIL_PROP[p.util].css,
  jsProp: UTIL_PROP[p.util].js,
}))

const { app, win } = await launchNomiApp({
  name: 'dangling-tailwind-tokens',
  userDataDir: userData,
  args: ['--no-proxy-server'],
  settleMs: 1800,
})

for (let i = 0; i < 8; i++) {
  const skip = win.locator('button, [role="button"], a', { hasText: /跳过|开始创作|进入|完成/ }).first()
  if (await skip.count()) await skip.click({ timeout: 1500 }).catch(() => {})
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(350)
}

const report = {}
const failures = []
for (const scheme of ['light', 'dark']) {
  console.log(`\n— ${scheme.toUpperCase()} —`)
  await setScheme(win, scheme)
  await win.waitForTimeout(700)
  await ensureInProject(win)

  const m = await measure(win, probeInput)
  report[scheme] = m.rows
  const dist = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
  for (const r of m.rows) {
    const drift = dist(r.classRgb, r.varRgb)
    const visible = dist(r.classRgb, r.inheritedRgb)
    const ok = drift <= 2
    // 断言一：类名色必须等于 var() 色。不等 = 该类没生成 CSS，元素掉回继承色（本次修的就是这个）。
    if (!ok) failures.push(`[${scheme}] ${r.cls} 类名色 rgb(${r.classRgb}) ≠ var 色 rgb(${r.varRgb})——映射没生效，类仍悬空`)
    // 断言二：类名色必须与继承色明显不同。相等意味着这个"修复"在用户眼里什么都没变——
    // 要么 token 被定义成了正文色（无意义映射），要么我们量错了地方。修了就得看得见。
    if (dist(r.classRgb, r.inheritedRgb) < 8) {
      failures.push(`[${scheme}] ${r.cls} 与继承色几乎同色 rgb(${r.inheritedRgb})——这个修复在用户眼里不产生任何差别`)
    }
    console.log(
      `  ${r.cls.padEnd(28)} 类=rgb(${r.classRgb.join(',')})`.padEnd(58) +
        ` var=rgb(${r.varRgb.join(',')})`.padEnd(22) +
        ` 继承=rgb(${r.inheritedRgb.join(',')})` +
        ` → ${ok ? '✅生效' : '❌仍悬空'}，与继承色差 ${visible}/255 ${visible >= 24 ? '(肉眼可见)' : '(视觉接近)'}`,
    )
  }

  await paintProof(win, probeInput, INK_STEPS)
  await snap(win, `proof-strip-${scheme}`)
  await win.evaluate(() => document.getElementById('nomi-dangling-proof')?.remove())
  await win.waitForTimeout(250)

  for (const [label, name] of [
    ['canvas', '生成'],
    ['timeline', '预览'],
    ['assets', '素材'],
  ]) {
    const tab = win.locator('button, [role="button"], [role="tab"]', { hasText: new RegExp(`^${name}$`) }).first()
    if (await tab.count()) {
      await tab.click({ timeout: 4000 }).catch(() => {})
      await win.waitForTimeout(1300)
      const hit = await scanLive(win, probeInput)
      if (hit.length) console.log(`  [${label}] 天然消费点：${hit.map((f) => `${f.cls}×${f.count}=${f.value}`).join(', ')}`)
      await snap(win, `${label}-${scheme}`)
    }
  }
}

// 断言三：明暗两轮必须量到不同的值。本次修的 token 明暗都有各自定义（如 success-ink
// #248a3d / #7ee8aa），两轮完全相同只可能是主题没真翻——localStorage 写了但没重挂、
// 或 140ms 过渡还没走完就采样了。那样"暗色也通过"是假的，它量的还是浅色那帧。
for (const [i, light] of (report.light ?? []).entries()) {
  const dark = report.dark?.[i]
  if (!dark || dark.cls !== light.cls) continue
  if (light.classRgb.join() === dark.classRgb.join()) {
    failures.push(`${light.cls} 明暗两轮量到同一个 rgb(${light.classRgb})——主题没真翻，暗色那轮的结论不作数`)
  }
}

console.log(`\nDone. ${n} shots → ${path.relative(repoRoot, shotsDir)}`)
if (failures.length) {
  console.error(`\n✖ ${failures.length} 条断言未通过：`)
  for (const f of failures) console.error(`   · ${f}`)
  await app.close()
  process.exit(1)
}
console.log(`✅ ${probes.length} 个真实类名 × 明暗两轮：类名色 = var() 色、明显区别于继承色、明暗各自生效。`)
await app.close()
