// 「没发出去的尝试放掉认领、可以直接重试」真 App 走查（L-claim，2026-10-06）。复现 V-1042 审计第 22 张截图那一幕：
// 分镜参考卡「林薇」先用 GPT Image 2 生成（出网闸在连上之前拦下，请求没离开本机）→ 失败面说清原因 →
// 换成回环图片模型点「重试」→ 认领放行、真的出图。
//
// 零额度：供应商是本机回环夹具，出网闸拦真实域名（scripts/walkthrough-network-guard.cjs）+ 黑洞代理；窗口全程在屏幕外。
// 用法：
//   pnpm run build
//   NOMI_AUDIT_LOCALE=zh-CN node tests/ux/claim-unsent-retry.walk.mjs
//   NOMI_AUDIT_LOCALE=en    node tests/ux/claim-unsent-retry.walk.mjs
// 产出：tests/ux/shots/claim-unsent-retry/<locale>/*.png + observations.json；任何一条预期不成立进程退出码非 0。
import fs from 'node:fs'
import path from 'node:path'
import { stationTimeout } from './_station-budget.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'
const locale = process.env.NOMI_AUDIT_LOCALE === 'en' ? 'en' : 'zh-CN'
const EN = locale === 'en'
const t = (zh, en) => (EN ? en : zh)

const { launchCoreSmoke } = await import('./core-smoke/fixture.mjs')
const { startEgressWatch, readEgressLog } = await import('./full-walk/egress.mjs')
const { startUploadRelay } = await import('./full-walk/uploadRelay.mjs')
const { standingBackgroundResponders } = await import('./full-walk/brain.mjs')
const { repoRoot } = await import('./_launchApp.mjs')
const { FIXTURE_VENDOR } = await import('./agent-runtime-fixture.mjs')

const DOC = 'doc-1'
const DESIGN = 'claim-sb'
const plan = {
  title: t('雨夜追逐', 'Rainy chase'),
  anchors: [
    { id: 'hero', kind: 'character', name: t('林薇', 'Lin Wei'), description: t('短发，风衣，眼神冷', 'Short hair, trench coat, cold eyes'), carrier: 'visual' },
    { id: 'alley', kind: 'scene', name: t('后巷', 'Back alley'), description: t('窄巷，霓虹，积水', 'Narrow alley, neon, puddles'), carrier: 'visual' },
  ],
  shots: [
    { index: 1, shotId: 'shot-1', shotKind: 'image', durationSec: 3, anchorIds: ['hero', 'alley'], prompt: t('林薇冲进后巷', 'Lin Wei runs into the alley') },
  ],
}

const outDir = path.join(repoRoot, 'tests', 'ux', 'shots', 'claim-unsent-retry', locale)
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const tmpDir = path.join(repoRoot, '.tmp', 'claim-unsent-retry')
fs.mkdirSync(tmpDir, { recursive: true })

const egress = await startEgressWatch({ logFile: path.join(tmpDir, `egress-${locale}.jsonl`) })
const relay = await startUploadRelay()
const smoke = await launchCoreSmoke({
  name: 'claim-unsent-retry', needs: ['loopbackProvider', 'fixtureTextModel', 'paidGenerationRoute'], locale, syntheticCredentialStorage: true,
  seed: () => ({
    nodes: [], groups: [], edges: [],
    payload: {
      workbenchDocuments: [{ id: DOC, version: 1, title: t('雨夜', 'Rainy night'), updatedAt: 10,
        contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t('雨夜，林薇被追进后巷。', 'On a rainy night, Lin Wei is chased into an alley.') }] }] } }],
      activeDocumentId: DOC,
      storyboardDesignsByDocumentId: { [DOC]: [{ id: DESIGN, documentId: DOC, title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }] },
    },
  }),
  extras: {
    mainRequire: [...egress.mainRequire, path.join(repoRoot, 'tests', 'ux', '_offscreenWindows.cjs')],
    env: { ...egress.env, ...relay.env },
    needsOptions: { fixture: { usage: 'measured' } },
  },
})
const fixture = smoke.needs.loopbackProvider
standingBackgroundResponders(fixture)
const win = () => smoke.win

