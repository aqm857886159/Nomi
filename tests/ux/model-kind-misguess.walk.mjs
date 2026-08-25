// R13 走查 + R16 真实用户任务闭环：「接了个中转，想生图，但图像模型被猜成了文本」。
// 零额度——只操作目录与界面，绝不触发任何真实生成。
//
// 这条任务复现的是 issue #4/#8/#9/#19/#23/#42/#62 的同源主诉「接入了模型但用不了」的**主症状**：
// 类型猜错后模型不会报错，而是从对应下拉里**消失**（生成侧每层都按 kind 过滤），而设置页一片绿。
//
// 走完整闭环（每步截图，人眼判断）：
//   ① 设置页：能力摘要说出「文本 3 · 图片 0」，不再只有一个绿「已连接」
//   ② 模型抽屉：能力条显示图片未接 + 诊断横幅说明「类型是猜的，都落进了文本」
//   ③ 就地把 seedream-4-0 改成图片
//   ④ 目录层验收：kind 变了，且 **text_to_image 通道真的建出来了**（只翻标签的话这里是 null）
//   ⑤ 生成侧验收：图像模型下拉里现在有它了 —— 用户回到卡住的地方就能继续
//
// 用法: pnpm run build && node tests/ux/model-kind-misguess.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, 'docs/design/mockups/2026-08-11-model-kind-misguess')
fs.mkdirSync(outDir, { recursive: true })

const WIN_W = 1680
const WIN_H = 1050
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-kind-walk-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

// 病灶现场：一家中转，3 个模型全被猜成 text（含一个真图片模型 + 一个 3D），且**没有任何 mapping**
// ——这正是 guessModelKind 猜不中时的真实落库形状（文本模型刻意不带通道）。
const now = new Date().toISOString()
const model = (modelKey, labelZh) => ({
  modelKey, vendorKey: 'relay', modelAlias: modelKey, labelZh,
  kind: 'text', enabled: true,
  onboarding: { addedVia: 'manual', trialId: '', docsUrl: '', addedAt: now, fields: [] },
  createdAt: now, updatedAt: now,
})
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 8,
  vendors: [{
    key: 'relay', name: '某中转站', enabled: true, hasApiKey: true,
    baseUrlHint: 'https://relay.test/v1', authType: 'bearer',
    providerKind: 'openai-compatible', createdAt: now, updatedAt: now,
  }],
  models: [
    model('seedream-4-0', 'Seedream 4.0'),
    model('step-1o-turbo', 'Step 1o Turbo'),
    model('house-brand-v2', 'House Brand v2'),
  ],
  mappings: [],
  apiKeysByVendor: { relay: { apiKey: 'sk-test', enabled: true, createdAt: now, updatedAt: now } },
}), 'utf8')

const checks = []
const note = (name, detail = '') => { checks.push({ name, detail }); console.log(`  · ${name}${detail ? ` — ${detail}` : ''}`) }
const fails = []
const expect = (cond, label) => {
  if (cond) note(`✓ ${label}`)
  else { fails.push(label); console.log(`  ✗ ${label}`) }
}

const { app, win: initialWin } = await launchNomiApp({
  name: 'model-kind-misguess',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

let win = initialWin
const getWin = () => {
  const live = app.windows().filter((w) => !w.isClosed())
  win = live[live.length - 1] || win
  return win
}

async function resizeWindow() {
  try {
    const bw = await app.browserWindow(getWin())
    await bw.evaluate((w, { width, height }) => { w.setBounds({ x: 0, y: 0, width, height }); w.center() }, { width: WIN_W, height: WIN_H })
  } catch (e) { note('resize 失败(非致命)', e.message) }
  await getWin().waitForTimeout(400)
}

async function snap(name, clip) {
  const p = path.join(outDir, name)
  await screenshotSettled(getWin(), clip ? { path: p, clip } : { path: p })
  note(`截图 ${name}`, `${(fs.statSync(p).size / 1024).toFixed(0)}KB`)
  return p
}

/** 截某个元素附近那一块（整屏图上小字看不清）。 */
async function snapNear(selector, name, pad = 16) {
  const box = await getWin().evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  }, selector)
  if (!box) { note(`未找到 ${selector}，改截全屏`); return snap(name) }
  return snap(name, {
    x: Math.max(0, Math.round(box.x) - pad),
    y: Math.max(0, Math.round(box.y) - pad),
    width: Math.min(WIN_W, Math.round(box.width) + pad * 2),
    height: Math.min(WIN_H, Math.round(box.height) + pad * 2),
  })
}

