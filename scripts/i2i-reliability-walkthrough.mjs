// R13 真机走查：图生图可靠性三层修复（docs/plan/2026-07-06-i2i-reference-reliability.md）。
// A（存量自愈）：种一份 v4 catalog（老中转 image 条目：size/quality/n + 只有 t2i mapping）→ 启动
//    → 断言磁盘 catalog 升到 v5 且补了 image_edit mapping + supportsReferenceImages + 比例/清晰度
//    → UI 上该模型的参考槽 + 清晰度真的出现（此前根本不渲染）。
// B（诚实护栏 + chip 失效态）：kie GPT Image 2 切「图生图」零参考 → 生成钮禁用 + 人话 tooltip；
//    上传一张参考后删掉底层文件 → chip 显示「图已失效」。
// 截图人眼判断。用法：node scripts/i2i-reliability-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { addCanvasNodeFromRail } from '../tests/ux/_canvasRail.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.i2i-reliability-lab')
fs.mkdirSync(outDir, { recursive: true })

const NOW = new Date().toISOString()
// 1x1 png
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==', 'base64')

/** v4 catalog：8c711f0c 之前接入的中转 image 条目（无 image_edit / 无 supportsReferenceImages / 老 size 参数）。 */
function legacyCatalogFixture() {
  return {
    version: 4,
    vendors: [{
      key: 'yunwu-ai', name: '云雾中转', enabled: true, hasApiKey: true,
      baseUrlHint: 'https://yunwu.example.com', authType: 'bearer', authHeader: null, authQueryParam: null,
      providerKind: 'openai-compatible', createdAt: NOW, updatedAt: NOW,
    }],
    models: [{
      modelKey: 'my-relay-image-xl', vendorKey: 'yunwu-ai', modelAlias: 'my-relay-image-xl',
      labelZh: '云雾图像 XL', kind: 'image', enabled: true,
      meta: {
        parameters: [
          { key: 'size', label: '尺寸', type: 'select', options: [{ value: '1024x1024', label: '1024x1024' }] },
          { key: 'quality', label: '质量', type: 'select', options: [{ value: 'standard', label: 'standard' }] },
          { key: 'n', label: '张数', type: 'number' },
        ],
      },
      onboarding: { addedVia: 'manual', trialId: '', docsUrl: '', addedAt: NOW, fields: [] },
      createdAt: NOW, updatedAt: NOW,
    }],
    mappings: [{
      id: 'mapping-legacy-t2i', vendorKey: 'yunwu-ai', taskKind: 'text_to_image', name: '文生图', enabled: true,
      create: {
        method: 'POST', path: '/v1/images/generations',
        headers: { Authorization: 'Bearer {{user_api_key}}', 'Content-Type': 'application/json' },
        body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', size: '{{request.params.size}}', n: '{{request.params.n}}', response_format: 'url' },
        response_mapping: { image_url: 'data[*].url' },
      },
      createdAt: NOW, updatedAt: NOW,
    }],
    apiKeysByVendor: {
      'yunwu-ai': { apiKey: 'sk-walkthrough-fake', vendorKey: 'yunwu-ai', enabled: true, enc: 'plain', createdAt: NOW, updatedAt: NOW },
    },
  }
}

function prepDirs(tag, withKieKey) {
  const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), `i2i-walk-${tag}-settings-`))
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), `i2i-walk-${tag}-projects-`))
  const fixture = legacyCatalogFixture()
  if (withKieKey) fixture.apiKeysByVendor.kie = { apiKey: 'sk-kie-walkthrough-fake', vendorKey: 'kie', enabled: true, enc: 'plain', createdAt: NOW, updatedAt: NOW }
  fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify(fixture, null, 2))
  return { settingsDir, projectsDir }
}

async function launch(dirs) {
  return launchNomiApp({
    name: 'i2i-reliability',
    env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
    settingsDir: dirs.settingsDir,
    projectsDir: dirs.projectsDir,
    settleMs: 0, // openBlankProjectWithImageNode 内部自己等 domcontentloaded + 2000ms
  })
}

const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