const O = { locale, checks: {} }
const failures = []
const check = (name, ok, detail) => { O.checks[name] = { ok: Boolean(ok), detail }; if (!ok) failures.push(name) }
const snap = async (name) => { await win().screenshot({ path: path.join(outDir, `${name}.png`) }) }
const settle = (ms = 700) => win().waitForTimeout(ms)
const readProject = () => JSON.parse(fs.readFileSync(path.join(smoke.project.projectRoot, '.nomi', 'project.json'), 'utf8')).payload
const editor = () => win().locator('[data-storyboard-editor="true"]:visible')
const anchorRow = (id) => editor().locator(`[data-storyboard-anchor-row="${id}"]`)
const hero = () => anchorRow('hero')
const modelButton = (scope) => scope.locator('[data-storyboard-composer-bar]').getByRole('button', { name: t('模型', 'Model'), exact: true }).first()
const anchorNode = (id) => readProject().generationCanvas.nodes.find((n) => n.meta?.anchorId === id)
const heroNode = () => anchorNode('hero')
const waitFace = async (face, row = hero()) => {
  for (let i = 0; i < 40; i += 1) { await settle(1000); if (await row.locator(`[data-anchor-face="${face}"]`).count()) return true }
  return false
}
// 「在本机就被拦下」的真实场景：回环供应商这一家的自定义请求头里混进了中文（用户在接入页粘错的那一种），
// 主进程的请求头守卫在交给网络之前就拒了。改的是主进程每次都现读的那份目录文件，不碰界面。
const catalogFile = () => path.join(smoke.settingsDir, 'model-catalog.json')
const setFixtureVendorHeader = (value) => {
  const catalog = JSON.parse(fs.readFileSync(catalogFile(), 'utf8'))
  const vendor = catalog.vendors.find((v) => v.key === FIXTURE_VENDOR)
  vendor.meta = { ...(vendor.meta ?? {}), extraHeaders: value ? { 'X-Workspace': value } : {} }
  fs.writeFileSync(catalogFile(), `${JSON.stringify(catalog, null, 2)}
`)
}