try {
  await resizeWindow()
  await getWin().waitForTimeout(1200)

  // 先关掉开屏/首次上手引导：不关的话画布根本到不了，而 ①② 那两步是靠全局事件开的浮层——
  // 会「看起来都过了」，后面依赖画布的步骤却整段静默跳过（这次就栽了一回，所以下面的跳过都要出声）。
  await getWin().evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
  })
  await getWin().reload()
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(2000)

  // ── ① 设置页 · 模型连接：能力摘要 ──────────────────────────────────────────
  await getWin().evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-settings')))
  await getWin().waitForTimeout(900)
  // 设置默认停在「通用」页，AI 区块要点了那个 tab 才挂载。
  const aiTab = getWin().locator('[role="dialog"][aria-label="设置"] button', { hasText: 'AI' }).first()
  if (await aiTab.count()) { await aiTab.click(); await getWin().waitForTimeout(700) }
  const settingsVisible = await getWin().locator('[data-settings-section="ai-models"]').count()
  if (settingsVisible) {
    await snapNear('[data-settings-section="ai-models"] section', '01-settings-capabilities.png')
    const txt = await getWin().locator('[data-settings-section="ai-models"]').first().innerText()
    expect(/文本\s*3/.test(txt), '设置页能力摘要显示「文本 3」（这家能干什么，一眼可见）')
    expect(!/图片\s*[1-9]/.test(txt), '设置页没有谎报图片能力')
  } else {
    note('设置面板未打开（入口差异），跳过 ①')
  }

  // ── ② 模型抽屉：能力条 + 诊断横幅 ─────────────────────────────────────────
  // 先关掉设置弹层：它是 inset-0 的模态遮罩，留着会拦掉后面所有点击（栽过一次，报错只说
  // 「intercepts pointer events」，看起来像抽屉没渲染）。
  await getWin().keyboard.press('Escape')
  await getWin().waitForTimeout(500)
  await getWin().evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog')))
  await getWin().waitForTimeout(1200)
  await snap('02-drawer-diagnosis.png')
  const bannerCount = await getWin().locator('[data-drawer-kind-gap]').count()
  expect(bannerCount > 0, '抽屉出现「类型可能猜错了」诊断横幅')
  if (bannerCount > 0) {
    await snapNear('[data-drawer-kind-gap]', '03-drawer-banner.png')
    const banner = await getWin().locator('[data-drawer-kind-gap]').first().innerText()
    note('横幅文案', banner.replace(/\s+/g, ' '))
    expect(/猜/.test(banner), '横幅说明了「类型是猜的」这个真实缺口')
  }

  // ── ③ 就地改类型 ─────────────────────────────────────────────────────────
  // 展开这家中转的卡（折叠态里没有模型行）。
  const vendorCard = getWin().locator('button', { hasText: '某中转站' }).first()
  if (await vendorCard.count()) { await vendorCard.click(); await getWin().waitForTimeout(700) }
  await snap('04-drawer-expanded.png')

  const retypeTrigger = getWin().locator('[aria-label*="更改"][aria-label*="Seedream"]').first()
  const hasTrigger = await retypeTrigger.count()
  expect(hasTrigger > 0, '模型行上有「更改类型」控件（此前落库后完全不可改）')
  if (hasTrigger) {
    await retypeTrigger.click()
    await getWin().waitForTimeout(500)
    await snap('05-retype-menu.png')
    // 必须限定到**展开着的那个**下拉：每行各有一个 NomiSelect，它们的 option 节点都在 DOM 里，
    // 不加 :visible 会选中某个隐藏行的选项，然后干等到超时（栽过一次）。
    const imageOption = getWin().locator('[data-combobox-option]:visible', { hasText: '图片' }).first()
    if (await imageOption.count()) {
      await imageOption.click()
      await getWin().waitForTimeout(1200)
    }
    await snap('06-after-retype.png')
  }

  // ── ④ 目录层验收：kind + 通道 ────────────────────────────────────────────
  const catalog = await getWin().evaluate(async () => {
    const mc = window.nomiDesktop?.modelCatalog
    if (!mc) return null
    // D2 起 modelCatalog 读路径改走 ipcRenderer.invoke，返回 Promise——必须 await，
    // 否则拿到的是 Promise 而非数组（症状：`listModels(...).find is not a function`）。
    const m = (await mc.listModels()).find((x) => x.modelKey === 'seedream-4-0')
    const maps = await mc.listMappings({ vendorKey: 'relay' })
    return {
      kind: m?.kind ?? null,
      params: (m?.meta?.parameters || []).length,
      taskKinds: maps.map((x) => x.taskKind),
    }
  })
  if (catalog) {
    note('目录状态', JSON.stringify(catalog))
    expect(catalog.kind === 'image', '模型 kind 已改成 image')
    // 这条是本次修复的核心：只翻标签的话通道仍然缺，下一步会换个错继续失败。
    expect(catalog.taskKinds.includes('text_to_image'), 'text_to_image 调用通道**真的建出来了**')
    expect(catalog.params > 0, '按图片类型重建了参数控件（否则节点上一个控件都没有）')
  }

  // ── ⑤ 生成侧验收：它回到图像模型下拉里了 ─────────────────────────────────
  const inDropdown = await getWin().evaluate(async () => {
    const mc = window.nomiDesktop?.modelCatalog
    if (!mc) return null
    // D2 读路径是 ipcRenderer.invoke，返回 Promise；先 await 才能使用数组方法。
    return (await mc.listModels({ kind: 'image', enabled: true })).map((m) => m.modelKey)
  })
  if (inDropdown) {
    note('图像可选模型', JSON.stringify(inDropdown))
    expect(inDropdown.includes('seedream-4-0'), '图像模型下拉里出现了它 —— 用户回到卡住处即可继续')
  }

  await snap('07-final-drawer.png')

  // ── ⑥ 错误卡（旧项目 / MCP / 批跑 才会撞的那条路）────────────────────────────
  // 现场用**真实 UI 路径**造，不注入假状态：现在 seedream 已是 image → 能在图像节点下拉里选中它
  // → 再从抽屉把它改回文本 → 那个节点就持有了一个「类型对不上」的 modelKey，正是旧项目/批跑的形状。
  // 点生成会在 findExecutableModel 处直接抛错（连 HTTP 都不发），零额度。
  await getWin().keyboard.press('Escape')
  await getWin().waitForTimeout(400)
  const blankProject = getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  if (await blankProject.count()) {
    await blankProject.click()
    await getWin().waitForTimeout(2500)
  }
  // 新建项目落在「创作(文本)」页，画布要点顶栏「生成」才到（与 canvas-control-clarity 同一套路）。
  const toGeneration = getWin().getByRole('button', { name: '生成', exact: true }).first()
  if (await toGeneration.count()) {
    await toGeneration.click()
    await getWin().locator('.generation-canvas-v2-toolbar').waitFor({ timeout: 8000 }).catch(() => {})
    await getWin().waitForTimeout(800)
  }
  const imageTool = getWin().locator('[data-node-kind="image"]').first()
  // 到不了画布就**判失败**，不静默跳过——「跳过的步骤」看起来和「通过的步骤」一样，等于假绿。
  expect(await imageTool.count() > 0, '进到画布、拿得到图像节点工具（⑥ 的前提）')
  if (await imageTool.count()) {
    await imageTool.click()
    await getWin().waitForTimeout(1200)

    // 在节点上把模型选成 seedream-4-0（此刻它是 image，下拉里有）。
    const modelTrigger = getWin().getByRole('button', { name: '模型', exact: true }).first()
    if (await modelTrigger.count()) {
      await modelTrigger.click()
      await getWin().waitForTimeout(500)
      const opt = getWin().locator('[data-combobox-option]:visible', { hasText: 'Seedream 4.0' }).first()
      if (await opt.count()) { await opt.click(); await getWin().waitForTimeout(800) }
    }
    await snap('08-node-model-selected.png')

    // 把它改回文本 —— 制造「节点存着的 modelKey 与类型对不上」。
    const flipped = await getWin().evaluate(() =>
      Boolean(window.nomiDesktop?.modelCatalog?.retypeModel?.({ vendorKey: 'relay', modelKey: 'seedream-4-0', kind: 'text' })))
    note('已把模型改回文本', String(flipped))

    // 提示词非空生成钮才可点；且必须用节点上那颗（aria-label「生成素材」），
    // 顶栏那个「生成」是页面切换 tab，点它只会换页——第一次就是这么静默什么都没发生。
    // 节点的提示词框是 tiptap 的 contenteditable，不是 textarea（全页唯一那个 textarea 是画布助手的
    // 输入条——填错地方就会撞「请先写点提示词再生成」那条**别的**错，看起来像本次修改没生效）。
    const promptTarget = getWin().locator('[data-node-id] [contenteditable="true"]').last()
    expect(await promptTarget.count() > 0, '找得到图像节点的提示词框（tiptap contenteditable）')
    if (await promptTarget.count()) {
      await promptTarget.click()
      await getWin().keyboard.type('一只在屋顶上的猫')
      await getWin().waitForTimeout(600)
    }
    const genBtn = getWin().locator('[aria-label="生成素材"]').first()
    expect(await genBtn.count() > 0, '节点上找得到生成钮')
    if (await genBtn.count()) {
      await genBtn.click()
      await getWin().waitForTimeout(1200)
      // 首次花费确认闸。这里点确认**不会真花钱**：请求在 findExecutableModel 就抛了（类型对不上），
      // 连 HTTP 都发不出去——这正是我们要看的那条错误路径。
      // 花费闸的确认钮没有 data 钩子，只能按文案取；顶栏那个同名「生成」是页面 tab、排在 DOM 前面，
      // 所以取 last()（first() 会点回顶栏，什么都不会发生——栽过）。
      const confirmGen = getWin().getByRole('button', { name: '生成', exact: true }).last()
      if (await confirmGen.count()) {
        await confirmGen.click()
        await getWin().waitForTimeout(1000)
      }
      await getWin().waitForTimeout(3500)
    }
    await snap('09-error-card.png')
    const errCard = getWin().locator('[role="alert"]').first()
    if (await errCard.count()) {
      await snapNear('[role="alert"]', '10-error-card-close.png', 8)
      const txt = (await errCard.innerText()).replace(/\s+/g, ' ')
      note('错误卡文案', txt)
      expect(/类型/.test(txt), '错误卡说的是「类型登记错了」，不再是假的「模型未配置」')
      expect(/seedream-4-0/.test(txt), '错误卡点名了是哪个模型')
      // 按钮比旧版长（「改成图像并重试」），这条量几何：整排动作必须还在卡内，不许被挤出去。
      const fits = await getWin().evaluate(() => {
        const card = document.querySelector('[role="alert"]')
        if (!card) return null
        const cr = card.getBoundingClientRect()
        const btns = [...card.querySelectorAll('button')]
        const last = btns[btns.length - 1]?.getBoundingClientRect()
        const widest = Math.max(...btns.map((b) => b.getBoundingClientRect().right))
        // 每颗按钮是不是被压得**把文字从词中间劈开**：行高约 1 行的按钮变成 2 行即中招。
        // 只量溢出量不出来（它没越界，只是难看），所以单独量高度——2026-08-11 走查实拍到
        //「换个模/型」「复制详/情」。
        const wrapped = btns
          .map((b) => ({ text: (b.textContent || '').trim(), h: b.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(b).lineHeight) || 16 }))
          .filter((b) => b.text && b.h > b.lh * 1.8)
          .map((b) => b.text)
        return { cardRight: cr.right, cardBottom: cr.bottom, widest, lastBottom: last?.bottom ?? 0, wrapped }
      })
      if (fits) {
        note('错误卡几何', JSON.stringify(fits))
        expect(fits.widest <= fits.cardRight + 1, '动作按钮没有横向溢出卡片（长文案不挤爆按钮排）')
        expect(fits.lastBottom <= fits.cardBottom + 1, '动作按钮没有被顶出卡片底边')
        expect(fits.wrapped.length === 0, `没有按钮被压成折行断字（实测折行的：${fits.wrapped.join('/') || '无'}）`)
      }
    } else {
      note('未渲染错误卡（可能未触发生成），跳过 ⑥')
    }
  }
} catch (e) {
  console.error('走查异常：', e)
  fails.push(`异常: ${e.message}`)
  try { await snap('99-error.png') } catch { /* 窗口已死 */ }
} finally {
  await app.close().catch(() => {})
}

console.log(`\n截图目录：${outDir}`)
if (fails.length) {
  console.error(`\n✗ ${fails.length} 项未通过：\n` + fails.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}
console.log(`\n✓ 全部 ${checks.filter((c) => c.name.startsWith('✓')).length} 项断言通过`)
