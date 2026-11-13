// 生成框参考行（B3）「在用 / 未用到」的读与判——纯函数，不起 App、不花钱就能单测。
//
// 付费走查 composer-b3-reference.paid.mjs（步骤本体 _composerB3ReferenceSteps.mjs，零花费演练共用）花钱前要核
// 「界面上标为在用的参考 = 要发出去的参考」。它不自己推导谁在用：
// 只在页面里取选中镜头那张生成框的 outerHTML（pageReadComposer），交给 readComposerReferences 拆，再按场景判
// （judgeComposerReferences）。锚点全取自生产组件 src/workbench/assets/AssetReference.tsx——NodeParameterControls 把
// resolveReferencePlacement 的落槽 / 未用到原样交给它，和请求组装同一个推导：
//   · [data-reference-row]                     参考行（一张生成框恰好一行）
//   · [data-asset-slot="firstFrameUrl" | …]    单图格（首尾帧方式下的首帧、尾帧；格里有小图 = 在用）
//   · [data-asset-slot-group="array"]          参考数组（参考方式下在用的那一排）
//   · [data-reference-unused]                  「未用到」淡格（清单 ComposerB3 板的 ref.slot.unused；旧工程残留另带 data-reference-parked）
//   · [data-asset-tile] … <img src>            每张小图；src 就是节点上存的那个地址（AssetTile → NomiImage，不改写）
// 零花费测试（_composerReferenceRow.test.mjs）拿同一个生产组件的服务端渲染喂这两个函数：组件改了锚点或嵌套，
// 测试先红——不等协调付费那一刻才发现（旧脚本 reference-leak-hotfix.paid.mjs 就是这样在 B3 上悄悄失效的）。

/**
 * 在页面里跑（`win.evaluate(pageReadComposer, nodeId)`）：这个节点下的生成框有几张、第一张的 outerHTML。
 * Playwright 只序列化函数源码，所以里面不许引用模块里的任何东西（选择器写死在这里）。
 */
export function pageReadComposer(nodeId) {
  const composers = [...document.querySelectorAll('.generation-canvas-v2-node__composer')]
    .filter((element) => element.closest('[data-node-id]')?.getAttribute('data-node-id') === nodeId)
  return { composers: composers.length, html: composers[0]?.outerHTML ?? '' }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decode(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)))
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

