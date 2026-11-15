// APIMart 线路走查的「用户动作」唯一一份：零额度走查（apimart-domestic-line-walkthrough.mjs）和真实付费核对
// （apimart-domestic-line-paid.mjs）点的是同一套按钮，所以动作只写在这里，两边各自只管自己的判据与护栏。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 主进程网络模拟 / 记账（主入口之前装上；见文件头）。 */
export const NETSIM = path.join(repoRoot, 'scripts', 'apimart-line-netsim.cjs')
export const PRIMARY = 'https://api.apimart.ai'
export const DOMESTIC = 'https://api.apib.ai'

/** 界面文案（两种语言只在这一处）。 */
export const UI = {
  'zh-CN': {
    settings: '设置', models: '模型', back: '返回', saveVerify: '保存验证', editAddress: '编辑 APIMart 接入地址',
    invalidAddress: '接入地址需以 http(s):// 开头。', unreachable: '连不上这个地址：', nextStep: '下一步：',
    newBlank: '新建空白项目', workspace: '工作区切换', generateTab: '生成', addImageNode: '添加图片节点', model: '模型', generateAsset: '生成素材', confirm: '生成',
  },
  en: {
    settings: 'Settings', models: 'Models', back: 'Back', saveVerify: 'Save Verify', editAddress: 'Edit APIMart connection address',
    invalidAddress: 'The connection address must start with http(s)://.', unreachable: "Can't reach this address:", nextStep: 'Next:',
    newBlank: 'New blank project', workspace: 'Switch workspace', generateTab: 'Generate', addImageNode: 'Add Image node', model: 'Model', generateAsset: 'Generate asset', confirm: 'Generate',
  },
}

/** `--packaged <Nomi 可执行文件>`：从参数表里取出来（并删掉这两项），没给就是空串 = 开发构建。 */
export function takePackagedFlag(argv) {
  const at = argv.indexOf('--packaged')
  if (at < 0) return ''
  const exe = path.resolve(argv[at + 1] ?? '')
  if (!argv[at + 1] || !fs.existsSync(exe)) throw new Error(`--packaged needs an existing Nomi executable, got: ${argv[at + 1] ?? '(nothing)'}`)
  argv.splice(at, 2)
  return exe
}

/** 网络账本（JSONL）。 */
export function netLog(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

/** 轮询到 check() 给出真值为止（给出的值原样返回）；超时返回 undefined，由调用方照实记。 */
export async function until(win, check, timeout = 90_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await check()
    if (value || Date.now() > deadline) return value || undefined
    await win.waitForTimeout(400)
  }
}

export async function openModels(win, t) {
  await win.getByRole('button', { name: t.settings, exact: true }).first().click()
  await win.getByRole('dialog', { name: t.settings }).getByRole('button', { name: t.models, exact: true }).click()
  await win.waitForSelector('[data-settings-section="models"]')
}

/** 地址行：点「修改」→ 填 → 保存。返回保存后那一行下面的报错（没有就是空串）。 */
export async function saveAddress(win, t, address) {
  await win.getByRole('button', { name: t.editAddress }).click()
  const field = win.locator('[data-model-connection-field="baseUrl"]')
  await field.fill(address)
  await win.locator('[data-model-connection-save="baseUrl"]').click()
  await win.waitForTimeout(700)
  return (await win.locator('[data-model-connection-field="baseUrl"]').count())
    ? (await field.locator('xpath=../..').innerText()).trim()
    : ''
}

/** 编辑态里的「取消」（VendorBaseUrlField 给它挂了 data-model-connection-edit）。按 Esc 会连设置窗一起关掉。 */
export async function cancelAddressEdit(win) {
  await win.locator('[data-model-connection-edit="baseUrl"]').click()
}

/** 关掉设置窗（Esc 一次退一层：连接页 → 模型首页 → 关窗）。 */
export async function closeSettings(win) {
  for (let i = 0; i < 4 && await win.locator('[data-settings-overlay]').count(); i += 1) {
    await win.keyboard.press('Escape')
    await win.waitForTimeout(300)
  }
  if (await win.locator('[data-settings-overlay]').count()) throw new Error('settings dialog did not close')
}

export async function modelsSectionText(win) {
  return win.locator('[data-settings-section="models"]').innerText()
}

/** 连接卡右上角的体检结论（ModelConnection 的四态；「检查中…」之外的三态才算落定）。 */
export const HEALTH_BADGE = { checking: /检查中…|Checking…/, settled: /已连通|连不上|已保存|Connected|Unreachable|Saved/ }

/** 等连接卡上的体检结论落定（体检是打开卡片后才发的一次异步请求）；落定了返回 true。 */
export async function healthSettled(win, timeout = 15_000) {
  return Boolean(await until(win, async () => {
    const text = await modelsSectionText(win)
    return !HEALTH_BADGE.checking.test(text) && HEALTH_BADGE.settled.test(text)
  }, timeout))
}

/**
 * 画布上生成一张：新建空白项目 → 生成 → 加图片节点 → 写提示词 → 选模型 → 生成素材（弹确认就点「生成」），
 * 一直等到节点里那张图真的解码出来（不是占位）——截图要拍得到结果。
 */
export async function generateOnce(win, t, { model = /GPT Image 2(?!\.)/, prompt = '一只棕灰色短毛猫侧身蜷卧在浅灰色平面上', timeout = 60_000 } = {}) {
  await win.getByText(t.newBlank, { exact: false }).first().click()
  await win.locator(`[aria-label="${t.workspace}"]`).getByText(t.generateTab, { exact: true }).click()
  await win.locator(`[aria-label="${t.addImageNode}"]`).first().click()
  // 新节点的提示词框挂在画布浮框里，出现前 contenteditable 的最后一个是创作区那块（不可见）。
  await win.locator('[data-node-id]').first().waitFor()
  await win.waitForTimeout(1200)
  await win.locator('div[contenteditable="true"]').last().click()
  await win.keyboard.type(prompt, { delay: 8 })
  await win.locator(`[aria-label="${t.model}"]`).first().click()
  await win.getByRole('option', { name: model }).first().click()
  await win.locator(`[aria-label="${t.generateAsset}"]`).first().click()
  const confirm = win.locator('[data-spend-confirm-dialog]').last().getByRole('button', { name: t.confirm, exact: true })
  if (await confirm.count()) await confirm.first().click()
  await win.waitForFunction(() => [...document.querySelectorAll('[data-node-id] img')]
    .some((img) => img.complete && img.naturalWidth > 200), undefined, { timeout })
  await win.waitForTimeout(800)
}
