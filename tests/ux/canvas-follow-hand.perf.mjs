// 画布跟手量具（docs/plan/2026-09-25-canvas-follow-hand.md 第 0 步）。
//
// 为什么要它：用户在「30 多个 15 秒 1080p 视频节点」的真实画布上觉得打字、@ 素材、拉时长、新建节点、拖节点都卡，
// 叠放的节点拖出来会粘在鼠标上。之前几轮量的不是这块画布（节点被视口裁掉、视频没加载），也没量过这些动作。
// 这份量具在**被测构建自己的** Electron 里（--repo 指哪棵树就量哪棵），用真实素材搭出那块画布，
// 真实鼠标 / 键盘把九个动作各做 3 轮，同时记**时延**（页面自己的 rAF / 事件时钟）和**结构计数**（挂着几个 <video>、
// 一次输入重渲了多少组件、连带重渲了几个别的节点）。
//
// 两档：
//   --structural  快速档（约 1.5 分钟，判的是计数不是毫秒，与机器快慢无关）：空闲 <video> = 0、同时在播 ≤ 1、
//                 悬停过再离开不留播放器、同一张卡再悬停能播、打一个字别的节点重渲 0、新建节点别的节点重渲 0、
//                 叠放拖出（含松手事件丢失）粘住 0、方向键能挪。任一条不成立 → 退出码 1。每条都带阳性对照，
//                 证明探针真的看得见（否则「0」和「探针坏了」分不开）。
//                 CI：每个非纯文档 PR 都跑（.github/workflows/quality-gate.yml 的 Core Flow Smoke (empty) 那一格，
//                 复用同一次构建；2026-09-25 用户拍板）。
//   默认（全量）  九个动作的时延 + 结构计数，每项 3 轮取中位；对照跟手级预算（拖 / 滑杆 / 打字每帧 ≤ 50ms，@ 弹出与新建节点 ≤ 100ms）
//                 只报不判（机器相关）；结构断言照样判。
//   两份结果（改前 / 改后）并排出 Markdown 对比表：node tests/ux/canvas-follow-hand/report.mjs <改前.json> <改后.json>
//
// 用法（先 pnpm build；Windows 上别开别的 Nomi / Electron）：
//   node tests/ux/canvas-follow-hand.perf.mjs --structural
//   node tests/ux/canvas-follow-hand.perf.mjs --repo ../Nomi-release-0.22.1 --label before --work D:/tmp
// 素材：视频默认取真实素材登记表里的 video-canvas-follow-hand-1080p15（仓库内 tests/ux/fixtures/canvas-follow-hand-1080p15.mp4，
// 缺了就红，不退回合成素材）；--video 可换一段别的真实片子。图默认 docs/audit 里真实生成的图。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveMedia, scriptRepo, IDLE_NODE } from './canvas-follow-hand/fixture.mjs'
import { openCanvasSession, fitAll, otherElectronProcesses } from './canvas-follow-hand/session.mjs'
import { waitMediaSettled, idleState, hoverSweep, hoverToPlay, createVideoNode, dragNode, arrowKeys, stackDragOut, posterAndPlayShots } from './canvas-follow-hand/scenarios-canvas.mjs'
import { typing, typingOneKey, atMention, atVideoInImageToVideo, durationSlider, autosave, switchModel } from './canvas-follow-hand/scenarios-composer.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'

const REAL_VIDEO_ID = 'video-canvas-follow-hand-1080p15'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const opt = (name, fallback = null) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback }

const structural = flag('--structural')
const repo = path.resolve(opt('--repo', scriptRepo))
const label = opt('--label', path.basename(repo))
const rounds = Number(opt('--rounds', '3'))
const workRoot = path.resolve(opt('--work', os.tmpdir()))
const mode = structural ? 'structural' : 'full'
const outFile = path.resolve(opt('--out', path.join(scriptRepo, 'tests/ux/shots/canvas-follow-hand', label, `${mode}.json`)))
const shotDir = path.dirname(outFile)
fs.mkdirSync(shotDir, { recursive: true })

// 别的 Electron 只会污染毫秒数；快速档判的是计数，只提醒不拦（CI 上前一步冒烟留下的进程不该让它红）。
const others = otherElectronProcesses()
if (others.length && !structural && !flag('--allow-other-electron')) {
  throw new Error(`同机还有 ${others.length} 个 Electron / Nomi 进程（${[...new Set(others)].join(', ')}），会抢 GPU 与 CPU，帧数不可比。关掉再跑，或加 --allow-other-electron 明知故跑。`)
}
if (others.length) console.warn(`[cfh] 同机还有 ${others.length} 个 Electron / Nomi 进程；快速档只判计数，照跑`)

