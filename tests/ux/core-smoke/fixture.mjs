// 核心冒烟的夹具（2026-09-22，docs/plan/2026-09-22-core-flow-smoke-three-defenses.md）。
//
// 三种夹具：
//   empty        空白起点：项目里只有场景自带的最少节点
//   used         「用过的项目」：同一项目里先铺 24 张真实卡（取自真实用户项目快照，多版本、带连线）、
//                两个带成员的编组 + 一个空编组框、时间轴有 clip 且展开、Agent 面板开着、窗口 1280×800
//   profile-copy 只在本机：用户真实 profile 的 cp -R 深拷贝（runner 负责拷与删），项目按 used 建进拷贝
//
// 前置状态怎么造（取舍见方案）：写 App 自己持久化的 `.nomi/project.json` + App 自己的本机偏好键，
// 再**从项目库卡片用 UI 打开**——加载 / 迁移 / 规范化 / 渲染走的都是用户重开昨天项目的真实路径。
// 不往 store 里灌任何东西。被测动作一律由走查用真实鼠标 / 键盘 / 滚轮驱动。
//
// 素材：只用登记表里的真实素材（仓库内那条真 AI 镜头 + 它的抽帧，见 tests/ux/real-media-fixtures.json），
// 缺文件即红，不退回合成素材。几何从文件探出来，不硬写。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { expect } from '../_assert.mjs'
import { launchNomiApp, repoRoot } from '../_launchApp.mjs'
import { CANVAS_STAGE_SELECTOR } from '../_canvasHit.mjs'
import { stationTimeout } from '../_station-budget.mjs'
import { requireRealMediaAssets } from '../fixtures/realMedia.mjs'
import { provisionNeeds } from './needs.mjs'
import { CORE_SMOKE_FIXTURES, LOCAL_ONLY_FIXTURES } from './scenarios.mjs'

const require = createRequire(import.meta.url)
const FFMPEG = require('@ffmpeg-installer/ffmpeg').path
const FFPROBE = require('@ffprobe-installer/ffprobe').path

/** 「用过的项目」的窗口：用户笔记本上常见的小窗（内容区像素）。 */
export const USED_VIEWPORT = Object.freeze({ width: 1280, height: 800 })
const SNAPSHOT_FILE = path.join(repoRoot, 'tests/ux/fixtures/perf-heavy.project.json')
const FRAME_TIMES = Object.freeze(['0.5', '1.3', '2.1', '2.9', '3.7', '4.5'])
const AGENT_PANEL = '[data-agent-resident="true"][data-agent-panel="true"]'
const TIMELINE_EXPANDED = '[data-timeline-collapse="true"]'

/** 本次进程由 runner 指派的夹具 / 用例 / 依赖。单独跑走查时默认 empty。 */
export function readCoreSmokeEnvironment(env = process.env) {
  const fixture = env.NOMI_CORE_SMOKE_FIXTURE || 'empty'
  if (![...CORE_SMOKE_FIXTURES, ...LOCAL_ONLY_FIXTURES].includes(fixture)) throw new Error(`未知夹具「${fixture}」`)
  const assignedNeeds = env.NOMI_CORE_SMOKE_NEEDS === undefined
    ? null
    : env.NOMI_CORE_SMOKE_NEEDS.split(',').map((item) => item.trim()).filter(Boolean)
  return {
    fixture,
    caseId: env.NOMI_CORE_SMOKE_CASE || null,
    assignedNeeds,
    profileCopyRoot: env.NOMI_CORE_SMOKE_PROFILE_COPY_ROOT || null,
    locale: env.NOMI_CORE_SMOKE_LOCALE || null,
  }
}

function probe(file) {
  const out = execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' })
  const parsed = JSON.parse(out)
  const stream = parsed.streams?.[0]
  if (!stream?.width || !stream?.height) throw new Error(`探不出 ${file} 的画面尺寸`)
  return { width: stream.width, height: stream.height, durationSeconds: Number(parsed.format?.duration) || null }
}

const localUrl = (projectId, relative) =>
  `nomi-local://asset/${encodeURIComponent(projectId)}/${relative.split('/').map(encodeURIComponent).join('/')}`

