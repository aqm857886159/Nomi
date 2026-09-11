// 整片默认画幅**真的发得出去**（R13/R16 真机走查，2026-09-12 根因合同
// docs/fixes/2026-09-12-storyboard-plan-defaults-passthrough.root-cause.json）。
//
// 复现的是用户报的那件事：在分镜「全部镜头」批量条上把整片画幅设成 9:16，表里每一格也画成竖的，
// 出片仍是横的。根因不是"少合并了一个键"，而是**界面显示的和请求体携带的是两份真相**——
// `plan.aspectRatio` 只有分镜表 UI 在读，落画布那一层直接铺 `shot.params`，于是"继承整片默认"
// 的行（95% 的行）落到画布上根本不带画幅，静默回落成模型档案默认。
//
// 所以这条走查的验收点不是截图好不好看，而是**一条链两端对上**：
//   ① 真人手势在批量条上选 9:16（不是灌 store、不是调桥）
//   ② 真人点行内「生成」→ 真花钱确认卡 → 真执行通路
//   ③ loopback 供应商收到的**真实出站报文**里 aspect_ratio === '9:16'
// 少了 ③ 这条走查就还是只证界面（gates 绿 ≠ 走查跑过那一族教训）。
//
// 变异测试留痕（2026-09-12 实跑，别把这条走查当成"能抓住任何一处退化"）：
//   · 只把落画布那一处（buildShotRowNodes）改回裸铺 → **仍然绿**。行内生成是「materialize 之后
//     立刻 syncShotNodeWithRow 写回一遍」，投影那一处把画幅又补了回来。
//   · 两处一起改回裸铺（= 修复前的真实状态）→ 红，且红得正是用户报的那个形状：
//     界面显示 9:16、出站报文 aspect_ratio="1:1"。
// 所以这条走查证的是**整条链**，不是某一段；哪一段退化由两份单测分别锁
// （storyboardPlan.test.ts 锁落画布、storyboardProjection.test.ts 锁写回）。
//
// 夹具模型的档案换成 `nano-banana`（唯一改动写在下面 patchCatalogForAspect 里，附理由）：
// 默认的 `agnes-image` 只声明像素 `size`、**没有** aspect_ratio 控件——那一族模型接不住整片画幅
// 是产品的真实行为（批量条会如实说出来，见单测 unsupportedFilmDefaultKeys），
// 但用它就没法在这条链上取证"能接住的模型真的接住了"。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { createAgentRuntimeFixture, FIXTURE_IMAGE_MODEL } from './agent-runtime-fixture.mjs'
import { clickOrFail, expect, expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-film-aspect-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'film-aspect-walk'
const projectRoot = path.join(projectsDir, projectId)
const outDir = process.env.FILM_ASPECT_OUT || path.join(repoRoot, 'tests/ux/shots/storyboard-film-aspect')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

const DESIGN = 'sb-film-aspect'
// 方案上**刻意不写 aspectRatio**，每一镜也不写 params——这正是修复前会掉队的那个形状。
const plan = {
  title: '竖屏短片',
  anchors: [],
  shots: [1, 2].map((index) => ({
    index,
    shotId: `shot-${index}`,
    shotKind: 'image',
    durationSec: 3,
    anchorIds: [],
    prompt: `第 ${index} 镜画面`,
    modelKey: FIXTURE_IMAGE_MODEL,
  })),
}
const project = {
  id: projectId, name: '整片画幅走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [{
      id: 'doc-1', version: 1, title: '竖屏', updatedAt: 10,
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '竖屏短片。' }] }] },
    }],
    activeDocumentId: 'doc-1',
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardDesignsByDocumentId: {
      'doc-1': [{ id: DESIGN, documentId: 'doc-1', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }],
    },
  },
}
for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(project, null, 2))
}

// 零额度 loopback：真 SDK/IPC/renderer/存储，只有远端供应商是本地假的。
const fixture = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir })

/**
 * 夹具目录的两处外科手术（只影响这条走查自己的 settingsDir，不动共享夹具）：
 *  ① 图片模型的档案换成 `nano-banana` —— 它声明 canonical `aspect_ratio`（默认 1:1，选项含 9:16），
 *     所以"整片设 9:16"与"档案默认 1:1"不同，能区分出"真的传过去了"和"恰好一样"。
 *  ② 出站报文模板加一行 `aspect_ratio` —— 夹具原模板只发 `size`（为 agnes 档案写的）。
 *     不加这行，报文里永远没有这个字段，③ 那条断言就成了永远不可能通过的假红。
 */
