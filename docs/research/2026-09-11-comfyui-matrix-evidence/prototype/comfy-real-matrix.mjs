// 真机 ComfyUI 工作流接入矩阵（2026-09-11，第一次真跑）。
// 纪律：像真人一样只走界面——不预埋 catalog、不灌 store、不发 IPC。
// 产出：docs/research/2026-09-11-comfyui-matrix-evidence/<row>-<step>.png + findings.json
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from '../../../../tests/ux/_launchApp.mjs'
import { screenshotSettled } from '../../../../tests/ux/_assert.mjs'

const EVID = path.join(repoRoot, 'docs/research/2026-09-11-comfyui-matrix-evidence')
const WF = path.join(EVID, 'workflows')
fs.mkdirSync(EVID, { recursive: true })
const findings = []
const note = (row, step, verdict, detail) => {
  const rec = { row, step, verdict, detail }
  findings.push(rec)
  console.log(`[[${row}/${step}]] ${verdict} :: ${typeof detail === 'string' ? detail.slice(0, 2000) : JSON.stringify(detail)}`)
}
const save = () => fs.writeFileSync(path.join(EVID, 'findings.json'), JSON.stringify(findings, null, 2))

const launched = await launchNomiApp({ name: 'comfy-real-matrix', settleMs: 2000 })
const { app, win } = launched
win.setDefaultTimeout(20_000)
const snap = async (name) => { await screenshotSettled(win, { path: path.join(EVID, `${name}.png`) }); console.log(`  shot: ${name}.png`) }
const dump = async (label) => {
  const txt = await win.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n'))
  console.log(`--- DOM(${label}) ---\n${txt.slice(0, 6000)}\n--- /DOM ---`)
  return txt
}
const panelText = async () => win.evaluate(() => {
  const h = [...document.querySelectorAll('*')].find((e) => e.textContent?.trim() === '导入自定义工作流')
  let n = h?.closest('div')
  for (let i = 0; i < 6 && n; i++) { if (n.innerText?.includes('已识别为') || n.innerText?.includes('分析')) break; n = n.parentElement }
  return n?.innerText ?? '(panel not found)'
})

/** 导入一张工作流：粘贴 → 分析 → 记录②③ → 命名 → 导入。 */
async function importWorkflow(row, file, label, { doImport = true } = {}) {
  console.log(`\n######## ${row}: ${label} (${file})`)
  const json = fs.readFileSync(path.join(WF, file), 'utf8')
  const custom = win.getByRole('button', { name: '自定义' }).first()
  if (await custom.isVisible().catch(() => false)) { await custom.click(); await win.waitForTimeout(1200) }
  const ta = win.locator('textarea').first()
  await ta.fill(json)
  await win.waitForTimeout(400)
  await snap(`${row}-01-pasted`)
  await win.getByRole('button', { name: /^分析$/ }).first().click()
  await win.waitForTimeout(10000)
  await snap(`${row}-02-analyzed`)
  const p = await panelText()
  console.log(`--- PANEL(${row}) ---\n${p}\n--- /PANEL ---`)
  note(row, 'step2-inputs', 'panel', p)
  const missing = p.match(/\d+ 个输入引用了本机没有的文件\/选项：[^\n]*/)?.[0] ?? '(no missing-files line)'
  const missingNodes = p.match(/本机 ComfyUI 缺 \d+ 个节点：[^\n]*/)?.[0] ?? '(no missing-nodes line)'
  note(row, 'step3-missing', 'reconcile', { missingFiles: missing, missingNodes })
  if (!doImport) {
    const close = win.locator('[aria-label="收起"], [title="收起"]').first()
    if (await close.isVisible().catch(() => false)) await close.click()
    return { panel: p }
  }
  const nameBox = win.getByPlaceholder(/给它起个名/).first()
  await nameBox.fill(label)
  await win.waitForTimeout(300)
  await win.getByRole('button', { name: /^导入$/ }).first().click()
  await win.waitForTimeout(6000)
  await snap(`${row}-03-import-gate`)
  const gate = await dump(`${row}-import-gate`)
  note(row, 'step4-gate', gate.includes('确认接入并开始验证') ? 'verification-modal' : 'no-modal',
    gate.match(/确认接入并开始验证[\s\S]{0,400}/)?.[0] ?? '')
  const confirm = win.getByRole('button', { name: /^确认验证$/ }).first()
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click()
    await win.waitForTimeout(45000)
    await snap(`${row}-04-verified`)
    const v = await dump(`${row}-verified`)
    note(row, 'step4-run', /验证通过|已启用|可用/.test(v) ? 'verify-pass' : 'verify-unclear',
      v.match(/(验证[^\n]*|失败[^\n]*|错误[^\n]*|已启用[^\n]*)/g)?.slice(0, 6).join(' | ') ?? v.slice(-800))
  }
  const after = await dump(`${row}-after-import`)
  note(row, 'step1-import', after.includes(label) ? 'imported-listed' : 'NOT-LISTED', after.includes(label) ? label : after.slice(-1200))
  // 关掉可能残留的弹层，回到 ComfyUI 卡
  for (const sel of ['button:has-text("关闭")', '[aria-label="关闭"]']) {
    const el = win.locator(sel).first()
    if (await el.isVisible().catch(() => false)) { await el.click().catch(() => {}); await win.waitForTimeout(800) }
  }
  save()
  return { panel: p, after }
}

