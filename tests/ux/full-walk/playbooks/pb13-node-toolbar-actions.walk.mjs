#!/usr/bin/env node
// 剧本 PB13 · 铁律 ⑫「点了 = 以为的」第二批：图片节点浮条上每个动作各点一下（2026-10-06 用户：抠图没法用、
// 菜单盖住按钮、高清是死路——第一批 ⑫ 只登记了分镜表，浮条一个都没点过，所以这三样都没被拦住）。
//
// 每一下走 `monitor.checkClickTarget`：点之前读一遍页面和落盘项目，点之后再读一遍，拿 catalog.mjs 的 userExpectation 对照；
// 对不上的当场写进逃逸账本。本机动作（抠图 / 旋转 / 裁剪 / 宫格）也算——它们不花钱，但同样会「点了没反应」。
//
// 零花费：供应商是本机回环夹具；派生类动作只建节点、不开跑，判据里核「供应商一笔都没收到」。
// 抠图要的模型从 Nomi 自己的镜像拉：走查的出网闸不放公网，所以这里把镜像上的那几块先拉到本机缓存
// （.tmp/remove-background-mirror/<版本>/，第一次跑要下约 56MB），在 127.0.0.1 上起一个只读的文件服务，
// 由出网闸把 App 对镜像地址的请求改投过来（NOMI_WALK_URL_REDIRECTS，闸里记 redirected）——
// App 请求的还是那个镜像地址，产品代码一行不改（不加「测试专用地址」那种第二条路）。
// 窗口放屏幕外、不抢焦点；隔离资料目录，不连用户开着的 Nomi。
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clickOrFail, expect } from '../../_assert.mjs'
import { stationTimeout } from '../../_station-budget.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR } from '../../agent-runtime-fixture.mjs'
import { probePopupGeometry } from '../../design-lab/popupGeometry.mjs'
import { NODE_TOOLBAR_CLICK_TARGETS } from '../catalog.mjs'
import { uiText } from '../invariants.mjs'
import { clickBlank, selectNode } from '../actions.mjs'
import { startPlaybook } from '../launch.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

// ── 抠图镜像：地址与资源清单只认产品里那一份（removeBackgroundModelSource.ts），这里按源码读，不抄常量 ──
const source = fs.readFileSync(path.join(repoRoot, 'src/lib/removeBackgroundModelSource.ts'), 'utf8')
const MIRROR_VERSION = /IMGLY_BACKGROUND_REMOVAL_DATA_VERSION = '([^']+)'/.exec(source)?.[1]
const MIRROR_ROOT = /REMOVE_BACKGROUND_PUBLIC_PATH = `([^`]+)`/.exec(source)?.[1]?.replace('${IMGLY_BACKGROUND_REMOVAL_DATA_VERSION}', MIRROR_VERSION ?? '')
const MODEL = /REMOVE_BACKGROUND_MODEL = '([^']+)'/.exec(source)?.[1]
if (!MIRROR_VERSION || !MIRROR_ROOT || !MODEL) throw new Error('读不出 removeBackgroundModelSource.ts 里的镜像地址 / 版本 / 模型——常量改名了，剧本要跟着改')
const RESOURCE_KEYS = [`/models/${MODEL}`, '/onnxruntime-web/ort-wasm-simd-threaded.wasm', '/onnxruntime-web/ort-wasm-simd-threaded.mjs']
const CACHE_DIR = path.join(repoRoot, '.tmp', 'remove-background-mirror', MIRROR_VERSION)

/** 把镜像上要用的文件拉到本机缓存（已有且大小对就跳过）。返回 文件名 → 本地路径。 */
async function ensureMirrorCache() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const manifestFile = path.join(CACHE_DIR, 'resources.json')
  if (!fs.existsSync(manifestFile)) {
    const response = await fetch(`${MIRROR_ROOT}resources.json`)
    if (!response.ok) throw new Error(`镜像清单取不到：HTTP ${response.status}`)
    fs.writeFileSync(manifestFile, Buffer.from(await response.arrayBuffer()))
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  const files = new Map([['resources.json', manifestFile]])
  for (const key of RESOURCE_KEYS) {
    const entry = manifest[key]
    if (!entry) throw new Error(`镜像清单里没有 ${key}`)
    for (const chunk of entry.chunks) {
      const file = path.join(CACHE_DIR, chunk.name)
      const size = chunk.offsets[1] - chunk.offsets[0]
      if (!fs.existsSync(file) || fs.statSync(file).size !== size) {
        const response = await fetch(`${MIRROR_ROOT}${chunk.name}`)
        if (!response.ok) throw new Error(`镜像文件 ${chunk.name} 取不到：HTTP ${response.status}`)
        fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()))
      }
      files.set(chunk.name, file)
    }
  }
  return files
}
const mirrorFiles = await ensureMirrorCache()

const mirrorServer = http.createServer((request, response) => {
  const name = decodeURIComponent(String(request.url || '').replace(/^\//, '').split('?')[0])
  const file = mirrorFiles.get(name)
  if (!file) { response.writeHead(404, { 'access-control-allow-origin': '*' }).end('not in mirror cache'); return }
  response.writeHead(200, { 'content-type': name.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'access-control-allow-origin': '*' })
  fs.createReadStream(file).pipe(response)
})
await new Promise((resolve) => mirrorServer.listen(0, '127.0.0.1', resolve))
const MIRROR_LOCAL = `http://127.0.0.1:${mirrorServer.address().port}/`

