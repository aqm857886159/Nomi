// --nomi-accent-soft 色相 R13 走查 —— 亮/暗各走一遍，证明选中态/chip 是蓝的，不是粉/橄榄绿。
//
// 背景：--nomi-accent-soft 原本写 color-mix(in oklch, var(--nomi-accent) N%, var(--nomi-paper))，
// oklch 对色相走最短弧插值、而 paper 被钉了色相（浅 h=0 / 暗 h=80），accent 的 h250 被拽成
// 浅色 h≈347（粉）/ 暗色 h≈124（橄榄绿）。全 App 80+ 个消费点跟着跑色。改 in srgb 后应稳在 h≈248。
//
// 用法: NOMI_E2E=1 node tests/ux/accent-soft-hue.walk.mjs
// 产出: tests/ux/shots/accent-soft/*.png + 控制台打印每个模式下 token 的真实解析值与消费点数量。
//       截图必须人眼 Read 确认（R13 眼见链），控制台数字只是佐证。
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/accent-soft')
fs.mkdirSync(shotsDir, { recursive: true })

const userData = process.env.NOMI_UI_USER_DATA || path.join(repoRoot, '.tmp', 'nomi-accent-soft-userdata')
fs.mkdirSync(userData, { recursive: true })

let n = 0
async function snap(win, name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await win.screenshot({ path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
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
 * 读 token 的**真实解析值**。注意：未注册的自定义属性用 getPropertyValue 拿到的是 color-mix
 * 表达式原文，不是算好的颜色 —— 必须挂到元素上读真实计算属性才看得到浏览器算出来的结果。
 * 顺带扫一遍 DOM，数出真正渲染成这个颜色的元素（证明消费点跟着变了，不只是 token 变了）。
 */
async function readAccentSoft(win) {
  return win.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;left:-9999px;color:var(--nomi-accent-soft)'
    const probeAccent = document.createElement('div')
    probeAccent.style.cssText = 'position:fixed;left:-9999px;color:var(--nomi-accent)'
    document.body.append(probe, probeAccent)
    const soft = getComputedStyle(probe).color
    const accent = getComputedStyle(probeAccent).color
    probe.remove()
    probeAccent.remove()

    // 把任意 CSS 颜色画到 canvas 上取 rgb，再换算 oklch 色相 —— 与浏览器序列化格式无关。
    const toRgb = (css) => {
      const c = document.createElement('canvas')
      c.width = c.height = 1
      const x = c.getContext('2d')
      x.fillStyle = css
      x.fillRect(0, 0, 1, 1)
      return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }
    const hueOf = ([R, G, B]) => {
      const f = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      const [r, g, b] = [f(R), f(G), f(B)]
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
      const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
      const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
      let h = (Math.atan2(Bb, A) * 180) / Math.PI
      if (h < 0) h += 360
      return h
    }

    const softRgb = toRgb(soft)
    // 数出真正把这个颜色渲染成背景的元素（≈ 选中态/chip 实际生效处）
    const softCss = getComputedStyle(document.body).getPropertyValue('--nomi-accent-soft')
    let consumers = 0
    for (const el of document.querySelectorAll('*')) {
      const bg = getComputedStyle(el).backgroundColor
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && toRgb(bg).join() === softRgb.join()) consumers += 1
    }
    return {
      scheme: document.documentElement.getAttribute('data-mantine-color-scheme'),
      tokenText: softCss.trim(),
      softComputed: soft,
      softRgb,
      softHue: hueOf(softRgb),
      accentHue: hueOf(toRgb(accent)),
      consumers,
    }
  })
}

async function clickByText(win, sel, text) {
  const el = win.locator(sel, { hasText: text }).first()
  if (await el.count()) {
    await el.click({ timeout: 4000 }).catch(() => {})
    return true
  }
  return false
}

