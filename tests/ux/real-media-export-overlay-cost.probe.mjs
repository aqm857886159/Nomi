import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 真实素材导出回归（R13「四件真实」第④件的 export 类 · R17 棘轮）。守一条不变量：
//
//   **导出成本不随文字叠加层的条数成倍涨。**
//
// 事故经过与全部实测数字：docs/fixes/2026-09-21-export-text-overlay-cost.root-cause.json
//
// 为什么必须真素材：合成素材（lavfi 色块 / 2 秒 crf-35 小片）解码成本接近零，主链太便宜，
// 叠加层那条链涨多少都被淹掉——正是 R13 第④件说的那种假绿。
//
// 为什么判据是倍数不是秒数：教训在 docs/lessons（macOS 校准的预算在 Linux CI 上假红 1.3-2x）。
// 这里量同机的 N=60 相对 N=2，机器快慢同时作用于分子分母。新旧交替各 3 次的中位数：
// 修复前 39.1x、修复后 3.6x；独立验收另一轮量到 33.7x → 1.6x。阈值 8x 落在分离带中间。
//
// 内存只记录、不判定：峰值 RSS 随机器负载走，不随本次改动走——同一份代码三次就差 ±20%
// （我这边 6.06→5.07 GB 范围重叠，验收方量到 6.79→6.92 GB）。拿它当判据只会得到 flaky red，
// 而 flaky red 比没有判据更坏：它把人训练成忽略红灯。内存的账记在合同 residual_risks 里。
//
// 跑法：NOMI_REAL_MEDIA_DIR="/Users/aoqimin/Desktop/视频/" npx tsx tests/ux/real-media-export-overlay-cost.probe.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { requireRealMediaAssets } from './fixtures/realMedia.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * 判据一（类根因本身）：**每条**叠加层的静帧输入时长不许比它自己的可见窗口多出这么多秒。
 *
 * 为什么按条不按总和：总和里混着「每条窗口前后的固定余量」，字幕越短余量占比越大
 * （15 s 里塞 60 条 ⇒ 每条窗口 0.25 s、余量 0.4 s，总和自然是时间轴的 2.5 倍），
 * 于是总和判据要么误报、要么只能把阈值放松到看不出问题。按条比对的是「-t 跟谁走」这件事本身：
 * 跟自己的窗口走 ⇒ 差一个余量常数；跟时间轴全长走 ⇒ 差出整条片子（修复前这里是 15 s vs 0.25 s）。
 */
const STILL_INPUT_SLACK_SECONDS = 1
/** 判据二：N=60 相对 N=2 的墙钟倍数上限（新旧交替各 3 次的中位数：修复前 39.1x，修复后 3.6x）。 */
const WALL_RATIO_CEILING = 8

const SEGMENT_SECONDS = 15
const TIMELINE_FPS = 30
const OVERLAY_COUNTS = [2, 60]

/** 用仓库打包时随附的那两个二进制（导出链跑的就是它们），不许退回系统 ffmpeg/ffprobe。 */
function bundledBinary(packageName) {
  const resolved = createRequire(path.join(repoRoot, 'package.json'))(packageName)?.path
  if (!resolved) throw new Error(`找不到仓库自带的 ${packageName}——导出链跑的就是它，不许换成系统二进制`)
  return resolved
}

const FFMPEG = bundledBinary('@ffmpeg-installer/ffmpeg')
const FFPROBE = bundledBinary('@ffprobe-installer/ffprobe')

function run(bin, args) {
  const result = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`${path.basename(bin)} 失败 exit=${result.status}\n  args: ${args.join(' ')}\n${String(result.stderr).slice(-2000)}`)
  }
  return result.stdout
}

/** 几何一律从文件探出来，不写死（写死既是双真相源，也会让门岗的 hardcoded-media-geometry 规则红）。 */
function probeVideo(file) {
  const out = run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name', '-of', 'json', file])
  const stream = JSON.parse(out).streams[0]
  return { width: Number(stream.width), height: Number(stream.height), codec: String(stream.codec_name) }
}

/**
 * 用**真实素材的帧**造 N 张全画幅透明叠加 PNG：抽真帧 → 缩到导出画幅 → 裁下三分之一那条带 →
 * 用透明边补回整幅。形状与生产一致（全画幅 RGBA、只有一条带不透明），内容来自真实解码而不是合成图样。
 */
