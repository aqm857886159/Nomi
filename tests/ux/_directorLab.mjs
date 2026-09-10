// 导演台的浏览器旅程启动器；真实桌面入口/持久化/出片另由 director-electron.walk.mjs 验证。
//
// 浏览器隔离工程用于快速验证交互，不代表桌面输出/手机桥已通过。
//
// 启动：复用 canvas-perf 的 Vite dev 启动器（同一份 vite 配置、同一份源码），chromium headless；
// 每次都是全新工程（addInitScript 清 localStorage 工程键 + 打开 E2E 取证桥标志）。
//
// 用法：node tests/ux/director-j1-three-person-scene.walk.mjs（各旅程文件自己 import 本启动器）
// 产出：tests/ux/shots/director/<journey>/NN-*.png（gitignore），必须人眼 Read 过才算走查完成（R13 眼见链）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startDevRendererServer } from './canvas-perf/devRendererServer.mjs'
import { clickOrFail, expectVisible, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const PROJECT_KEY = 'nomi:director-lab:project'

/**
 * @param {{ name: string, viewport?: { width: number, height: number } }} options
 */
/** Vite 对任何路径都会回 200（SPA 回退），所以要看正文里有没有 devlab 的入口脚本，HEAD 不算数。 */
function servesDirectorLab(url) {
  return fetch(url)
    .then((response) => (response.ok ? response.text() : ''))
    .then((html) => html.includes('src/devlab/directorLab.tsx'), () => false)
}

/**
 * 找 devlab：NOMI_DIRECTOR_LAB_URL 指定的 / 本机已在跑的 `vite --port 5175`（开发时的习惯端口）优先复用，
 * 否则自起一个。两个 Vite 实例共用 .tmp/vite 依赖缓存会互相触发重新预打包，页面一直加载不完，
 * 所以「能复用就复用」不是优化，是必需。不碰 5173：那通常是 `pnpm dev` 的 Electron 渲染进程。
 */
async function resolveDevServer() {
  const candidates = [process.env.NOMI_DIRECTOR_LAB_URL, 'http://127.0.0.1:5175'].filter(Boolean)
  for (const origin of candidates) {
    if (await servesDirectorLab(`${origin}/director-lab.html`)) {
      console.log(`  · 复用已在跑的 devlab：${origin}`)
      return { url: `${origin}/index.html`, close: async () => {} }
    }
  }
  return startDevRendererServer({ preferredPort: 5285 })
}

export async function launchDirectorLab({ name, viewport = { width: 1440, height: 900 } }) {
  const server = await resolveDevServer()
  // 优先用 Playwright 自带的 Chromium；本机没装（npx playwright install 没跑过）就退回系统 Chrome，并明说
  const browser = await chromium.launch({ headless: true }).catch(async (error) => {
    console.log(`  · Playwright 自带 Chromium 不可用（${String(error).split('\n')[0]}），改用系统 Chrome`)
    return chromium.launch({ headless: true, channel: 'chrome' })
  })
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  page.setDefaultTimeout(stationTimeout())
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  await page.addInitScript((key) => {
    try {
      window.localStorage.setItem('__nomiE2E', '1')
      if (!window.sessionStorage.getItem(`${key}:initialized`)) {
        window.localStorage.removeItem(key)
        window.sessionStorage.setItem(`${key}:initialized`, '1')
      }
    } catch {
      // 无本地存储：走查照跑，工程只活在内存
    }
  }, PROJECT_KEY)
  const base = server.url.replace(/\/index\.html$/, '')
  // Vite 冷启动首屏要做依赖预打包 + 整张模块图的首次转译（three / spark / drei）：实测全新服务 + headless 约 5 分钟，
  // 预热过的服务 5 秒。模块脚本会阻塞 DOMContentLoaded，所以只等导航提交，首屏用画中画元素做信号，上限 8 分钟。
  // 迭代时开着一个 `vite --port 5175`（或设 NOMI_DIRECTOR_LAB_URL）就走热路径。
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  const shotsDir = path.join(repoRoot, 'tests/ux/shots/director', name)
  fs.mkdirSync(shotsDir, { recursive: true })
  await page.goto(`${base}/director-lab.html`, { timeout: stationTimeout({ operations: 4 }), waitUntil: 'commit' })
  try {
    await expectVisible(page.getByTestId('director-pip'), '导演台壳没起来（devlab 页面没挂出画中画）', stationTimeout({ operations: 32 }))
    await page.waitForFunction(() => Boolean(window.__nomiDirectorE2E), null, { timeout: stationTimeout({ operations: 4 }) })
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
    outlinerRow: (text) => page.locator('[data-testid="director-outliner-row"]', { hasText: text }).first(),
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

/** 顶栏「＋添加」→ 角色 → 女人/男人 → 点地面落点（世界坐标 x,z）。 */
export async function placeCharacter(lab, gender, x, z) {
  const { page } = lab
  await openAddMenu(lab, '角色')
  await clickOrFail(page.getByRole('button', { name: gender === 'female' ? '女人' : '男人' }), `角色下拉·${gender}`)
  const point = await lab.bridge('projectPoint', x, 0, z)
  await page.mouse.click(point.x, point.y)
}

/** 顶栏「＋添加」→ 机位 → 预设名（相对当前选中主体）。 */
export async function addCameraPreset(lab, presetLabel) {
  const { page } = lab
  await openAddMenu(lab, '机位')
  await clickOrFail(page.getByRole('button', { name: presetLabel, exact: true }), `机位预设·${presetLabel}`)
}

/**
 * 顶栏「＋添加」菜单：先开菜单，再进二级项。
 * 2026-09-09 五簇重排：视口左缘那条竖排创建栏没了，四个创建入口都住这个菜单（一功能一个家）。
 */
export async function openAddMenu(lab, itemLabel) {
  const { page } = lab
  await clickOrFail(page.getByTestId('director-add-menu'), '顶栏·添加')
  if (itemLabel) await clickOrFail(page.getByRole('button', { name: itemLabel, exact: true }), `添加菜单·${itemLabel}`)
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
  await clickOrFail(row.getByRole('button', { name: '添加动作 / 骨骼 / 视线片段' }), `轨道行·添加片段（${trackName}）`)
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