const videoFile = opt('--video') || requireRealMediaAssets([REAL_VIDEO_ID]).assets.get(REAL_VIDEO_ID).file
const media = resolveMedia({ video: videoFile, images: opt('--images') })
// 量的是 dist 里的构建，不是工作树：优先报构建戳里的提交（工作树可能已经往前走了）。
const buildStamp = (() => { try { return JSON.parse(fs.readFileSync(path.join(repo, 'dist/build-stamp.json'), 'utf8')) } catch { return null } })()
const gitHead = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim() } catch { return null } })()
const result = {
  tool: 'canvas-follow-hand.perf', mode, label, repo, commit: buildStamp?.head?.slice(0, 9) || gitHead, worktreeHead: gitHead, buildStamp, platform: `${process.platform}-${os.release()}`, cpu: os.cpus()[0]?.model, startedAt: new Date().toISOString(),
  media: { video: path.basename(media.videoFile), ...media.videoMeta, images: media.imageFiles.length },
  budgetsMs: { perFrame: 50, popup: 100 },
  scenarios: {}, checks: [], budgets: [],
}
const log = (...a) => console.log(`[cfh:${label}]`, ...a)
const failures = []

/** 结构断言：value 不超过 max，且阳性对照成立（探针真的看得见这类东西）。 */
function check(name, value, max, provenBy, proven) {
  const ok = value != null && value <= max && proven
  result.checks.push({ name, value, max, provenBy, proven, ok })
  if (!ok) failures.push(`${name}: 实测 ${value}（上限 ${max}）${proven ? '' : `；阳性对照不成立：${provenBy}`}`)
}
function budget(name, value, max) { result.budgets.push({ name, value, max, ok: value != null && value <= max }) }

const s = await openCanvasSession({ repo, workRoot, label, media })
result.fixture = { nodes: s.storeNodeCount, projDir: s.fixture.projDir, viewport: s.viewport, cursor: s.cursor }
log(`画布就绪：${s.storeNodeCount} 个节点；系统光标 ${s.cursor.parked}`)
const run = async (name, fn) => {
  const t = Date.now()
  try { result.scenarios[name] = await fn() } catch (error) { result.scenarios[name] = { error: String(error?.stack || error).slice(0, 800) }; failures.push(`${name} 没跑完：${error?.message || error}`) }
  log(`${name} ${Math.round((Date.now() - t) / 100) / 10}s`, JSON.stringify(result.scenarios[name]).slice(0, 400))
}
try {
  // 打开那一刻画布自己适应过一次（useAutoFitOnLoad）：记下打开后停稳的视口，证明量的是适应之后的状态。
  result.openTransform = await s.win.evaluate(() => document.querySelector(".react-flow__viewport")?.style.transform || "")
  result.fitTransform = await fitAll(s)
  // 快速档要在慢机（CI 的 2 核 Linux、软件渲染 / 软解）上也判得准：封面补齐与悬停起播都多给时间，只影响等多久，不影响判据。
  await run('settle', () => waitMediaSettled(s, structural ? { maxMs: 180_000 } : {}))
  await run('idle', () => idleState(s))
  if (!structural) await run('hoverSweep', () => hoverSweep(s, { rounds }))
  await run('hoverToPlay', () => hoverToPlay(s, structural ? { cards: [20], holdMs: 4000 } : {}))
  if (structural) await run('typingOneKey', () => typingOneKey(s, IDLE_NODE))
  else {
    await run('typing', () => typing(s, IDLE_NODE, { rounds }))
    await run('atMention', () => atMention(s, IDLE_NODE, { rounds }))
    await run('atVideoInImageToVideo', () => atVideoInImageToVideo(s, IDLE_NODE))
    await run('slider', () => durationSlider(s, IDLE_NODE, { rounds }))
    await run('autosave', () => autosave(s, IDLE_NODE, { rounds }))
    // 同一测试换到「即梦 Seedance（会员）」再跑一遍：它的图生视频带首帧槽，用户现场 @ 不出 chip 就在这类模型上。
    await run('atVideoInImageToVideoDreamina', async () => ({ model: await switchModel(s, IDLE_NODE, /即梦 Seedance/), ...(await atVideoInImageToVideo(s, IDLE_NODE)) }))
  }
  await fitAll(s)
  await run('create', () => createVideoNode(s, { rounds: structural ? 0 : rounds }))
  if (!structural) await run('drag', () => dragNode(s, { rounds }))
  await run('arrowKeys', () => arrowKeys(s))
  if (!structural) await run('shots', () => posterAndPlayShots(s, shotDir))
  await run('stackDragOut', () => stackDragOut(s, { rounds: structural ? 1 : 4 }))
} finally {
  await s.close()
  if (!flag('--keep')) fs.rmSync(s.tempRoot, { recursive: true, force: true })
}

