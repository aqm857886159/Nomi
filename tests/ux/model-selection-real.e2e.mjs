// 目录模型选择走查：验证创作助手和生成节点都保留模型入口，且选中的身份来自 catalog。
// 不发生成请求、不消耗额度；fixture 使用已知 provider 的模型 id（DeepSeek V4 Pro / GPT-5.2 /
// GPT Image 2 / Nano Banana），只验证 catalog 身份、退役项清理、选择和持久化。
import { launchNomiApp } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-model-selection-'))
const userDataDir = path.join(tempRoot, 'user-data')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [userDataDir, settingsDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const NOW = '2026-08-13T00:00:00.000Z'
const VENDOR = 'e2e-real-catalog'
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 8,
  vendors: [
    {
      key: VENDOR,
      name: 'E2E 真实目录',
      enabled: true,
      authType: 'none',
      baseUrlHint: null,
      authHeader: null,
      authQueryParam: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    // 迁移回归：旧装机可能仍有这条 APIMart 记录；启动 seed 必须精确摘掉它，不能靠“fixture 没有”通过。
    {
      key: 'apimart',
      name: 'APIMart',
      enabled: true,
      authType: 'none',
      baseUrlHint: null,
      authHeader: null,
      authQueryParam: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  models: [
    { modelKey: 'deepseek-v4-pro', vendorKey: VENDOR, labelZh: 'DeepSeek V4 Pro（目录）', kind: 'text', enabled: true, createdAt: NOW, updatedAt: NOW },
    { modelKey: 'gpt-5.2', vendorKey: VENDOR, labelZh: 'GPT-5.2（目录）', kind: 'text', enabled: true, createdAt: NOW, updatedAt: NOW },
    { modelKey: 'prompt-refiner', vendorKey: VENDOR, labelZh: '仅提示词增强（不可对话）', kind: 'text', enabled: true, meta: { promptRefineOnly: true }, createdAt: NOW, updatedAt: NOW },
    { modelKey: 'gpt-image-2', vendorKey: VENDOR, labelZh: 'GPT Image 2（目录）', kind: 'image', enabled: true, createdAt: NOW, updatedAt: NOW },
    { modelKey: 'nano-banana', vendorKey: VENDOR, labelZh: 'Nano Banana（目录）', kind: 'image', enabled: true, createdAt: NOW, updatedAt: NOW },
    { modelKey: 'deepseek-v3.1-250821', vendorKey: 'apimart', labelZh: 'DeepSeek V3.1（旧记录）', kind: 'text', enabled: true, createdAt: NOW, updatedAt: NOW },
  ],
  mappings: [],
  apiKeysByVendor: {},
}, null, 2))

function assert(condition, message, detail = '') {
  if (!condition) throw new Error(`MODEL SELECTION FAIL: ${message}${detail ? ` — ${detail}` : ''}`)
  console.log(`  ✓ ${message}`)
}

async function dismissFirstRun(win) {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi-onboarding-checklist:v1']) {
      window.localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await win.waitForTimeout(1000)
  for (let i = 0; i < 5; i += 1) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成|先逛逛/ }).first()
    if (await skip.count()) await skip.click({ timeout: 800 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(200)
  }
}

function findProjectJson(root) {
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name === 'project.json' && full.includes(`${path.sep}.nomi${path.sep}`)) return full
    }
  }
  return null
}

const { app, win } = await launchNomiApp({
  name: 'model-selection-real',
  userDataDir,
  settingsDir,
  projectsDir,
  settleMs: 1200,
})

