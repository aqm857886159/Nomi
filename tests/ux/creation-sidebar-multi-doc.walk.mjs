// 创作资源树可达性走查（R13/R16）——用户 2026-09-06 报回归：
// 「我们原来左边不是有剧本和分镜都能点吗？我们现在只能有这个方案，点不到原来那些地方了。」
//
// 钉死的不变量：**只要在编辑某一篇原稿或它的某个分镜方案，创作资源树就必须在场、
// 且列全所有原稿与所有分镜方案**。分镜表长什么样（v6 已拍板）不在本走查管辖内——
// 这里只管「还点不点得到别的原稿 / 别的方案」。
//
// 两条腿：
//   A 新形状项目：2 篇原稿 × 每篇 2 个方案，逐个点，creation ↔ storyboard 来回切；
//   B 老形状项目：payload 只有单份 workbenchDocument + storyboardPlan（真实老项目的形状，
//     见 ~/Documents/Nomi Projects 存量），走兼容投影后同样要能点到。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectCount, expectText, expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-creation-sidebar-'))
const projectsDir = path.join(tempRoot, 'projects')
const settingsDir = path.join(tempRoot, 'settings')
const outDir = process.env.CREATION_SIDEBAR_OUT || path.join(repoRoot, 'tests/ux/shots/creation-sidebar-multi-doc')
fs.mkdirSync(outDir, { recursive: true })

const doc = (id, title, text, updatedAt) => ({
  id, version: 1, title, updatedAt,
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
})
const plan = (title, shotCount) => ({
  title,
  profileKey: 'genre.short-drama',
  anchors: [],
  scenes: [{ id: 's1', title: '第一场' }],
  shots: Array.from({ length: shotCount }, (_, i) => ({
    index: i + 1, shotId: `shot-${i + 1}`, sceneId: 's1', shotKind: 'image',
    durationSec: 3, anchorIds: [], prompt: `${title} 第 ${i + 1} 镜`,
  })),
})
const design = (id, documentId, title, shotCount, sourceDocumentUpdatedAt) => ({
  id, documentId, title, plan: plan(title, shotCount),
  committed: false, status: 'draft', sourceDocumentUpdatedAt,
  createdAt: sourceDocumentUpdatedAt + 1, updatedAt: sourceDocumentUpdatedAt + 2,
})

function writeProject(projectId, name, payload) {
  const projectRoot = path.join(projectsDir, projectId)
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  const record = {
    id: projectId, name, version: 2, createdAt: 1, updatedAt: 2, savedAt: 2, revision: 1,
    lastKnownRootPath: projectRoot, payload,
  }
  for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
    fs.writeFileSync(target, JSON.stringify(record, null, 2))
  }
}

// ── A：新形状（多原稿 + 每篇多方案）──
writeProject('creation-sidebar-multi', '多原稿多方案', {
  workbenchDocuments: [doc('doc-a', '影子罢工了', '影子在清晨罢工。', 10), doc('doc-b', '夜风计划', '雨夜天台的对峙。', 20)],
  activeDocumentId: 'doc-a',
  timeline: null,
  generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
  storyboardDesignsByDocumentId: {
    'doc-a': [design('d-a1', 'doc-a', '影子 · 方案一', 3, 10), design('d-a2', 'doc-a', '影子 · 方案二', 4, 10)],
    'doc-b': [design('d-b1', 'doc-b', '夜风 · 方案一', 2, 20), design('d-b2', 'doc-b', '夜风 · 方案二', 5, 20)],
  },
})

// ── B：老形状。逐字照抄真实存量项目的 payload 形状（2026-09-06 实测
//    ~/Documents/Nomi Projects/Nomi 宣传片｜09_00 前交片 的 .nomi/project.json）：
//    · 只有单份 workbenchDocument，没有 workbenchDocuments / activeDocumentId；
//    · 原稿 title 是空串（老项目从来没给稿子起过名）；
//    · storyboardPlan 只有 title / anchors / shots 三个键——没有 scenes、没有 profileKey。
//    这三点都是兼容投影真正会踩的地方，别"补全"成新形状再测（那测的是自己的 fixture）。
writeProject('creation-sidebar-legacy', '老项目形状', {
  workbenchDocument: { ...doc('legacy-doc', '', '截止前的片场接管。', 30) },
  timeline: null,
  generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
  storyboardPlan: {
    title: 'Nomi 开源宣传片',
    anchors: [],
    shots: Array.from({ length: 6 }, (_, i) => ({
      index: i + 1, shotId: `shot-${i + 1}`, shotKind: 'image',
      durationSec: 3, anchorIds: [], prompt: `老项目第 ${i + 1} 镜`,
    })),
  },
  storyboardPlanCommitted: false,
})

const failures = []
const consoleErrors = []