const sc = result.scenarios
const typingRenders = structural ? sc.typingOneKey : sc.typing?.renders
const everPlayed = Math.max(sc.hoverToPlay?.maxPlaying ?? 0, sc.hoverSweep?.maxPlaying ?? 0)
check('空闲时挂着的 <video>', sc.idle?.videosMounted, 0, '悬停一张卡能起播', Boolean(sc.hoverToPlay?.playedAll))
check('同时在播的视频', everPlayed, 1, '至少有一个在播', everPlayed >= 1)
check('悬停过再离开：仍挂着的 <video>', sc.hoverToPlay?.videosLeftAfterLeave, 0, '悬停一张卡能起播', Boolean(sc.hoverToPlay?.playedAll))
check('同一张卡再悬停：不起播', sc.hoverToPlay?.replayed ? 0 : 1, 0, '第一次悬停起播了', Boolean(sc.hoverToPlay?.playedAll))
check('打字：别的节点重渲', typingRenders?.otherNodesRerendered, 0, '本卡编辑器有重渲', ((typingRenders?.byRegion?.composer || 0) + (typingRenders?.byRegion?.focusNode || 0)) > 0)
check('新建节点：别的节点重渲', sc.create?.renders?.otherNodesRerendered, 0, '新节点真的建出来了', sc.create?.renders?.commits > 0)
const stack = sc.stackDragOut
check('叠放拖出：松手后仍粘着', stack?.stuck, 0, '八成以上的拖动真的挪动了节点', stack?.normalDrags > 0 && stack.normalDrags - stack.notMoved >= stack.normalDrags * 0.8)
check('叠放拖出：松手事件丢了仍粘着', stack?.lostRelease?.stuck, 0, '这几次拖动确实把节点拖动了', stack?.lostRelease?.drags > 0 && stack.lostRelease.moved >= stack.lostRelease.drags * 0.8)
check('方向键：没挪或步长不一', sc.arrowKeys?.moved ? 0 : 1, 0, '选中了一张卡', sc.arrowKeys?.deltas?.length === 3)

if (!structural) {
  budget('拖节点·起手那一帧', sc.drag?.startFrame, 50)
  budget('拖节点·拖动中最长帧', sc.drag?.maxFrameDuring, 50)
  budget('拉时长滑杆·最长帧', sc.slider?.maxFrame, 50)
  budget('打字·按键到画面（最慢一键）', sc.typing?.toPaintMax, 50)
  budget('打字·最长帧', sc.typing?.maxFrame, 50)
  budget('@·打 @ 到列表出现', sc.atMention?.atToList, 100)
  budget('@·选中到 chip 出现', sc.atMention?.enterToChip, 100)
  budget('@·选中那一下最长帧', sc.atMention?.selectFrame, 50)
  budget('新建节点·点击到节点出现', sc.create?.clickToNode, 100)
  budget('新建节点·最长帧', sc.create?.maxFrame, 50)
  budget('自动保存·界面线程最长阻塞', sc.autosave?.maxBlock, 50)
}
result.failures = failures
result.finishedAt = new Date().toISOString()
fs.writeFileSync(outFile, `${JSON.stringify(result, null, 1)}\n`)
for (const c of result.checks) log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}：${c.value}（上限 ${c.max}；对照「${c.provenBy}」${c.proven ? '成立' : '不成立'}）`)
for (const b of result.budgets) log(`${b.ok ? '  ok' : 'OVER'} ${b.name}：${b.value}ms（预算 ${b.max}ms）`)
log(`结果：${outFile}`)
if (failures.length) {
  console.error(`\n✖ 画布跟手结构断言没过（${failures.length} 条）：\n  ${failures.join('\n  ')}`)
  process.exitCode = 1
}
