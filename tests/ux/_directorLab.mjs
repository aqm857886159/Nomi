// 导演台的浏览器旅程启动器；真实桌面入口/持久化/出片另由 director-electron.walk.mjs 验证。
//
// 浏览器隔离工程用于快速验证交互，不代表桌面输出/手机桥已通过。
//
// 启动：复用 canvas-perf 的 Vite dev 启动器（同一份 vite 配置、同一份源码），chromium headless；
// 每次都是全新工程（addInitScript 清 localStorage 工程键 + 打开 E2E 取证桥标志）。
//
// 3D-BOX 是唯一的导演台（2026-10-16，8876f0c5d）：打开先落在「导演视图」（DirectorEditor 的 viewMode 初值 'director'），
// 放人 / 机位 / 灯 / 资产库 / 大纲 / 时间轴 / 骨骼 / 截图产出都住「精修」，真人是点顶栏正中「导演 | 精修」的「精修」进去。
// 这一步**只在本文件写一次**（enterRefine / enterDirectorView）：launchDirectorLab 默认替旅程点进精修、lab.reload 重开后再点一次，
// Electron 走查打开导演台后自己调 enterRefine。哪天默认面又变了，只改这里。
// 钮按词典文字找（src/i18n/locales/director.ts，按页面当前语言取 zh / en），不按位置、不按「没按下的那颗」。
//
// 用法：node tests/ux/director-j1-three-person-scene.walk.mjs（各旅程文件自己 import 本启动器）
// 产出：tests/ux/shots/director/<journey>/NN-*.png（gitignore），必须人眼 Read 过才算走查完成（R13 眼见链）。
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startDevRendererServer } from './canvas-perf/devRendererServer.mjs'
import { clickOrFail, expectVisible, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const require = createRequire(import.meta.url)
let cachedModelArchetypeResolver

function modelArchetypeResolver() {
  if (!cachedModelArchetypeResolver) {
    ({ resolveArchetypeForModel: cachedModelArchetypeResolver } = require(path.join(repoRoot, 'dist-electron/shared/modelArchetypes/index.js')))
  }
  return cachedModelArchetypeResolver
}

const IMAGE_MODEL_CAPABILITIES = Object.freeze({
  TEXT_ONLY: 'text-only',
  REFERENCE_IMAGE: 'reference-image',
})

/**
 * 给画布图片节点钉住一个**现役目录模型档案**声明的能力。
 *
 * 走查前置不能吃新节点的自动默认：默认值会随健康度变化。候选来自 Electron
 * 的真实 modelCatalog 桥，能力来自本工作树构建产物里的 model archetype registry；
 * 这样模型下架/档案变更会在前置处报清楚，而不是伪装成产品断言失败。
 * @param {import('playwright').Page} page
 * @param {string} nodeId
 * @param {'text-only'|'reference-image'} capability
 */
export async function pinCanvasImageModelByCapability(page, nodeId, capability) {
  const capabilityLabel = capability === IMAGE_MODEL_CAPABILITIES.TEXT_ONLY ? '只吃文字' : '能接参考图'
  if (![IMAGE_MODEL_CAPABILITIES.TEXT_ONLY, IMAGE_MODEL_CAPABILITIES.REFERENCE_IMAGE].includes(capability)) {
    throw new Error(`前置不满足：未知的图片模型能力 ${JSON.stringify(capability)}`)
  }

  const rows = await page.evaluate(async () => {
    const listModels = window.nomiDesktop?.modelCatalog?.listModels
    if (typeof listModels !== 'function') return null
    return await listModels({ kind: 'image', enabled: true })
  })
  const resolver = modelArchetypeResolver()
  const candidates = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.kind === 'image' && row.enabled !== false && row.published !== false)
    .flatMap((row) => {
      const archetype = resolver({
        modelKey: row.modelKey,
        modelAlias: row.modelAlias,
        vendorKey: row.vendorKey,
        meta: row.meta,
        modelNameSource: row.modelNameSource,
      })
      if (!archetype) return []
      const mode = capability === IMAGE_MODEL_CAPABILITIES.REFERENCE_IMAGE
        ? archetype.modes.find((candidate) => candidate.slots?.some((slot) => slot.kind === 'image_ref'))
        : archetype.modes.find((candidate) => !candidate.slots?.some((slot) => slot.kind === 'image_ref'))
      const hasReferenceMode = archetype.modes.some((candidate) => candidate.slots?.some((slot) => slot.kind === 'image_ref'))
      const matches = capability === IMAGE_MODEL_CAPABILITIES.REFERENCE_IMAGE ? Boolean(mode) : !hasReferenceMode && Boolean(mode)
      return matches ? [{ row, archetype, mode }] : []
    })
    .sort((a, b) => `${a.row.vendorKey}/${a.row.modelKey}`.localeCompare(`${b.row.vendorKey}/${b.row.modelKey}`))

  const selected = candidates[0]
  if (!selected) {
    throw new Error(`前置不满足：档案里没有${capabilityLabel}能力的现役图片模型`)
  }
  // 选择逻辑本身也是走查前置的一部分：即使后续有人改坏候选过滤，
  // 也必须在产品断言之前以「前置不满足」停下，不能把能力错配伪装成产品回归。
  const selectedHasReferenceMode = selected.archetype.modes.some((candidate) => candidate.slots?.some((slot) => slot.kind === 'image_ref'))
  const selectedMatchesCapability = capability === IMAGE_MODEL_CAPABILITIES.REFERENCE_IMAGE
    ? selectedHasReferenceMode
    : !selectedHasReferenceMode
  if (!selectedMatchesCapability) {
    throw new Error(`前置不满足：挑到的档案 ${selected.archetype.id} 不具备${capabilityLabel}能力`)
  }

  await page.evaluate(({ id, model }) => {
    const store = window.__nomiCanvasStore
    const target = store?.getState().nodes.find((node) => node.id === id)
    if (!store || !target) throw new Error(`前置不满足：目标节点不存在，无法钉${model.capabilityLabel}的图片模型`)
    store.getState().updateNode(id, {
      meta: {
        ...(target.meta ?? {}),
        modelKey: model.modelKey,
        modelVendor: model.vendorKey,
        vendor: model.vendorKey,
        archetype: { id: model.archetypeId, modeId: model.modeId },
      },
    })
  }, {
    id: nodeId,
    model: {
      modelKey: selected.row.modelKey,
      vendorKey: selected.row.vendorKey,
      archetypeId: selected.archetype.id,
      modeId: selected.mode.id,
      capabilityLabel,
    },
  })

  return {
    capability,
    capabilityLabel,
    vendorKey: selected.row.vendorKey,
    modelKey: selected.row.modelKey,
    archetypeId: selected.archetype.id,
    modeId: selected.mode.id,
  }
}