try {
  await dismissFirstRun(win)

  const catalog = await win.evaluate(() => {
    const mc = window.nomiDesktop.modelCatalog
    const vendors = mc.listVendors()
    const models = mc.listModels({ enabled: true })
    const availableVendorKeys = new Set(vendors
      .filter((vendor) => vendor.enabled && (vendor.authType === 'none' || vendor.hasApiKey === true))
      .map((vendor) => String(vendor.key).toLowerCase()))
    const available = models.filter((model) => availableVendorKeys.has(String(model.vendorKey).toLowerCase()))
    return {
      hasRetiredApimartV31: models.some((model) => model.vendorKey === 'apimart' && model.modelKey === 'deepseek-v3.1-250821'),
      text: available.filter((model) => model.kind === 'text').map((model) => ({ vendorKey: model.vendorKey, modelKey: model.modelKey, labelZh: model.labelZh })),
      image: available.filter((model) => model.kind === 'image').map((model) => ({ vendorKey: model.vendorKey, modelKey: model.modelKey, labelZh: model.labelZh })),
    }
  })
  assert(!catalog.hasRetiredApimartV31, 'APIMart 退役 DeepSeek V3.1 250821 不进入真实 catalog')
  assert(catalog.text.some((model) => model.modelKey === 'deepseek-v4-pro'), '真实文本模型 DeepSeek V4 Pro 在 catalog')
  assert(catalog.image.some((model) => model.modelKey === 'nano-banana'), '真实图片模型 Nano Banana 在 catalog')

  await win.getByText('新建空白项目', { exact: false }).first().click({ timeout: 5000 })
  await win.waitForTimeout(2000)

  // 创作助手：模型入口必须存在，并且选择后写入完整 (vendorKey, modelKey) 偏好。
  const assistantPicker = win.locator('button[aria-label="助手模型"]').first()
  await assistantPicker.waitFor({ state: 'visible', timeout: 5000 })
  await assistantPicker.click()
  const assistantOptionTexts = await win.getByRole('option').allTextContents()
  assert(assistantOptionTexts.some((text) => text.includes('GPT-5.2（目录）')), '助手下拉展示 catalog 中的真实 GPT-5.2')
  assert(assistantOptionTexts.some((text) => /DeepSeek V4 Pro/i.test(text)), '助手下拉展示当前 APIMart DeepSeek V4 Pro')
  assert(!assistantOptionTexts.some((text) => text.includes('仅提示词增强')), '提示词增强专用模型不出现在通用助手下拉')
  await win.getByRole('option', { name: /GPT-5\.2（目录）/ }).click()
  await win.waitForTimeout(300)
  const assistantPref = await win.evaluate(() => JSON.parse(window.localStorage.getItem('nomi.assistantModel') || 'null'))
  assert(assistantPref?.vendorKey === VENDOR && assistantPref?.modelKey === 'gpt-5.2', '创作助手选择真实 GPT-5.2 并保存供应商身份', JSON.stringify(assistantPref))

  await win.getByRole('button', { name: '生成', exact: false }).first().click()
  await win.waitForTimeout(800)
  await addCanvasNodeFromRail(win, 'image')
  const composer = win.locator('.generation-canvas-v2-node__composer-card').last()
  await composer.waitFor({ timeout: 5000 })
  const modelButton = composer.locator('button[aria-label="模型"]').first()
  await modelButton.waitFor({ state: 'visible', timeout: 5000 })
  await modelButton.click()
  await win.getByRole('option', { name: /Nano Banana（目录）/ }).click()
  await win.waitForTimeout(800)
  assert((await modelButton.textContent()).includes('Nano Banana（目录）'), '生成节点可切换到真实 Nano Banana')

  const projectFile = findProjectJson(projectsDir)
  assert(Boolean(projectFile), '模型切换触发项目持久化')
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
  const imageNode = project.payload.generationCanvas.nodes.find((node) => node.kind === 'image')
  assert(
    imageNode?.meta?.modelKey === 'nano-banana'
      && (imageNode?.meta?.modelVendor === VENDOR || imageNode?.meta?.vendor === VENDOR)
      && catalog.image.some((model) => model.vendorKey === VENDOR && model.modelKey === imageNode.meta.modelKey),
    '持久化节点保存 catalog 中真实的 (vendorKey, modelKey)，而不是展示文案',
    JSON.stringify(imageNode?.meta),
  )

  console.log('\nMODEL SELECTION PASS: catalog → assistant → canvas → project persistence')
} finally {
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 3000))])
}