async function closeAppHard(instance) {
  const child = instance.process()
  await Promise.race([instance.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

/**
 * 资源树可达性对账：树在场 + 原稿行数对 + 方案行数对 + 点名的那几个标题都在。
 * 这条断言就是回归的红点——分镜模式下资源树整棵消失时，第一句就红。
 */
async function expectResourceTreeReachable(win, where, { documents, storyboards, titles }) {
  await expectVisible(win.locator('[data-creation-resource-tree="true"]'), `${where}：创作资源树不在场——点不到别的原稿/方案`)
  await expectCount(win.locator('[data-document-row]'), documents, `${where}：原稿行数应为 ${documents}`)
  await expectCount(win.locator('[data-storyboard-id]'), storyboards, `${where}：分镜方案行数应为 ${storyboards}`)
  for (const title of titles) {
    await expectVisible(win.locator('[data-creation-resource-tree="true"]').getByText(title, { exact: false }).first(), `${where}：资源树里找不到「${title}」`)
  }
}

// 项目默认开在生成页，所以「打开项目」= 进项目 + 切到创作页（用户从项目库进创作的真实两步）。
async function openProject(win, name) {
  const card = win.locator('[data-project-card]', { hasText: name }).first()
  await card.hover()
  const cont = card.getByText('继续创作', { exact: false }).first()
  if (await cont.isVisible().catch(() => false)) await cont.click()
  else await card.dblclick()
  await expectVisible(win.locator('[data-workspace-mode]'), `打开「${name}」后工作台没起来`)
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), `进「${name}」的创作页`)
}

const { app, win } = await launchNomiApp({ name: 'creation-sidebar-multi-doc', tempRoot, settingsDir, projectsDir, settleMs: 1200 })
win.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300)) })
win.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error?.message || error).slice(0, 300)}`))
const snap = async (name) => { await screenshotSettled(win, { path: path.join(outDir, name) }) }

try {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })

  // ─────────── 腿 A：多原稿 × 多方案 ───────────
  await openProject(win, '多原稿多方案')
  await expectResourceTreeReachable(win, '创作页初始', {
    documents: 2, storyboards: 4,
    titles: ['影子罢工了', '夜风计划', '影子 · 方案一', '夜风 · 方案二'],
  })
  await snap('01-creation-two-docs.png')

  // 点第二篇原稿 → 编辑器换稿，树不变
  await clickOrFail(win.locator('[data-document-row="doc-b"] [data-document-id]'), '点第二篇原稿')
  await expectText(win.locator('[data-document-row="doc-b"] [data-document-id]'), /夜风计划/, '第二篇原稿行标题不对')
  await expectVisible(win.locator('[data-document-row="doc-b"] [data-document-id][data-active="true"]'), '点了第二篇原稿但它没被标成 active')
  await snap('02-doc-b-selected.png')

  // 打开一个分镜方案 → 这里是回归的现场：分镜表出来了，但资源树整棵消失
  await clickOrFail(win.locator('[data-storyboard-id="d-b1"]'), '打开「夜风 · 方案一」')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '分镜编辑器没渲染')
  await snap('03-storyboard-open.png')
  await expectResourceTreeReachable(win, '分镜方案打开时', {
    documents: 2, storyboards: 4,
    titles: ['影子罢工了', '夜风计划', '影子 · 方案一', '夜风 · 方案二'],
  })

  // 在分镜页直接换到另一篇原稿的另一个方案（用户要的「点到我的其他那些剧本、分镜」）
  await clickOrFail(win.locator('[data-storyboard-id="d-a2"]'), '在分镜页切到另一篇原稿的方案二')
  await expectVisible(win.locator('[data-storyboard-id="d-a2"][data-active="true"]'), '切过去的方案没有被标成 active')
  await expectText(win.locator('[data-storyboard-editor="true"]'), /影子 · 方案二/, '分镜表没换成「影子 · 方案二」')
  await snap('04-switch-plan-across-docs.png')

  // 再点回原稿行 → 回到剧本编辑器（用户的「我看不到原来那个剧本了」）
  await clickOrFail(win.locator('[data-document-row="doc-a"] [data-document-id]'), '从分镜页点回原稿')
  await expectVisible(win.locator('[data-creation-surface="source"]'), '点回原稿后剧本编辑器没回来')
  await expectVisible(win.locator('[data-document-row="doc-a"] [data-document-id][data-active="true"]'), '点回原稿后它没被标成 active')
  await snap('05-back-to-script.png')

  // ─────────── 腿 B：老项目形状 ───────────
  await clickOrFail(win.getByRole('button', { name: /项目库|返回项目库/ }).first(), '回项目库')
  await openProject(win, '老项目形状')
  await expectResourceTreeReachable(win, '老项目创作页', {
    documents: 1, storyboards: 1,
    titles: ['Nomi 开源宣传片'],
  })
  await expectText(win.locator('[data-creation-surface="source"]'), /截止前的片场接管/, '老项目的剧本正文没投影出来')
  await snap('06-legacy-project-tree.png')

  const legacyDesign = win.locator('[data-storyboard-id]').first()
  await clickOrFail(legacyDesign, '打开老项目迁移出来的分镜方案')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '老项目分镜编辑器没渲染')
  await expectResourceTreeReachable(win, '老项目分镜打开时', {
    documents: 1, storyboards: 1,
    titles: ['Nomi 开源宣传片'],
  })
  await snap('07-legacy-storyboard-open.png')
  await clickOrFail(win.locator('[data-document-row="legacy-doc"] [data-document-id]'), '老项目从分镜点回原稿')
  await expectVisible(win.locator('[data-creation-surface="source"]'), '老项目点回原稿后剧本编辑器没回来')
  await expectText(win.locator('[data-creation-surface="source"]'), /截止前的片场接管/, '老项目回原稿后正文丢了')
  await snap('08-legacy-back-to-script.png')
} catch (error) {
  failures.push(String(error?.message || error))
} finally {
  await snap('99-final.png')
  await closeAppHard(app)
}

console.log(`\n截图：${outDir}`)
if (consoleErrors.length) console.log(`控制台错误 ${consoleErrors.length} 条（留证不判红）：\n  ${consoleErrors.slice(0, 8).join('\n  ')}`)
if (failures.length) {
  console.error(`\n❌ 创作资源树可达性走查失败 ${failures.length} 条：`)
  for (const failure of failures) console.error(`  · ${failure}`)
  process.exit(1)
}
console.log('\n✅ 创作资源树在原稿页与分镜页都可达，多原稿 / 多方案 / 老项目形状三面都能互相点到')
