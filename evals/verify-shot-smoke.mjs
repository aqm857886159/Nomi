// 真模型 smoke:验「镜级 verify」契约 —— 真视觉模型 + 真图 + verify prompt → 能否返回可解析 JSON 判决。
// 自带 --disable-gpu 启动、不开窗(verify 只需主进程 safeStorage 解密 + fetch),绕开本机 GUI/GPU 启动崩。
// 跑:node evals/verify-shot-smoke.mjs  (额度默认授权;需打包版 Nomi 关着)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadCatalog() {
  const p = path.join(os.homedir(), 'Library', 'Application Support', 'nomi', 'model-catalog.json')
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}
const isVision = (m) => /vision|multimodal|image[-_]?input|gpt-4o|claude-3|claude-opus-4|claude-sonnet-4|gemini|qwen.*-?vl|pixtral/i.test(JSON.stringify(m))
function pickVision(c) {
  for (const m of c.models || []) {
    if (!m.enabled || !isVision(m)) continue
    const v = (c.vendors || []).find((x) => x.key === (m.vendorKey ?? m.vendor))
    const rec = (c.apiKeysByVendor || {})[m.vendorKey ?? m.vendor]
    if (!v || !rec || !rec.apiKey) continue
    return { modelKey: m.modelKey ?? m.key, root: String(v.baseUrlHint || '').replace(/\/v1\/?$/, '').replace(/\/$/, ''), cipher: rec.apiKey, enc: rec.enc }
  }
  return null
}

function buildPrompt() {
  const rubric = [
    '- identity「身份」：画面主体是否与该镜引用的角色锚一致(脸型/发色/服装)\n    5档：完全一致 ｜ 3档：细节偏 ｜ 1档：明显对不上',
    '- composition「构图」：机位/景别/主体站位是否符合镜头描述\n    5档：完全符合 ｜ 3档：机位偏 ｜ 1档：明显不符',
  ].join('\n')
  return [
    '你是资深影视分镜审片。下面这张图是某镜头实际生成的画面，按 Rubric 逐维度判它该打第几档(1-5)。',
    '镜头：《主角特写》  镜头意图：林小满走进咖啡馆，中景，暖光',
    '该镜设定锚：· 林小满：黑长直、圆脸、白衬衫',
    '这是首镜，不要评 continuity。',
    '<Rubric>', rubric, '</Rubric>',
    '不要调用任何工具，只输出 JSON：{"reason": string, "scores": {"identity": 1-5, "composition": 1-5}}。拿不准给保守(偏低)分。',
  ].join('\n')
}
function parseLoose(text) {
  let s = String(text || '').trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const brace = s.match(/\{[\s\S]*\}/)
  const candidate = brace ? brace[0] : s
  for (const c of [candidate, candidate.replace(/,(\s*[}\]])/g, '$1')]) {
    try { return JSON.parse(c) } catch { /* next */ }
  }
  throw new Error(`非 JSON：${candidate.slice(0, 160)}`)
}

async function main() {
  const cfg = pickVision(loadCatalog())
  if (!cfg) { console.log('❌ 无 enabled 视觉模型(带 key)→ verify 本机降级仅结构校验'); return null }
  console.log('视觉模型:', cfg.modelKey, '@', cfg.root)
  // 不开窗（verify 只要主进程 safeStorage 解密 + fetch）→ waitForWindow:false，否则白等到超时。
  // isolate:false：key 是 safeStorage 加密、绑 app 身份，换隔离 userData 就解不开了。
  const { app } = await launchNomiApp({
    name: 'verify-shot-smoke',
    args: ['--disable-gpu', '--disable-software-rasterizer', '--disable-dev-shm-usage'],
    env: { NOMI_SMOKE_NO_WINDOW: '1' },
    isolate: false,
    waitForWindow: false,
  })
  try {
    // 不开窗:直接在主进程 evaluate 解密 + 抓图 + 调模型。
    const dataUrl = `data:image/png;base64,${fs.readFileSync(path.join(repoRoot, 'icon.png')).toString('base64')}`
    const prompt = buildPrompt()
    const t0 = Date.now()
    const r = await app.evaluate(async ({ safeStorage }, a) => {
      let key = ''
      try { key = a.enc === 'safeStorage' ? safeStorage.decryptString(Buffer.from(a.cipher, 'base64')) : a.cipher } catch (e) { return { error: 'decrypt: ' + String(e) } }
      if (!key) return { error: 'decrypted empty' }
      try {
        const resp = await fetch(`${a.root}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
          body: JSON.stringify({ model: a.modelKey, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: a.prompt }, { type: 'image_url', image_url: { url: a.dataUrl } }] }] }),
        })
        const data = await resp.json()
        return { status: resp.status, content: data?.choices?.[0]?.message?.content ?? '', raw: JSON.stringify(data).slice(0, 200) }
      } catch (e) { return { error: 'fetch: ' + String(e) } }
    }, { cipher: cfg.cipher, enc: cfg.enc, root: cfg.root, modelKey: cfg.modelKey, prompt, dataUrl })
    const ms = Date.now() - t0
    if (r.error) { console.log('❌ 调用失败:', r.error); return false }
    console.log(`\n原始返回(${ms}ms, status ${r.status}):\n`, (r.content || r.raw || '').slice(0, 400))
    const parsed = parseLoose(r.content)
    const ok = parsed?.scores && Number.isFinite(Number(parsed.scores.identity)) && Number.isFinite(Number(parsed.scores.composition))
    console.log('\n解析:', JSON.stringify(parsed))
    console.log(ok ? '✅ 契约通过：可解析 JSON，含 identity/composition 档位' : '❌ 契约失败：JSON 缺 scores 维度')
    return ok
  } finally {
    await app.close().catch(() => {})
  }
}
main().catch((e) => console.error('❌ smoke 失败:', e.message))