try {
  await smoke.openProject()
  await win().locator('.nomi-stepper__step[data-mode="creation"]').first().click()
  await settle(700)
  await win().locator(`[data-storyboard-id="${DESIGN}"]`).first().click()
  await editor().waitFor({ timeout: stationTimeout({ operations: 2 }) })
  await settle(1000)
  await editor().locator('[data-storyboard-anchors-toggle="true"]').click()
  await settle(600)

  // ① 林薇先选 GPT Image 2（真实域名，出网闸在连上之前拦下）→ 生成。
  await modelButton(hero()).click()
  await settle(400)
  await win().getByRole('option', { name: /GPT Image 2(?!\.)/ }).first().click()
  await settle(700)
  await hero().locator('[data-storyboard-composer-bar] [data-storyboard-generate-state]').click()
  const failed = await waitFace('failed')
  check('first-attempt-fails', failed)
  await settle(600)
  await snap('01-blocked-attempt-failure-face')
  const faceText = (await hero().locator('[data-anchor-failure-reason]').innerText().catch(() => '')).trim()
  const faceHint = await hero().locator('[data-anchor-failure-reason]').getAttribute('title').catch(() => null)
  O.firstFailure = { faceText, faceHint, nodeError: String(heroNode()?.error ?? '').slice(0, 400) }
  check('face-says-why-not-generic', faceText && faceText !== t('生成失败', 'Generation failed'), faceText)
  check('face-offers-retry', await hero().locator('[data-anchor-face="failed"] button').count() > 0)
  check('no-reconcile-in-error', !/needs_reconcile|submission-unknown/.test(O.firstFailure.nodeError), O.firstFailure.nodeError)

  // ② 换成回环图片模型，点「重试」：认领放行，真的出图。
  await modelButton(hero()).click()
  await settle(400)
  await win().getByRole('option', { name: /Fixture/ }).first().click()
  await settle(600)
  await hero().locator('[data-anchor-face="failed"] button').click()
  const done = await waitFace('done')
  await settle(800)
  await snap('02-model-changed-retry-succeeds')
  O.afterRetry = { face: await hero().locator('[data-anchor-face]').first().getAttribute('data-anchor-face'), nodeStatus: heroNode()?.status, nodeError: String(heroNode()?.error ?? '').slice(0, 200) }
  check('retry-succeeds', done, O.afterRetry)
  check('retry-not-refused-as-reconcile', !/needs_reconcile/.test(O.afterRetry.nodeError), O.afterRetry.nodeError)

  // ③ 后巷：回环模型，但这一家的请求头里混进了中文 → 在本机就被拦下（一个字节都没出去）。
  const alley = anchorRow('alley')
  await modelButton(alley).click()
  await settle(400)
  await win().getByRole('option', { name: /Fixture/ }).first().click()
  await settle(600)
  setFixtureVendorHeader('工作区')
  await alley.locator('[data-storyboard-composer-bar] [data-storyboard-generate-state]').click()
  const localFailed = await waitFace('failed', alley)
  await settle(600)
  await snap('03-stopped-on-this-computer')
  const localText = (await alley.locator('[data-anchor-failure-reason]').innerText().catch(() => '')).trim()
  const localHint = await alley.locator('[data-anchor-failure-reason]').getAttribute('title').catch(() => null)
  O.localRefusal = { faceText: localText, faceHint: localHint, nodeError: String(anchorNode('alley')?.error ?? '').slice(0, 400), fixtureImagesBefore: fixture.images.length }
  check('local-refusal-fails', localFailed)
  check('local-refusal-says-not-sent', localText === t('这次生成没有发出去，停在了这台电脑上', 'This generation was never sent; it stopped on this computer'), localText)
  check('local-refusal-hover-has-technical-details', /技术详情：|Technical details: /.test(String(localHint)), localHint)
  check('local-refusal-is-released', /submission_not_sent/.test(Buffer.from(String(O.localRefusal.nodeError.match(/NOMI_VENDOR_ERR_B64::([^:]+)::/)?.[1] ?? ''), 'base64').toString('utf8')), O.localRefusal.nodeError)

  // ④ 把请求头改对，点「重试」：认领放行，真的出图（回环这时才收到第一笔）。
  setFixtureVendorHeader('')
  await alley.locator('[data-anchor-face="failed"] button').click()
  const localDone = await waitFace('done', alley)
  await settle(800)
  await snap('04-fixed-header-retry-succeeds')
  check('local-refusal-retry-succeeds', localDone, { face: await alley.locator('[data-anchor-face]').first().getAttribute('data-anchor-face') })
} catch (error) {
  failures.push(`walk-error: ${String(error?.message ?? error).split('\n')[0]}`)
} finally {
  const vendorHits = readEgressLog(path.join(tmpDir, `egress-${locale}.jsonl`)).filter((e) => e.kind === 'blocked' && /apimart/i.test(String(e.host)))
  O.egressBlockedApimart = vendorHits.length
  O.fixtureImageRequests = fixture.images.length
  check('blocked-request-never-reached-a-vendor', vendorHits.every((e) => e.kind === 'blocked'), vendorHits.map((e) => e.via))
  // 林薇重试 1 笔 + 后巷重试 1 笔；两次失败的尝试一笔都没到回环。
  check('fixture-received-exactly-two-image-requests', fixture.images.length === 2, fixture.images.length)
  O.failures = failures
  fs.writeFileSync(path.join(outDir, 'observations.json'), `${JSON.stringify(O, null, 2)}\n`)
  await smoke.close().catch(() => undefined)
  await egress.close().catch(() => undefined)
  await relay.close().catch(() => undefined)
}
console.log(`[claim-unsent-retry] ${locale}: ${failures.length ? `FAILED ${failures.join(', ')}` : 'all checks passed'}`)
process.exit(failures.length ? 1 : 0)
