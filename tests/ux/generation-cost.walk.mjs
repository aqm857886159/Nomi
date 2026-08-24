// 真实用户任务走查：同一生成节点在「目录有积分价」与「目录无积分价」两种现场的交互边界。
// 只验证展示，不点击生成，不上传素材，不花额度。
import { launchNomiApp } from './_launchApp.mjs'
import { expectAbsent, expectText, expectVisible, proveProbe } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MODEL_KEY = 'cost-walk-image'
const VENDOR_KEY = 'cost-walk'
const MODEL_LABEL = '成本估算走查模型'

function seedFixture(tempRoot, { pricing }) {
  const settingsDir = path.join(tempRoot, 'settings')
  const projectsDir = path.join(tempRoot, 'projects')
  fs.mkdirSync(settingsDir, { recursive: true })
  fs.mkdirSync(projectsDir, { recursive: true })
  const now = '2026-08-25T00:00:00.000Z'
  const model = {
    vendorKey: VENDOR_KEY,
    modelKey: MODEL_KEY,
    labelZh: MODEL_LABEL,
    kind: 'image',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    meta: { adapter: { state: 'verified', runId: 'cost-walk' } },
  }
  if (pricing) {
    model.pricing = { cost: 8.52, enabled: true, specCosts: [] }
  }
  fs.writeFileSync(
    path.join(settingsDir, 'model-catalog.json'),
    JSON.stringify({
      version: 1,
      vendors: [{
        key: VENDOR_KEY,
        name: '成本估算走查供应商',
        enabled: true,
        baseUrlHint: 'https://cost-walk.example/v1',
        authType: 'none',
        providerKind: 'openai-compatible',
        meta: {},
        createdAt: now,
        updatedAt: now,
      }],
      models: [model],
      mappings: [],
    }, null, 2),
  )
  const projectId = `cost-walk-${pricing ? 'known' : 'unknown'}`
  const projectDir = path.join(projectsDir, `cost-${projectId}`)
  fs.mkdirSync(projectDir, { recursive: true })
  fs.writeFileSync(
    path.join(projectDir, 'project.json'),
    JSON.stringify({
      id: projectId,
      name: pricing ? '积分估算：有价格' : '积分估算：无价格',
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      savedAt: 1,
      revision: 1,
      lastKnownRootPath: projectDir,
      payload: {
        workbenchDocument: { version: 1, title: '积分估算走查', updatedAt: 1, contentJson: { type: 'doc', content: [] } },
        timeline: null,
        generationCanvas: {
          nodes: [{
            id: 'cost-node',
            kind: 'image',
            title: '成本估算镜头',
            position: { x: 80, y: 80 },
            categoryId: 'shots',
            shotIndex: 1,
            meta: {
              modelKey: MODEL_KEY,
              modelAlias: MODEL_KEY,
              modelVendor: VENDOR_KEY,
              vendor: VENDOR_KEY,
              modelLabel: MODEL_LABEL,
            },
          }],
          edges: [],
          selectedNodeIds: [],
          groups: [],
        },
        storyboardPlan: null,
        storyboardPlanCommitted: false,
      },
    }, null, 2),
  )
  return { settingsDir, projectsDir, projectName: pricing ? '积分估算：有价格' : '积分估算：无价格' }
}

async function runCase({ pricing }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-generation-cost-'))
  const fixture = seedFixture(tempRoot, { pricing })
  const shotsDir = path.join(tempRoot, 'shots')
  fs.mkdirSync(shotsDir, { recursive: true })
  const { app, win } = await launchNomiApp({
    name: `generation-cost-${pricing ? 'known' : 'unknown'}`,
    tempRoot,
    settingsDir: fixture.settingsDir,
    projectsDir: fixture.projectsDir,
    settleMs: 1200,
  })
  try {
    await win.evaluate(() => {
      for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
        localStorage.setItem(key, 'seen')
      }
    })
    await win.reload()
    await win.waitForLoadState('domcontentloaded')
    const card = win.locator('[data-project-card]', { hasText: fixture.projectName }).first()
    await expectVisible(card, `项目库里找不到「${fixture.projectName}」`)
    const continueButton = card.getByText('继续创作', { exact: false }).first()
    if (await continueButton.isVisible().catch(() => false)) await continueButton.click()
    else await card.dblclick()
    const generationNav = win.getByRole('button', { name: '生成', exact: true })
    await expectVisible(generationNav, '打开项目后没等到「生成」导航')
    await generationNav.click()
    const batchDock = win.locator('[data-batch-dock="true"]').first()
    await expectVisible(batchDock, '生成画布里没渲染批量生成栏')
    const batchEstimate = batchDock.locator('[data-batch-cost-estimate]')
    if (pricing) {
      await expectVisible(batchEstimate, '有目录价格时批量生成栏没有显示估算积分')
      await expectText(batchEstimate, /约 8\.52 积分|About 8\.52 credits/, '批量估算积分文案不正确')
    } else {
      const batchProof = await proveProbe(batchDock, '无价格场景的批量生成栏探针可用')
      await expectAbsent(batchEstimate, {
        provenBy: batchProof,
        message: '目录没有积分计算时批量生成栏不应出现成本组件',
      })
    }
    const node = win.locator('[data-node-id="cost-node"]').first()
    await expectVisible(node, '生成画布里没渲染成本估算节点')
    await node.click()
    const composer = win.locator('.generation-canvas-v2-node__composer-card').first()
    await expectVisible(composer, '生成画布里没渲染成本估算节点')
    const estimate = composer.locator('[data-cost-estimate]')
    if (pricing) {
      await expectVisible(estimate, '有目录价格时没有显示估算积分')
      await expectText(estimate, /约 8\.52 积分|About 8\.52 credits/, '估算积分文案不正确')
      await win.screenshot({ path: path.join(shotsDir, 'known-cost.png') })
      console.log(`  ✓ 有目录价格：显示 ${await estimate.innerText()}；截图 ${path.join(shotsDir, 'known-cost.png')}`)
    } else {
      const composerProof = await proveProbe(composer, '无价格场景的生成卡探针可用')
      await expectAbsent(estimate, {
        provenBy: composerProof,
        message: '目录没有积分计算时不应出现成本组件',
      })
      await win.screenshot({ path: path.join(shotsDir, 'unknown-cost.png') })
      console.log(`  ✓ 无目录价格：成本组件隐藏；截图 ${path.join(shotsDir, 'unknown-cost.png')}`)
    }
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 5000))])
  }
}

await runCase({ pricing: true })
await runCase({ pricing: false })
console.log('GENERATION COST WALK PASS: known + unknown conditional UI')
