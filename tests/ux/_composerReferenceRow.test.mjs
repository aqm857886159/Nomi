// 付费走查 composer-b3-reference.paid.mjs 花钱前那道「界面标的在用 / 未用到」核对，先零花费验一遍：
// 拿**生产组件** AssetReference（B3 生成框参考行）的服务端渲染喂 readComposerReferences / judgeComposerReferences，
// props 照 NodeParameterControls 在首尾帧方式下交给它的那一份摆（首帧、尾帧两格 + 3 张未用到）。
// 组件改了锚点（data-reference-unused / data-asset-slot / data-asset-tile）或嵌套，这里先红，不等付费那一刻。
// 另钉两条：步骤本体在点 ↑ 之前真的跑这道判、判不过就抛（反例：删掉花钱前的界面核对，这里红）；
// 花钱前只经界面改状态——这条样本对 E2E 桥的每一处用法都在白名单里（反例：把「点不到就写 store」的退路塞回去，这里红）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

import AssetReference from '../../src/workbench/assets/AssetReference'
import { fileMapper, judgeComposerReferences, readComposerReferences } from './_composerReferenceRow.mjs'
import { uiText } from './full-walk/invariants.mjs'

vi.mock('react-i18next', async (original) => ({
  ...await original(),
  useTranslation: () => ({ t: (key) => key }),
}))

const PROJECT = 'project-paid-b3'
const REFS = ['ref-1.png', 'ref-2.png', 'ref-3.png']
const FILES = [...REFS, 'first.png', 'last.png']
const url = (file) => `nomi-local://asset/${PROJECT}/assets/imported/${file}`
const fileOf = fileMapper(FILES, url)
const SCENE = { frames: [{ slot: 'firstFrameUrl', file: 'first.png' }, { slot: 'lastFrameUrl', file: 'last.png' }], unused: REFS, fileOf }

// NodeParameterControls 在 Seedance 2.0（apimart）首尾帧方式下的单图格：首帧、尾帧（尾帧 min 0 → 「可不填」）。
const frameSlot = (key, label, optional) => ({ key, label, accept: 'image', form: 'single', persistAsEdge: true, numbered: false, max: 1, optional })
const FRAME_SLOTS = [frameSlot('firstFrameUrl', '首帧', false), frameSlot('lastFrameUrl', '尾帧', true)]
const ARRAY_SLOT = { key: 'referenceImageUrls', label: '角色参考', accept: 'image', form: 'array', persistAsEdge: false, numbered: true, max: 9 }

/** 生产组件渲染出来的参考行，外面套一层和画布上一样的生成框壳（pageReadComposer 取的就是这一层的 outerHTML）。 */
function composerHtml(props) {
  const row = renderToStaticMarkup(React.createElement(AssetReference, {
    projectId: PROJECT, openSlotKey: '', uploadingSlotKey: '',
    onTogglePicker: vi.fn(), onPick: vi.fn(), onUpload: vi.fn(), onRemove: vi.fn(), onPickOnCanvas: vi.fn(),
    ...props,
  }))
  return { composers: 1, html: `<div class="generation-canvas-v2-node__composer nokey" data-composer-host="canvas"><div data-node-composer-references>${row}</div></div>` }
}
const firstLast = (overrides = {}) => composerHtml({
  slots: FRAME_SLOTS,
  valuesByKey: { firstFrameUrl: url('first.png'), lastFrameUrl: url('last.png') },
  unusedUrls: REFS.map(url), parkedUrls: new Set(), onRemoveUnused: vi.fn(), onUseParked: vi.fn(), onSwapFrames: vi.fn(),
  ...overrides,
})
const judge = (read) => judgeComposerReferences(readComposerReferences(read), SCENE)