/** 把登记的真实镜头拷进项目、抽帧，全部尺寸实测。 */
function materializeRealMedia(projectRoot, projectId) {
  const { assets } = requireRealMediaAssets(['video-ai-shot-640x360', 'image-ai-shot-frame-png'])
  const video = assets.get('video-ai-shot-640x360')
  const frameSpec = assets.get('image-ai-shot-frame-png').spec
  const dir = path.join(projectRoot, 'assets', 'imported')
  fs.mkdirSync(dir, { recursive: true })
  const videoRelative = 'assets/imported/ai-shot.mp4'
  fs.copyFileSync(video.file, path.join(projectRoot, videoRelative))
  const frames = FRAME_TIMES.map((at, index) => {
    const relative = `assets/imported/frame-${index + 1}.png`
    const file = path.join(projectRoot, relative)
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at, '-i', video.file, '-frames:v', '1', file], { stdio: 'pipe' })
    if (fs.statSync(file).size < frameSpec.minBytes) throw new Error(`抽帧 ${relative} 只有 ${fs.statSync(file).size} 字节，低于登记下限 ${frameSpec.minBytes}（多半黑帧）`)
    return { relative, url: localUrl(projectId, relative) }
  })
  const videoGeometry = probe(path.join(projectRoot, videoRelative))
  const frameGeometry = probe(path.join(projectRoot, frames[0].relative))
  return {
    frames,
    video: { relative: videoRelative, url: localUrl(projectId, videoRelative), posterUrl: frames[0].url },
    imageMeta: { imageWidth: frameGeometry.width, imageHeight: frameGeometry.height, imageAspectRatio: frameGeometry.width / frameGeometry.height },
    videoMeta: { videoWidth: videoGeometry.width, videoHeight: videoGeometry.height, videoAspectRatio: videoGeometry.width / videoGeometry.height },
    videoDurationSeconds: videoGeometry.durationSeconds,
  }
}

/** 给场景 seed 用的小工具：造一条指向真实抽帧的图片结果。 */
function mediaHelpers(media) {
  const frame = (index) => media.frames[(index - 1) % media.frames.length]
  return {
    frame,
    video: media.video,
    imageMeta: () => ({ ...media.imageMeta }),
    videoMeta: () => ({ ...media.videoMeta }),
    imageResult: (id, frameIndex, createdAt = 1) => ({ id, type: 'image', url: frame(frameIndex).url, thumbnailUrl: frame(frameIndex).url, createdAt }),
  }
}

function nodeBox(node) {
  const width = node.size?.width ?? 320
  const height = node.size?.height ?? 320
  return { left: node.position.x, top: node.position.y, right: node.position.x + width, bottom: node.position.y + height }
}

/**
 * 「用过的项目」的背景：从真实用户项目快照里挑 24 张卡（保留真实标题 / 提示词 / 多版本 history / meta 形状），
 * 媒体全部改指登记的真实素材，几何换成实测值。再按快照的数据形状补编组、空编组框、时间轴 clip。
 */