const { app, win } = await launchNomiApp({
  name: 'accent-soft-hue',
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

/**
 * 确保停在项目工作台，不是项目库页 —— 库页没有 上手清单/画布/时间轴这些 accent-soft 的主消费点，
 * 停在那儿浅色那轮什么都拍不到（前两版走查就是这么漏的，consumers 一直是 0）。
 * 项目卡本身就是 role=button、aria-label 以「继续创作」开头，不需要先 hover。
 */
async function ensureInProject(win) {
  const enter = win.getByRole('button', { name: /^继续创作/ }).first()
  if (await enter.count()) {
    await enter.click({ timeout: 4000 }).catch(() => {})
    await win.waitForTimeout(2000)
  }
  const where = await win.locator('button, [role="tab"]', { hasText: /^生成$/ }).count()
  console.log(`  进入项目：${where > 0 ? '已在工作台' : '⚠️ 仍在库页'}`)
}

const report = {}
for (const scheme of ['light', 'dark']) {
  console.log(`\n— ${scheme.toUpperCase()} —`)
  await setScheme(win, scheme)
  await win.waitForTimeout(700)
  await ensureInProject(win)

  const m = await readAccentSoft(win)
  report[scheme] = m
  const drift = Math.min(Math.abs(m.softHue - m.accentHue), 360 - Math.abs(m.softHue - m.accentHue))
  console.log(`  token   : ${m.tokenText}`)
  console.log(`  computed: ${m.softComputed}  rgb(${m.softRgb.join(',')})`)
  console.log(`  hue     : accent-soft h≈${m.softHue.toFixed(1)}  vs  accent h≈${m.accentHue.toFixed(1)}  → 偏离 ${drift.toFixed(1)}°`)
  console.log(`  当前页面渲染成该色的元素: ${m.consumers} 个`)

  // 修复前 vs 修复后并排色卡 —— 两个值都从当前 accent/paper **现算**（不写死），
  // 唯一差别就是混合空间。人眼一看就知道改动到底把颜色从什么变成了什么。
  await win.evaluate(() => {
    document.getElementById('nomi-hue-proof')?.remove()
    const probe = (css) => {
      const d = document.createElement('div')
      d.style.cssText = `flex:1;height:96px;background:${css}`
      return d
    }
    const read = (v) => {
      const d = document.createElement('div')
      d.style.cssText = `position:fixed;left:-9999px;color:var(${v})`
      document.body.appendChild(d)
      const c = getComputedStyle(d).color
      d.remove()
      return c
    }
    const accent = read('--nomi-accent')
    const paper = read('--nomi-paper')
    const pct = getComputedStyle(document.body).getPropertyValue('--nomi-accent-soft').match(/([0-9.]+)%/)?.[1] ?? '12'
    const box = document.createElement('div')
    box.id = 'nomi-hue-proof'
    box.style.cssText =
      'position:fixed;z-index:2147483647;left:50%;top:40px;transform:translateX(-50%);width:640px;' +
      'padding:14px;border-radius:12px;background:var(--nomi-paper);border:1px solid var(--nomi-line);' +
      'box-shadow:0 12px 40px rgba(0,0,0,.35);font:13px/1.5 system-ui;color:var(--nomi-ink)'
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:12px;margin-top:8px'
    const label = (t) => {
      const s = document.createElement('div')
      s.style.cssText = 'flex:1;text-align:center;padding-top:6px;color:var(--nomi-ink-60)'
      s.textContent = t
      return s
    }
    const labels = document.createElement('div')
    labels.style.cssText = 'display:flex;gap:12px'
    row.append(
      probe(`color-mix(in oklch, ${accent} ${pct}%, ${paper})`),
      probe(`color-mix(in srgb, ${accent} ${pct}%, ${paper})`),
      probe(accent),
    )
    labels.append(label('修复前 in oklch'), label('修复后 in srgb'), label('--nomi-accent 参照'))
    const title = document.createElement('div')
    title.style.cssText = 'font-weight:600'
    title.textContent = `--nomi-accent-soft（${document.documentElement.getAttribute('data-mantine-color-scheme')}）：左=旧值 右=新值`
    box.append(title, row, labels)
    document.body.appendChild(box)
  })
  await win.waitForTimeout(300)
  await snap(win, `swatch-before-after-${scheme}`)
  await win.evaluate(() => document.getElementById('nomi-hue-proof')?.remove())

  // 上手清单：当前步的高亮行是 accent-soft 的真实消费点，明暗都能开。
  const coach = win.locator('button, [role="button"]', { hasText: /上手/ }).first()
  if (await coach.count()) {
    await coach.click({ timeout: 3000 }).catch(() => {})
    await win.waitForTimeout(900)
    const hit = await readAccentSoft(win)
    console.log(`  上手清单打开后，渲染成 accent-soft 的元素: ${hit.consumers} 个`)
    await snap(win, `checklist-${scheme}`)
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(400)
  }

  if (await clickByText(win, 'button, [role="button"], [role="tab"]', '生成')) {
    await win.waitForTimeout(1400)
    await snap(win, `canvas-${scheme}`)
  }
  if (await clickByText(win, 'button, [role="button"], [role="tab"]', '预览')) {
    await win.waitForTimeout(1200)
    await snap(win, `timeline-${scheme}`)
  }
}

console.log(`\nDone. ${n} shots → ${path.relative(repoRoot, shotsDir)}`)
console.log(JSON.stringify(report, null, 2))
await app.close()