describe('生成框参考行的「在用 / 未用到」：生产组件 AssetReference 的服务端渲染', () => {
  it('首尾帧方式：首帧、尾帧两格在用，3 张参考标「未用到」→ 判过，摘要写清谁在用、谁没用到', () => {
    const verdict = judge(firstLast())
    expect(verdict.problems).toEqual([])
    expect(verdict.summary.inUse).toEqual({ firstFrameUrl: ['first.png'], lastFrameUrl: ['last.png'] })
    expect([...verdict.summary.unused].sort()).toEqual(REFS)
    expect(verdict.summary.arrayInUse).toEqual([])
    expect(verdict.summary.parked).toEqual([])
    expect(verdict.summary.slotLabels).toEqual(['首帧', 'assetLibrary.refRow.lastFrameOptional'])
  })

  it('反例：还停在参考方式（5 张都进参考数组、标为在用）→ 判红，点名首尾帧格不对、数组里有在用的、未用到不对', () => {
    const verdict = judge(composerHtml({ slots: [ARRAY_SLOT], valuesByKey: { referenceImageUrls: ['first.png', 'last.png', ...REFS].map(url) } }))
    const text = verdict.problems.join('\n')
    expect(text).toMatch(/单图格是 \[没有\]/)
    expect(text).toMatch(/参考数组里还有 5 张标为在用/)
    expect(text).toMatch(/标「未用到」的是 （没有）/)
  })

  it('反例：只有 2 张标「未用到」（第 3 张被当成在用 / 丢了）→ 判红', () => {
    const verdict = judge(firstLast({ unusedUrls: REFS.slice(0, 2).map(url) }))
    expect(verdict.problems.join('\n')).toMatch(/标「未用到」的是 ref-1\.png、ref-2\.png，应恰好是 ref-1\.png、ref-2\.png、ref-3\.png/)
  })

  it('反例：首帧格空着、或首尾帧对调 → 判红', () => {
    expect(judge(firstLast({ valuesByKey: { lastFrameUrl: url('last.png') } })).problems.join('\n')).toMatch(/「firstFrameUrl」格里标为在用的是 （空）/)
    const swapped = judge(firstLast({ valuesByKey: { firstFrameUrl: url('last.png'), lastFrameUrl: url('first.png') } })).problems.join('\n')
    expect(swapped).toMatch(/「firstFrameUrl」格里标为在用的是 last\.png/)
    expect(swapped).toMatch(/「lastFrameUrl」格里标为在用的是 first\.png/)
  })

  it('反例：未用到里混进一张场景外的图 → 判红并点名', () => {
    const verdict = judge(firstLast({ unusedUrls: [...REFS, 'nomi-local://asset/other/assets/stray.png'].map((item) => (item.includes('://') ? item : url(item))) }))
    expect(verdict.problems.join('\n')).toMatch(/对不回场景里的文件：\?stray\.png/)
  })

  it('旧工程残留（先放一边，data-reference-parked）也是「未用到」：判过，摘要单列出来', () => {
    const verdict = judge(firstLast({ parkedUrls: new Set([url('ref-2.png')]) }))
    expect(verdict.problems).toEqual([])
    expect(verdict.summary.parked).toEqual(['ref-2.png'])
  })

  it('没选中（没有生成框）/ 两张生成框 / 两行参考 → 判红', () => {
    expect(judgeComposerReferences(readComposerReferences({ composers: 0, html: '' }), SCENE).problems.join('\n')).toMatch(/生成框有 0 张[\s\S]*参考行有 0 行/)
    const doubled = firstLast()
    expect(judge({ ...doubled, composers: 2 }).problems.join('\n')).toMatch(/生成框有 2 张/)
    const twoRows = { composers: 1, html: `<div>${doubled.html}${doubled.html}</div>` }
    expect(judge(twoRows).problems.join('\n')).toMatch(/参考行有 2 行/)
  })
})

describe('浏览器 outerHTML 的写法也读得出（img 不自闭合、属性顺序不同、属性值里有 > 和实体）', () => {
  // 真界面上的字从词典取（中文界面那一份），不在测试里另抄一份文案。
  const zh = (key) => uiText('zh-CN', key)
  const tile = (file) => `<div class="group/tile relative h-10 w-10 opacity-40" data-asset-tile="image"><span class="x"><img loading="lazy" alt="${file}" src="${url(file)}" decoding="async" class="w-full h-full"></span></div>`
  const live = [
    '<div class="generation-canvas-v2-node__composer" data-composer-host="canvas">',
    '<div class="flex [&>svg]:size-4" data-reference-row="true">',
    `<div class="ml-3" data-asset-slot="firstFrameUrl">${tile('first.png').replace(' opacity-40', '')}<span data-asset-slot-label="true">首帧</span></div>`,
    `<div data-asset-slot="lastFrameUrl" class="x">${tile('last.png').replace(' opacity-40', '')}<span data-asset-slot-label="true">${zh('assetLibrary.refRow.lastFrameOptional')}</span></div>`,
    ...REFS.map((file) => `<div class="flex" data-reference-unused="true" title="a &gt; b &amp; c">${tile(file)}</div>`),
    `<span data-reference-tail="true">${zh('assetLibrary.refRow.imageEdit')}</span></div></div>`,
  ].join('')
  it('读出首帧、尾帧两格与 3 个未用到，判过', () => {
    const verdict = judgeComposerReferences(readComposerReferences({ composers: 1, html: live }), SCENE)
    expect(verdict.problems).toEqual([])
    expect(verdict.summary.slotLabels).toEqual(['首帧', zh('assetLibrary.refRow.lastFrameOptional')])
  })
  it('小图没出图（NomiImage 加载失败换成了占位，没有 img）→ 判红', () => {
    const broken = live.replace(`<img loading="lazy" alt="ref-3.png" src="${url('ref-3.png')}" decoding="async" class="w-full h-full">`, `<div title="x" aria-label="${zh('assetLibrary.expiredReference')}">${zh('assetLibrary.expiredReference')}</div>`)
    const verdict = judgeComposerReferences(readComposerReferences({ composers: 1, html: broken }), SCENE)
    expect(verdict.problems.join('\n')).toMatch(/第 3 个「未用到」格里有 1 张小图、0 张出了图/)
  })
})