try {
  await snap('00-launch')
  await win.getByRole('button', { name: '连接模型' }).first().click()
  await win.waitForTimeout(2500)
  await win.getByText('本地 ComfyUI', { exact: true }).first().click()
  await win.waitForTimeout(1500)
  await snap('02-comfy-card')
  await win.getByRole('button', { name: /启用 ComfyUI/ }).first().click()
  await win.waitForTimeout(7000)
  await snap('03-comfy-connected')
  const t3 = await dump('comfy-connected')
  note('env', 'connect', /已连接|0\.35/.test(t3) ? 'connected' : 'submitted-awaiting-verification',
    t3.match(/已提交[^\n]*|已连接[^\n]*/)?.[0] ?? '')

  const only = process.env.ONLY_ROWS ? process.env.ONLY_ROWS.split(',') : null
  const rows = [
    ['row1a', 'row1a-sd15-txt2img-official-verbatim-api.json', 'R1a 官方原文 文生图'],
    ['row4b', 'row4b-negative-control-missing-files.json', 'R4b 缺件负向对照'],
    ['row7a', 'row7-kjnodes-api.json', 'R7a KJNodes 装之前'],
    ['row7b', 'row7-kjnodes-api.json', 'R7b KJNodes 装之后'],
    ['row1b', 'row1b-sd15-txt2img-ckpt-corrected-api.json', 'R1 SD15 文生图'],
    ['row2', 'row2-sd15-img2img-api.json', 'R2 SD15 图生图'],
    ['row3', 'row3-sd15-lora-api.json', 'R3 SD15 加LoRA'],
    ['row4', 'row4-upscale-esrgan-api.json', 'R4 放大 ESRGAN'],
    ['row5', 'row5-video-gan-upscaler-localfiles-api.json', 'R5 视频无模型链'],
    ['row5ui', 'row5-gan-upscaler-UIFORMAT.json', 'R5UI 视频链 界面格式'],
    ['row6', 'row6-flux-dev-official-api.json', 'R6 Flux 缺件专测'],
    ['row6ui', 'row6-flux-dev-official-UIFORMAT.json', 'R6UI Flux 界面格式'],
    ...(process.env.ROW7 ? [['row7', process.env.ROW7, 'R7 自定义节点包']] : []),
  ]
  for (const [r, f, l] of rows.filter(([r]) => !only || only.includes(r))) {
    try { await importWorkflow(r, f, l, { doImport: false }) }
    catch (e) { note(r, 'row-error', 'exception', String(e).slice(0, 400)); await snap(`${r}-zz-error`).catch(() => {}) }
  }

  await snap('04-all-imported')
  await dump('all-imported')
} catch (e) {
  console.error('WALK FAILED', e)
  note('fatal', 'error', 'exception', String(e?.stack ?? e))
  await snap('zz-error').catch(() => {})
}

save()
console.log('EVIDENCE_DIR=' + EVID)
await app.close().catch(() => {})