const PROJECT_KEY = 'nomi:director-lab:project'
const LOCALE_KEY = 'nomi:locale:v1'

/** Vite 对任何路径都会回 200（SPA 回退），所以要看正文里有没有 devlab 的入口脚本，HEAD 不算数。 */
function servesDirectorLab(url) {
  return fetch(url)
    .then((response) => (response.ok ? response.text() : ''))
    .then((html) => html.includes('src/devlab/directorLab.tsx'), () => false)
}

/**
 * 已在跑的 Vite 服务的是不是**本工作树**：同一台机器上常有别的工作树开着 `vite --port 5175`，
 * 它一样回得出 director-lab.html，复用它 = 拿别人那份源码跑本工作树的走查（绿红都不作数）。
 * 判据：在本工作树 .tmp/ 写一个一次性探针文件，看那个服务能不能原样回出来。
 */
async function servesThisCheckout(origin) {
  const name = `director-lab-root-probe-${randomUUID()}.txt`
  const file = path.join(repoRoot, '.tmp', name)
  const token = randomUUID()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, token)
  try {
    const body = await fetch(`${origin}/.tmp/${name}`).then((response) => (response.ok ? response.text() : ''), () => '')
    return body.trim() === token
  } finally {
    fs.rmSync(file, { force: true })
  }
}

/**
 * 找 devlab：NOMI_DIRECTOR_LAB_URL 指定的 / 本机已在跑的 `vite --port 5175`（开发时的习惯端口）优先复用，
 * 否则自起一个。两个 Vite 实例共用 .tmp/vite 依赖缓存会互相触发重新预打包，页面一直加载不完，
 * 所以「能复用就复用」不是优化，是必需。不碰 5173：那通常是 `pnpm dev` 的 Electron 渲染进程。
 * 组件夹具类走查（director-fields / -timeline-pointer / -waypoint-aim）也走这一个：它们要的同样是「本仓源码的 Vite」。
 * @returns {Promise<{ url: string, origin: string, close: () => Promise<void> }>}
 */