describe('fileMapper：小图地址对回场景文件', () => {
  it('完整本地地址（含查询串）、按文件名、对不回', () => {
    expect(fileOf(url('ref-1.png'))).toBe('ref-1.png')
    expect(fileOf(`${url('first.png')}?v=2`)).toBe('first.png')
    expect(fileOf('nomi-local://asset/elsewhere/last.png')).toBe('last.png')
    expect(fileOf('nomi-local://asset/elsewhere/%E6%96%B0.png')).toBeNull()
    expect(fileOf('https://cdn.example/unknown.png')).toBeNull()
  })
})

// ── 花钱前只经界面改状态：这条付费样本对应用 E2E 桥（window.__nomi*）的用法白名单 ──
// 扫这条样本自有的全部文件（步骤本体、两个入口脚本、读参考行的纯函数），按语法树把每一处提到 __nomi 的标识符、字符串、
// 模板、正则逐个归类（注释不在树里，不算）。放行的只有下面四种写法，其它一律红（fail-closed）：
//   · window.localStorage.setItem('__nomiE2E', '1')          打开 E2E 桥（开关，不是应用状态）
//   · Boolean(window.__nomiCanvasStore)                      判桥挂上没有
//   · window.__nomiCanvasStore.getState().nodes.find(…)      读节点（读的这个节点由 addNode / 界面经 immer 写进 store，深冻结：读出来的对象改不动 store）
//   · window.__nomiCanvasStore.getState().addNode(…)         布场景：全部文件里恰好 1 处，在步骤本体里、在 await switchToFirstLast( 之前
// 红的例子：取别名（const state = …getState()）、解构、setState / selectNode / updateNode 等别的成员、别的桥
// （__nomiCapabilityApply、__nomiProductionLandingStore …）、globalThis. / window[…] / 裸名写法、字符串里写桥名。
// 这是「门岗自动拦」，做不到「结构上做不出来」：window.__nomiCanvasStore 是很多零额度走查共用的 E2E 桥
// （localStorage __nomiE2E 为 '1' 才挂，src/workbench/production/ProductionCanvasLandingHost.tsx），这条样本布场景、读节点也靠它；
// 不改产品代码就没法只对这一条脚本收回写权限，所以静态钉住这条样本自己的文件。
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readRepo = (file) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')
const STEPS = 'tests/ux/_composerB3ReferenceSteps.mjs'
const SAMPLE_FILES = [STEPS, 'tests/ux/composer-b3-reference.paid.mjs', 'tests/ux/composer-b3-reference-paid.rehearsal.walk.mjs', 'tests/ux/_composerReferenceRow.mjs']

const isWindow = (node) => ts.isIdentifier(node) && node.text === 'window'
const isCallOf = (call, callee) => Boolean(call) && ts.isCallExpression(call) && call.expression === callee