function buildUsedBackground({ snapshot, projectId, media, origin }) {
  // 只挑真的出过结果的卡（用过的项目里，卡上是有东西的；没结果的空卡由场景自己放）。
  const source = snapshot.payload.generationCanvas.nodes.filter((node) => node.result || (node.history ?? []).length > 0)
  const multi = source.filter((node) => (node.history ?? []).length >= 2)
  const images = source.filter((node) => node.kind !== 'video' && node.kind !== 'asset').slice(0, 8)
  const pickedIds = new Set([...multi, ...images].map((node) => node.id))
  const moreVideos = source.filter((node) => node.kind === 'video' && !pickedIds.has(node.id)).slice(0, 24 - pickedIds.size)
  const picked = [...images, ...multi, ...moreVideos]
  const size = { width: 320, height: Math.round(320 * media.imageMeta.imageHeight / media.imageMeta.imageWidth) }
  const columns = 6
  const remapEntry = (entry, node, index, version) => {
    const isVideo = node.kind === 'video'
    const frame = media.frames[(index + version) % media.frames.length]
    return {
      id: entry.id,
      type: isVideo ? 'video' : 'image',
      url: isVideo ? media.video.url : frame.url,
      thumbnailUrl: frame.url,
      ...(entry.model ? { model: entry.model } : {}),
      ...(entry.taskKind ? { taskKind: entry.taskKind } : {}),
      createdAt: entry.createdAt ?? version + 1,
      ...(entry.provenance ? { provenance: entry.provenance } : {}),
    }
  }
  const nodes = picked.map((node, index) => {
    const history = (node.history ?? []).map((entry, version) => remapEntry(entry, node, index, version))
    const result = node.result ? remapEntry(node.result, node, index, history.length) : history.at(-1)
    return {
      id: `used-${node.id}`,
      kind: node.kind,
      title: node.title,
      prompt: node.prompt ?? '',
      categoryId: node.categoryId ?? 'shots',
      ...(node.renderKind ? { renderKind: node.renderKind } : {}),
      references: [],
      runs: [],
      status: 'success',
      result,
      history: history.length ? history : [result],
      position: { x: origin.x + (index % columns) * (size.width + 100), y: origin.y + Math.floor(index / columns) * (size.height + 140) },
      size,
      meta: {
        ...(node.meta ?? {}),
        ...(node.kind === 'video' ? media.videoMeta : media.imageMeta),
        previewHeight: size.height,
      },
    }
  })
  const idMap = new Map(picked.map((node) => [node.id, `used-${node.id}`]))
  const edges = (snapshot.payload.generationCanvas.edges ?? [])
    .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
    .map((edge) => ({ ...edge, id: `used-${edge.id}`, source: idMap.get(edge.source), target: idMap.get(edge.target) }))
  const frameOf = (members, pad = 60) => {
    const boxes = members.map(nodeBox)
    const left = Math.min(...boxes.map((box) => box.left)) - pad
    const top = Math.min(...boxes.map((box) => box.top)) - pad
    return { x: left, y: top, w: Math.max(...boxes.map((box) => box.right)) + pad - left, h: Math.max(...boxes.map((box) => box.bottom)) + pad - top }
  }
  const groupA = nodes.slice(0, 3)
  const groupB = nodes.slice(9, 12)
  const lastBottom = Math.max(...nodes.map((node) => nodeBox(node).bottom))
  const groups = [
    { id: 'used-group-cast', name: '角色与场景', categoryId: 'shots', nodeIds: groupA.map((node) => node.id), frameBounds: frameOf(groupA), createdAt: 1, updatedAt: 1 },
    { id: 'used-group-shots', name: '第二场', categoryId: 'shots', nodeIds: groupB.map((node) => node.id), frameBounds: frameOf(groupB), createdAt: 1, updatedAt: 1 },
    { id: 'used-frame-empty', name: '待整理', categoryId: 'shots', nodeIds: [], frameBounds: { x: origin.x, y: lastBottom + 160, w: 520, h: 300 }, createdAt: 1, updatedAt: 1 },
  ]
  for (const group of groups) for (const id of group.nodeIds) nodes.find((node) => node.id === id).groupId = group.id
  const fps = snapshot.payload.timeline?.fps ?? 30
  const clipFrames = Math.max(1, Math.round((media.videoDurationSeconds ?? 1) * fps))
  const clipNodes = nodes.filter((node) => node.kind === 'video').slice(0, 6)
  const clips = clipNodes.map((node, index) => ({
    id: `used-clip-${index}`, type: 'video', sourceNodeId: node.id, label: node.title,
    startFrame: index * clipFrames, endFrame: (index + 1) * clipFrames, frameCount: clipFrames,
    offsetStartFrame: 0, offsetEndFrame: 0, url: media.video.url, thumbnailUrl: media.video.posterUrl,
  }))
  return { nodes, edges, groups, clips, fps }
}

