#!/usr/bin/env node
// 教程站的截图和短动图：从**真 App**自动录（可重跑——界面变了，一键重录，不用手截）。
//
//   pnpm run build                                    先有构建产物（dist / dist-electron）
//   node tests/ux/docs-media.record.mjs               中英各录一遍，写进 marketing/docs-media/<语言>/
//   node tests/ux/docs-media.record.mjs --locale=en   只录英文
//   node tests/ux/docs-media.record.mjs --only=mcp-card,mcp-clients   只重录点名的几张
//
// 怎么录（取舍见 docs/plan/2026-10-10-docs-site.md）：
//   · 起的是仓库现有的隔离走查实例（tests/ux/core-smoke/fixture.mjs 的 launchCoreSmoke）：隔离的 userData / 设置 / 项目目录，
//     不碰 %APPDATA%\Nomi 里用户真实资料，出网闸只放行本机；窗口全程在屏幕外、不抢焦点、不弹阻塞框；跑完关。
//   · 项目是夹具：画布上的图和视频是仓库登记的那条真 AI 镜头（tests/ux/real-media-fixtures.json）及其抽帧，不是色块。
//   · 「AI 助手连接」要有被检测到的助手才有切换条：给进程一个临时的假主目录（里面各放一个文件的 .claude / .codex / .cursor），
//     只有这个子进程看得见它，用户真实主目录一个字节不碰；Nomi 在隔离实例里本来就拒绝改写助手配置，所以这里只截「接入前」的卡。
//   · 标注：截图前往页面里临时插几个带编号的框（位置读自真实元素），截完就删；框是教程的说明，不是产品界面。
//   · 动图：分步截帧，ffmpeg 拼成 webm（VP9，无声）。短、小、一次一件事。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { launchCoreSmoke } = await import('./core-smoke/fixture.mjs')
const { repoRoot } = await import('./_launchApp.mjs')
const { screenshotSettled } = await import('./_assert.mjs')
const { uiText } = await import('./full-walk/invariants.mjs')
const { stationTimeout } = await import('./_station-budget.mjs')
const FFMPEG = require('@ffmpeg-installer/ffmpeg').path
const FFPROBE = require('@ffprobe-installer/ffprobe').path

const argValue = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const localeArg = argValue('locale') ?? 'all'
const theme = argValue('theme') ?? 'light' // 教程里的界面图统一亮色（App 默认跟随系统，不钉死会因录制机器而异）
if (theme !== 'light' && theme !== 'dark') throw new Error(`--theme 只认 light / dark，收到 ${theme}`)
const only = argValue('only')?.split(',').filter(Boolean) ?? null
const LOCALES = localeArg === 'all' ? ['zh-CN', 'en'] : [localeArg]
if (!LOCALES.every((locale) => locale === 'zh-CN' || locale === 'en')) throw new Error(`--locale 只认 zh-CN / en / all，收到 ${localeArg}`)

const MEDIA_ROOT = path.join(repoRoot, 'marketing', 'docs-media')
const VIEWPORT = { width: 1440, height: 900 }
const wanted = (name) => !only || only.includes(name)

// ── 夹具内容（按语言）──────────────────────────────────────────────────────────────
const copy = (locale) => {
  const zh = locale === 'zh-CN'
  const t = (zhText, enText) => (zh ? zhText : enText)
  return {
    t,
    projectName: t('黄雨衣女孩的一天', 'A Day in a Yellow Raincoat'),
    docTitle: t('故事', 'Story'),
    story: [
      t('仓库里的灯坏了。穿黄雨衣的女孩推开门，手里只有一支手电筒。', 'The lights in the warehouse are out. A girl in a yellow raincoat pushes open the door with nothing but a flashlight.'),
      t('她照向角落，看见桌上有一封没拆的信。', 'She sweeps the beam across the room and finds an unopened letter on the table.'),
    ],
    nodes: {
      door: { title: t('门口', 'At the door'), prompt: t('穿黄色雨衣的女孩推开仓库的门，手里拿着手电筒，青绿色的门，冷色光。', 'A girl in a yellow raincoat pushes open a warehouse door holding a flashlight, teal door, cool light.') },
      table: { title: t('木桌上的信', 'Letter on the table'), prompt: t('手电筒的光扫过木桌，桌上有一封没拆的信。', 'A flashlight beam sweeps across a wooden table with an unopened letter.') },
      shot: { title: t('镜头 1', 'Shot 1'), prompt: t('女孩推门走进仓库，镜头缓慢跟拍，手电筒光束在墙上晃动。', 'The girl walks into the warehouse, slow tracking shot, the flashlight beam swaying across the wall.') },
    },
  }
}

