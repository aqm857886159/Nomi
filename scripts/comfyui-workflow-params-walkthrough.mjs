import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查：PR#55 ComfyUI 自定义工作流「生成时可调参数」。
// 路径：模型接入 → 本地 ComfyUI（mock 探测）→ 导入自定义工作流 → 贴 LTX 常量节点形态 JSON →
// 分析 → 参数区（空态+常用 chips）→ 一键加 宽/高/秒/帧率 → 添加参数/删除参数 → 导入 →
// 铅笔重开编辑验参数持久化。截图人眼判断。
// 用法：node scripts/comfyui-workflow-params-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.comfyui-workflow-params-walk')
mkdirSync(outDir, { recursive: true })
const settingsDir = makeTempDir('comfyui-params-walk-')
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

// LTX 2.3 常量节点形态（同 comfyuiWorkflowImport.test.ts 固件）：宽高/秒数/帧率藏在常量节点 value。
const LTX_GRAPH = JSON.stringify({
  108: { class_type: 'LTXVImgToVideo', inputs: { width: ['292', 0], height: ['293', 0], length: ['287', 0], positive: ['110', 0], image: ['200', 0] } },
  110: { class_type: 'CLIPTextEncode', inputs: { text: 'default prompt', clip: ['111', 0] } },
  // 第二个文本节点：让「用户自己改提示词绑定」那一步真的有得选（场景⑥的前提）。
  109: { class_type: 'CLIPTextEncode', inputs: { text: 'a second text encode', clip: ['111', 0] } },
  111: { class_type: 'CLIPLoader', inputs: { clip_name: 't5xxl_fp16.safetensors' } },
  200: { class_type: 'LoadImage', inputs: { image: 'start.png' } },
  285: { class_type: 'PrimitiveFloat', _meta: { title: 'FPS' }, inputs: { value: 24 } },
  287: { class_type: 'SimpleCalculatorKJ', inputs: { a: ['291', 0], b: ['285', 0], operation: 'multiply' } },
  291: { class_type: 'INTConstant', _meta: { title: 'LENGTH (in seconds)' }, inputs: { value: 5 } },
  292: { class_type: 'INTConstant', _meta: { title: 'WIDTH' }, inputs: { value: 960 } },
  293: { class_type: 'INTConstant', _meta: { title: 'HEIGHT' }, inputs: { value: 544 } },
  300: { class_type: 'SaveVideo', inputs: { video: ['108', 0], filename_prefix: 'ltx' } },
})

const mock = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/system_stats')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ system: { os: 'posix', python_version: '3.11.9', comfyui_version: '0.3.30' }, devices: [{ name: 'cuda:0', type: 'cuda', vram_total: 1 }] }))
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => mock.listen(8188, '127.0.0.1', r))