/** 一处提到 __nomi 的标识符 / 字面量 → 放行的哪一种（kind），或者红的原因（reason）。 */
function bridgeUsage(node) {
  if (!ts.isIdentifier(node)) {
    const call = node.parent
    const setItem = ts.isCallExpression(call) && call.arguments.length === 2 && call.arguments[0] === node ? call.expression : null
    const isSwitch = Boolean(setItem) && ts.isStringLiteral(node) && node.text === '__nomiE2E'
      && ts.isStringLiteral(call.arguments[1]) && call.arguments[1].text === '1'
      && ts.isPropertyAccessExpression(setItem) && setItem.name.text === 'setItem'
      && ts.isPropertyAccessExpression(setItem.expression) && setItem.expression.name.text === 'localStorage' && isWindow(setItem.expression.expression)
    return isSwitch ? { kind: 'e2e-switch' } : { reason: "字符串 / 模板 / 正则里写了桥名（只放行 window.localStorage.setItem('__nomiE2E', '1')）" }
  }
  if (node.text !== '__nomiCanvasStore') return { reason: `用了白名单外的 E2E 桥 ${node.text}` }
  const bridge = node.parent
  if (!ts.isPropertyAccessExpression(bridge) || bridge.name !== node || !isWindow(bridge.expression)) return { reason: '不是 window.__nomiCanvasStore 这种写法（globalThis. / 裸名 / 从 window 解构出桥）' }
  const up = bridge.parent
  if (ts.isCallExpression(up) && ts.isIdentifier(up.expression) && up.expression.text === 'Boolean' && up.arguments.length === 1) return { kind: 'exists' }
  if (!ts.isPropertyAccessExpression(up) || up.name.text !== 'getState') {
    return { reason: `用了 ${ts.isPropertyAccessExpression(up) ? `window.__nomiCanvasStore.${up.name.text}` : 'window.__nomiCanvasStore 本身（取别名 / 当参数传走）'}（只放行 Boolean(…) 判存在、getState().nodes.find(…)、getState().addNode(…)）` }
  }
  const state = up.parent
  if (!isCallOf(state, up)) return { reason: '把 window.__nomiCanvasStore.getState 本身拿走了' }
  const member = state.parent
  if (ts.isVariableDeclaration(member)) {
    return { reason: ts.isIdentifier(member.name) ? `取了别名 ${member.name.text} = …getState()（拿着别名什么都能写）` : '解构了 getState()（拿出来的成员什么都能写）' }
  }
  if (!ts.isPropertyAccessExpression(member) || member.expression !== state) return { reason: 'getState() 的结果没有直接读 .nodes.find(…) 或调 .addNode(…)' }
  if (member.name.text === 'addNode' && isCallOf(member.parent, member)) return { kind: 'addNode' }
  const find = member.parent
  if (member.name.text === 'nodes' && ts.isPropertyAccessExpression(find) && find.name.text === 'find' && isCallOf(find.parent, find)) return { kind: 'read' }
  return { reason: `用了 getState().${member.name.text}（只放行 .nodes.find(…) 读节点、.addNode(…) 布场景）` }
}