function blankTimeline(fps) {
  return { version: 1, fps, scale: 1, playheadFrame: 0, tracks: [
    { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
    { id: 'videoTrack', type: 'video', label: '视频轨', clips: [] },
  ] }
}

/** 写项目文件。返回 { projectId, projectName, projectRoot, summary }。 */
export function buildCoreSmokeProject({ fixture, projectsDir, name, seed }) {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'))
  const projectId = `project-core-smoke-${name}`
  const projectName = `核心冒烟 ${name}`
  const projectRoot = path.join(projectsDir, `core-smoke-${name}-${fixture}`)
  fs.rmSync(projectRoot, { recursive: true, force: true })
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'exports'), { recursive: true })
  const media = materializeRealMedia(projectRoot, projectId)
  const own = seed ? seed(mediaHelpers(media)) : {}
  const ownNodes = own.nodes ?? []
  const ownGroups = own.groups ?? []
  const ownEdges = own.edges ?? []
  const used = fixture !== 'empty'
  let background = { nodes: [], edges: [], groups: [], clips: [], fps: snapshot.payload.timeline?.fps ?? 30 }
  if (used) {
    const ownRight = Math.max(80, ...ownNodes.map((node) => nodeBox(node).right), ...ownGroups.map((group) => group.frameBounds.x + group.frameBounds.w))
    const ownTop = Math.min(80, ...ownNodes.map((node) => node.position.y), ...ownGroups.map((group) => group.frameBounds.y))
    background = buildUsedBackground({ snapshot, projectId, media, origin: { x: ownRight + 240, y: ownTop } })
  }
  const timeline = blankTimeline(background.fps)
  timeline.tracks[1].clips = background.clips
  const now = Date.now()
  const payload = used
    // 用过的项目：连文档 / 分镜方案 / 分类都用真实快照里那份（它们是用户真的写过的东西）。
    ? { ...structuredClone(snapshot.payload), timeline }
    : { categories: structuredClone(snapshot.payload.categories), timeline }
  // 场景自带的整块 payload 补丁（如分镜方案 + 文稿）：只在场景声明了才有，其余场景一个字节不变。
  if (own.payload) Object.assign(payload, own.payload)
  payload.generationCanvas = {
    nodes: [...ownNodes, ...background.nodes],
    edges: [...ownEdges, ...background.edges],
    groups: [...ownGroups, ...background.groups],
    selectedNodeIds: [],
  }
  const record = {
    id: projectId, name: projectName, version: snapshot.version,
    createdAt: now, updatedAt: now, savedAt: now, revision: 1,
    lastKnownRootPath: path.resolve(projectRoot), payload,
  }
  fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(record, null, 1))
  return {
    projectId, projectName, projectRoot, record,
    summary: {
      fixture, nodes: payload.generationCanvas.nodes.length, edges: payload.generationCanvas.edges.length,
      groups: payload.generationCanvas.groups.length, emptyFrames: payload.generationCanvas.groups.filter((group) => group.nodeIds.length === 0).length,
      multiVersionNodes: payload.generationCanvas.nodes.filter((node) => (node.history ?? []).length >= 2).length,
      clips: timeline.tracks.reduce((sum, track) => sum + track.clips.length, 0),
    },
  }
}

/** profile-copy：把我们的项目登记进拷贝里的项目表（拷贝里的表由 runner 已改写到拷贝路径）。 */
function registerInCopiedRegistry(settingsDir, project) {
  const file = path.join(settingsDir, 'recent-workspaces.json')
  const entries = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
  const next = [{ id: project.projectId, name: project.projectName, rootPath: path.resolve(project.projectRoot), lastOpenedAt: Date.now(), missing: false, source: 'folder' },
    ...entries.filter((entry) => entry.id !== project.projectId)]
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
}

/**
 * 起 App、准备依赖、写好项目；返回句柄。走查自己决定何时 `openProject()`（有的走查要先在项目库里做准备）。
 *
 * @param {object} options
 * @param {string} options.name              场景名（进目录名 / 项目名）
 * @param {(helpers) => ({nodes?, groups?, edges?})} [options.seed]  场景自带的最少节点（两种夹具都有）
 * @param {string[]} [options.needs]         必须与 CORE_SMOKE_SCENARIOS 里登记的一致
 * @param {Record<string,string>} [options.preferences]  场景自己的本机偏好（语言外），如画布手势档
 * @param {{width:number,height:number}} [options.emptyViewport]  empty 夹具的窗口；used/profile-copy 固定 USED_VIEWPORT
 * @param {string} [options.locale]          'zh-CN' | 'en'；profile-copy 下以用户真实语言为准
 * @param {true} [options.syntheticCredentialStorage]  走查会往 catalog 写占位凭据时**必须**显式声明 true：
 *   声明了就不许在 profile-copy 下跑（那一档连的是用户真实资料的拷贝与真实钥匙串），起进程之前就拒。
 * @param {{ mainRequire?: string[], env?: Record<string,string>, needsOptions?: object }} [options.extras]
 *   全功能走查在同一只夹具上多挂的三样（核心冒烟不传，一个字节不变）：主进程入口前加载的模块
 *   （启动器的 mainRequire，走查网络闸就是它）、额外的进程环境（黑洞代理）、交给依赖登记表的档位（如夹具 `usage: 'measured'`）。
 */