function deriveOverlayPngs(sourceVideo, outDir, count, exportWidth, exportHeight) {
  fs.mkdirSync(outDir, { recursive: true })
  const bandHeight = Math.max(2, Math.round(exportHeight / 5))
  const bandTop = Math.round(exportHeight * 0.66)
  const files = []
  for (let index = 0; index < count; index += 1) {
    const file = path.join(outDir, `overlay-${String(index).padStart(3, '0')}.png`)
    const seek = (10 + index * 3).toFixed(3)
    run(FFMPEG, [
      '-v', 'error', '-ss', seek, '-i', sourceVideo, '-frames:v', '1',
      '-vf', `scale=${exportWidth}:${exportHeight}:force_original_aspect_ratio=increase,crop=${exportWidth}:${bandHeight},format=rgba,pad=${exportWidth}:${exportHeight}:0:${bandTop}:color=#00000000`,
      '-y', file,
    ])
    files.push(file)
  }
  return files
}

function manifestFor(sourceVideo, exportWidth, exportHeight) {
  const durationFrames = SEGMENT_SECONDS * TIMELINE_FPS
  return {
    version: 1,
    projectId: 'real-media-overlay-cost',
    createdAt: new Date().toISOString(),
    timeline: {
      fps: TIMELINE_FPS,
      durationFrames,
      range: { startFrame: 0, endFrame: durationFrames },
      tracks: [{
        id: 'visual-1',
        kind: 'visual',
        clips: [{ id: 'clip-main', assetId: 'real', startFrame: 0, endFrame: durationFrames, sourceStartFrame: 0, sourceEndFrame: durationFrames }],
      }],
    },
    profile: {
      preset: 'publish',
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'none',
      audioMode: 'mute',
      pixelFormat: 'yuv420p',
      quality: 'standard',
      width: exportWidth,
      height: exportHeight,
      fps: TIMELINE_FPS,
    },
    assets: { real: { id: 'real', kind: 'video', absolutePath: sourceVideo } },
  }
}

/**
 * 墙钟（判据）+ 峰值常驻内存（**尽力而为的留痕**，判不判都不影响结论）。
 *
 * 内存走 `/usr/bin/time`：macOS `-l` 报字节、GNU `-v` 报 KB。两种都不认时返回 null 而不是抛——
 * 峰值内存在这条腿里只是证据链（喂 residual_risk 与「导出成本二期」），
 * 为一个不参与判定的量把整条腿弄红，就是 flaky red 的另一种长法。
 * 墙钟只量 ffmpeg 自己，`/usr/bin/time` 起不来就直接 spawn，判据一天都不缺。
 */
function runMeasured(args) {
  const timeFlag = os.platform() === 'linux' ? '-v' : '-l'
  const started = Date.now()
  let result = spawnSync('/usr/bin/time', [timeFlag, FFMPEG, ...args], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  let measuredMemory = true
  if (result.error) {
    measuredMemory = false
    result = spawnSync(FFMPEG, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  }
  const wallSeconds = (Date.now() - started) / 1000
  if (result.status !== 0) {
    throw new Error(`导出失败 exit=${result.status}\n${String(result.stderr).slice(-3000)}`)
  }
  if (!measuredMemory) return { wallSeconds, peakBytes: null }
  const text = String(result.stderr)
  const mac = /(\d+)\s+maximum resident set size/.exec(text)
  const linux = /Maximum resident set size \(kbytes\):\s*(\d+)/.exec(text)
  const peakBytes = mac ? Number(mac[1]) : linux ? Number(linux[1]) * 1024 : null
  return { wallSeconds, peakBytes }
}

function frameCount(file) {
  const out = run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'default=nk=1:nw=1', file])
  return Number(out.trim())
}