/** 这条样本自有文件里 E2E 桥用法的问题；空数组 = 全在白名单里。 */
function bridgeProblems(files) {
  const problems = []
  const addNodes = []
  let switchAt = -1
  for (const { file, text } of files) {
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const where = (node) => `${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}`
    const visit = (node) => {
      const literal = ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isRegularExpressionLiteral(node)
      if (literal && node.text.includes('__nomi')) {
        const usage = bridgeUsage(node)
        if (usage.reason) problems.push(`${where(node)} ${usage.reason}`)
        if (usage.kind === 'addNode') addNodes.push({ file, at: node.getStart(tree), where: where(node) })
      }
      const callee = ts.isAwaitExpression(node) && ts.isCallExpression(node.expression) ? node.expression.expression : null
      if (file === STEPS && switchAt === -1 && callee && ts.isIdentifier(callee) && callee.text === 'switchToFirstLast') switchAt = node.getStart(tree)
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
  if (addNodes.length !== 1) problems.push(`布场景的 addNode 有 ${addNodes.length} 处（${addNodes.map((entry) => entry.where).join('、') || '没有'}），应恰好 1 处`)
  if (switchAt === -1) problems.push(`${STEPS} 里找不到 await switchToFirstLast(…)：经参数面板切首尾帧那一步没了`)
  for (const entry of addNodes) {
    if (entry.file !== STEPS) problems.push(`${entry.where} addNode 不在步骤本体里`)
    else if (switchAt !== -1 && entry.at > switchAt) problems.push(`${entry.where} addNode 在 await switchToFirstLast( 之后：布场景之后不许再写 store`)
  }
  return problems
}

// 第 1 轮 switchToFirstLast 里那段退路的写 store 部分，原样（dd0941c48；协调退回的就是它：点不到就改写方式、照样往下走去花钱）。
const ROUND1_FALLBACK = [
  "    if (await modeId() !== 'firstlast') {",
  '      await win.evaluate((id) => {',
  '        const state = window.__nomiCanvasStore.getState()',
  '        const node = state.nodes.find((candidate) => candidate.id === id)',
  "        state.updateNode(id, { meta: { ...node.meta, archetype: { ...node.meta.archetype, modeId: 'firstlast' } } })",
  '      }, shotId)',
  '    }',
].join('\n')
const BEFORE_COMPOSER = '  const composer = win.locator('
const insertBefore = (anchor, line) => (text) => text.replace(anchor, `${line}\n${anchor}`)
const COUNTER_EXAMPLES = [
  ['第 1 轮的退路原样塞回 switchToFirstLast（截图 + 抛错换成取别名再 updateNode）', (text) => text.replace(/ {4}await walk\.snap\('fail-mode-switch'\)\n[\s\S]*?throw new Error\([^\n]*\n/, `${ROUND1_FALLBACK}\n`), /取了别名 state = …getState\(\)/],
  ['选中改回写 store：getState().selectNode(id)', insertBefore(BEFORE_COMPOSER, '  await win.evaluate((id) => window.__nomiCanvasStore.getState().selectNode(id), shotId)'), /用了 getState\(\)\.selectNode/],
  ['window.__nomiCanvasStore.setState({})', insertBefore(BEFORE_COMPOSER, '  await win.evaluate(() => window.__nomiCanvasStore.setState({}))'), /用了 window\.__nomiCanvasStore\.setState/],
  ['再加一次 addNode', insertBefore(BEFORE_COMPOSER, "  await win.evaluate(() => window.__nomiCanvasStore.getState().addNode({ kind: 'video' }).id)"), /addNode 有 2 处/],
  ['切方式挪到布场景之前（布场景的写落在切方式之后）', insertBefore('  // 视频镜头：', '  await switchToFirstLast(win, walk, composer, shotId)'), /addNode 在 await switchToFirstLast\( 之后/],
  ['解构 getState()', insertBefore(BEFORE_COMPOSER, '  await win.evaluate((id) => { const { updateNode } = window.__nomiCanvasStore.getState(); updateNode(id, {}) }, shotId)'), /解构了 getState\(\)/],
  ['换一座桥写：window.__nomiCapabilityApply', insertBefore(BEFORE_COMPOSER, '  await win.evaluate(() => window.__nomiCapabilityApply({}))'), /白名单外的 E2E 桥 __nomiCapabilityApply/],
  ['把写法藏进字符串：win.evaluate(\'…setState…\')', insertBefore(BEFORE_COMPOSER, "  await win.evaluate('window.__nomiCanvasStore.setState({})')"), /字符串 \/ 模板 \/ 正则里写了桥名/],
]

describe('付费样本花钱前真的核界面状态（反例：删掉这道判，这里红）', () => {
  it('步骤本体在点 ↑ 之前读选中镜头的生成框参考行、判过才往下走；判出的问题并进花钱前的那一次抛错', () => {
    const source = readRepo(STEPS).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // 红了就点名「花钱前不核界面状态」：协调看报错就知道这条付费样本又退回了只核 store 的老样子。
    const NOT_CHECKED = '花钱前不核界面状态'
    // 读：页面里取生成框 → 拆 → 判（不是截图了事）。
    expect(source, `${NOT_CHECKED}：步骤本体里没有「页面里取生成框 → 拆 → 判」这一道`).toMatch(/judgeComposerReferences\(readComposerReferences\(await win\.evaluate\(pageReadComposer, shotId\)\)/)
    const read = source.indexOf('await readComposerUntilSettled(win, shotId')
    const merged = source.indexOf('problems.push(...shown.problems)')
    // 认旅程里那一句（带「：\n」）：switchToFirstLast 点不到时也抛同前缀的错，不能混成一处。
    const thrown = source.indexOf('花钱前核对没过（一分钱没花）：\\n')
    const spend = source.indexOf('clickOrFail(generateButton')
    expect([read, merged, thrown, spend].every((index) => index > -1), `${NOT_CHECKED}：读 / 并进问题 / 抛错 / 点 ↑ 缺了一步 ${JSON.stringify({ read, merged, thrown, spend })}`).toBe(true)
    expect(read < merged && merged < thrown && thrown < spend, `${NOT_CHECKED}：顺序应是读 → 并进问题 → 抛错 → 才点 ↑`).toBe(true)
  })

  it('花钱前只经界面改状态：样本自有文件对 E2E 桥的每一处用法都在白名单里，布场景的 addNode 恰好 1 处、在切方式之前', () => {
    expect(bridgeProblems(SAMPLE_FILES.map((file) => ({ file, text: readRepo(file) })))).toEqual([])
  })

  it.each(COUNTER_EXAMPLES)('反例：%s → 红', (_name, mutate, expected) => {
    const original = readRepo(STEPS)
    const mutated = mutate(original)
    expect(mutated, '反例没改到步骤本体（锚点变了，反例要跟着改，不然它什么也没证）').not.toBe(original)
    const files = SAMPLE_FILES.map((file) => ({ file, text: file === STEPS ? mutated : readRepo(file) }))
    expect(bridgeProblems(files).join('\n')).toMatch(expected)
  })
})