export async function resolveDirectorDevServer() {
  const candidates = [process.env.NOMI_DIRECTOR_LAB_URL, 'http://127.0.0.1:5175'].filter(Boolean).map((url) => url.replace(/\/+$/, ''))
  for (const origin of candidates) {
    if (!(await servesDirectorLab(`${origin}/director-lab.html`))) continue
    if (!(await servesThisCheckout(origin))) {
      console.log(`  · ${origin} 在跑的不是本工作树的源码，不复用`)
      continue
    }
    console.log(`  · 复用已在跑的 devlab：${origin}`)
    return { url: `${origin}/index.html`, origin, close: async () => {} }
  }
  const server = await startDevRendererServer({ preferredPort: 5285 })
  return { ...server, origin: server.url.replace(/\/index\.html$/, '') }
}

/** 优先用 Playwright 自带的 Chromium；本机没装（npx playwright install 没跑过）就退回系统 Chrome，并明说。 */
export async function launchDirectorBrowser() {
  return chromium.launch({ headless: true }).catch(async (error) => {
    console.log(`  · Playwright 自带 Chromium 不可用（${String(error).split('\n')[0]}），改用系统 Chrome`)
    return chromium.launch({ headless: true, channel: 'chrome' })
  })
}

/**
 * 页面当前语言（i18n 把语言同步在 <html lang>）下的一条导演台文案，key 相对 `director.`。
 * 走 uiText：词典里没有这条就当场抛——键被改名时不会拿 undefined 去当名字（getByRole 的 name 为 undefined = 不按名字过滤，点到哪颗算哪颗）。
 */
export async function directorText(page, key) {
  const lang = await page.evaluate(() => document.documentElement.lang)
  return uiText(lang === 'en' ? 'en' : 'zh-CN', `director.${key}`)
}

/** 顶栏正中「导演 | 精修」里的一颗（两个面同一枚 ViewModeSwitch：role=group + aria-label = 词典 viewModeAria）。 */
async function viewModeButton(page, face) {
  const label = await directorText(page, face === 'refine' ? 'topbar.refineView' : 'topbar.directorView')
  const group = page.getByRole('group', { name: await directorText(page, 'topbar.viewModeAria'), exact: true })
  return { label, button: group.getByRole('button', { name: label, exact: true }) }
}

/** 进「精修」（已在精修就不动）：点「精修」，精修顶栏（director-topbar）出来才算到。 */
export async function enterRefine(page) {
  const { label, button } = await viewModeButton(page, 'refine')
  await expectVisible(button, `导演台顶栏正中没有「${label}」`)
  if ((await button.getAttribute('aria-pressed')) !== 'true') await clickOrFail(button, `顶栏·导演 | 精修 →「${label}」`)
  await expectVisible(page.getByTestId('director-topbar'), `点了「${label}」，精修顶栏没出来`)
}

/** 回「导演视图」（已在就不动）：导演视图外壳（director-3dbox-view）出来才算到。 */
export async function enterDirectorView(page) {
  const { label, button } = await viewModeButton(page, 'director')
  await expectVisible(button, `导演台顶栏正中没有「${label}」`)
  if ((await button.getAttribute('aria-pressed')) !== 'true') await clickOrFail(button, `顶栏·导演 | 精修 →「${label}」`)
  await expectVisible(page.getByTestId('director-3dbox-view'), `点了「${label}」，导演视图没出来`)
}

/** 进到旅程要的那一面：'refine'（旧导演台那整套工具都在这里）或 'director'（导演视图本身）。 */
export async function enterDirectorFace(page, face) {
  if (face === 'refine') await enterRefine(page)
  else if (face === 'director') await enterDirectorView(page)
  else throw new Error(`enterDirectorFace：只认 'refine' / 'director'，收到 ${JSON.stringify(face)}`)
}