const SRC = 'src-image'
const base = { categoryId: 'shots', references: [], runs: [] }
const pb = await startPlaybook({
  id: 'pb13-node-toolbar-actions',
  needs: ['loopbackProvider'],
  offscreen: true,
  env: { NOMI_WALK_URL_REDIRECTS: JSON.stringify([{ from: MIRROR_ROOT, to: MIRROR_LOCAL }]) },
  seed: ({ imageResult, imageMeta }) => ({
    nodes: [{
      ...base, id: SRC, kind: 'image', title: 'Harbour', prompt: '', position: { x: 260, y: 260 }, status: 'success',
      result: imageResult('src-r1', 1, 1), history: [imageResult('src-r1', 1, 1)],
      meta: { ...imageMeta(), modelKey: FIXTURE_IMAGE_MODEL, modelVendor: FIXTURE_VENDOR, imageModel: FIXTURE_IMAGE_MODEL, imageModelVendor: FIXTURE_VENDOR },
    }],
    groups: [],
    edges: [],
  }),
})
const { smoke, fixture, monitor, locale } = pb
const win = () => smoke.win
const text = (key) => uiText(locale, key)
const toolbar = () => win().locator(`[role="toolbar"][aria-label="${text('generationCommon.imageToolbar.aria')}"]`).first()
const button = (name) => toolbar().getByRole('button', { name, exact: true }).first()
const targetOf = (id) => {
  const found = NODE_TOOLBAR_CLICK_TARGETS.find((entry) => entry.id === id)
  if (!found) throw new Error(`catalog.mjs 没有登记可点目标 ${id}`)
  return found
}

/** 页面与落盘此刻的样子：只读 DOM 与项目文件，不读组件内部状态。 */
async function readPage() {
  const project = await monitor.readProject()
  const canvas = project?.payload?.generationCanvas ?? project?.generationCanvas ?? {}
  const nodes = (canvas.nodes ?? []).map((node) => ({
    id: node.id, kind: node.kind, status: node.status, hasResult: Boolean(node.result?.url), resultUrl: node.result?.url ?? null,
    versions: (node.history ?? []).length, prompt: String(node.prompt ?? ''), model: node.meta?.modelKey ?? null, vendor: node.meta?.modelVendor ?? null, width: node.meta?.imageWidth ?? null, height: node.meta?.imageHeight ?? null,
  }))
  const dom = await win().evaluate(() => {
    const visible = (element) => {
      if (!element) return false
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    }
    return {
      dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible).map((element) => element.getAttribute('aria-label') || element.getAttribute('data-testid') || 'dialog'),
      whiteboard: visible(document.querySelector('[data-nomi-whiteboard-modal="true"]')),
      modelSettingsPages: [...document.querySelectorAll('[data-model-settings-page]')].filter(visible).map((element) => element.getAttribute('data-model-settings-page')),
      menus: [...document.querySelectorAll('[role="menu"]')].filter(visible).length,
      feedback: [...document.querySelectorAll('[role="status"], [data-node-feedback], [data-canvas-toast]')].filter(visible).map((element) => element.textContent?.trim()).filter(Boolean).slice(0, 4),
    }
  })
  return { nodes, edges: (canvas.edges ?? []).map((edge) => ({ source: edge.source, target: edge.target })), groups: (canvas.groups ?? []).length, providerImages: fixture.images.length, ...dom }
}
const nodeOf = (snapshot, id) => snapshot.nodes.find((node) => node.id === id)
const newNodes = (before, after) => after.nodes.filter((node) => !before.nodes.some((old) => old.id === node.id))
const describeNew = (added, after) => added.map((node) => `${node.kind}${node.hasResult ? '（带结果）' : '（空）'}${node.status ? `·${node.status}` : ''}${node.prompt ? '·提示词已填' : ''}${after.edges.some((edge) => edge.source === SRC && edge.target === node.id) ? '·连着原图' : ''}`).join('、')