const projectsDir = makeTempDir('comfyui-params-proj-')
const { app, win } = await launchNomiApp({
  name: 'comfyui-workflow-params',
  settingsDir,
  projectsDir,
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settleMs: 1800,
})
const errors = []
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await win.getByRole('button', { name: '接入模型', exact: false }).first().click()
  await win.waitForTimeout(1000)
  await win.getByText('有本地 ComfyUI', { exact: false }).first().click()
  await win.waitForTimeout(500)
  await win.getByText('本地 ComfyUI', { exact: true }).first().click()
  await win.waitForTimeout(400)
  await win.getByRole('button', { name: '启用 ComfyUI', exact: false }).first().click()
  await win.waitForTimeout(2200)
  await win.getByText('本地 ComfyUI', { exact: true }).first().click()
  await win.waitForTimeout(600)

  // 导入自定义工作流 → 贴 JSON → 分析
  await win.getByRole('button', { name: '导入自定义工作流', exact: false }).first().click()
  await win.waitForTimeout(400)
  await win.getByRole('textbox', { name: 'ComfyUI 工作流 JSON' }).fill(LTX_GRAPH)
  await win.getByRole('button', { name: '分析工作流', exact: true }).click()
  await win.waitForTimeout(700)
  await win.getByText('生成时可调参数', { exact: true }).scrollIntoViewIfNeeded()
  await shot(win, '01-params-empty-with-presets.png') // 验：参数区空态提示 + 常用 chips（宽/高/秒/帧率可点）

  // 一键加四个常用参数
  for (const label of ['宽度', '高度', '秒数', '帧率']) {
    await win.getByRole('button', { name: label, exact: true }).click()
    await win.waitForTimeout(150)
  }
  await win.getByText('生成时可调参数', { exact: true }).scrollIntoViewIfNeeded()
  await shot(win, '02-four-preset-params.png') // 验：4 行参数（节点选择器/类型/显示名/删除钮），chips 变灰

  // 添加参数（自动挑第一个未用候选）→ 再删掉
  await win.getByRole('button', { name: '添加参数', exact: true }).click()
  await win.waitForTimeout(300)
  await shot(win, '03-add-free-param.png') // 验：第 5 行出现（任意标量候选）
  const removeButtons = win.getByRole('button', { name: '删除参数', exact: true })
  await removeButtons.last().click()
  await win.waitForTimeout(300)

  // 命名 + 导入
  await win.getByPlaceholder('给它起个名', { exact: false }).fill('LTX 常量参数走查')
  await win.getByRole('button', { name: '导入', exact: true }).click()
  await win.waitForTimeout(1200)
  await shot(win, '04-imported-model-row.png') // 验：模型行出现 + 成功 toast

  // 铅笔重开编辑（hover 才显形）：先等成功 toast 消退——toast 文本含模型名，会抢走 getByText.first()
  await win.waitForTimeout(3500)
  // 导入后卡会重挂、默认收起（工作流行随之藏起来）→ 先展开，否则 hover 不到那一行。
  const card = win.getByText('本地 ComfyUI', { exact: true }).first()
  if (!(await win.getByText('LTX 常量参数走查', { exact: false }).first().isVisible().catch(() => false))) {
    await card.click()
    await win.waitForTimeout(600)
  }
  await win.getByText('LTX 常量参数走查', { exact: false }).first().hover()
  await win.waitForTimeout(300)
  await win.getByRole('button', { name: '编辑工作流 LTX 常量参数走查', exact: false }).first().click()
  await win.waitForTimeout(700)
  await win.getByText('生成时可调参数', { exact: true }).scrollIntoViewIfNeeded()
  await shot(win, '05-edit-mode-params-persisted.png') // 验：编辑态 4 行参数原样回来（宽/高/秒/帧率）

  // ── ⑥ 提示词节点不许出现在参数候选里，且**跟着用户改的绑定走**（2026-08-11 反馈的根因）──
  // 自动建议把 #110 选成提示词（108.positive 指向它）。那 #110 就不该再出现在参数下拉里；
  // 用户改选 #109 之后，#110 必须回到候选、#109 退出去。钉死在分析那一刻就是原来那个 bug。
  // ⚠️ 收下拉别按 Escape：那会把整张「模型设置」浮卡一起关掉（走查栽过）。再点一次触发器即可。
  // 截图必须在下拉**展开时**拍——要人眼看的就是候选清单本身。
  const paramNodeOptions = async (shotName) => {
    const trigger = win.getByRole('button', { name: '参数绑定节点', exact: false }).first()
    await trigger.click()
    await win.waitForTimeout(350)
    const text = await win.getByRole('listbox').first().innerText()
    await shot(win, shotName)
    await trigger.click()
    await win.waitForTimeout(250)
    return text
  }
  await win.getByRole('button', { name: '添加参数', exact: true }).click()
  await win.waitForTimeout(300)
  // 验：下拉里没有 #110（它是提示词），有 #109
  let options = await paramNodeOptions('06-param-options-exclude-prompt.png')
  if (options.includes('#110')) throw new Error('提示词节点 #110 仍出现在可调参数候选里')
  if (!options.includes('#109')) throw new Error('非提示词的文本节点 #109 反而不在候选里')

  // 用户改提示词绑定：#110 → #109
  await win.getByRole('button', { name: '提示词节点', exact: false }).first().click()
  await win.waitForTimeout(350)
  await win.getByRole('option', { name: '#109', exact: false }).first().click()
  await win.waitForTimeout(400)
  // 验：换过来了——有 #110、没 #109
  options = await paramNodeOptions('07-param-options-follow-rebind.png')
  if (options.includes('#109')) throw new Error('改绑后新提示词节点 #109 仍留在参数候选里（候选池没跟着绑定走）')
  if (!options.includes('#110')) throw new Error('改绑后原提示词节点 #110 没回到参数候选（候选池被钉死在自动建议上）')
  console.log('  参数候选跟着提示词绑定实时变: ✓')

  console.log(errors.length ? ('  ⚠️ console/page errors:\n' + errors.slice(0, 8).join('\n')) : '  ✅ 无 console/page error')
} catch (e) {
  console.error('  ❌ 走查失败：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close()
  mock.close()
}