function patchCatalogForAspect() {
  const catalogPath = path.join(settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  const model = catalog.models.find((entry) => entry.modelKey === FIXTURE_IMAGE_MODEL)
  if (!model) throw new Error('夹具目录里找不到图片模型——走查前提不成立，别继续跑')
  model.meta = { ...(model.meta ?? {}), archetypeId: 'nano-banana' }
  const mapping = catalog.mappings.find((entry) => entry.taskKind === 'text_to_image')
  if (!mapping) throw new Error('夹具目录里找不到 text_to_image 映射——出站报文无从取证')
  mapping.create.body.aspect_ratio = '{{request.params.aspect_ratio}}'
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
}
patchCatalogForAspect()

async function closeAppHard(instance) {
  const child = instance.process()
  await Promise.race([instance.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

// 不经渲染层 IPC 再存一次 key：loopback vendor 不是内置种子家、且声明 authType:'none'，
// `validateCandidateCredential`（electron/catalog/validateCandidateCredential.ts:34-36）**按设计**
// 拒验这种家，走那条路只会拿到「暂时无法验证密钥」。夹具目录自带的 plain key 就是
// 其余 agent-runtime 走查用的那把（见 agent-runtime-walk-support.createRuntimeWalk：零种 key、
// 照样真跑出图）。方案里每一镜已经钉死 modelKey，不依赖模型下拉列不列得出它。

const { app, win } = await launchNomiApp({ name: 'storyboard-film-aspect', tempRoot, settingsDir, projectsDir, settleMs: 1200 })
const failures = []
const snap = async (name) => { await screenshotSettled(win, { path: path.join(outDir, name) }) }
const spendDialog = () => win.locator('div.fixed.inset-0').filter({ hasText: /开始生成|额度/ }).last()

/** 真人动作：点开 NomiSelect（Mantine Combobox，portal 弹层）再挑一条。`:visible` 是硬要求。 */
async function pickFromSelect(ariaLabel, wanted, humanLabel) {
  await clickOrFail(win.locator(`[aria-label="${ariaLabel}"]`).first(), `${humanLabel}下拉`)
  const options = win.locator('[role="option"]:visible')
  await expect(options, `${humanLabel}下拉点开了却一个选项都没有`).not.toHaveCount(0)
  const texts = (await options.allTextContents()).map((text) => text.trim())
  const index = texts.findIndex((text) => text === wanted || text.includes(wanted))
  if (index < 0) throw new Error(`WALK FAIL: ${humanLabel}下拉里没有「${wanted}」。实际选项：${JSON.stringify(texts)}`)
  await options.nth(index).click()
  await win.waitForTimeout(400)
  return texts[index]
}

try {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  const projectCard = win.locator('[data-project-card]', { hasText: '整片画幅走查' }).first()
  if (await projectCard.isVisible().catch(() => false)) {
    await projectCard.hover()
    const cont = projectCard.getByText('继续创作', { exact: false }).first()
    if (await cont.isVisible().catch(() => false)) await cont.click()
    else await projectCard.dblclick()
  }
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '切到创作页')
  // 侧栏点中方案就直接进分镜页（草稿方案没有摘要卡那一跳）。
  await clickOrFail(win.locator(`[data-storyboard-id="${DESIGN}"]`), '侧栏选中分镜设计')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '分镜编辑器没有渲染')

  // ── 1. 起点：整片画幅还没定（批量条显「按模型默认」）──
  const aspectMarker = win.locator('[data-storyboard-aspect-default]')
  await expect(aspectMarker, '批量条上没有整片画幅挂点')
    .toHaveAttribute('data-storyboard-aspect-default', 'model-default', { timeout: 15_000 })
  await snap('01-before-film-aspect.png')

  // ── 2. 真人手势：在「全部镜头」批量条上把整片画幅设成 9:16 ──
  await pickFromSelect('全部镜头的画幅', '9:16', '整片画幅')
  await expect(aspectMarker, '选完 9:16 后批量条没有把整片默认换过去')
    .toHaveAttribute('data-storyboard-aspect-default', '9:16', { timeout: 5000 })
  // 每一行都只是"继承"——一行覆盖胶囊都不该冒出来（继承是读时算的，不是抄进每一行）。
  const overrideChips = await win.locator('[data-storyboard-aspect-override]').count()
  if (overrideChips !== 0) failures.push(`整片改画幅后不该出现行覆盖胶囊，实为 ${overrideChips} 枚`)
  await snap('02-film-aspect-set.png')

  // ── 3. 行内「生成」真跑（fixture 零额度）：materialize → 花钱确认 → runner ──
  if (fixture.images.length !== 0) failures.push(`点生成之前就发生了 ${fixture.images.length} 次供应商调用`)
  await clickOrFail(win.locator('[data-storyboard-row="1"]').getByRole('button', { name: '生成镜 1' }), '点镜 1 生成')
  await expectVisible(spendDialog(), '行内生成没有弹花钱确认卡（执行通路断了）')
  await snap('03-spend-confirm.png')
  await clickOrFail(spendDialog().getByRole('button', { name: '生成', exact: true }), '确认生成（fixture 零额度）')
  await expect
    .poll(() => fixture.images.length, { timeout: 30_000, message: '确认后 loopback 供应商一次图片请求都没收到' })
    .toBe(1)
  await expect(win.locator('[data-storyboard-row="1"] [data-storyboard-frame]'), '镜 1 没有进入 done')
    .toHaveAttribute('data-storyboard-frame', 'done', { timeout: 30_000 })
  await snap('04-generated.png')

  // ── 4. 验收点：**出站报文**带着整片画幅（显示 ≡ 请求）──
  const body = fixture.images[0]?.body ?? {}
  if (body.aspect_ratio !== '9:16') {
    failures.push(`出站报文没有带上整片画幅：aspect_ratio=${JSON.stringify(body.aspect_ratio)}（应为 "9:16"）。`
      + `这正是修复前的形状——界面显示竖屏、请求却按模型默认（1:1）发。完整报文：${JSON.stringify(body).slice(0, 400)}`)
  }
  if (body.model !== FIXTURE_IMAGE_MODEL) {
    failures.push(`出站报文的模型不是方案里钉的那个：${JSON.stringify(body.model)}`)
  }

  fixture.assertClean()
} finally {
  await closeAppHard(app)
  await fixture.close()
}

if (failures.length) {
  console.error('❌ 整片画幅贯通走查失败：')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('✅ 整片画幅贯通走查通过：批量条选 9:16 → 落画布 → 出站报文 aspect_ratio=9:16')
console.log(`   截图：${outDir}`)