async function openMenu(label) {
  await clickOrFail(button(label), `浮条「${label}」`)
  await expect(win().locator('[role="menu"], [data-grid-split-picker]').first(), `「${label}」点开了`).toBeVisible({ timeout: stationTimeout() })
}
async function reselect() {
  await win().keyboard.press('Escape').catch(() => undefined)
  if (!(await toolbar().isVisible().catch(() => false))) await selectNode(win(), SRC)
  await expect(toolbar(), '浮条在').toBeVisible({ timeout: stationTimeout() })
}
/** 派生类动作的判据：多一个空闲的图片节点，连着原图、提示词已填、供应商一笔没收；原图不变。 */
const judgeDerived = (before, after) => {
  const added = newNodes(before, after)
  const derived = added.find((node) => node.kind === 'image' && !node.hasResult && node.prompt && after.edges.some((edge) => edge.source === SRC && edge.target === node.id))
  const srcSame = nodeOf(after, SRC)?.resultUrl === nodeOf(before, SRC)?.resultUrl
  const charged = after.providerImages > before.providerImages
  const ok = added.length === 1 && Boolean(derived) && srcSame && !charged
  return { ok, actual: added.length ? `多了 ${added.length} 个节点：${describeNew(added, after)}${srcSame ? '' : '；原图被改了'}${charged ? '；供应商收到了请求' : '；供应商没收到请求'}` : `没有多出节点${after.feedback.length ? `；提示「${after.feedback.join(' / ')}」` : ''}` }
}