/** 一个开标签里的属性（值里有 `>`、有实体都认；没写值的布尔属性记成空串）。 */
function attributesOf(tag) {
  const attrs = {}
  const body = tag.replace(/^<[a-z0-9]+/i, '').replace(/\/?>$/, '')
  for (const match of body.matchAll(/\s([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attrs
}

// 开标签：引号里的 `>` 不算结束（浏览器序列化 outerHTML 时属性值里的 `>` 不一定转义）。
const DIV_TOKEN = /<div\b(?:[^>"']|"[^"]*"|'[^']*')*>|<\/div\s*>/gi
const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi
// 小图本体的属性（data-asset-tile-tag / -remove / -tip 是别的东西，后面跟的是 `-` 不是 `=`）。
const TILE_ATTR = /\sdata-asset-tile\s*=/gi

/** 文档顺序里每个满足 `wanted(attrs)` 的 div：它的属性与里面的 HTML（按 div 配平，嵌套照样对）。 */
function divBlocks(html, wanted) {
  const found = []
  const stack = []
  let match
  DIV_TOKEN.lastIndex = 0
  while ((match = DIV_TOKEN.exec(html)) !== null) {
    if (match[0][1] !== '/') {
      const attrs = attributesOf(match[0])
      stack.push({ attrs, from: DIV_TOKEN.lastIndex, keep: wanted(attrs) })
      continue
    }
    const open = stack.pop()
    if (open?.keep) found.push({ attrs: open.attrs, from: open.from, inner: html.slice(open.from, match.index) })
  }
  return found.sort((a, b) => a.from - b.from).map(({ attrs, inner }) => ({ attrs, inner }))
}

function imageSources(html) {
  return [...String(html).matchAll(IMG_TAG)].map((match) => attributesOf(match[0]).src).filter((src) => typeof src === 'string' && src !== '')
}
function tileCount(html) {
  return [...String(html).matchAll(TILE_ATTR)].length
}
function textOf(html) {
  return decode(String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/**
 * 生成框 outerHTML（pageReadComposer 的结果）→ 参考行快照。只拆，不判。
 * @param {{ composers: number, html: string }} read
 */
export function readComposerReferences({ composers, html }) {
  const rows = divBlocks(html, (attrs) => 'data-reference-row' in attrs)
  const row = rows[0]?.inner ?? ''
  const cell = (block) => ({ tiles: tileCount(block.inner), srcs: imageSources(block.inner), text: textOf(block.inner) })
  return {
    composers,
    rows: rows.length,
    slots: divBlocks(row, (attrs) => 'data-asset-slot' in attrs).map((block) => ({ key: block.attrs['data-asset-slot'], ...cell(block) })),
    arrays: divBlocks(row, (attrs) => attrs['data-asset-slot-group'] === 'array').map(cell),
    unused: divBlocks(row, (attrs) => 'data-reference-unused' in attrs).map((block) => ({ parked: block.attrs['data-reference-parked'] === 'true', ...cell(block) })),
  }
}

/**
 * 小图地址 → 场景里的文件名（认不出 → null）。先按完整的本地地址认（去掉查询串），再按路径最后一段的文件名认。
 * @param {string[]} files
 * @param {(file: string) => string} localUrlOf
 */
export function fileMapper(files, localUrlOf) {
  const bare = (url) => String(url).split('?')[0].split('#')[0]
  const byUrl = new Map(files.map((file) => [bare(localUrlOf(file)), file]))
  return (src) => {
    const url = bare(src)
    if (byUrl.has(url)) return byUrl.get(url)
    let last = url.slice(url.lastIndexOf('/') + 1)
    try { last = decodeURIComponent(last) } catch { /* 不是合法的百分号编码：按原样比 */ }
    return files.includes(last) ? last : null
  }
}

const sorted = (list) => [...list].sort().join('、')

/**
 * 判：花钱前 B3 生成框上标的就是场景要的样子——frames 每格恰好一张、是那张图（在用）；参考数组里没有在用的图；
 * 「未用到」恰好是 unused 那几张，每格一张（只变淡、格下不写字：边界样张 K3，用户 2026-11-12）。
 * @param {ReturnType<typeof readComposerReferences>} snapshot
 * @param {{ frames: Array<{ slot: string, file: string }>, unused: string[], fileOf: (src: string) => string | null }} scene
 * @returns {{ problems: string[], summary: Record<string, unknown> }}
 */
export function judgeComposerReferences(snapshot, { frames, unused, fileOf }) {
  const problems = []
  // 认不出的图只露路径最后一段（本地地址里没有密钥，但报告要短）。
  const name = (src) => fileOf(src) ?? `?${String(src).split('?')[0].split('/').pop().slice(0, 40)}`
  if (snapshot.composers !== 1) problems.push(`选中镜头下的生成框有 ${snapshot.composers} 张（应恰好 1 张：没选中、或多选时不挂生成框）`)
  if (snapshot.rows !== 1) problems.push(`生成框里的参考行有 ${snapshot.rows} 行（应恰好 1 行）`)

  const keys = snapshot.slots.map((slot) => slot.key)
  if (keys.join('|') !== frames.map((frame) => frame.slot).join('|')) {
    problems.push(`生成框里的单图格是 [${keys.join('、') || '没有'}]，应是 [${frames.map((frame) => frame.slot).join('、')}]（方式没切到首尾帧？）`)
  }
  for (const frame of frames) {
    const slot = snapshot.slots.find((candidate) => candidate.key === frame.slot)
    const shown = (slot?.srcs ?? []).map(name)
    if (!slot || slot.tiles !== 1 || shown.length !== 1 || shown[0] !== frame.file) {
      problems.push(`「${frame.slot}」格里标为在用的是 ${shown.join('、') || '（空）'}（小图 ${slot?.tiles ?? 0} 张），应恰好是 ${frame.file}`)
    }
  }
  const arrayInUse = snapshot.arrays.flatMap((group) => group.srcs.map(name))
  const arrayTiles = snapshot.arrays.reduce((sum, group) => sum + group.tiles, 0)
  if (arrayTiles > 0) problems.push(`参考数组里还有 ${arrayTiles} 张标为在用：${arrayInUse.join('、') || '（小图没出图）'}（首尾帧方式下不该有）`)

  const unusedShown = snapshot.unused.flatMap((entry) => entry.srcs.map(name))
  if (sorted(unusedShown) !== sorted(unused)) problems.push(`标「未用到」的是 ${unusedShown.join('、') || '（没有）'}，应恰好是 ${unused.join('、')}`)
  snapshot.unused.forEach((entry, index) => {
    if (entry.tiles !== 1 || entry.srcs.length !== 1) problems.push(`第 ${index + 1} 个「未用到」格里有 ${entry.tiles} 张小图、${entry.srcs.length} 张出了图（应各 1 张；没出图 = 图片加载失败）`)
  })

  const everySrc = [...snapshot.slots, ...snapshot.arrays, ...snapshot.unused].flatMap((cell) => cell.srcs)
  const strangers = everySrc.filter((src) => fileOf(src) === null)
  if (strangers.length) problems.push(`参考行里有 ${strangers.length} 张图对不回场景里的文件：${strangers.map(name).join('、')}`)

  return {
    problems,
    summary: {
      inUse: Object.fromEntries(snapshot.slots.map((slot) => [slot.key, slot.srcs.map(name)])),
      slotLabels: snapshot.slots.map((slot) => slot.text),
      arrayInUse,
      unused: unusedShown,
      parked: snapshot.unused.filter((entry) => entry.parked).flatMap((entry) => entry.srcs.map(name)),
      problems,
    },
  }
}