/** 视频总帧数（30fps）：探出来，不硬写。 */
function videoFrames(file) {
  const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { encoding: 'utf8' })
  return Math.max(30, Math.round(Number(JSON.parse(out).format.duration) * 30))
}

async function recordLocale(locale) {
  const c = copy(locale)
  const outDir = path.join(MEDIA_ROOT, locale)
  fs.mkdirSync(outDir, { recursive: true })
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-docs-media-'))
  // 假主目录与假 APPDATA：只有被测进程看得见。每个助手目录里放一个文件（检测要「真有痕迹」，空目录不算）。
  const fakeHome = path.join(scratch, 'home')
  for (const marker of ['.claude', '.codex', '.cursor']) {
    fs.mkdirSync(path.join(fakeHome, marker), { recursive: true })
    fs.writeFileSync(path.join(fakeHome, marker, 'placeholder.txt'), 'docs media fixture\n')
  }
  const fakeAppData = path.join(fakeHome, 'AppData', 'Roaming')
  fs.mkdirSync(fakeAppData, { recursive: true })

  let clipFrames = 0
  const smoke = await launchCoreSmoke({
    name: 'docs-media',
    locale,
    emptyViewport: VIEWPORT,
    preferences: { 'nomi-color-scheme': theme },
    seed: (media) => {
      const frames = videoFrames(path.join(repoRoot, 'tests/ux/fixtures/real-shot-640x360.mp4'))
      clipFrames = frames
      const base = { categoryId: 'shots', references: [], runs: [], status: 'success' }
      const image = (id, frameIndex, x, spec) => {
        const result = media.imageResult(`${id}-result`, frameIndex)
        return {
          ...base, id, kind: 'image', title: spec.title, prompt: spec.prompt, result, history: [result],
          position: { x, y: 140 }, size: { width: 320, height: 180 }, meta: { ...media.imageMeta(), previewHeight: 180 },
        }
      }
      const videoResult = { id: 'shot-1-result', type: 'video', url: media.video.url, thumbnailUrl: media.video.posterUrl, createdAt: 1 }
      return {
        nodes: [
          image('door', 1, 80, c.nodes.door),
          image('table', 4, 80, { ...c.nodes.table }),
          {
            ...base, id: 'shot-1', kind: 'video', title: c.nodes.shot.title, prompt: c.nodes.shot.prompt, result: videoResult, history: [videoResult],
            position: { x: 560, y: 140 }, size: { width: 420, height: 236 }, meta: { ...media.videoMeta(), previewHeight: 236 },
          },
        ].map((node) => (node.id === 'table' ? { ...node, position: { x: 80, y: 420 } } : node)),
        edges: [
          { id: 'edge-door-shot', source: 'door', target: 'shot-1', mode: 'reference', order: 0 },
          { id: 'edge-table-shot', source: 'table', target: 'shot-1', mode: 'reference', order: 1 },
        ],
        groups: [],
        payload: {
          workbenchDocuments: [{
            id: 'doc-1', version: 1, title: c.docTitle, updatedAt: 10,
            contentJson: { type: 'doc', content: c.story.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) },
          }],
          activeDocumentId: 'doc-1',
          timeline: {
            version: 1, fps: 30, scale: 1, playheadFrame: 0,
            tracks: [
              { id: 'imageTrack', type: 'image', label: '', clips: [] },
              {
                id: 'videoTrack', type: 'video', label: '', clips: [{
                  id: 'clip-1', type: 'video', sourceNodeId: 'shot-1', label: c.nodes.shot.title,
                  startFrame: 0, endFrame: frames, frameCount: frames, offsetStartFrame: 0, offsetEndFrame: 0,
                  url: media.video.url, thumbnailUrl: media.video.posterUrl,
                }],
              },
            ],
          },
        },
      }
    },
    extras: {
      mainRequire: [path.join(repoRoot, 'tests/ux/_quietWalk.cjs')],
      env: { USERPROFILE: fakeHome, HOME: fakeHome, APPDATA: fakeAppData },
    },
  })

  const win = () => smoke.win
  const written = []
  const file = (name, extension = 'png') => path.join(outDir, `${name}.${extension}`)
  const settle = (ms = 600) => win().waitForTimeout(ms)

  /** 在页面里临时画带编号的框（位置读自真实元素），返回收掉它们的函数。 */
  async function mark(items) {
    const boxes = []
    for (const [index, locator] of items.entries()) {
      const box = await locator.first().boundingBox()
      if (!box) throw new Error(`标注 ${index + 1}：没找到可标注的元素`)
      boxes.push({ n: index + 1, x: box.x, y: box.y, w: box.width, h: box.height })
    }
    await win().evaluate((list) => {
      const layer = document.createElement('div')
      layer.id = '__docs-annotations'
      layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none'
      for (const box of list) {
        const ring = document.createElement('div')
        ring.style.cssText = `position:absolute;left:${box.x - 4}px;top:${box.y - 4}px;width:${box.w + 8}px;height:${box.h + 8}px;border:2px solid #2e6cb4;border-radius:10px;box-shadow:0 0 0 2px rgba(255,255,255,0.85)`
        const badge = document.createElement('div')
        badge.textContent = String(box.n)
        const nearTop = box.y < 20
        const nearLeft = box.x < 20
        badge.style.cssText = `position:absolute;left:${nearLeft ? 2 : -12}px;top:${nearTop ? 2 : -12}px;width:22px;height:22px;border-radius:999px;background:#2e6cb4;color:#fff;font:700 12px/22px Inter,system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff`
        ring.appendChild(badge)
        layer.appendChild(ring)
      }
      document.body.appendChild(layer)
    }, boxes)
    return () => win().evaluate(() => document.getElementById('__docs-annotations')?.remove())
  }

  async function shot(name, { clip, marks } = {}) {
    if (!wanted(name)) return
    let clear = null
    try {
      clear = marks ? await mark(marks) : null
    } catch (error) {
      // 标注找不到元素：留一张现场图，别让人对着报错猜（.tmp 不入库）。
      const failDir = path.join(repoRoot, '.tmp', 'docs-media')
      fs.mkdirSync(failDir, { recursive: true })
      await win().screenshot({ path: path.join(failDir, `${locale}-${name}-FAIL.png`) }).catch(() => undefined)
      throw error
    }
    try {
      await screenshotSettled(win(), { path: file(name), ...(clip ? { clip } : {}) })
    } finally {
      await clear?.()
    }
    written.push(`${locale}/${name}.png`)
    console.log(`shot ${locale}/${name}.png`)
  }

  /** 弹窗（设置）整块裁出来，比整屏小，也更聚焦。 */
  async function dialogClip() {
    const box = await win().locator('[data-settings-dialog]').first().boundingBox()
    if (!box) throw new Error('设置弹窗没出现')
    const pad = 12
    return { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(VIEWPORT.width, box.width + pad * 2), height: Math.min(VIEWPORT.height, box.height + pad * 2) }
  }

  /** 分步截帧拼成 webm。frames = [{ file, seconds }]。 */
  function encodeClip(name, frames) {
    if (!wanted(name)) return
    const list = frames.map((frame) => `file '${frame.file.replaceAll('\\', '/')}'\nduration ${frame.seconds}`).join('\n')
      + `\nfile '${frames.at(-1).file.replaceAll('\\', '/')}'\n`
    const listFile = path.join(scratch, `${name}.txt`)
    fs.writeFileSync(listFile, list)
    const target = file(name, 'webm')
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-vf', 'scale=1080:-2:flags=lanczos,fps=10,format=yuv420p', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '42', '-row-mt', '1', '-an', target])
    written.push(`${locale}/${name}.webm`)
    console.log(`clip ${locale}/${name}.webm (${(fs.statSync(target).size / 1024).toFixed(0)} KB)`)
  }

  let frameIndex = 0
  const grabFrame = async (seconds = 1) => {
    const target = path.join(scratch, `frame-${String(frameIndex++).padStart(3, '0')}.png`)
    await screenshotSettled(win(), { path: target })
    return { file: target, seconds }
  }

  try {
    // ── 项目库 ────────────────────────────────────────────────────────────────
    // 夹具项目叫「核心冒烟 …」：改成教程里该有的名字，再让窗口重读项目列表。
    const projectFile = path.join(smoke.project.projectRoot, '.nomi', 'project.json')
    const record = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
    record.name = c.projectName
    smoke.project.projectName = c.projectName // openProject 按它找项目卡
    fs.writeFileSync(projectFile, JSON.stringify(record, null, 1))
    const registryFile = path.join(smoke.settingsDir, 'recent-workspaces.json')
    if (fs.existsSync(registryFile)) {
      const entries = JSON.parse(fs.readFileSync(registryFile, 'utf8'))
      fs.writeFileSync(registryFile, JSON.stringify(entries.map((entry) => (entry.id === smoke.project.projectId ? { ...entry, name: c.projectName } : entry)), null, 2))
    }
    await win().reload()
    await win().waitForLoadState('domcontentloaded')
    await settle(1500)
    const newProject = win().getByRole('button', { name: new RegExp(`^(${uiText(locale, 'appShell.library.newProject')})`) }).first()
    const bannerAction = win().getByRole('button', { name: uiText(locale, 'library.connectTextModel') }).first()
    await shot('library', { clip: { x: 0, y: 0, width: VIEWPORT.width, height: 420 }, marks: [newProject, bannerAction] })

    // ── 打开项目：生成页（画布）─────────────────────────────────────────────────
    await smoke.openProject()
    await win().mouse.move(VIEWPORT.width - 40, VIEWPORT.height / 2) // 鼠标挪到空处：别让某个节点带着悬停工具条入镜
    await settle(1200)
    const agentBall = win().locator('[data-agent-ball]').first()
    await shot('canvas-overview', {
      marks: [
        win().locator('.nomi-stepper').first(),
        win().locator('[data-shell-rail-group="project"]').first(),
        win().locator('[data-canvas-add-more]').first().locator('xpath=..'),
        agentBall,
        win().locator('[data-timeline-strip]').first(),
      ],
    })

    // ── 创作页 ────────────────────────────────────────────────────────────────
    await win().locator('.nomi-stepper__step[data-mode="creation"]').first().click()
    await settle(1200)
    // 首次询问卡「帮 Nomi 变好」：按用户的做法点「不分享」，让教程截图不带这张和教程无关的卡。
    const decline = win().getByRole('button', { name: uiText(locale, 'agentPanelV4.consent.decline') }).first()
    if (await decline.isVisible().catch(() => false)) { await decline.click(); await settle(500) }
    await shot('creation', { marks: [win().locator('.ProseMirror').first(), win().locator('[data-agent-panel="true"]').first()] })

    // ── 预览页（时间轴 + 导出）────────────────────────────────────────────────
    await win().locator('.nomi-stepper__step[data-mode="preview"]').first().click()
    await settle(1500)
    const exportButton = win().getByRole('button', { name: new RegExp(uiText(locale, 'timelinePreview.exportMp4')) }).first()
    await shot('preview-export', { marks: [exportButton] })

    // ── Agent 面板（回到生成页，叫出小球）────────────────────────────────────────
    await win().locator('.nomi-stepper__step[data-mode="generation"]').first().click()
    await settle(800)
    if (!(await win().locator('[data-agent-panel="true"]').first().isVisible().catch(() => false))) await agentBall.click()
    await settle(1200)
    await shot('agent-panel', { marks: [win().locator('[data-agent-panel="true"] textarea, [data-agent-panel="true"] [contenteditable="true"]').first()] })

    // ── 设置 → 模型 ───────────────────────────────────────────────────────────
    await win().locator('[data-shell-settings]').first().click()
    await settle(600)
    await win().locator('[data-settings-dialog] [data-settings-tab-id="models"]').first().click()
    await settle(1200)
    const apimart = win().locator('[data-settings-dialog]').getByText(/APIMart/).first()
    await apimart.scrollIntoViewIfNeeded()
    await apimart.evaluate((el) => { for (let node = el.parentElement; node; node = node.parentElement) if (node.scrollHeight > node.clientHeight + 40) { node.scrollTop += 160; break } }) // 再多滚一点，让「接入 APIMart」整行入镜
    await settle(500)
    await shot('settings-models', { clip: await dialogClip(), marks: [apimart] })

    // ── 设置 → 自动化与权限 → AI 助手连接 ─────────────────────────────────────────
    await win().locator('[data-settings-dialog] [data-settings-tab-id="automation"]').first().click()
    await settle(600)
    const manage = win().getByRole('button', { name: uiText(locale, 'settings.automation.mcp.manage') }).first()
    const settingsFrames = []
    if (wanted('mcp-open-card')) settingsFrames.push(await grabFrame(1.2))
    await shot('mcp-automation', { clip: await dialogClip(), marks: [manage] })
    await manage.click()
    await win().locator('[data-assistant-generic-clients]').first().waitFor({ timeout: stationTimeout() })
    await settle(1800)
    if (wanted('mcp-open-card')) settingsFrames.push(await grabFrame(1.6))
    const segment = (label) => win().locator('[data-settings-dialog]').getByText(label, { exact: true }).locator('visible=true').first()
    const connectButton = win().locator('[data-settings-dialog] button').filter({ hasText: new RegExp(uiText(locale, 'onboardingProviders.assistant.connect').replace('{{client}}', '.+')) }).first()
    await shot('mcp-card', { clip: await dialogClip(), marks: [segment('Claude Code'), connectButton, win().locator('[data-assistant-generic-copy]')] })

    for (const [name, label] of [['mcp-codex', 'Codex'], ['mcp-cursor', 'Cursor']]) {
      await segment(label).click()
      await settle(900)
      if (wanted('mcp-open-card')) settingsFrames.push(await grabFrame(1.4))
      await shot(name, { clip: await dialogClip(), marks: [segment(label), win().locator('[data-settings-dialog] button').filter({ hasText: new RegExp(uiText(locale, 'onboardingProviders.assistant.copyConfig').replace('{{client}}', '.+')) }).first()] })
    }
    encodeClip('mcp-open-card', settingsFrames)
    await win().locator('[data-settings-dialog]').getByRole('button', { name: uiText(locale, 'common.close') }).first().click()
    await win().locator('[data-settings-dialog]').first().waitFor({ state: 'hidden' })
    await settle(500)

    // ── 动图：创作 → 生成 → 预览 三步来回 ─────────────────────────────────────────
    if (wanted('workflow-steps')) {
      const stepFrames = []
      for (const mode of ['creation', 'generation', 'preview', 'generation']) {
        await win().locator(`.nomi-stepper__step[data-mode="${mode}"]`).first().click()
        await settle(1100)
        stepFrames.push(await grabFrame(mode === 'generation' ? 1.4 : 1.2))
      }
      encodeClip('workflow-steps', stepFrames)
    }
  } finally {
    await smoke.close()
    fs.rmSync(scratch, { recursive: true, force: true })
  }
  return written
}

const all = []
for (const locale of LOCALES) all.push(...await recordLocale(locale))
console.log(`\ndocs-media: ${all.length} 个文件写进 ${path.relative(repoRoot, MEDIA_ROOT)}`)