export async function launchCoreSmoke({ name, seed = null, needs = [], preferences = {}, emptyViewport, locale = 'zh-CN', syntheticCredentialStorage = null, extras = {} }) {
  const environment = readCoreSmokeEnvironment()
  const { fixture } = environment
  // 隔离的合成凭据存储是 empty / used 的既定前提；profile-copy 刻意不用它（要的是用户真实偏好）。
  // 走查声明了要写占位凭据、而当前夹具给不了隔离存储时，**在起进程之前**就红，不靠事后人眼发现
  // 一条 e2e 占位 key 被写进了真钥匙串。
  const isolatedCredentials = fixture !== 'profile-copy'
  if (syntheticCredentialStorage !== null) {
    if (syntheticCredentialStorage !== true) throw new Error(`场景 ${name}：syntheticCredentialStorage 只接受 true（声明「我要写占位凭据」），不接受 ${syntheticCredentialStorage}`)
    if (!isolatedCredentials) throw new Error(`场景 ${name} 声明要往 catalog 写占位凭据（需要隔离的合成凭据存储），但 ${fixture} 夹具连的是用户真实资料的拷贝——这条走查不能在 ${fixture} 下跑`)
  }
  if (environment.assignedNeeds) {
    const declared = [...needs].sort().join(',')
    const assigned = [...environment.assignedNeeds].sort().join(',')
    if (declared !== assigned) throw new Error(`场景 ${name} 在走查里声明的 needs [${declared}] 与清单登记的 [${assigned}] 不一致——清单是唯一 owner`)
  }
  const effectiveLocale = environment.locale || locale
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-core-smoke-${name}-${fixture}-`))
  let dirs
  if (fixture === 'profile-copy') {
    if (!environment.profileCopyRoot) throw new Error('profile-copy 夹具只能由 runner 起（它负责 cp -R 拷贝与事后删除）：pnpm run test:core-smoke -- --fixture profile-copy')
    dirs = { userDataDir: path.join(environment.profileCopyRoot, 'user-data'), settingsDir: path.join(environment.profileCopyRoot, 'user-data'), projectsDir: path.join(environment.profileCopyRoot, 'projects') }
  } else {
    dirs = { userDataDir: path.join(tempRoot, 'user-data'), settingsDir: path.join(tempRoot, 'settings'), projectsDir: path.join(tempRoot, 'projects') }
  }
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true })
  const project = buildCoreSmokeProject({ fixture, projectsDir: dirs.projectsDir, name, seed })
  if (fixture === 'profile-copy') registerInCopiedRegistry(dirs.settingsDir, project)
  // userDataDir + appName：需要「能真提交的生成路」的依赖要用它们复原 safeStorage 身份（内置档案的
  // key 是加密存的）。核心冒烟一律跑**开发版 Electron**（initialLocalStorage 只在开发版下合法），
  // 所以 appName 就是 package.json 里的 `nomi`（同 `agent-runtime-walk-support.mjs:390` 的非打包分支）。
  const provisioned = await provisionNeeds(needs, {
    repoRoot, settingsDir: dirs.settingsDir, userDataDir: dirs.userDataDir, appName: 'nomi',
    ...(extras.needsOptions ? { options: extras.needsOptions } : {}),
  })
  const testNetworkGuardPath = path.join(repoRoot, 'scripts', 'walkthrough-network-guard.cjs')
  const launchEnv = { NOMI_TEST_NETWORK_GUARD: '1', ...provisioned.env, ...(extras.env ?? {}) }
  const used = fixture !== 'empty'
  const viewport = used ? USED_VIEWPORT : (emptyViewport ?? USED_VIEWPORT)
  const initialLocalStorage = {
    'nomi:locale:v1': effectiveLocale,
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:canvas-gesture-hint:v1': 'seen',
    __nomiE2E: '1',
    ...(used ? { 'nomi.timelinePanel.collapsed': '0' } : {}),
    ...preferences,
    ...provisioned.localStorage,
  }
  let launched
  try {
    launched = await launchNomiApp({
      name: `core-smoke-${name}-${fixture}`,
      tempRoot,
      ...dirs,
      settleMs: 0,
      viewportSize: viewport,
      initialLocalStorage,
      // 依赖登记表里 `env` 那一格（needs.mjs）：只有主进程读得到的口子走这里。
      ...(Object.keys(launchEnv).length ? { env: launchEnv } : {}),
      mainRequire: [...new Set([testNetworkGuardPath, ...(extras.mainRequire ?? [])])],
      args: ['--no-proxy-server'],
      syntheticCredentialStorage: isolatedCredentials,
    })
  } catch (error) {
    await provisioned.close()
    throw error
  }
  const { app } = launched
  let win = launched.win
  // profile-copy：用户已有的偏好（initialLocalStorage 只填空位）说了算，语言以实际为准。
  const actualLocale = await win.evaluate(() => localStorage.getItem('nomi:locale:v1'))
  const finalLocale = actualLocale === 'en' ? 'en' : 'zh-CN'

  async function openProject() {
    await win.locator('[data-project-card]', { hasText: project.projectName }).first().click({ timeout: stationTimeout({ operations: 2 }) })
    await expect.poll(() => app.windows().some((page) => /projectId=/.test(page.url())), { timeout: stationTimeout() }).toBe(true)
    win = app.windows().find((page) => /projectId=/.test(page.url()))
    const browserWindow = await app.browserWindow(win)
    // 忽略宿主真实鼠标：走查的输入全部来自 Playwright，不让桌面上的光标漂进来。
    await browserWindow.evaluate((target, size) => { target.setContentSize(size.width, size.height); target.setIgnoreMouseEvents(true) }, viewport)
    await win.setViewportSize(viewport)
    // 空项目打开时落在创作页：像用户一样点顶栏的「生成」进画布（按 data-mode 找，不依赖语言）。
    await win.locator('.nomi-stepper').first().waitFor({ timeout: stationTimeout() })
    const stage = win.locator(CANVAS_STAGE_SELECTOR).first()
    if (!(await stage.isVisible())) await win.locator('.nomi-stepper__step[data-mode="generation"]').first().click()
    await stage.waitFor({ state: 'visible', timeout: stationTimeout() })
    if (used) await assertUsedState()
    return win
  }

  /** 「用过的项目」不是口头的：时间轴确实展开、Agent 面板确实开着、窗口确实是小窗。任何一条不成立就红。 */
  async function assertUsedState() {
    const actual = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    if (actual.width !== viewport.width || actual.height !== viewport.height) {
      throw new Error(`used 夹具前提不成立：窗口应为 ${viewport.width}×${viewport.height}，实际 ${actual.width}×${actual.height}`)
    }
    await expect(win.locator(TIMELINE_EXPANDED).first(), 'used 夹具前提：时间轴处于展开态（收起钮可见）').toBeVisible({ timeout: stationTimeout() })
    await expect(win.locator(AGENT_PANEL).first(), 'used 夹具前提：Agent 面板开着').toBeVisible({ timeout: stationTimeout() })
    const counts = await win.evaluate(() => ({ nodes: document.querySelectorAll('.react-flow__node').length }))
    console.log(`[core-smoke] used 状态就位：${JSON.stringify({ ...project.summary, renderedNodes: counts.nodes, viewport: actual })}`)
  }

  return {
    app,
    get win() { return win },
    fixture,
    used,
    /** 这次是不是跑在隔离的合成凭据存储上（profile-copy 为 false）。 */
    isolatedCredentials,
    caseId: environment.caseId,
    locale: finalLocale,
    viewport,
    /** used / profile-copy 下窗口由夹具定死，走查不许再改尺寸。 */
    lockedViewport: used,
    needs: provisioned.handles,
    /** 主进程 stdout+stderr 的尾巴。红的时候「宿主为什么拒」只写在这里（渲染层只拿得到语义码）。 */
    mainLogTail: launched.mainLogTail,
    project,
    tempRoot,
    ...dirs,
    openProject,
    async close() {
      await app.close().catch(() => undefined)
      await provisioned.close()
    },
  }
}