async function main() {
  const { assets } = requireRealMediaAssets(['video-4k-hevc-10bit'])
  const source = assets.get('video-4k-hevc-10bit').file
  const sourceGeometry = probeVideo(source)

  // 跑的是仓库真正的导出编译器，不是复刻（复刻只能证明复刻是对的）。
  const { compileFfmpegFiltergraph } = await import(pathToFileURL(path.join(repoRoot, 'electron/export/ffmpegFiltergraph.ts')).href)
  const { buildWebmToMp4Args } = await import(pathToFileURL(path.join(repoRoot, 'electron/export/ffmpegCommandBuilder.ts')).href)

  const workDir = makeTempDir('nomi-overlay-cost-')
  // 导出画幅由真实素材推出来（竖屏成片：宽 = 源高的一半，再按 9:16 推高），不写死。
  const exportWidth = Math.round(sourceGeometry.height / 4) * 2
  const exportHeight = Math.round((exportWidth * 16) / 9 / 2) * 2
  const pngDir = path.join(workDir, 'overlays')
  const maxCount = Math.max(...OVERLAY_COUNTS)
  const pngs = deriveOverlayPngs(source, pngDir, maxCount, exportWidth, exportHeight)

  const timelineSeconds = SEGMENT_SECONDS
  const results = []
  const failures = []

  for (const count of OVERLAY_COUNTS) {
    const manifest = manifestFor(source, exportWidth, exportHeight)
    const span = Math.floor((timelineSeconds * TIMELINE_FPS) / count)
    const textOverlays = Array.from({ length: count }, (unused, index) => ({
      path: pngs[index],
      startFrame: index * span,
      endFrame: index * span + span,
    }))
    const plan = compileFfmpegFiltergraph({ manifest, textOverlays })
    const overlayInputs = plan.inputs.filter((input) => String(input.assetId).startsWith('text_overlay_'))
    const inputSeconds = (input) => {
      const at = input.inputArgs.indexOf('-t')
      return at >= 0 ? Number(input.inputArgs[at + 1]) : 0
    }
    const stillSeconds = overlayInputs.reduce((sum, input) => sum + inputSeconds(input), 0)
    const overspent = overlayInputs
      .map((input, index) => ({
        index,
        seconds: inputSeconds(input),
        windowSeconds: (textOverlays[index].endFrame - textOverlays[index].startFrame) / TIMELINE_FPS,
      }))
      .filter(({ seconds, windowSeconds }) => seconds > windowSeconds + STILL_INPUT_SLACK_SECONDS)
    const outputPath = path.join(workDir, `overlay-cost-n${count}.mp4`)
    const args = buildWebmToMp4Args({ inputPath: '', outputPath, profile: manifest.profile, noAudio: true, filtergraph: plan })
    const measured = runMeasured(args)
    const frames = frameCount(outputPath)
    results.push({ count, stillSeconds, frames, ...measured })

    if (overspent.length > 0) {
      const worstOverspend = overspent[0]
      failures.push(
        `N=${count}：${overspent.length} 条叠加层的静帧输入超出自己的窗口 >${STILL_INPUT_SLACK_SECONDS}s`
        + `（第 ${worstOverspend.index} 条：-t ${worstOverspend.seconds.toFixed(2)}s vs 窗口 ${worstOverspend.windowSeconds.toFixed(2)}s）`
        + `——叠加层的上游又按全片长生成了（修复前这里是 ${timelineSeconds}s vs ${(timelineSeconds / count).toFixed(2)}s）`,
      )
    }
    if (frames !== timelineSeconds * TIMELINE_FPS) {
      failures.push(`N=${count}：产物 ${frames} 帧，期望 ${timelineSeconds * TIMELINE_FPS} 帧`)
    }
  }

  const base = results[0]
  const worst = results[results.length - 1]
  const wallRatio = worst.wallSeconds / base.wallSeconds
  if (wallRatio > WALL_RATIO_CEILING) {
    failures.push(
      `N=${worst.count} 相对 N=${base.count} 耗时 ${wallRatio.toFixed(1)}x > 上限 ${WALL_RATIO_CEILING}x`
      + `（新旧交替各 3 次的中位数：修复前 39.1x，修复后 3.6x）——导出成本又开始随字幕条数涨了`,
    )
  }

  console.log(`素材：${path.basename(source)} ${sourceGeometry.width}×${sourceGeometry.height} ${sourceGeometry.codec}`)
  console.log(`导出：${exportWidth}×${exportHeight} @${TIMELINE_FPS}fps，${SEGMENT_SECONDS}s 校准段`)
  for (const r of results) {
    console.log(
      `  N=${String(r.count).padStart(3)}  墙钟 ${r.wallSeconds.toFixed(1)}s`
      + `  峰值内存 ${r.peakBytes === null ? '未测到' : `${(r.peakBytes / 2 ** 30).toFixed(2)}GB`}（只记录，不判定——见文件抬头）`
      + `  静帧输入合计 ${r.stillSeconds.toFixed(1)}s  产物 ${r.frames} 帧`,
    )
  }
  console.log(`  N=${worst.count}/N=${base.count} 耗时倍数 ${wallRatio.toFixed(1)}x（上限 ${WALL_RATIO_CEILING}x）`)
  fs.rmSync(workDir, { recursive: true, force: true })

  if (failures.length > 0) {
    console.error(`\n✖ 导出叠加层成本回归（${failures.length} 条）：`)
    for (const failure of failures) console.error(`   - ${failure}`)
    process.exitCode = 1
    return
  }
  console.log('\n✅ 导出成本没有随文字叠加层条数成倍涨')
}

await main()