let harnessError = null
try {
  await monitor.step('打开项目（从项目库）', () => smoke.openProject(), { surfaces: ['*'], critical: true })
  await monitor.step('选中这张图，浮条出来', async () => {
    await selectNode(win(), SRC)
    await expect(toolbar(), '图片浮条').toBeVisible({ timeout: stationTimeout() })
  }, { surfaces: ['*'], critical: true })
  await monitor.screenshot('01-toolbar')

  await monitor.checkClickTarget(targetOf('tb-multi-angle-grid'), {
    observe: readPage,
    act: async () => {
      await clickOrFail(button(text('generationCommon.quickActions.actions.multiAngleGrid')), '多机位九宫格')
      await expect.poll(async () => (await readPage()).nodes.length, { timeout: stationTimeout() }).toBeGreaterThan(1).catch(() => undefined)
    },
    judge: judgeDerived,
  })
  await reselect()

  await monitor.checkClickTarget(targetOf('tb-more-next-moment'), {
    observe: readPage,
    act: async () => {
      await openMenu(text('generationCommon.quickActions.moreEffects'))
      await clickOrFail(win().locator('[data-menu-item="quick-next-moment"]').first(), '下一刻')
      await expect.poll(async () => (await readPage()).nodes.length, { timeout: stationTimeout() }).toBeGreaterThan(2).catch(() => undefined)
    },
    judge: judgeDerived,
  })
  await reselect()

  await monitor.checkClickTarget(targetOf('tb-refine-outpaint'), {
    observe: readPage,
    act: async () => {
      await openMenu(text('generationCommon.quickActions.refine'))
      await clickOrFail(win().locator('[data-menu-item="quick-outpaint"]').first(), '扩图')
      await expect.poll(async () => (await readPage()).nodes.length, { timeout: stationTimeout() }).toBeGreaterThan(3).catch(() => undefined)
    },
    judge: judgeDerived,
  })
  await reselect()

  let upscaleRow = null
  await monitor.checkClickTarget(targetOf('tb-refine-upscale'), {
    observe: readPage,
    act: async () => {
      const before = await readPage()
      await openMenu(text('generationCommon.quickActions.refine'))
      const item = win().locator('[data-menu-item="quick-upscale"]').first()
      upscaleRow = { disabled: (await item.getAttribute('data-disabled')) !== null, text: (await item.innerText()).replace(/\s+/g, ' ').trim() }
      await monitor.screenshot('click-tb-refine-upscale-menu')
      if (!upscaleRow.disabled) await item.click()
      else await win().keyboard.press('Escape')
      await expect.poll(async () => { const now = await readPage(); return now.modelSettingsPages.includes('platformConnect') || now.nodes.length > before.nodes.length }, { timeout: stationTimeout() }).toBe(true).catch(() => undefined)
      await monitor.screenshot('click-tb-refine-upscale-settings')
    },
    judge: (before, after) => {
      // 两种处境都合理，看目录里此刻有没有能放大的模型（菜单第二行有没有那句引导就是答案）：
      //   · 有（例：即梦超清——本地免钥匙的家，装机就算「可用」）：多一个连着原图、用放大模型的空闲节点，供应商零请求；
      //   · 没有：第二行说缺什么、要接谁，点了落到 kie 的接入页，不建节点、不花钱。
      const guided = upscaleRow ? upscaleRow.text.includes(text('generationCommon.quickActions.guides.upscaleAdd')) : false
      const landed = after.modelSettingsPages.includes('platformConnect')
      const added = newNodes(before, after)
      const charged = after.providerImages > before.providerImages
      const prepared = added.length === 1 && !added[0].hasResult && after.edges.some((edge) => edge.source === SRC && edge.target === added[0].id)
      const ok = Boolean(upscaleRow) && !upscaleRow.disabled && !charged && (guided ? landed && added.length === 0 : prepared)
      const what = guided
        ? `第二行写着引导；点了${landed ? '打开了设置里 kie 的接入页' : `没有落到接入页（看到的是 ${after.modelSettingsPages.join(' / ') || '无'}）`}${added.length ? '；却建了节点' : ''}`
        : `目录里有放大模型，点了${prepared ? `多了一个连着原图的空闲放大节点（${added.map((node) => `${node.vendor}/${node.model}`).join('、')}）` : `没有建出放大节点（多了 ${added.length} 个）`}`
      return { ok, actual: !upscaleRow ? '菜单里没有这一项' : `这一项${upscaleRow.disabled ? '灰着点不了' : '可以点'}，写着「${upscaleRow.text}」；${what}${charged ? '；供应商收到了请求' : ''}` }
    },
  })
  await monitor.step('关上设置（复原）', async () => {
    await win().keyboard.press('Escape')
    await win().keyboard.press('Escape')
    await expect.poll(async () => (await readPage()).modelSettingsPages.length, { timeout: stationTimeout() }).toBe(0).catch(() => undefined)
  }, { surfaces: ['*'] })
  await reselect()

  await monitor.checkClickTarget(targetOf('tb-refine-rotate'), {
    observe: readPage,
    act: async () => {
      await openMenu(text('generationCommon.quickActions.refine'))
      await clickOrFail(win().locator('[data-menu-item="transform-rotate-right"]').first(), '向右旋转 90°')
      await expect.poll(async () => nodeOf(await readPage(), SRC)?.versions, { timeout: stationTimeout() }).toBeGreaterThan(1).catch(() => undefined)
    },
    judge: (before, after) => {
      const was = nodeOf(before, SRC)
      const now = nodeOf(after, SRC)
      const swapped = was?.width && now?.width === was.height && now?.height === was.width
      const ok = Boolean(now) && now.resultUrl !== was.resultUrl && now.versions === was.versions + 1 && Boolean(swapped) && newNodes(before, after).length === 0
      return { ok, actual: `版本 ${was?.versions} → ${now?.versions}，尺寸 ${was?.width}×${was?.height} → ${now?.width}×${now?.height}${now?.resultUrl === was?.resultUrl ? '，当前版没换' : '，当前版换成了新的一版'}` }
    },
  })
  await reselect()

  let cropOpened = false
  await monitor.checkClickTarget(targetOf('tb-refine-crop'), {
    observe: readPage,
    act: async () => {
      await openMenu(text('generationCommon.quickActions.refine'))
      await clickOrFail(win().locator('[data-menu-item="crop"]').first(), '裁剪')
      const cancel = win().getByRole('button', { name: text('generationCommon.cropGrid.cancel') }).first()
      cropOpened = await cancel.isVisible({ timeout: stationTimeout() }).catch(() => false)
      await monitor.screenshot('click-tb-refine-crop-open')
      if (cropOpened) await cancel.click()
      await win().waitForTimeout(300)
    },
    judge: (before, after) => {
      const was = nodeOf(before, SRC)
      const now = nodeOf(after, SRC)
      const ok = cropOpened && now?.resultUrl === was?.resultUrl && now?.versions === was?.versions
      return { ok, actual: `${cropOpened ? '出现了裁剪框' : '没出现裁剪框'}；取消后${now?.resultUrl === was?.resultUrl && now?.versions === was?.versions ? '图和版本都没变' : '图或版本变了'}` }
    },
  })
  await reselect()

  await monitor.checkClickTarget(targetOf('tb-grid-four'), {
    observe: readPage,
    act: async () => {
      const startCount = (await readPage()).nodes.length
      await openMenu(text('generationCommon.quickActions.grid'))
      await clickOrFail(win().locator('[data-grid-split-picker] button').first(), '4 宫格')
      await clickOrFail(win().getByRole('button', { name: text('generationCommon.cropGrid.confirmSplit') }).first(), '确认切分')
      await expect.poll(async () => (await readPage()).nodes.length, { timeout: stationTimeout() }).toBeGreaterThanOrEqual(startCount + 4).catch(() => undefined)
    },
    judge: (before, after) => {
      const added = newNodes(before, after)
      const srcSame = nodeOf(after, SRC)?.resultUrl === nodeOf(before, SRC)?.resultUrl
      const ok = added.length === 4 && added.every((node) => node.hasResult) && after.groups === before.groups + 1 && srcSame
      return { ok, actual: `多了 ${added.length} 个节点（${added.filter((node) => node.hasResult).length} 个带图），分组 ${before.groups} → ${after.groups}${srcSame ? '，原图没变' : '，原图被改了'}` }
    },
  })
  await reselect()

  const removeStarted = Date.now()
  let removeTook = 0
  await monitor.checkClickTarget(targetOf('tb-remove-background'), {
    observe: readPage,
    act: async () => {
      await clickOrFail(button(text('generationCommon.imageToolbar.removeBackground')), '抠图')
      // 首次要下模型（本机缓存应答）+ 单线程推理；判据看落盘的新版本，不看转圈。
      await expect.poll(async () => nodeOf(await readPage(), SRC)?.resultUrl?.includes('remove-bg') ?? false, { timeout: stationTimeout({ operations: 16 }) }).toBe(true).catch(() => undefined)
      removeTook = Date.now() - removeStarted
    },
    judge: (before, after) => {
      const was = nodeOf(before, SRC)
      const now = nodeOf(after, SRC)
      const isCutout = Boolean(now?.resultUrl?.includes('remove-bg'))
      const ok = isCutout && now.versions === was.versions + 1 && now.status === 'success'
      return { ok, actual: `${isCutout ? '当前版换成了抠图结果' : '当前版没换'}，版本 ${was?.versions} → ${now?.versions}，用时约 ${Math.round(removeTook / 1000)} 秒${after.feedback.length ? `；提示「${after.feedback.join(' / ')}」` : ''}` }
    },
  })
  await monitor.step('抠图结果是透明底（角上透明）', async () => {
    const url = nodeOf(await readPage(), SRC)?.resultUrl
    const alpha = await win().evaluate(async (src) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = src })
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      const corner = context.getImageData(1, 1, 1, 1).data[3]
      let opaque = 0
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data
      for (let index = 3; index < data.length; index += 4 * 97) if (data[index] > 200) opaque += 1
      return { corner, opaqueShare: opaque / (data.length / (4 * 97)) }
    }, url)
    expect(alpha.corner, `角上的 alpha（${JSON.stringify(alpha)}）`).toBeLessThan(40)
    // 主体留多少取决于这张图本身（登记的真实抽帧是一间屋子，没有明显主体，几乎整张都会被当成背景）——只记下来，不判。
    monitor.note({ kind: 'remove-background-alpha', ...alpha })
  }, { surfaces: ['*'] })
  await reselect()

  await monitor.checkClickTarget(targetOf('tb-whiteboard'), {
    observe: readPage,
    act: async () => {
      await clickOrFail(toolbar().getByRole('button', { name: text('generationCommon.imageToolbar.whiteboard'), exact: true }).first(), '画板')
      await expect(win().locator('[data-nomi-whiteboard-modal="true"]').first(), '画板打开').toBeVisible({ timeout: stationTimeout() }).catch(() => undefined)
      await win().waitForTimeout(600)
    },
    judge: (_before, after) => ({ ok: after.whiteboard, actual: after.whiteboard ? '画板打开了' : '画板没打开' }),
  })
  await monitor.step('关上画板（复原）', async () => {
    await win().keyboard.press('Escape')
    await expect(win().locator('[data-nomi-whiteboard-modal="true"]'), '画板关上').toHaveCount(0, { timeout: stationTimeout() })
  }, { surfaces: ['*'] })
  await reselect()

  await monitor.checkClickTarget(targetOf('tb-fullscreen'), {
    observe: readPage,
    act: async () => {
      await clickOrFail(toolbar().getByRole('button', { name: text('generationCommon.imageToolbar.fullscreenAria'), exact: true }).first(), '全屏预览')
      await win().waitForTimeout(600)
    },
    judge: (before, after) => ({ ok: after.dialogs.length > before.dialogs.length, actual: after.dialogs.length > before.dialogs.length ? `打开了预览（${after.dialogs.join(' / ')}）` : '没打开预览' }),
  })
  await monitor.step('Esc 关上预览（复原）', async () => {
    await win().keyboard.press('Escape')
    await win().waitForTimeout(300)
  }, { surfaces: ['*'] })
  await reselect()

  await monitor.checkClickTarget(targetOf('tb-provenance'), {
    observe: readPage,
    act: async () => {
      await clickOrFail(toolbar().getByRole('button', { name: text('generationCommon.provenance.view'), exact: true }).first(), '查看生成记录')
      await win().waitForTimeout(600)
    },
    judge: (before, after) => ({ ok: after.dialogs.length > before.dialogs.length, actual: after.dialogs.length > before.dialogs.length ? `打开了（${after.dialogs.join(' / ')}）` : '没打开' }),
  })
  await monitor.step('Esc 关上生成记录（复原）', async () => {
    await win().keyboard.press('Escape')
    await win().waitForTimeout(300)
  }, { surfaces: ['*'] })
  await reselect()

  await monitor.checkClickTarget(targetOf('tb-duplicate-variant'), {
    observe: readPage,
    act: async () => {
      const startCount = (await readPage()).nodes.length
      await clickOrFail(toolbar().getByRole('button', { name: text('generationCommon.node.duplicateVariant'), exact: true }).first(), '复制为变体')
      await expect.poll(async () => (await readPage()).nodes.length, { timeout: stationTimeout() }).toBeGreaterThan(startCount).catch(() => undefined)
    },
    judge: (before, after) => {
      const added = newNodes(before, after)
      const ok = added.length === 1 && !added[0].hasResult && added[0].kind === 'image' && after.providerImages === before.providerImages
      return { ok, actual: added.length ? `多了 ${added.length} 个节点：${describeNew(added, after)}` : '没有多出节点' }
    },
  })

  // ── 节点贴画布上沿时打开「改图 ▾」：菜单不许压住浮条那一排（用户截图那一格，真 App 版） ──
  let geometry = null
  await monitor.checkClickTarget(targetOf('tb-menu-near-top'), {
    observe: readPage,
    act: async () => {
      await clickBlank(win())
      await selectNode(win(), SRC)
      const stage = await win().locator('.generation-canvas-v2__stage').first().boundingBox()
      const card = await win().locator(`[data-node-id="${SRC}"]`).first().boundingBox()
      if (!stage || !card) throw new Error('量不到舞台或卡片')
      // 中键拖画布，把卡的上沿拖到离舞台上沿 30px（浮条被夹回舞台里、头顶放不下菜单）。
      const start = { x: stage.x + stage.width - 60, y: stage.y + stage.height - 60 }
      const dy = Math.round(stage.y + 30 - card.y)
      await win().mouse.move(start.x, start.y)
      await win().mouse.down({ button: 'middle' })
      await win().mouse.move(start.x + 2, start.y + 1)
      await win().mouse.move(start.x, start.y + dy, { steps: 10 })
      await win().mouse.up({ button: 'middle' })
      await win().waitForTimeout(500)
      await reselect()
      await openMenu(text('generationCommon.quickActions.refine'))
      await win().waitForTimeout(200)
      geometry = await win().evaluate(probePopupGeometry)
      await monitor.screenshot('click-tb-menu-near-top-open')
      await win().keyboard.press('Escape')
    },
    judge: () => ({
      ok: Boolean(geometry) && geometry.layers > 0 && geometry.violations.length === 0,
      actual: !geometry ? '没量到' : geometry.layers === 0 ? '菜单没打开' : geometry.violations.length ? `菜单压住了：${geometry.violations.map((v) => v.rule).join('、')}` : '菜单整块在窗口里，没压住「改图」和浮条上别的按钮',
    }),
  })
} catch (error) {
  harnessError = error
} finally {
  process.exitCode = await pb.finish(harnessError)
  mirrorServer.close()
}
