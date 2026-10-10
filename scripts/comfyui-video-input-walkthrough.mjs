// R13 真机走查：**视频输入通道**（补帧/视频超分/视频去背景那类「视频进视频出」的工作流）。
// 这条通道此前整条不存在：LoadVideo 的输入键是 `file`，而分析器写死了只认 `image`
//（语料 29 个 LoadVideo 全部用 file、零个用 image）→ 视频输入一个都绑不上。
//
// 真 ComfyUI（127.0.0.1:8188）。工作流选零模型依赖的纯视频处理：LoadVideo → GetVideoComponents
// → CreateVideo → SaveVideo（等价于补帧/超分的形状，但不需要下任何模型）。
//   ① 上传一条真 mp4 到 ComfyUI（验 /upload/image 收视频、返回名进 LoadVideo.file 的 combo）
//   ② 导入面板：分析出「源视频」绑定行（而不是把 mp4 塞进首帧图）
//   ③ 建图后 LoadVideo.file 被替成 {{request.params.source_video_url}}
//   ④ 拿真文件名提交 /prompt，ComfyUI 真跑完出视频
// 用法：node scripts/comfyui-video-input-walkthrough.mjs
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { importLocal } from './lib/repoPaths.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const COMFY = 'http://127.0.0.1:8188'
const stats = await fetch(`${COMFY}/system_stats`).then((r) => r.json()).catch(() => null)
if (!stats) { console.error('❌ 真 ComfyUI 没在 8188 跑'); process.exit(1) }
console.log(`  真 ComfyUI ${stats.system?.comfyui_version} ✓`)

// 造一条真 mp4
const clip = '/tmp/nomi-v2v-walk.mp4'
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=96x96:rate=8:duration=1', '-pix_fmt', 'yuv420p', clip])

// ── ① 上传（视频走 comfyui-upload 同一端点）──
const form = new FormData()
form.append('image', new Blob([readFileSync(clip)], { type: 'video/mp4' }), 'nomi-v2v-walk.mp4')
form.append('type', 'input')
form.append('overwrite', 'true')
const up = await fetch(`${COMFY}/upload/image`, { method: 'POST', body: form }).then((r) => r.json())
console.log(`  ① 视频上传: ${up.name ? '✓ ' + up.name : '✗ ' + JSON.stringify(up)}`)
if (!up.name) process.exit(1)

const combo = await fetch(`${COMFY}/object_info/LoadVideo`).then((r) => r.json())
const opts = combo?.LoadVideo?.input?.required?.file?.[1]?.options || []
console.log(`  ①b 上传的名字出现在 LoadVideo.file 选项里: ${opts.includes(up.name) ? '✓' : '✗ ' + JSON.stringify(opts).slice(0, 120)}`)

// ── ②③ 分析器 + 建图（用落 main 的真实实现）──
const { analyzeComfyWorkflow, buildImportedWorkflow } = await importLocal('electron/catalog/comfyuiWorkflowImport.ts')
const graph = {
  1: { class_type: 'LoadVideo', inputs: { file: 'placeholder.mp4' } },
  2: { class_type: 'GetVideoComponents', inputs: { video: ['1', 0] } },
  3: { class_type: 'CreateVideo', inputs: { images: ['2', 0], fps: 8 } },
  4: { class_type: 'SaveVideo', inputs: { video: ['3', 0], filename_prefix: 'nomi_v2v', format: 'auto', codec: 'auto' } },
}
const a = analyzeComfyWorkflow(graph)
console.log(`  ② 源视频绑定: ${a.suggested.sourceVideoNodeId}.${a.suggested.sourceVideoInputKey} ${a.suggested.sourceVideoNodeId === '1' ? '✓' : '✗'}`)
console.log(`  ②b 没被当成首帧图: ${a.suggested.firstFrameNodeId === undefined ? '✓' : '✗ ' + a.suggested.firstFrameNodeId}`)
const built = buildImportedWorkflow(graph, a.suggested)
const placeholder = built.templatedGraph['1'].inputs.file
console.log(`  ③ 占位注入: ${placeholder} ${placeholder === '{{request.params.source_video_url}}' ? '✓' : '✗'}`)

// ── ④ 拿真文件名填进去，真提交 ──
// 按真实管线渲染模板（参数默认值来自 built.parameters —— 与 create.defaultParams 同源）
const { buildTemplateContext, renderTemplateValue } = await importLocal('electron/ai/requestPipeline.ts')
const params = Object.fromEntries(built.parameters.map((p) => [p.key, p.default]))
params.source_video_url = up.name
const ctx = buildTemplateContext({ prompt: '', params })
const runnable = renderTemplateValue(built.templatedGraph, ctx)
const res = await fetch(`${COMFY}/prompt`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: runnable, client_id: 'nomi-walk' }),
})
const body = await res.json()
if (!res.ok) { console.error('  ④ /prompt 被拒：', JSON.stringify(body).slice(0, 400)); process.exit(1) }
console.log(`  ④ 提交成功 prompt_id=${String(body.prompt_id).slice(0, 8)}`)

let out = null
for (let i = 0; i < 40; i += 1) {
  await new Promise((r) => setTimeout(r, 1000))
  const h = await fetch(`${COMFY}/history/${body.prompt_id}`).then((r) => r.json()).catch(() => ({}))
  const rec = h?.[body.prompt_id]
  if (rec?.status?.completed) { out = rec; break }
}
if (!out) { console.error('  ④b 超时没跑完'); process.exit(1) }
const files = Object.values(out.outputs || {}).flatMap((o) => Object.values(o).flat()).filter((f) => f?.filename)
console.log(`  ④b ComfyUI 真跑完: ${out.status?.status_str} → ${files.map((f) => f.filename).join(', ') || '(无产物)'}`)
if (out.status?.status_str !== 'success' || files.length === 0) process.exit(1)
console.log('  ✅ 视频进 → 视频出，整条通道打通')