async function openBlankProjectWithImageNode(win) {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2000)
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2600)
  // 关掉可能悬着的「上手清单」弹层，再切到「生成」页（画布工具栏在生成画布，不在创作页）。
  await win.keyboard.press('Escape')
  await win.waitForTimeout(300)
  await win.getByText('生成', { exact: true }).first().click()
  await win.waitForTimeout(1500)
  // 左缘点法收口在 ../tests/ux/_canvasRail.mjs：结构锚点，不认走 i18n 的 aria-label，找不到当场抛。
  await addCanvasNodeFromRail(win, 'image')
  await win.waitForTimeout(900)
  const node = win.locator('[data-kind="image"][data-node-id]').first()
  await node.waitFor({ timeout: 8000 })
  await node.click({ position: { x: 40, y: 40 } })
  await win.waitForTimeout(1400)
  return node
}

const errors = []
let failed = false

// ── A：存量自愈（catalog v4 → v5 + UI 出参考槽/清晰度）────────────────────────────────
{
  console.log('▶ A 存量中转自愈')
  const dirs = prepDirs('a', false)
  const { app, win } = await launch(dirs)
  try {
    const bw = await app.browserWindow(win)
    await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })).catch(() => {})
    win.on('pageerror', (e) => errors.push('A ' + String(e)))
    win.on('console', (m) => { if (m.type() === 'error') errors.push('A ' + m.text()) })

    await openBlankProjectWithImageNode(win)

    // 磁盘断言：启动时 readCatalog 已把 v4 迁到 v5 并补齐能力。
    const migrated = JSON.parse(fs.readFileSync(path.join(dirs.settingsDir, 'model-catalog.json'), 'utf8'))
    const edit = (migrated.mappings || []).find((m) => m.vendorKey === 'yunwu-ai' && m.taskKind === 'image_edit')
    const model = (migrated.models || []).find((m) => m.vendorKey === 'yunwu-ai')
    const paramKeys = (model?.meta?.parameters || []).map((p) => p.key)
    const okVersion = migrated.version === 5
    const okEdit = Boolean(edit && edit.create?.path === '/v1/chat/completions')
    const okFlag = model?.meta?.imageOptions?.supportsReferenceImages === true
    const okParams = paramKeys.includes('aspect_ratio') && paramKeys.includes('resolution') && !paramKeys.includes('size')
    console.log(`  磁盘迁移: version=${migrated.version} image_edit=${okEdit} supportsReferenceImages=${okFlag} 参数升级=${okParams} (keys=${paramKeys.join(',')})`)
    if (!(okVersion && okEdit && okFlag && okParams)) { failed = true; console.error('  ❌ v4→v5 迁移断言失败') }

    // 显式切到云雾中转模型（auto-select 可能选了内置即梦）。
    const modelTriggerA = win.locator('button[aria-label="模型"]').first()
    await modelTriggerA.waitFor({ timeout: 8000 })
    await modelTriggerA.click()
    await win.waitForTimeout(400)
    const relayOption = win.getByRole('option', { name: /云雾/ }).first()
    await relayOption.waitFor({ timeout: 6000 })
    await relayOption.click()
    await win.waitForTimeout(1200)

    // UI 断言：参考槽（添加参考图 tile）+ 清晰度 控件出现（迁移前该模型两者皆无）。
    const refTile = (await win.locator('button[aria-label="添加参考图"]').count()) + (await win.locator('button[aria-label="加参考"]').count())
    const resolutionCtl = await win.locator('[aria-label="清晰度"]').count()
    console.log(`  UI: 参考槽 tile=${refTile} 清晰度控件=${resolutionCtl}`)
    if (refTile === 0 || resolutionCtl === 0) { failed = true; console.error('  ❌ 存量模型参考槽/清晰度未出现') }
    await shot(win, 'A-relay-composer-healed.png')
  } catch (e) {
    failed = true
    console.error('  ❌ A 失败：', e)
    try { const w = await app.firstWindow(); await shot(w, 'A-ERROR.png') } catch { /* noop */ }
  } finally {
    await app.close()
  }
}