/**
 * @param {{ name: string, viewport?: { width: number, height: number }, view?: 'refine' | 'director', locale?: 'zh-CN' | 'en' }} options
 *   view：起跑时落在哪一面。默认 'refine'——旧导演台那批旅程测的全是精修里的工具；测导演视图本身的旅程传 'director'。
 */
export async function launchDirectorLab({ name, viewport = { width: 1440, height: 900 }, view = 'refine', locale = 'zh-CN' }) {
  if (locale !== 'zh-CN' && locale !== 'en') throw new Error(`launchDirectorLab：不支持的语言 ${JSON.stringify(locale)}`)
  const server = await resolveDirectorDevServer()
  const browser = await launchDirectorBrowser()
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  page.setDefaultTimeout(stationTimeout())
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  await page.addInitScript(({ key, locale: initialLocale, localeKey }) => {
    try {
      // i18n 在首个页面模块加载时同步读取这个键；必须在 goto 前写，不能等页面起来后再切换。
      window.localStorage.setItem(localeKey, initialLocale)
      window.localStorage.setItem('__nomiE2E', '1')
      if (!window.sessionStorage.getItem(`${key}:initialized`)) {
        window.localStorage.removeItem(key)
        window.sessionStorage.setItem(`${key}:initialized`, '1')
      }
    } catch {
      // 无本地存储：走查照跑，工程只活在内存
    }
  }, { key: PROJECT_KEY, locale, localeKey: LOCALE_KEY })
  const base = server.origin
  // Vite 冷启动首屏要做依赖预打包 + 整张模块图的首次转译（three / spark / drei）：实测全新服务 + headless 约 5 分钟，
  // 预热过的服务 5 秒。模块脚本会阻塞 DOMContentLoaded，所以只等导航提交，首屏用画中画元素做信号，上限 8 分钟。
  // 迭代时开着一个 `vite --port 5175`（或设 NOMI_DIRECTOR_LAB_URL）就走热路径。
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  const shotsDir = path.join(repoRoot, 'tests/ux/shots/director', name)
  fs.mkdirSync(shotsDir, { recursive: true })
  /** 导演台壳起来了（画中画 + E2E 取证桥）再进旅程要的那一面。首次与每次重载都走这一个。 */
  const boot = async (face, firstBoot) => {
    await expectVisible(page.getByTestId('director-pip'), '导演台壳没起来（devlab 页面没挂出画中画）', stationTimeout({ operations: firstBoot ? 32 : 4 }))
    await page.waitForFunction(() => Boolean(window.__nomiDirectorE2E), null, { timeout: stationTimeout({ operations: 4 }) })
    await enterDirectorFace(page, face)
  }
  await page.goto(`${base}/director-lab.html`, { timeout: stationTimeout({ operations: 4 }), waitUntil: 'commit' })
  try {
    await boot(view, true)
  } catch (error) {
    // 首屏没起来：把页面错误 / 控制台错误 / 截图一起吐出来，别让人对着「元素没找到」猜
    await page.screenshot({ path: path.join(shotsDir, '00-boot-failed.png') }).catch(() => {})
    console.error(`首屏失败。页面错误 ${pageErrors.length} 条：\n  ${pageErrors.slice(0, 5).join('\n  ')}\n控制台错误 ${consoleErrors.length} 条：\n  ${consoleErrors.slice(0, 8).join('\n  ')}`)
    await browser.close()
    await server.close()
    throw error
  }
  let shotIndex = 0
  const failures = []

  const lab = {
    page,
    pageErrors,
    shotsDir,
    async snap(label) {
      shotIndex += 1
      const file = path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${label}.png`)
      await screenshotSettled(page, { path: file })
      console.log(`  · shot ${path.relative(repoRoot, file)}`)
    },
    check(label, ok, detail = '') {
      console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
      if (!ok) failures.push(label)
      return ok
    },
    /**
     * 刷新页面 = 关掉再打开导演台（devlab 从 localStorage 读工程）：重开又落在导演视图，按 view 再点进旅程要的那一面。
     * @param {{ view?: 'refine' | 'director' }} [options]
     */
    async reload({ view: face = 'refine' } = {}) {
      await page.reload({ waitUntil: 'commit' })
      await boot(face, false)
    },
    /** localStorage 里的工程（编辑器 2s 空闲自动写回；要等状态用 waitScene）。 */
    project: () => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || 'null'), PROJECT_KEY),
    async scene() {
      const project = await lab.project()
      if (!project) return null
      return project.scenes.find((item) => item.id === project.activeSceneId) || project.scenes[0]
    },
    /**
     * 等工程落盘到满足条件（谓词源码在页面里求值，参数 s = 激活图层, p = 工程）。
     * 用轮询代替固定 sleep：自动保存是 2s 空闲触发，真实耗时会变。
     */
    async waitScene(predicateSource, label, timeout = 20_000) {
      try {
        await page.waitForFunction(
          ({ key, src }) => {
            const project = JSON.parse(window.localStorage.getItem(key) || 'null')
            if (!project) return false
            const scene = project.scenes.find((item) => item.id === project.activeSceneId) || project.scenes[0]
            // eslint-disable-next-line no-new-func -- 走查谓词，页面内求值
            return Boolean(new Function('s', 'p', `return (${src})`)(scene, project))
          },
          { key: PROJECT_KEY, src: predicateSource },
          { timeout },
        )
        return true
      } catch {
        throw new Error(`等不到工程状态「${label}」：${predicateSource}`)
      }
    },
    /** E2E 取证桥（scene/E2EBridge.tsx）：projectPoint / projectByName / orientationByName / boundsByEntity / findAll … */
    bridge: (method, ...args) => page.evaluate(([name, list]) => {
      const bridge = window.__nomiDirectorE2E
      return bridge && typeof bridge[name] === 'function' ? bridge[name](...list) : null
    }, [method, args]),
    toasts: () => page.locator('[role="alert"], [role="status"]').allInnerTexts(),
    /** 大纲行。2026-10-04 起大纲住精修顶栏「▤ 图层名 ▾」浮层里（精修「选中才出」），要先 openOutliner() 才在 DOM 里。 */
    outlinerRow: (text) => page.locator('[data-testid="director-outliner-row"]', { hasText: text }).first(),
    /** 打开精修顶栏「▤ 图层名 ▾」浮层（大纲 + 场景设置）；已经开着就不动。 */
    async openOutliner() {
      const trigger = page.getByTestId('director-scene-menu')
      // 先等它可见再读 aria-expanded：不在精修面时这里当场说清，而不是 getAttribute 干等满 15 秒报「Timeout」
      await expectVisible(trigger, '精修顶栏没有「▤ 图层名 ▾」（不在精修面？）')
      if ((await trigger.getAttribute('aria-expanded')) !== 'true') await clickOrFail(trigger, '顶栏·▤ 图层名 ▾')
      await expectVisible(page.getByTestId('director-outliner'), '大纲浮层没打开')
    },
    /** 收起大纲浮层（再点一次触发器，和用户一样）；没开就不动。 */
    async closeOutliner() {
      const trigger = page.getByTestId('director-scene-menu')
      if ((await trigger.getAttribute('aria-expanded')) === 'true') await clickOrFail(trigger, '顶栏·收起大纲')
    },
    /** 在大纲里点一行再收起浮层：用户「挑一个东西」的完整动作（浮层不挡后面在视口里的点击）。 */
    async pickInOutliner(text, label, options) {
      await lab.openOutliner()
      await clickOrFail(lab.outlinerRow(text), label ?? `大纲·${text}`, options)
      await lab.closeOutliner()
    },
    trackRow: (text) => page.getByTestId('director-timeline-tracks').locator('[data-testid="director-timeline-track"]', { hasText: text }).first(),
    async finish() {
      if (pageErrors.length) {
        console.log(`  ✗ 页面报了 ${pageErrors.length} 个未捕获错误：\n    ${pageErrors.slice(0, 5).join('\n    ')}`)
        failures.push('page errors')
      }
      await browser.close()
      await server.close()
      if (failures.length) {
        console.error(`✗ ${name}：${failures.length} 项失败 —— ${failures.join(' / ')}`)
        process.exit(1)
      }
      console.log(`✓ ${name}：全部通过`)
    },
  }
  return lab
}

/** 精修顶栏「＋」→ 角色 → 女人/男人 → 点地面落点（世界坐标 x,z）。 */
export async function placeCharacter(lab, gender, x, z) {
  const { page } = lab
  await openAddMenu(lab, 'creation.character')
  const genderKey = gender === 'female' ? 'creation.female' : 'creation.male'
  const genderLabel = await directorText(page, genderKey)
  await clickOrFail(page.getByRole('button', { name: genderLabel, exact: true }), `角色下拉·${genderLabel}`)
  const point = await lab.bridge('projectPoint', x, 0, z)
  await page.mouse.click(point.x, point.y)
}

/** 精修顶栏「＋」→ 机位 → 预设名（相对当前选中主体）。 */
export async function addCameraPreset(lab, presetLabel) {
  const { page } = lab
  await openAddMenu(lab, 'creation.camera')
  const presetKeys = ['cameraPreset.front_medium', 'cameraPreset.front_closeup']
  const presetKey = presetLabel.includes('.')
    ? presetLabel
    : (await Promise.all(presetKeys.map(async (key) => ({ key, label: await directorText(page, key) })))).find((entry) => entry.label === presetLabel)?.key
  const label = presetKey ? await directorText(page, presetKey) : presetLabel
  await clickOrFail(page.getByRole('button', { name: label, exact: true }), `机位预设·${label}`)
}

/**
 * 精修顶栏「＋」菜单：先开菜单，再进二级项。
 * 2026-09-09 五簇重排：视口左缘那条竖排创建栏没了，四个创建入口都住这个菜单（一功能一个家）；2026-10-04 触发器只剩「＋」图标；
 * 2026-10-16 起它只在精修面（导演视图没有）——launchDirectorLab 默认已点进精修，Electron 走查打开导演台后先 enterRefine。
 */
export async function openAddMenu(lab, itemLabel) {
  const { page } = lab
  await clickOrFail(page.getByTestId('director-add-menu'), '精修顶栏·＋')
  const itemKey = {
    '角色': 'creation.character',
    '机位': 'creation.camera',
    '灯光': 'creation.light',
    '方块': 'creation.box',
  }[itemLabel] ?? (itemLabel?.includes('.') ? itemLabel : null)
  const label = itemKey ? await directorText(page, itemKey) : itemLabel
  if (label) await clickOrFail(page.getByRole('button', { name: label, exact: true }), `添加菜单·${label}`)
}

/** 「＋」菜单底部「资产库」→ 左侧抽屉（2026-10-04 资产库不再常驻右栏页签）。 */
export async function openAssets(lab) {
  const { page } = lab
  await clickOrFail(page.getByTestId('director-add-menu'), '精修顶栏·＋')
  await clickOrFail(page.getByTestId('director-open-assets'), '＋菜单·资产库')
  await expectVisible(page.getByTestId('director-assets-drawer'), '资产库抽屉没打开')
}

/** 关资产库抽屉（点卡头 ×）。抽屉从顶栏下拉到视口底、按设计压在左下预览小窗上面（AssetsDrawer 头注释），要点小窗先关它，和用户一样。 */
export async function closeAssets(lab) {
  const { page } = lab
  await clickOrFail(page.getByTestId('director-assets-close'), '资产库抽屉·×')
  await expectVisible(page.getByTestId('director-pip'), '关了资产库抽屉，左下预览小窗没回来')
}

/** 轨道列头「+ 添加轨道 ▾」→ 实体名（加进来自动带一段 4s 空路径片段）。 */
export async function addTrack(lab, entityName) {
  const { page } = lab
  await clickOrFail(page.getByTestId('director-timeline-tracks-header').getByRole('button', { name: /添加轨道/ }), '轨道列头·添加轨道')
  await clickOrFail(page.getByRole('button', { name: entityName, exact: true }), `添加轨道·${entityName}`)
}

/** 轨道主行「+」（添加动作 / 骨骼 / 视线片段）→ 菜单项（行内加号）。 */
export async function rowAddClipMenu(lab, trackName, itemLabel) {
  const row = lab.trackRow(trackName)
  await expectVisible(row, `时间轴上没有「${trackName}」轨道`)
  const addClipLabel = await directorText(lab.page, 'timeline.menu.addClip')
  await clickOrFail(row.getByRole('button', { name: addClipLabel, exact: true }), `轨道行·添加片段（${trackName}）`)
  await clickOrFail(lab.page.getByRole('menuitem', { name: itemLabel, exact: true }), `追加片段菜单·${itemLabel}`)
}

/** 右键轨道主行 → 菜单项。 */
export async function trackMenu(lab, trackName, itemLabel) {
  const row = lab.trackRow(trackName)
  await expectVisible(row, `时间轴上没有「${trackName}」轨道`)
  await row.click({ button: 'right' })
  await clickOrFail(lab.page.getByRole('menuitem', { name: itemLabel, exact: true }), `轨道菜单·${itemLabel}`)
}

/** 右键副轨行（「动作」「视线」「骨骼帧」…按家族文案找，调用方保证时间轴里只有一条该家族副轨）→ 菜单项。 */
export async function subTrackMenu(lab, familyLabel, itemLabel) {
  const row = lab.page.getByTestId('director-timeline-tracks').getByText(familyLabel, { exact: true }).first()
  await expectVisible(row, `时间轴上没有「${familyLabel}」副轨`)
  await row.click({ button: 'right' })
  await clickOrFail(lab.page.getByRole('menuitem', { name: itemLabel, exact: true }), `副轨菜单·${itemLabel}`)
}

/** 在地面上从世界点 a 拖到 b（画路径 / 画方块底面都用它）。 */
export async function dragGround(lab, a, b, steps = 12) {
  const { page } = lab
  const from = await lab.bridge('projectPoint', a[0], 0, a[1])
  const to = await lab.bridge('projectPoint', b[0], 0, b[1])
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let index = 1; index <= steps; index += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * index) / steps, from.y + ((to.y - from.y) * index) / steps)
  }
  await page.mouse.up()
  return { from, to }
}

/** 3DGS 二进制 PLY（山谷地形）；按导入源的 Y/Z 朝向编码，场景入口绕 X 180° 后还原为 Y-up。 */
export function writeValleyPly(file, count = 40000) {
  const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']
  const header = ['ply', 'format binary_little_endian 1.0', `element vertex ${count}`, ...props.map((p) => `property float ${p}`), 'end_header', ''].join('\n')
  const body = Buffer.alloc(count * props.length * 4)
  let seed = 12345
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let index = 0; index < count; index += 1) {
    const x = (random() - 0.5) * 60
    const z = (random() - 0.5) * 60
    // 中央六米为 y=0 的可站立谷底，坡面从两侧升起。旧夹具在角色脚下起伏，无法验证真正落地。
    const wall = Math.max(0, Math.abs(x) - 3)
    const y = wall * 0.35 + Math.sin(z * 0.3) * Math.min(wall, 1) * 0.6 - 0.12
    const tone = 0.35 + (y / 12) * 0.4
    const values = [x, -y, -z, 0, -1, 0, 0.2 + tone * 0.3, 0.3 + tone * 0.4, 0.15, 2.5, Math.log(0.25 + random() * 0.3), Math.log(0.06), Math.log(0.25 + random() * 0.3), 1, 0, 0, 0]
    values.forEach((value, k) => body.writeFloatLE(value, (index * props.length + k) * 4))
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.concat([Buffer.from(header, 'ascii'), body]))
  return file
}

/** 最小合法 GLB：一个立方体（非索引 36 顶点，只有 POSITION、无材质），给「普通 GLB 保持模型」类走查用，不依赖任何外部模型文件。 */
export function writeCubeGlb(file, size = 0.5) {
  const h = size / 2
  const faces = [
    [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]],
    [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]],
    [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]],
    [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]],
    [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]],
    [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]],
  ]
  const positions = []
  for (const [a, b, c, d] of faces) positions.push(...a, ...b, ...c, ...a, ...c, ...d)
  const bin = Buffer.from(new Float32Array(positions).buffer)
  const json = {
    asset: { version: '2.0', generator: 'nomi-director-lab' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'cube' }],
    meshes: [{ name: 'cube', primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [-h, -h, -h], max: [h, h, h] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength }],
    buffers: [{ byteLength: bin.byteLength }],
  }
  const pad4 = (buffer, fill) => (buffer.byteLength % 4 ? Buffer.concat([buffer, Buffer.alloc(4 - (buffer.byteLength % 4), fill)]) : buffer)
  const jsonChunk = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20)
  const binChunk = pad4(bin, 0)
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonChunk.byteLength + 8 + binChunk.byteLength, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonChunk.byteLength, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binChunk.byteLength, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]))
  return file
}

export { clickOrFail, expectVisible }
