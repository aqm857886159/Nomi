#!/usr/bin/env node
/**
 * Real-provider acceptance run through Nomi capability core.
 * Every media URL in the record is returned by a real Nomi generate call.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { invoke } from './lib/nomiClient.mjs'

const require = createRequire(import.meta.url)
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path
const ffprobe = require('@ffprobe-installer/ffprobe').path
const spendOptions = { spawnEnv: { NOMI_LOOP_SPEND_OK: '1', NOMI_POLL_TIMEOUT_MS: '900000' } }
const provider = 'apimart'
const imageModel = 'doubao-seedream-4.5'
const videoModel = 'doubao-seedance-2.0'
const shotDuration = 5

const anchors = [
  { id: 'woman', kind: 'character', name: '小满', description: '成年女性，短黑发，银色耳钉，明黄色雨衣，右手铜色暖光灯。', carrier: 'visual' },
  { id: 'street', kind: 'scene', name: '雨夜街口', description: '同一条湿润霓虹街口，青绿色半开门在左侧。', carrier: 'visual' },
  { id: 'studio', kind: 'scene', name: '门内工作室', description: '门内同一间暖色创作工作室，木桌靠窗，桌上有小屏幕。', carrier: 'visual' },
  { id: 'lantern', kind: 'prop', name: '暖光灯', description: '小型铜色提灯，暖黄色光，贯穿全片。', carrier: 'visual' },
  { id: 'note', kind: 'prop', name: '湿纸条', description: '米白色湿纸条，上面只有一幅门线稿，不出现可读文字。', carrier: 'visual' },
]

const shots = [
  {
    shotId: 'shot-1', narrativeGoal: '发现线索', actionChain: '她弯腰捡起湿纸条，抬灯照到门线稿，再抬头看向左后方半开的门。', dramaticBeat: '目标建立：纸条指向一扇门。', continuityLocks: '黄色雨衣、短黑发、银耳钉、暖灯、湿纸条、左侧青绿色半开门。',
    ffDesc: '雨夜街口中景，女性在右侧蹲下，暖灯照亮湿纸条，半开青绿色门在左后方，霓虹倒影。', motionDesc: '低位缓慢靠近；她捡起纸条，照亮线稿，抬头看向左后方的门。', lfDesc: '她站起身，纸条在左手、暖灯在右手，身体朝向左后方半开门。', firstFrameRef: 'anchor:street', subtitle: '她捡到的，不是一张废纸。', transition: { type: 'cut' },
  },
  {
    shotId: 'shot-2', previousShotId: 'shot-1', narrativeGoal: '做出决定', actionChain: '她走到同一扇门前，右手提灯照门缝，左手压下门把，把门推开。', dramaticBeat: '决定：跟随纸条进入门内。', continuityLocks: '同一门和门把、纸条在左手、暖灯在右手、黄色雨衣湿润。',
    ffDesc: '连续门前近景，门在左侧，女性在右侧，左手纸条靠近门把，右手暖灯照门缝。', motionDesc: '肩后跟拍；她走到门前，照亮门缝，用左手压门把并把门推到可通过宽度。', lfDesc: '门被推开，女性半侧身站在门槛外，左手握门把和纸条，右手灯光照进门内。', firstFrameRef: 'tail:shot-1', subtitle: '门没有回答她，只留了一条缝。', transition: { type: 'match_cut', durationFrames: 10 },
  },
  {
    shotId: 'shot-3', previousShotId: 'shot-2', narrativeGoal: '跨过门槛', actionChain: '她从打开的门槛跨进门内，鞋底带进雨水，回头确认门在身后，再朝木桌走去。', dramaticBeat: '空间转折：街外变成同一门内工作室。', continuityLocks: '同一门槛在后方、木桌在前方、黄色雨衣湿润、暖灯和纸条仍在手上、雨水脚印。',
    ffDesc: '从工作室内向门口拍，打开的青绿色门在后方，女性正跨过门槛，木桌在右前方。', motionDesc: '镜头向后轻退；她跨过门槛，留下水滴，回头看门一次，再朝右前方木桌走。', lfDesc: '她到达靠窗木桌左侧，门在背景可见，雨水脚印从门槛连到桌边。', firstFrameRef: 'tail:shot-2', subtitle: '她跨进去，雨还跟在脚边。', transition: { type: 'dissolve', durationFrames: 12 },
  },
  {
    shotId: 'shot-4', previousShotId: 'shot-3', narrativeGoal: '把发现变成行动', actionChain: '她把暖灯放在桌面左上角，把湿纸条压在透明垫下，用铅笔画出第一格分镜。', dramaticBeat: '行动落地：线索第一次变成创作。', continuityLocks: '同一木桌、灯在左上角、纸条在透明垫下、铅笔和第一张卡、窗在右后方。',
    ffDesc: '同一木桌近景，灯在左上角，湿纸条被透明垫压住，女性坐在桌前，双手都在桌面上。桌下保持空无一人。', motionDesc: '固定近景；只有一个女性，双手始终在桌面上。她先放灯，再压平纸条，拿铅笔在卡片上画出门框第一格；桌下为空，没有第二个人、脸或眼睛。', lfDesc: '灯稳定发光，纸条和第一张卡并排，卡片有抽象门框图形但没有文字；桌下仍为空。', firstFrameRef: 'tail:shot-3', subtitle: '她决定，把这条线索做成一场戏。', transition: { type: 'cut' },
  },
  {
    shotId: 'shot-5', previousShotId: 'shot-4', narrativeGoal: '组织成片', actionChain: '她把第一张卡和五张新卡从左到右排成时间线，最后把最右一张推到屏幕下并按下播放键。', dramaticBeat: '推进到结果：零散画面被组织成粗剪。', continuityLocks: '同一木桌俯拍、六张卡从左到右、暖灯左上角、纸条在透明垫下、手从左向右移动。',
    ffDesc: '同一木桌俯拍，第一张卡在左侧、五张空白卡在右侧，暖灯左上角，纸条在透明垫下。', motionDesc: '俯拍缓慢下降；她逐张对齐六张卡，最后一张推到小屏幕下并按下播放键，屏幕亮起。', lfDesc: '六张卡形成横向时间线，屏幕亮起抽象彩色画面，灯和纸条仍在原位。', firstFrameRef: 'tail:shot-4', subtitle: '一张卡不够，她把它们排成了时间。', transition: { type: 'match_cut', durationFrames: 10 },
  },
  {
    shotId: 'shot-6', previousShotId: 'shot-5', narrativeGoal: '看见完成结果', actionChain: '清晨光线从同一扇窗进入，她看着屏幕里的六格粗剪，把暖灯放稳，再看向窗外。', dramaticBeat: '结果收束：她完成了属于自己的第一版。', continuityLocks: '同一工作室和窗、屏幕播放六格画面、六张卡和纸条在桌面、暖灯左上角。',
    ffDesc: '同一工作室清晨，窗在右后方，六张卡和纸条在桌上，屏幕亮着六格抽象画面，女性坐在桌边。', motionDesc: '镜头沿屏幕缓慢拉到窗边；她看完屏幕，把暖灯放稳，抬头看向清晨窗外。', lfDesc: '清晨窗光、屏幕、六张卡、纸条、暖灯和女性同框，屏幕继续播放，结果安静成立。', firstFrameRef: 'tail:shot-5', subtitle: '天亮时，她有了自己的第一版。', transition: { type: 'dissolve', durationFrames: 12 },
  },
]

const storyPlan = { title: '纸条指向的第一版', anchors, shots }

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}
function findProjectDir(projectId) {
  const root = path.join(os.homedir(), 'Documents', 'Nomi Projects')
  for (const name of fs.readdirSync(root)) {
    const candidate = path.join(root, name)
    if (!fs.statSync(candidate).isDirectory()) continue
    try { if (JSON.parse(fs.readFileSync(path.join(candidate, '.nomi', 'project.json'), 'utf8')).id === projectId) return candidate } catch {}
  }
  throw new Error('cannot find created Nomi project directory for ' + projectId)
}
function localAssetPath(projectDir, url) {
  if (typeof url !== 'string' || !url.startsWith('nomi-local://asset/')) throw new Error('provider did not return local asset: ' + url)
  const marker = url.indexOf('/', 'nomi-local://asset/'.length)
  const relative = decodeURIComponent(url.slice(marker + 1).split(/[?#]/, 1)[0])
  const target = path.resolve(projectDir, relative)
  if (!target.startsWith(path.resolve(projectDir) + path.sep)) throw new Error('asset escaped project')
  return target
}
function assetUrl(result) {
  const asset = (result.assets || []).find((item) => item && item.url)
  if (!asset) throw new Error('Nomi generate returned no asset: ' + JSON.stringify(result).slice(0, 500))
  return asset.url
}
function anchorIdsForShot(index) {
  if (index < 2) return ['woman', 'street', 'lantern', 'note']
  if (index === 2) return ['woman', 'street', 'studio', 'lantern', 'note']
  return ['woman', 'studio', 'lantern', 'note']
}
function productionPlan(basePlan) {
  return {
    ...basePlan,
    shots: (basePlan.shots || []).map((shot, index) => ({
      ...shot,
      durationSec: Number(shot.durationSec || shotDuration),
      anchorIds: Array.isArray(shot.anchorIds) && shot.anchorIds.length ? shot.anchorIds : anchorIdsForShot(index),
      prompt: shot.prompt || `${shot.motionDesc || ''}\n${shot.continuityLocks || ''}`.trim(),
    })),
  }
}
async function generate(input) {
  console.log('→ ' + input.title)
  const result = await invoke('generate', input, spendOptions)
  if (result.status !== 'succeeded') throw new Error('Nomi generate failed: ' + JSON.stringify(result).slice(0, 600))
  const url = assetUrl(result)
  console.log('  ✓ ' + input.title + ' ' + url)
  return { url, result }
}
function stamp(seconds) {
  const millis = Math.round(seconds * 1000)
  return '00:' + String(Math.floor(millis / 60000)).padStart(2, '0') + ':' + String(Math.floor((millis % 60000) / 1000)).padStart(2, '0') + ',' + String(millis % 1000).padStart(3, '0')
}
function writeSrt(file, maxDuration = Number.POSITIVE_INFINITY) {
  const blocks = shots.map((shot, index) => {
    const start = index * shotDuration
    const end = Math.min((index + 1) * shotDuration - 0.18, Math.max(start + 0.1, maxDuration - 0.08))
    return (index + 1) + '\n' + stamp(start) + ' --> ' + stamp(end) + '\n' + shot.subtitle
  })
  fs.writeFileSync(file, blocks.join('\n\n') + '\n', 'utf8')
}
function assemble(projectDir, runDir, videoFiles) {
  const assemblyDir = path.join(runDir, 'assembly')
  fs.mkdirSync(assemblyDir, { recursive: true })
  const trimmed = videoFiles.map((source, index) => {
    const target = path.join(assemblyDir, 'shot-' + (index + 1) + '.mp4')
    execFileSync(ffmpeg, ['-y', '-i', source, '-t', String(shotDuration), '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', target], { stdio: 'ignore' })
    return target
  })
  const args = ['-y']
  trimmed.forEach((file) => args.push('-i', file))
  const filters = []
  let current = '[0:v]'
  let currentDuration = shotDuration
  for (let index = 1; index < trimmed.length; index += 1) {
    const next = '[' + index + ':v]'
    const output = '[v' + index + ']'
    // Five authored crossfades should preserve a ~30s program, not silently
    // shorten it to 28.6s. 0.12s is long enough to read as a transition while
    // keeping the six 5s story beats inside the delivery contract.
    const overlap = 0.12
    filters.push(current + next + 'xfade=transition=fade:duration=' + overlap + ':offset=' + (currentDuration - overlap).toFixed(2) + output)
    current = output
    currentDuration += shotDuration - overlap
  }
  const raw = path.join(assemblyDir, 'video-no-subtitles.mp4')
  args.push('-filter_complex', filters.join(';'), '-map', current, '-r', '30', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', raw)
  execFileSync(ffmpeg, args, { stdio: 'ignore' })
  const srt = path.join(runDir, 'subtitles.srt')
  writeSrt(srt, currentDuration)
  const outputDir = path.join(projectDir, 'exports')
  fs.mkdirSync(outputDir, { recursive: true })
  const output = path.join(outputDir, 'nomi-real-continuity-30s.mp4')
  execFileSync(ffmpeg, ['-y', '-i', raw, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000:duration=' + currentDuration.toFixed(3), '-i', srt, '-map', '0:v:0', '-map', '1:a:0', '-map', '2:0', '-vf', 'subtitles=' + srt.replace(/:/g, '\\:'), '-t', currentDuration.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-c:s', 'mov_text', '-movflags', '+faststart', output], { stdio: 'ignore' })
  return { output, srt, durationSeconds: currentDuration }
}

function mediaDuration(file) {
  return Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).trim())
}

function mixNarration(projectDir, runDir, sourceFilm, narrationFiles, durationSeconds) {
  const output = path.join(projectDir, 'exports', 'nomi-real-continuity-30s-sound.mp4')
  const args = ['-y', '-i', sourceFilm]
  narrationFiles.forEach((file) => args.push('-i', file))
  const filters = []
  const clipStarts = timelineClips().map((clip) => clip.startFrame / 30)
  const playbackRate = 1.25
  const cueTimings = narrationFiles.map((file, index) => {
    const delay = Math.round((clipStarts[index] + 0.25) * 1000)
    const sourceDurationSeconds = mediaDuration(file)
    const startSeconds = delay / 1000
    const endSeconds = startSeconds + sourceDurationSeconds / playbackRate
    filters.push(`[${index + 1}:a]aresample=48000,atempo=${playbackRate},volume=1.35,adelay=${delay}|${delay}[voice${index}]`)
    return { startSeconds, endSeconds, sourceDurationSeconds, playbackRate }
  })
  filters.push(`anoisesrc=color=pink:duration=${durationSeconds.toFixed(3)}:amplitude=0.018:r=48000,highpass=f=90,lowpass=f=3200,afade=t=out:st=13:d=3[rain]`)
  filters.push(`aevalsrc=0.012*sin(2*PI*110*t)+0.007*sin(2*PI*164.81*t):s=48000:d=${durationSeconds.toFixed(3)},lowpass=f=520,afade=t=in:d=2,afade=t=out:st=26:d=3[pad]`)
  const voiceInputs = narrationFiles.map((_file, index) => `[voice${index}]`).join('')
  filters.push(`${voiceInputs}[rain][pad]amix=inputs=${narrationFiles.length + 2}:duration=longest:dropout_transition=0,loudnorm=I=-18:LRA=7:TP=-1.5[aout]`)
  args.push('-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[aout]', '-map', '0:s?', '-t', durationSeconds.toFixed(3), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-c:s', 'copy', '-movflags', '+faststart', output)
  execFileSync(ffmpeg, args, { stdio: 'ignore' })
  return { output, cueTimings, playbackRate }
}

function timelineClips() {
  const overlapFrames = Math.round(0.12 * 30)
  let cursor = 0
  return shots.map((shot, index) => {
    const startFrame = cursor
    const endFrame = startFrame + shotDuration * 30
    cursor += index < shots.length - 1 ? shotDuration * 30 - overlapFrames : shotDuration * 30
    return { shotId: shot.shotId, startFrame, endFrame }
  })
}

async function retryShot(projectDir, runDir, shotNumber, reason) {
  const index = shotNumber - 1
  if (!Number.isInteger(index) || index < 0 || index >= shots.length) throw new Error(`invalid --retry-shot ${shotNumber}`)
  const recordPath = path.join(runDir, 'generation-record-v1.json')
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
  record.plan = productionPlan(record.plan)
  const current = record.video?.shots?.[index]
  const shot = record.plan?.shots?.[index] || shots[index]
  if (!current || !shot) throw new Error(`generation record has no shot-${shotNumber}`)
  const keyframe = record.keyframes?.find((item) => item.shotId === shot.shotId)
  if (!keyframe?.url) throw new Error(`generation record has no keyframe for ${shot.shotId}`)
  const prompt = [
    '固定电影近景，重试这一镜，严格保持首帧构图和角色服装。',
    '画面中只有一个成年女性，坐在桌边，双手始终在桌面上；桌子下面必须是空的，绝对不要出现第二个人、脸、眼睛、身体或倒影。',
    '她先把铜色暖灯放在左上角，再把湿纸条压平，最后用铅笔在第一张卡片上画一个抽象门框；动作慢而清楚，镜头不要变焦，不要改变桌面布局。',
    '禁止新增人物、禁止桌下生物、禁止可读文字、禁止鬼影和双重曝光。',
  ].join(' ')
  const generated = await generate({
    projectId: record.projectId,
    intent: 'video',
    vendor: record.provider || provider,
    modelKey: record.videoModel || videoModel,
    title: `重试 ${shot.shotId}`,
    prompt,
    references: [keyframe.url],
    firstFrameDesc: shot.ffDesc,
    lastFrameDesc: shot.lfDesc,
    params: { size: '16:9', duration: shotDuration, generate_audio: false },
  })
  const previousUrl = current.url
  record.video.shots[index] = {
    ...current,
    url: generated.url,
    prompt,
    retryCount: Number(current.retryCount || 0) + 1,
    retryReason: reason,
    parentUrl: previousUrl,
  }
  record.export.retry = { shotId: shot.shotId, retryCount: record.video.shots[index].retryCount, reason, previousUrl, replacementUrl: generated.url }
  const assembled = assemble(projectDir, runDir, record.video.shots.map((item) => localAssetPath(projectDir, item.url)))
  record.export.durationSeconds = assembled.durationSeconds
  writeJson(recordPath, record)
  const timelinePath = path.join(runDir, 'timeline-v1.json')
  const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'))
  timeline.timelineContract.durationFrames = Math.round(assembled.durationSeconds * 30)
  timeline.timelineContract.clips = timelineClips()
  timeline.media.relativePath = path.relative(projectDir, assembled.output)
  timeline.retry = record.export.retry
  writeJson(timelinePath, timeline)
  return { shotId: shot.shotId, previousUrl, replacementUrl: generated.url, film: assembled.output, durationSeconds: assembled.durationSeconds }
}

async function addAudio(projectDir, runDir) {
  const recordPath = path.join(runDir, 'generation-record-v1.json')
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
  const sourceFilm = path.join(projectDir, 'exports', 'nomi-real-continuity-30s.mp4')
  if (!fs.existsSync(sourceFilm)) throw new Error(`silent picture master not found: ${sourceFilm}`)
  const narration = Array.isArray(record.audio?.narration) && record.audio.narration.length === record.plan.shots.length
    ? record.audio.narration.map((cue) => ({ ...cue }))
    : []
  if (!narration.length) {
    for (let index = 0; index < record.plan.shots.length; index += 1) {
      const shot = record.plan.shots[index]
      const prompt = shot.subtitle || shots[index]?.subtitle
      if (!prompt) throw new Error(`missing narration text for ${shot.shotId || index + 1}`)
      const generated = await generate({
        projectId: record.projectId,
        intent: 'audio',
        vendor: 'apimart',
        modelKey: 'nomi-audio',
        modeId: 'speech',
        title: `旁白 ${shot.shotId}`,
        prompt,
        params: { voice: 'shimmer', speed: 0.92 },
      })
      narration.push({ shotId: shot.shotId, prompt, url: generated.url, vendor: 'apimart', modelKey: 'nomi-audio', modeId: 'speech', voice: 'shimmer', speed: 0.92 })
    }
  }
  const durationSeconds = Number(record.export.durationSeconds || 29.4)
  const narrationFiles = narration.map((cue) => localAssetPath(projectDir, cue.url))
  const mixed = mixNarration(projectDir, runDir, sourceFilm, narrationFiles, durationSeconds)
  mixed.cueTimings.forEach((timing, index) => Object.assign(narration[index], timing))
  record.audio = {
    narration,
    mix: {
      sourcePictureMaster: path.relative(projectDir, sourceFilm),
      ambience: ['rain-pink-noise-first-half', 'low-warm-pad'],
      durationSeconds,
      output: path.relative(projectDir, mixed.output),
      playbackRate: mixed.playbackRate,
    },
  }
  record.export.relativePath = path.relative(projectDir, mixed.output)
  writeJson(recordPath, record)
  const timelinePath = path.join(runDir, 'timeline-v1.json')
  const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'))
  timeline.media.relativePath = path.relative(projectDir, mixed.output)
  timeline.audio = record.audio
  writeJson(timelinePath, timeline)
  const runPath = path.join(runDir, 'run.json')
  const run = JSON.parse(fs.readFileSync(runPath, 'utf8'))
  const exportArtifact = run.artifacts?.find((artifact) => artifact.kind === 'export')
  if (exportArtifact) exportArtifact.projectRelativePath = path.relative(projectDir, mixed.output)
  run.audio = { narrationCueCount: narration.length, output: path.relative(projectDir, mixed.output) }
  writeJson(runPath, run)
  return { output: mixed.output, narrationCueCount: narration.length, durationSeconds, playbackRate: mixed.playbackRate }
}

function reassembleExisting(projectDir, runDir) {
  const recordPath = path.join(runDir, 'generation-record-v1.json')
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
  const videoFiles = record.video.shots.map((shot) => localAssetPath(projectDir, shot.url))
  const assembled = assemble(projectDir, runDir, videoFiles)
  record.export.durationSeconds = assembled.durationSeconds
  writeJson(recordPath, record)
  const timelinePath = path.join(runDir, 'timeline-v1.json')
  const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'))
  timeline.timelineContract.durationFrames = Math.round(assembled.durationSeconds * 30)
  timeline.timelineContract.clips = timelineClips()
  timeline.media.relativePath = path.relative(projectDir, assembled.output)
  writeJson(timelinePath, timeline)
  return assembled
}

async function main() {
  if (process.argv.includes('--add-audio')) {
    const projectDir = path.resolve(process.env.NOMI_REAL_FILM_PROJECT || '')
    const runDir = path.resolve(process.env.NOMI_REAL_FILM_RUN || '')
    if (!projectDir || !runDir) throw new Error('NOMI_REAL_FILM_PROJECT and NOMI_REAL_FILM_RUN are required for --add-audio')
    console.log(JSON.stringify(await addAudio(projectDir, runDir), null, 2))
    return
  }
  if (process.argv.includes('--normalize-record')) {
    const runDir = path.resolve(process.env.NOMI_REAL_FILM_RUN || '')
    if (!runDir) throw new Error('NOMI_REAL_FILM_RUN is required for --normalize-record')
    const recordPath = path.join(runDir, 'generation-record-v1.json')
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
    record.plan = productionPlan(record.plan)
    writeJson(recordPath, record)
    const storyboardPath = path.join(runDir, 'storyboard-v1.json')
    if (fs.existsSync(storyboardPath)) {
      const storyboard = JSON.parse(fs.readFileSync(storyboardPath, 'utf8'))
      storyboard.plan = productionPlan(storyboard.plan)
      writeJson(storyboardPath, storyboard)
    }
    console.log(JSON.stringify({ recordPath, normalized: true }, null, 2))
    return
  }
  const retryFlag = process.argv.indexOf('--retry-shot')
  if (retryFlag >= 0) {
    const projectDir = path.resolve(process.env.NOMI_REAL_FILM_PROJECT || '')
    const runDir = path.resolve(process.env.NOMI_REAL_FILM_RUN || '')
    const shotNumber = Number(process.argv[retryFlag + 1])
    const reason = process.env.NOMI_RETRY_REASON || 'frame review found a provider-generated continuity artifact'
    if (!projectDir || !runDir) throw new Error('NOMI_REAL_FILM_PROJECT and NOMI_REAL_FILM_RUN are required for --retry-shot')
    const result = await retryShot(projectDir, runDir, shotNumber, reason)
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (process.argv.includes('--reassemble')) {
    const projectDir = path.resolve(process.env.NOMI_REAL_FILM_PROJECT || '')
    const runDir = path.resolve(process.env.NOMI_REAL_FILM_RUN || '')
    if (!projectDir || !runDir) throw new Error('NOMI_REAL_FILM_PROJECT and NOMI_REAL_FILM_RUN are required for --reassemble')
    const assembled = reassembleExisting(projectDir, runDir)
    console.log(JSON.stringify({ projectDir, runDir, film: assembled.output, durationSeconds: assembled.durationSeconds }, null, 2))
    return
  }
  const modelList = await invoke('models.list', {}, {})
  const model = (modelList.models || []).find((item) => item.vendor === provider && item.modelKey === videoModel && item.keyStatus === 'ok')
  if (!model) throw new Error('APIMart Seedance model/key is not available in Nomi')
  const project = await invoke('project.create', { name: '真实连续性片 2026-08-21' }, {})
  const projectId = project.id
  const projectDir = findProjectDir(projectId)
  const runId = 'run-real-continuity-' + projectId.slice(-8)
  const runDir = path.join(projectDir, '.nomi', 'runs', runId)
  fs.mkdirSync(runDir, { recursive: true })
  const scriptText = '小满在雨夜捡到一张画着门的湿纸条。她推开纸条指向的门，把线索画成第一张分镜卡，再将卡片排成时间线并看见完成的粗剪；清晨，她把暖灯放稳，确认这是一版真正属于自己的开始。'
  const scriptHash = createHash('sha256').update(scriptText).digest('hex')
  writeJson(path.join(runDir, 'script-v1.json'), { schemaVersion: 1, kind: 'script', artifactId: 'artifact-script-v1', version: 1, source: 'external-mcp', content: scriptText, contentHash: scriptHash, reviewStatus: 'approved', createdAt: new Date().toISOString() })
  const anchor = await generate({ projectId, intent: 'image', vendor: provider, modelKey: imageModel, title: '角色与世界锚点', prompt: '电影写实角色与场景参考图：成年短黑发女性，银色耳钉，明黄色雨衣，右手铜色暖光灯，左手湿纸条；背景同时可见雨夜霓虹街口、左侧青绿色半开门、门内暖色工作室木桌的视觉线索；统一真实电影摄影，禁止可读文字和品牌。', params: { size: '16:9' } })
  const keyframes = []
  const videos = []
  let previousKeyframe = anchor.url
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index]
    const references = index === 0 ? [anchor.url] : [anchor.url, previousKeyframe]
    const keyframe = await generate({ projectId, intent: 'image', vendor: provider, modelKey: imageModel, title: '首帧 ' + shot.shotId, prompt: shot.ffDesc + '\n角色与世界锚点：成年短黑发女性、银色耳钉、明黄色雨衣、铜色暖光灯。' + shot.continuityLocks + '\n只生成静态首帧，不写运镜，不写文字。', references, params: { size: '16:9' } })
    keyframes.push({ shotId: shot.shotId, url: keyframe.url })
    previousKeyframe = keyframe.url
    const video = await generate({ projectId, intent: 'video', vendor: provider, modelKey: videoModel, title: '视频 ' + shot.shotId, prompt: shot.motionDesc + '\n' + shot.continuityLocks + '\n禁止瞬移、禁止换装、禁止可读文字。', references: [keyframe.url], firstFrameDesc: shot.ffDesc, lastFrameDesc: shot.lfDesc, params: { size: '16:9', duration: shotDuration, generate_audio: false } })
    videos.push({ shotId: shot.shotId, url: video.url })
  }
  const videoFiles = videos.map((video) => localAssetPath(projectDir, video.url))
  const assembled = assemble(projectDir, runDir, videoFiles)
  const plan = productionPlan({ ...storyPlan, sourceScriptArtifactId: 'artifact-script-v1', sourceScriptVersion: 1, sourceScriptHash: scriptHash })
  const generationRecord = { schemaVersion: 2, kind: 'real-provider-generation-record', projectId, runId, provider, imageModel, videoModel, anchor: { url: anchor.url, model: imageModel }, plan, keyframes, video: { shots: videos.map((video, index) => ({ shotId: video.shotId, previousShotId: shots[index].previousShotId, firstFrameRef: 'keyframe:' + video.shotId, firstFrameDesc: shots[index].ffDesc, lastFrameDesc: shots[index].lfDesc, references: [keyframes[index].url], prompt: shots[index].motionDesc, url: video.url })) }, export: { relativePath: path.relative(projectDir, assembled.output), durationSeconds: assembled.durationSeconds, subtitles: { file: path.relative(projectDir, path.join(runDir, 'subtitles.srt')), cues: shots.length }, transitions: shots.slice(0, -1).map((shot, index) => ({ fromShotId: shot.shotId, toShotId: shots[index + 1].shotId, ...shot.transition })) } }
  const planHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex')
  writeJson(path.join(runDir, 'storyboard-v1.json'), { schemaVersion: 1, kind: 'storyboard', artifactId: 'artifact-storyboard-v1', version: 1, source: 'external-mcp', sourceScriptArtifactId: 'artifact-script-v1', sourceScriptVersion: 1, sourceScriptHash: scriptHash, reviewStatus: 'approved', planHash, plan, createdAt: new Date().toISOString() })
  writeJson(path.join(runDir, 'generation-record-v1.json'), generationRecord)
  writeJson(path.join(runDir, 'timeline-v1.json'), { schemaVersion: 1, kind: 'timeline', artifactId: 'artifact-timeline-v1', version: 1, source: 'external-mcp', timelineContract: { fps: 30, durationFrames: Math.round(assembled.durationSeconds * 30), clips: timelineClips(), subtitles: shots.map((shot, index) => ({ startFrame: index * shotDuration * 30, endFrame: Math.min(Math.round(assembled.durationSeconds * 30) - 6, (index + 1) * shotDuration * 30 - 6), text: shot.subtitle, style: 'caption' })), transitions: generationRecord.export.transitions }, media: { relativePath: path.relative(projectDir, assembled.output), source: 'real-provider' } })
  writeJson(path.join(runDir, 'run.json'), { schemaVersion: 1, projectId, runId, status: 'awaiting_rough_cut_review', source: 'external-mcp', provider, model: videoModel, artifacts: [{ artifactId: 'artifact-script-v1', kind: 'script', status: 'adopted' }, { artifactId: 'artifact-storyboard-v1', kind: 'storyboard', status: 'adopted' }, { artifactId: 'artifact-timeline-v1', kind: 'timeline', status: 'adopted' }, { artifactId: 'artifact-export-v1', kind: 'export', status: 'adopted', projectRelativePath: path.relative(projectDir, assembled.output) }], note: '真实 APIMart Seedream/Seedance 生成；每镜先生成静态首帧，再用首帧做 I2V，下一镜首帧同时引用角色锚和上一镜首帧。' })
  console.log(JSON.stringify({ projectId, projectDir, runId, runDir, film: assembled.output }, null, 2))
}

main().catch((error) => { console.error(error && error.stack ? error.stack : String(error)); process.exitCode = 1 })