// ── B：图生图护栏（禁用+tooltip）+ chip 失效态 ─────────────────────────────────────────
{
  console.log('▶ B 图生图护栏 + chip 失效态')
  const dirs = prepDirs('b', true)
  const { app, win } = await launch(dirs)
  try {
    const bw = await app.browserWindow(win)
    await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })).catch(() => {})
    win.on('pageerror', (e) => errors.push('B ' + String(e)))
    win.on('console', (m) => { if (m.type() === 'error') errors.push('B ' + m.text()) })

    await openBlankProjectWithImageNode(win)

    // 选 GPT Image 2（kie 内置种子；假 key 只为「可用」，不生成不花钱）。NomiSelect=Mantine Combobox。
    const modelTrigger = win.locator('button[aria-label="模型"]').first()
    await modelTrigger.waitFor({ timeout: 8000 })
    await modelTrigger.click()
    await win.waitForTimeout(400)
    const gptOption = win.getByRole('option', { name: /GPT Image 2/ }).first()
    await gptOption.waitFor({ timeout: 6000 })
    await gptOption.click()
    await win.waitForTimeout(1200)

    // 切「图生图」模式（ModeBar）。
    await win.getByRole('button', { name: '图生图', exact: true }).first().click()
    await win.waitForTimeout(800)

    // 断言：零参考 → 生成钮禁用 + title 是人话（此前恒可点、静默当纯文生发出去）。
    const genBtn = win.locator('button[aria-label="生成素材"], button[aria-label="重新生成"]').first()
    const disabled = await genBtn.isDisabled()
    const wrapTitle = await genBtn.locator('xpath=ancestor::span[1]').getAttribute('title')
    console.log(`  生成钮 disabled=${disabled} title=「${wrapTitle}」`)
    if (!disabled || !String(wrapTitle || '').includes('图生图需要参考图')) { failed = true; console.error('  ❌ 图生图零参考护栏未生效') }
    await shot(win, 'B1-i2i-guard-disabled.png')

    // 上传一张参考 → chip 出现 → 删底层文件 → chip 失效态「图已失效」。
    const tmpPng = path.join(os.tmpdir(), `i2i-walk-ref-${Date.now()}.png`)
    fs.writeFileSync(tmpPng, TINY_PNG)
    await win.locator('button[aria-label="加参考"]').first().click()
    await win.waitForTimeout(500)
    const fileInput = win.locator('input[type="file"]').last()
    await fileInput.setInputFiles(tmpPng)
    await win.waitForTimeout(2500)
    const enabledAfter = !(await genBtn.isDisabled())
    console.log(`  上传参考后生成钮可点=${enabledAfter}`)
    if (!enabledAfter) { failed = true; console.error('  ❌ 加了参考仍禁用') }
    await shot(win, 'B2-i2i-with-reference.png')

    // 找到刚落盘的项目资产文件并删除 → 触发 img onError → 「图已失效」。
    const pngs = []
    const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.(png|jpe?g|webp)$/i.test(f.name)) pngs.push(p) } }
    walk(dirs.projectsDir)
    console.log(`  项目资产图片数=${pngs.length}`)
    for (const p of pngs) fs.rmSync(p)
    // 重启实例（绕开已加载 <img> 与协议缓存）→ 重开项目 → chip 必须走真实 404 → 「图已失效」。
    await app.close()
    // 重启实例用固定的 settleMs:2000，不经共用 launch() helper（后者省掉等待给 openBlankProjectWithImageNode 自己做）。
    const { app: app2, win: win2 } = await launchNomiApp({
      name: 'i2i-reliability',
      env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
      settingsDir: dirs.settingsDir,
      projectsDir: dirs.projectsDir,
      settleMs: 2000,
    })
    const bw2 = await app2.browserWindow(win2)
    await bw2.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })).catch(() => {})
    await win2.getByText('未命名项目', { exact: false }).first().click()
    await win2.waitForTimeout(2600)
    await win2.keyboard.press('Escape')
    await win2.getByText('生成', { exact: true }).first().click()
    await win2.waitForTimeout(1500)
    await win2.locator('[data-kind="image"][data-node-id]').first().click({ position: { x: 40, y: 40 } })
    await win2.waitForTimeout(1800)
    const invalidChip = await win2.getByText('图已失效', { exact: false }).count()
    console.log(`  「图已失效」chip=${invalidChip}`)
    if (invalidChip === 0) { failed = true; console.error('  ❌ chip 失效态未出现') }
    await shot(win2, 'B3-chip-invalid.png')
    await app2.close()
  } catch (e) {
    failed = true
    console.error('  ❌ B 失败：', e)
    try { const w = await app.firstWindow(); await shot(w, 'B-ERROR.png') } catch { /* noop */ }
  } finally {
    await app.close()
  }
}

console.log(errors.length ? ('⚠️ console/page errors:\n' + errors.slice(0, 10).join('\n')) : '✅ 无 console/page error')
console.log(failed ? '❌ 走查有失败项' : '✅ 走查全部通过')
process.exitCode = failed ? 1 : 0
