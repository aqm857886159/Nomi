// 设计实验室 · 付费卡（SpendCardQ1 板，2026-10-24 D2 第③步）走查。零额度：纯本地渲染，不碰任何生成 API。
//
// 每一格都是真面板里那张卡（生产钩子 useAgentPanelSpendCard + 生产卡体 + 生产面板），夹具只是画布节点、制作 Run 与宿主推过来的那一次出价。
// 每一格截图（中英、光暗）+ 下面这些板断言。断言名就是 SpendCardQ1.board.json 里各元素的 `assertion`（check:board-parity R4）。
// 期望的字一律从词典按键取（不在走查里再抄一份文案）；看不见的宿主行为（点「生成」走画布那一台发动机、节点改了卡跟着变、
// 完成时画布各亮一下、收起后小球数上它）在真 Electron 里钉：tests/ux/agent-spend-card.walk.mjs。
//
// 「点过 / 鼠标停在」的格子一律用真指针（Playwright 的真鼠标：CSS :hover 才会亮，「不生成 ×」才会露出来）做完再拍、再断言——
// 不用程序 focus() 或合成的 pointerover（那样拍出来是「格子亮了、× 没出来」的假悬停帧，或者多出一圈键盘焦点环）。
// 驱动（walkScreen.mjs）在断言之前就拍了每一格（那时没有指针），所以走真指针的格子在这里做完动作后重拍同一个文件。
//
// 用法：node tests/ux/design-lab-spend-card.walk.mjs  （ONLY=spend-batch 只跑一格）
import path from 'node:path'
import { expect } from '@playwright/test'
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'
import { REPO_ROOT } from './design-lab/labStates.mjs'
import { uiText, uiTextPattern, uiTextWith } from './full-walk/invariants.mjs'

const A = {
  title: 'board:SpendCardQ1/card.title',
  badge: 'board:SpendCardQ1/card.badge',
  pointers: 'board:SpendCardQ1/card.pointers',
  exclude: 'board:SpendCardQ1/card.pointer.exclude',
  summary: 'board:SpendCardQ1/card.summary',
  total: 'board:SpendCardQ1/card.total',
  status: 'board:SpendCardQ1/card.pointer.status',
  perShot: 'board:SpendCardQ1/card.per-shot',
  cancel: 'board:SpendCardQ1/card.cancel',
  generate: 'board:SpendCardQ1/card.generate',
  progress: 'board:SpendCardQ1/card.progress',
  progressStop: 'board:SpendCardQ1/card.progress.stop',
  done: 'board:SpendCardQ1/card.done',
  failure: 'board:SpendCardQ1/card.failure',
  decline: 'board:SpendCardQ1/card.failure.decline',
  retry: 'board:SpendCardQ1/card.failure.retry',
  goEdit: 'board:SpendCardQ1/card.failure.go-edit',
  brake: 'board:SpendCardQ1/card.brake-note',
  unreadable: 'board:SpendCardQ1/card.unreadable',
  // 同一行刹车原因也是「权限两档」那张板的元素（刹车把直接档退回这张卡，原因写在标题下）。
  brakeReason: 'board:AgentPermissionTiers/spend-card.brake-reason',
  // 卡里的指向元素是 NodePointer 板的生产件：P1 外壳（标题行在框外）、「已定位」是那张板的元素。
  p1: 'board:NodePointer/pointer.p1',
  located: 'board:NodePointer/pointer.located',
}

const SHOT_DIR = path.join(REPO_ROOT, 'tests/ux/shots/design-lab-spend-card')

const NODE = (shot) => `lab-spend-node-${shot}`
const MONEY = /[¥￥$€£]|\d+\.\d{2}/

/** 词典取字 + 填占位；带 count 的走复数后缀（共用的 `uiTextWith`）。 */
const tr = (locale, key, values = {}) => uiTextWith(locale, key, values)

/** 带一个占位的那句话 → 正则（占位成捕获组），用来从卡上把「镜 02」这一类读回来。 */
const pattern = (locale, key) => new RegExp(uiTextPattern(uiText(locale, key), { anchored: true }) + '$')

const localeOf = (id) => (/-en(?:-|$)/.test(id) ? 'en' : 'zh-CN')

/** 卡上此刻摆着的一切（一次读完，断言在 Node 这边比）。 */
async function cardFacts(page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-v4-block="intervention"]')
    if (!card) return null
    const text = (selector) => card.querySelector(selector)?.textContent?.trim() ?? null
    const confirm = card.querySelector('[data-v4-control="confirm"]')
    const dismiss = card.querySelector('[data-v4-control="slot-dismiss"]')
    const body = card.querySelector('[data-v4-block="spend-body"]')
    const pointers = body ? [...body.querySelectorAll('[data-node-pointer]')].map((el) => ({
      id: el.getAttribute('data-node-pointer-id'),
      face: el.getAttribute('data-node-pointer-face'),
      density: el.getAttribute('data-node-pointer'),
      title: el.querySelector('[data-node-pointer-title]')?.textContent?.trim() ?? '',
      located: Boolean(el.querySelector('[data-node-pointer-located]')),
      text: el.textContent ?? '',
      aria: el.getAttribute('aria-label') ?? '',
      disabled: el.getAttribute('aria-disabled') === 'true',
      frame: (() => {
        const frame = el.querySelector('[data-node-pointer-frame]')
        if (!frame) return null
        const rect = frame.getBoundingClientRect()
        return { ratio: rect.width / rect.height }
      })(),
      // 缩略图正中这一格自己画的件（种类图标 / 状态胶囊 / 已定位）；宿主挂的常驻「恢复」另算（pinned）。
      centers: [...(el.querySelector('[data-node-pointer-frame]')?.querySelectorAll('[data-node-pointer-center]') ?? [])].map((node) => node.getAttribute('data-node-pointer-center')),
      pinned: Boolean(el.closest('[data-node-pointer-cell]')?.hasAttribute('data-accessory-pinned')),
      hot: el.getAttribute('data-node-pointer-hot') === 'true',
      // 标题行在画面框外（上面一行），不是框里的东西。
      titleOutsideFrame: (() => {
        const title = el.querySelector('[data-node-pointer-title]')
        const frame = el.querySelector('[data-node-pointer-frame]')
        if (!title || !frame) return null
        return !frame.contains(title) && title.getBoundingClientRect().bottom <= frame.getBoundingClientRect().top + 1
      })(),
    })) : []
    const toggles = body ? [...body.querySelectorAll('[data-spend-exclusion]')].map((el) => ({
      kind: el.getAttribute('data-spend-exclusion'),
      name: el.getAttribute('aria-label') ?? '',
      text: el.textContent?.trim() ?? '',
      // 露没露出来归组管（藏的是钮外面那一槽）：从钮往上乘到格子为止，才是人眼看到的透明度。
      opacity: (() => {
        let value = 1
        for (let node = el; node && !node.matches('[data-node-pointer-cell]'); node = node.parentElement) value *= Number(getComputedStyle(node).opacity)
        return value
      })(),
      disabled: el.disabled,
      cell: el.closest('[data-node-pointer-cell]')?.querySelector('[data-node-pointer]')?.getAttribute('data-node-pointer-id') ?? null,
      excluded: Boolean(el.closest('[data-node-pointer-cell]')?.querySelector('[data-node-pointer-cell-dimmed]')),
      // 「不生成 ×」要和输入框里参考图的 × 是同一件（共用 ThumbCornerX）：标记、点击区、圆点的大小与颜色、圆点在这一格画面框的哪个位置。
      cornerX: (() => {
        const rect = (node) => { const box = node.getBoundingClientRect(); return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height } }
        const dot = el.querySelector(':scope > i')
        const frame = el.closest('[data-node-pointer-cell]')?.querySelector('[data-node-pointer-frame]')
        // 颜色串的写法不一（oklch / oklab / rgb）：统一画到 1 个像素上读回 sRGB 再比。
        const rgb = (value) => { const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1; const context = canvas.getContext('2d', { willReadFrequently: true }); context.fillStyle = '#000'; context.fillStyle = value; context.fillRect(0, 0, 1, 1); return Array.from(context.getImageData(0, 0, 1, 1).data).join(',') }
        const token = (name) => { const probe = document.createElement('span'); probe.style.color = `var(${name})`; document.body.append(probe); const value = rgb(getComputedStyle(probe).color); probe.remove(); return value }
        const dotStyle = dot ? getComputedStyle(dot) : null
        return {
          shared: el.hasAttribute('data-thumb-corner-x'),
          hit: rect(el),
          dot: dot ? rect(dot) : null,
          frame: frame ? rect(frame) : null,
          dotBackground: dotStyle ? rgb(dotStyle.backgroundColor) : null,
          dotColor: dotStyle ? rgb(dotStyle.color) : null,
          dotRadius: dotStyle ? Number.parseFloat(dotStyle.borderTopLeftRadius) : null,
          ink: token('--nomi-ink'),
          paper: token('--nomi-paper'),
        }
      })(),
    })) : []
    const notices = [...card.querySelectorAll('[data-v4-block="spend-notice"]')].map((el) => ({
      tone: el.getAttribute('data-tone'),
      text: el.querySelector('span > span')?.textContent ?? el.textContent ?? '',
      detail: el.querySelector('[data-v4-block="spend-notice-detail"]')?.textContent ?? null,
    }))
    const perShot = card.querySelector('[data-v4-block="price-per-item"]')
    const confirmText = confirm ? (confirm.textContent ?? '').replace('⏎', '').trim() : null
    return {
      kind: card.getAttribute('data-kind'),
      tone: card.getAttribute('data-tone'),
      waiting: card.getAttribute('data-waiting'),
      // 标题那一句：标题行里去掉徽章与图标剩下的字（不按字面减徽章——「生成」两个字标题里也有）。
      title: (() => {
        const heading = card.querySelector('[data-v4-block="slot-title"]')
        if (!heading) return null
        const clone = heading.cloneNode(true)
        clone.querySelectorAll('[data-v4-block="slot-badge"], [data-v4-block="slot-title-icon"]').forEach((node) => node.remove())
        return clone.textContent?.trim() ?? ''
      })(),
      badge: text('[data-v4-block="slot-badge"]'),
      titleIcon: Boolean(card.querySelector('[data-v4-block="slot-title-icon"]')),
      progress: text('[data-v4-block="slot-progress"]'),
      confirm: confirm ? { text: confirmText, disabled: confirm.disabled, locate: Boolean(confirm.querySelector('svg')) } : null,
      dismiss: dismiss ? { text: dismiss.textContent?.trim() ?? '', disabled: dismiss.disabled } : null,
      pointers,
      toggles,
      notices,
      groupSummary: body?.querySelector('[data-node-pointer-group-summary]')?.textContent ?? null,
      groupSummaryTitle: body?.querySelector('[data-node-pointer-group-summary]')?.getAttribute('title') ?? null,
      hoverSummary: body?.querySelector('[data-node-pointer-hover-summary]')?.textContent ?? null,
      perShot: perShot ? {
        open: perShot.open,
        label: perShot.querySelector('summary')?.textContent?.trim() ?? '',
        rows: [...perShot.querySelectorAll(':scope > div > div')].map((row) => [...row.children].map((cell) => cell.textContent ?? '')),
      } : null,
      // 卡上不许有一个可改的东西：编辑器零件（生成框、参数 chip、摘要 pill、参数面板）与输入框一个都不许出现（设计系统 §1.0）。
      editors: card.querySelectorAll('textarea, input, select, [contenteditable="true"], [data-composer-host], [data-node-composer-footer], [data-parameter-chip], [data-parameter-summary], [data-agent-parameter-panel]').length,
      cardText: card.textContent ?? '',
      // 逐镜价格折叠口（板 card.per-shot）展开后本来就印每镜价（D5）；「界面不谈钱」查的是它以外的所有字。
      // （d3be41f5d 把这条从「页脚」改成了「整张卡」，把折叠口里板上写明要印的价也当成违规——spend-mixed 两格因此一直红，只跑 4 格时看不见。）
      cardTextOutsidePerShot: (() => {
        const clone = card.cloneNode(true)
        clone.querySelectorAll('[data-v4-block="price-per-item"]').forEach((node) => node.remove())
        return clone.textContent ?? ''
      })(),
      cardBox: (() => { const rect = card.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width } })(),
      confirmBox: confirm ? (() => { const rect = confirm.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width } })() : null,
    }
  })
}

/** 不许蓝色描边：卡体与收据里没有一个类把强调色 / info 色用在边线、环、描边、阴影上（转圈的文字色不算）。 */
async function noAccentOutline(page, state, record) {
  const offenders = await page.evaluate(() => {
    const bad = []
    for (const root of document.querySelectorAll('[data-v4-block="spend-body"], [data-v4-block="generation-receipt-pointers"]')) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const cls = typeof el.className === 'string' ? el.className : el.getAttribute('class') || ''
        if (/(?:border|ring|outline|shadow)-[^\s]*(?:accent|info)/.test(cls)) bad.push(cls.slice(0, 120))
      }
    }
    return bad
  })
  if (offenders.length) record(`${state.id} ${A.pointers}: 出现强调色描边类 ${offenders.slice(0, 3).join(' | ')}`)
}

/** 每一张卡都守的几条：卡上没有编辑器零件、动作行上不出钱、不许蓝描边。 */
async function commonCard(page, state, record, facts) {
  if (facts.editors) record(`${state.id} ${A.pointers}: 卡上出现了 ${facts.editors} 个可改的东西（生成框 / 参数 chip / 输入框）——改参数的家只有节点`)
  if (MONEY.test(facts.cardTextOutsidePerShot)) record(`${state.id} ${A.total}: 卡上印了钱「${facts.cardTextOutsidePerShot}」（10-08 界面不谈钱；逐镜折叠口除外）`)
  if (facts.confirm && MONEY.test(facts.confirm.text)) record(`${state.id} ${A.generate}: 主按钮印了钱「${facts.confirm.text}」`)
  expectOneCenter(state, record, facts)
  await noAccentOutline(page, state, record)
}

const faceOf = (facts, shot) => facts.pointers.find((pointer) => pointer.id === NODE(shot))

/** 等人决定的那一档（板 ①②⑦⑧ 与连带的去掉 / 删除 / 剩下 N 段 / 换过模型）。 */
async function expectDecide(page, state, record, facts, expected) {
  const locale = localeOf(state.id)
  if (facts.kind !== 'spend') record(`${state.id} ${A.title}: 介入槽里不是付费卡（kind=${facts.kind}）`)
  if (facts.tone) record(`${state.id} ${A.failure}: 等人决定的卡不该是警示边（tone=${facts.tone}）`)
  if (facts.waiting !== 'true') record(`${state.id} ${A.title}: 等人决定的卡外框要是「在等你」（waiting=${facts.waiting}）`)
  if (facts.titleIcon) record(`${state.id} ${A.title}: 等人决定的标题前不顶图标`)
  const title = expected.title ?? (expected.remaining
    ? tr(locale, expected.video === false ? 'agentPanelV4.spendParamsTitleRemainingImage' : 'agentPanelV4.spendParamsTitleRemainingVideo', { count: expected.asked })
    : expected.video === false
      ? tr(locale, expected.asked === 1 ? 'agentPanelV4.spendParamsTitleImageSingle' : 'agentPanelV4.spendParamsTitleImage', { count: expected.asked })
      : tr(locale, 'agentPanelV4.spendParamsTitle', { count: expected.asked }))
  if (facts.title !== title) record(`${state.id} ${A.title}: 标题应是「${title}」，实际「${facts.title}」`)
  // 卡标题是一句问话、不带数量（数量只在主按钮）：中英都不许有数字。
  if (/\d/.test(facts.title ?? '')) record(`${state.id} ${A.title}: 标题里不许带数量（数量只在主按钮），实际「${facts.title}」`)
  if (facts.badge) record(`${state.id} ${A.badge}: 方案一不再显示标题徽章（实际「${facts.badge}」）`)
  const generate = expected.confirm
  if (!facts.confirm || facts.confirm.text !== generate) record(`${state.id} ${A.generate}: 主按钮应是「${generate}」，实际「${facts.confirm?.text}」`)
  if (facts.confirm && facts.confirm.disabled !== Boolean(expected.disabled)) record(`${state.id} ${A.generate}: 主按钮${expected.disabled ? '应置灰' : '应可点'}（disabled=${facts.confirm.disabled}）`)
  if (facts.confirm?.locate) record(`${state.id} ${A.generate}: 「生成」前不该有定位图标`)
  const cancel = tr(locale, 'agentPanelV4.reject')
  if (!facts.dismiss || facts.dismiss.text !== cancel || facts.dismiss.disabled) record(`${state.id} ${A.cancel}: 「${cancel}」应在且可点：${JSON.stringify(facts.dismiss)}`)
  if (Boolean(facts.perShot) !== Boolean(expected.perShot)) record(`${state.id} ${A.perShot}: 逐镜折叠${expected.perShot ? '应出现（各镜价格不同）' : '不该出现'}`)
  if (facts.progress) record(`${state.id} ${A.progress}: 等人决定的卡不该有进度行`)
  await commonCard(page, state, record, facts)
}

/** 多段卡的指向元素：一组三格，各格是节点此刻的样子；读屏名 = 镜号 + 名字 + 状态 + 点了去定位。 */
function expectGroup(state, record, facts, faces) {
  const locale = localeOf(state.id)
  const cards = facts.pointers.filter((pointer) => pointer.density === 'card')
  if (cards.length !== faces.length) record(`${state.id} ${A.pointers}: 应有 ${faces.length} 个指向元素，实际 ${cards.length}`)
  faces.forEach((face, index) => {
    const pointer = faceOf(facts, index + 1)
    if (pointer?.face !== face) record(`${state.id} ${A.pointers}: 镜 ${index + 1} 应是 ${face}，实际 ${pointer?.face}`)
  })
  const hint = locale === 'en' ? /Opens it on the canvas/ : /点了在画布上定位/
  const live = cards.filter((pointer) => pointer.face !== 'removed')
  if (live.some((pointer) => !hint.test(pointer.aria))) record(`${state.id} ${A.pointers}: 指向元素读屏名没说「点了去节点」：${live.map((pointer) => pointer.aria).join(' | ')}`)
}

function expectToggles(state, record, facts, kinds) {
  const got = [1, 2, 3].map((shot) => facts.toggles.find((toggle) => toggle.cell === NODE(shot))?.kind ?? null)
  if (JSON.stringify(got) !== JSON.stringify(kinds)) record(`${state.id} ${A.exclude}: 各格小钮应是 ${JSON.stringify(kinds)}，实际 ${JSON.stringify(got)}`)
  const locale = localeOf(state.id)
  for (const toggle of facts.toggles) {
    const key = toggle.kind === 'restore' ? 'agentPanelV4.spendCard.restoreName' : 'agentPanelV4.spendCard.excludeName'
    if (!pattern(locale, key).test(toggle.name)) record(`${state.id} ${A.exclude}: 小钮读屏名「${toggle.name}」不是词典那一句（${key}）`)
    if (toggle.kind === 'restore' && (toggle.opacity < 0.99 || !toggle.excluded)) record(`${state.id} ${A.exclude}: 去掉了的那一格应淡下去、「恢复」常驻：${JSON.stringify(toggle)}`)
    if (toggle.kind === 'exclude') expectCornerX(state, record, toggle)
  }
}

/**
 * 「不生成」是缩略图右上角的小 ×，和输入框里参考图的 × 同一件（板 card.pointer.exclude；共用 ThumbCornerX，不是各画各的）：
 * 带共用件的标记、点击区 28px、圆点 16px 黑底（ink）白叉（paper）、圆点中心落在**这一格自己画面框**的右上角里 4px（竖图就在竖框自己的角上）。
 */
function expectCornerX(state, record, toggle) {
  const x = toggle.cornerX
  const near = (value, target, tolerance = 1) => Math.abs(value - target) <= tolerance
  if (!x.shared) record(`${state.id} ${A.exclude}: ${toggle.cell} 的「不生成」没有用共用的 ThumbCornerX（缺 data-thumb-corner-x）——样子要和参考图的 × 同一份定义`)
  if (!near(x.hit.width, 28) || !near(x.hit.height, 28)) record(`${state.id} ${A.exclude}: × 的点击区应是 28px，实际 ${x.hit.width.toFixed(1)}×${x.hit.height.toFixed(1)}`)
  if (!x.dot || !near(x.dot.width, 16) || !near(x.dot.height, 16)) record(`${state.id} ${A.exclude}: × 的圆点应是 16px，实际 ${JSON.stringify(x.dot && [x.dot.width, x.dot.height])}`)
  if (x.dotBackground !== x.ink || x.dotColor !== x.paper || !(x.dotRadius >= 8)) record(`${state.id} ${A.exclude}: × 应是黑底（ink）白叉（paper）的圆：${JSON.stringify({ bg: x.dotBackground, color: x.dotColor, ink: x.ink, paper: x.paper, radius: x.dotRadius })}`)
  if (x.dot && x.frame) {
    const right = x.frame.right - (x.dot.left + x.dot.width / 2)
    const top = x.dot.top + x.dot.height / 2 - x.frame.top
    if (!near(right, 4, 1.5) || !near(top, 4, 1.5)) record(`${state.id} ${A.exclude}: × 的圆点中心应在这一格画面框右上角里 4px（和参考图同一个摆法），实际 右 ${right.toFixed(1)}px / 上 ${top.toFixed(1)}px（${toggle.cell}）`)
  }
}

/** 鼠标（或键盘）停在哪一格，「不生成 ×」就只在那一格露出来；别的格子的藏着。 */
function expectOnlyShown(state, record, facts, shot) {
  const shown = facts.toggles.filter((toggle) => toggle.opacity > 0.99).map((toggle) => toggle.cell)
  if (JSON.stringify(shown) !== JSON.stringify([NODE(shot)])) record(`${state.id} ${A.exclude}: 鼠标停在镜 0${shot} 上时，只该露出它那一颗「不生成 ×」，实际露出 ${JSON.stringify(shown)}`)
}

/**
 * 缩略图正中只放一样东西（板 card.pointer.status / card.pointer.exclude）：这一格自己画的正中件（种类图标 / 状态胶囊 / 已定位）
 * 加上宿主挂的常驻「恢复」，合起来不许超过一件。铺满整格的（结果图、等待面）和贴角的小标不算正中件。
 * `expected`：每一格应是哪一档（'icon' | 'status' | 'located' | 'restore' | null）；缺省只验「不超过一件」。
 */
function expectOneCenter(state, record, facts, expected) {
  const cards = facts.pointers.filter((pointer) => pointer.density === 'card')
  cards.forEach((pointer, index) => {
    const pieces = [...pointer.centers, ...(pointer.pinned ? ['restore'] : [])]
    if (pieces.length > 1) record(`${state.id} ${A.status}: 镜 0${index + 1} 缩略图正中叠了 ${pieces.length} 样东西（${pieces.join(' + ')}），只许放一样`)
    if (expected && (pieces[0] ?? null) !== expected[index]) record(`${state.id} ${A.status}: 镜 0${index + 1} 缩略图正中应是 ${expected[index]}，实际 ${pieces[0] ?? null}`)
  })
}

/**
 * 真点击过 / 鼠标停着的那一格：标题行在画面框外，标题 + 缩略图外面没有任何一层环（按钮、格子、组都不许有 outline / 描边 / 阴影）。
 * 全局键盘焦点环（`:root :focus-visible`）只在键盘聚焦时画；真鼠标点一下不会触发它——所以这里要求没有。
 */
async function expectNoOuterRing(page, state, record, shot) {
  const result = await page.evaluate((id) => {
    const button = document.querySelector(`[data-v4-block="spend-body"] [data-node-pointer-id="${id}"]`)
    if (!button) return null
    const layers = [['pointer', button], ['cell', button.closest('[data-node-pointer-cell]')], ['group', button.closest('[data-node-pointer-group]')]]
    return {
      focused: document.activeElement === button,
      focusVisible: button.matches(':focus-visible'),
      layers: layers.filter(([, el]) => el).map(([name, el]) => {
        const style = getComputedStyle(el)
        return { name, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow, borderTop: style.borderTopWidth }
      }),
    }
  }, NODE(shot))
  if (!result) { record(`${state.id} ${A.p1}: 找不到第 ${shot} 格的指向元素`); return }
  if (result.focusVisible) record(`${state.id} ${A.p1}: 真点击后第 ${shot} 格不该进键盘焦点环（:focus-visible），那是程序 focus() / 键盘才有的`)
  const rings = result.layers.filter((layer) => (layer.outlineStyle !== 'none' && layer.outlineWidth !== '0px') || layer.boxShadow !== 'none' || layer.borderTop !== '0px')
  if (rings.length) record(`${state.id} ${A.p1}: 点过的第 ${shot} 格在标题 + 缩略图外面多了一圈框：${JSON.stringify(rings)}`)
}

/** 驱动在断言之前拍过这一格（没有指针）；走真指针的格子做完动作后重拍同一个文件，PNG / 接触表里是真悬停 / 真点击之后的样子。 */
async function reshoot(page, state) {
  await page.locator(`[data-design-lab-shot="${state.id}"]`).screenshot({ path: path.join(SHOT_DIR, `${state.id}.png`), animations: 'disabled' })
}

const pointerAt = (page, shot) => page.locator(`[data-v4-block="spend-body"] [data-node-pointer-id="${NODE(shot)}"]`)

/** 鼠标真落到这一格缩略图的下半（人眼看着缩略图点的那一块；藏着的「不生成 ×」此刻不接指针，挡不住这一下）。`action`：'hover' | 'click'。 */
async function mouseOnto(page, shot, action) {
  const target = pointerAt(page, shot)
  const box = await target.boundingBox()
  await target[action]({ position: { x: Math.round((box?.width ?? 40) / 2), y: Math.round((box?.height ?? 40) - 8) } })
}

/** 等「不生成 ×」真露出来：从钮往上乘到格子为止的透明度 = 1（:hover 真亮了才会）。 */
function waitForCornerX(page, shot) {
  return page.waitForFunction((id) => {
    const cell = document.querySelector(`[data-node-pointer-cell] [data-node-pointer-id="${id}"]`)?.closest('[data-node-pointer-cell]')
    const toggle = cell?.querySelector('[data-spend-exclusion]')
    if (!toggle) return false
    let opacity = 1
    for (let node = toggle; node && node !== cell; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
    return opacity > 0.99
  }, NODE(shot), { timeout: 3000 })
}

/**
 * 板上写着「点过 / 鼠标停在」的格子，用真指针做完再拍（见文件头）：
 *   spend-one-zh-wide   真点击第 1 格（点过 = 「已定位」；点完鼠标还停在它上面，所以 × 也露着）
 *   spend-one-zh-narrow 鼠标真停到第 2 格
 *   spend-mixed         鼠标真停到第 3 格（竖图）：它的 × 要在竖框自己的角上，不在格子的右缘。悬停会把组下方那一行换成这一格自己的摘要，
 *                       所以这一格放在最后（`late`）：先在没有指针的卡上验完整行摘要，再悬停。
 */
const REAL_POINTER = {
  'spend-one-zh-wide': { shot: 1, action: 'click' },
  'spend-one-zh-narrow': { shot: 2, action: 'hover' },
  'spend-mixed': { shot: 3, action: 'hover', late: true },
}

async function realPointer(page, state, record) {
  const plan = REAL_POINTER[state.id]
  if (!plan) return
  await mouseOnto(page, plan.shot, plan.action)
  if (plan.action === 'click') {
    await pointerAt(page, plan.shot).locator('[data-node-pointer-located]').waitFor({ timeout: 3000 }).catch(() => record(`${state.id} ${A.located}: 真点击第 ${plan.shot} 格后没有立起「已定位」`))
  }
  await waitForCornerX(page, plan.shot).catch(() => record(`${state.id} ${A.exclude}: 鼠标真停在镜 0${plan.shot} 上后「不生成 ×」没露出来`))
  await reshoot(page, state)
}

async function expectStatusCapsules(page, state, record) {
  const bad = await page.evaluate(() => [...document.querySelectorAll('[data-node-pointer="card"]')].flatMap((pointer) => {
    const frame = pointer.querySelector('[data-node-pointer-frame]')
    const statuses = [...(frame?.querySelectorAll('[data-node-pointer-status]') ?? [])]
    if (!['generating', 'failed'].includes(pointer.getAttribute('data-node-pointer-face') ?? '')) return []
    if (statuses.length !== 1 || !statuses[0]?.querySelector('svg')) return [{ id: pointer.getAttribute('data-node-pointer-id'), statuses: statuses.length, icon: Boolean(statuses[0]?.querySelector('svg')) }]
    const box = statuses[0].getBoundingClientRect()
    const frameBox = frame.getBoundingClientRect()
    return Math.abs((box.left + box.width / 2) - (frameBox.left + frameBox.width / 2)) > 8 || Math.abs((box.top + box.height / 2) - (frameBox.top + frameBox.height / 2)) > 8
      ? [{ id: pointer.getAttribute('data-node-pointer-id'), center: true }]
      : []
  }))
  if (bad.length) record(`${state.id} ${A.status}: 状态必须是缩略图正中一个图标 + 文字胶囊：${JSON.stringify(bad)}`)
}

/** 失败留在卡里（板 ⑤⑥ 与结果未知 / 本机判得出发不出去）。 */
async function expectFailure(page, state, record, facts, expected) {
  const locale = localeOf(state.id)
  if (facts.kind !== 'spend') record(`${state.id} ${A.failure}: 介入槽里不是付费卡（kind=${facts.kind}）`)
  if (facts.tone !== 'danger') record(`${state.id} ${A.failure}: 失败的卡外框应是警示边（tone=${facts.tone}）`)
  if (!facts.titleIcon) record(`${state.id} ${A.failure}: 失败的标题前要有 ⚠`)
  const titleMatch = pattern(locale, expected.titleKey).exec(facts.title ?? '')
  if (!titleMatch) record(`${state.id} ${A.failure}: 标题「${facts.title}」不是 ${expected.titleKey} 那一句`)
  const shotRef = titleMatch?.groups?.shot
  const pointer = faceOf(facts, expected.shot)
  if (shotRef && !(pointer?.text ?? '').includes(shotRef.replace(/\s+/g, ' ').trim().split(' ').pop())) record(`${state.id} ${A.failure}: 标题说的「${shotRef}」不是出问题那一格的镜号`)
  const danger = facts.notices.find((notice) => notice.tone === 'danger')
  const reason = tr(locale, expected.reasonKey)
  if (!danger || !danger.text.includes(reason)) record(`${state.id} ${A.failure}: 原因行应是「${reason}」，实际 ${JSON.stringify(facts.notices)}`)
  for (const part of expected.detail ?? []) {
    if (!(danger?.detail ?? '').includes(part)) record(`${state.id} ${A.failure}: 别的几段此刻怎样那一行缺「${part}」：${danger?.detail}`)
  }
  const decline = tr(locale, 'agentPanelV4.spendCard.decline')
  if (!facts.dismiss || facts.dismiss.text !== decline || facts.dismiss.disabled) record(`${state.id} ${A.decline}: 失败时否定钮应是「${decline}」且可点：${JSON.stringify(facts.dismiss)}`)
  const name = expected.retry ? A.retry : A.goEdit
  const confirm = expected.retry ? tr(locale, 'agentPanelV4.spendCard.retry') : tr(locale, expected.locateKey, { shot: shotRef ?? '' })
  if (!facts.confirm || facts.confirm.text !== confirm || facts.confirm.disabled) record(`${state.id} ${name}: 主按钮应是可点的「${confirm}」，实际 ${JSON.stringify(facts.confirm)}`)
  if (facts.confirm && facts.confirm.locate === Boolean(expected.retry)) record(`${state.id} ${name}: ${expected.retry ? '「再试一次」前不该有定位图标' : '「去改 / 去看」前要有定位图标（点了是去节点）'}`)
  // 钱的口径：结果未知时可能已经扣费，一个字都不许说没花钱；任何失败都不教「点 ×」（右上角没有 ×）。
  if (expected.unclear && /没有花钱|没花钱|not charged|no charge|wasn.t charged|nothing was charged/i.test(facts.cardText)) record(`${state.id} ${A.failure}: 结果未知却说了没花钱：${facts.cardText}`)
  if (/点\s*×|点「×」|click\s*×/i.test(facts.cardText)) record(`${state.id} ${A.failure}: 卡上教用户「点 ×」，但右上角没有 ×`)
  // 失败留在卡里时，还没决定的那几镜照样能「不生成 ×」；没发出去 / 已发出 / 结果未知的那几格不挂（它们不在这一下的出价里）。
  if (expected.toggles) expectToggles(state, record, facts, expected.toggles)
  await commonCard(page, state, record, facts)
}

/** 窄面板：标题行只留镜号（名字靠读屏名 / 悬停），卡与主按钮都不被裁。 */
function expectNarrow(state, record, facts) {
  const named = facts.pointers.filter((pointer) => /纸船出发|越过落叶|漂向远处|Paper boat departs|Past the leaves|Drifting away/.test(pointer.text))
  if (named.length) record(`${state.id} ${A.pointers}: 窄面板里标题行还印着名字：${named.map((pointer) => pointer.id).join(', ')}`)
  if (facts.cardBox.width > 301) record(`${state.id} ${A.pointers}: 卡比 300 的面板还宽：${facts.cardBox.width}`)
  if (facts.confirmBox && facts.confirmBox.right > facts.cardBox.right + 1) record(`${state.id} ${A.generate}: 主按钮被裁在卡外：${JSON.stringify(facts.confirmBox)} / ${JSON.stringify(facts.cardBox)}`)
}

function expectImageTitles(state, record, facts, expected) {
  const actual = facts.pointers.map((pointer) => pointer.title)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) record(`${state.id} ${A.pointers}: 图片标题应保留公共前缀并按唯一尾巴截断：${JSON.stringify({ expected, actual })}`)
}

function expectImageSummary(state, record, facts, expected) {
  const summary = facts.groupSummary ?? facts.hoverSummary
  if (summary !== expected) record(`${state.id} ${A.summary}: 图片节点整行摘要应是「${expected}」，实际「${summary}」`)
  if ((summary ?? '').includes('共') || (summary ?? '').includes('total')) record(`${state.id} ${A.summary}: 图片摘要不应出现视频时长总计：${summary}`)
}

async function expectReceipt(page, state, record, phase, faces) {
  const locale = localeOf(state.id)
  if (await page.locator('[data-v4-block="intervention"]').count()) record(`${state.id} ${A.done}: 完成后卡应离开输入框上方那一格`)
  const receipt = page.locator('[data-v4-block="generation-receipt-pointers"]')
  if (!(await expect(receipt).toHaveCount(1).then(() => true, () => false))) { record(`${state.id} ${A.done}: 对话流里没有那一条带组指向的收据`); return }
  const facts = await receipt.evaluate((root) => ({
    operation: root.getAttribute('data-operation-id'),
    phase: root.querySelector('[data-v4-block="generation-receipt-line"]')?.getAttribute('data-receipt-phase') ?? null,
    line: root.querySelector('[data-v4-block="generation-receipt-line"]')?.textContent?.trim() ?? '',
    faces: [...root.querySelectorAll('[data-node-pointer="card"]')].map((el) => el.getAttribute('data-node-pointer-face')),
    // 收据露在折起来的过程行外面（工作折成一行，结果那一句不折）。
    folded: Boolean(root.closest('details:not([open])')),
  }))
  if (facts.operation !== 'lab-spend-op') record(`${state.id} ${A.done}: 收据指的不是这一次出价：${facts.operation}`)
  const key = phase === 'generated' ? 'agentPanelV4.spendCard.receiptGeneratedVideo' : 'agentPanelV4.spendCard.receiptSentVideo'
  const line = tr(locale, key, { count: faces.length })
  if (facts.phase !== phase || facts.line !== line) record(`${state.id} ${A.done}: 收据那一句应是「${line}」（${phase}），实际「${facts.line}」（${facts.phase}）`)
  if (MONEY.test(facts.line)) record(`${state.id} ${A.done}: 收据上印了钱「${facts.line}」`)
  if (JSON.stringify(facts.faces) !== JSON.stringify(faces)) record(`${state.id} ${A.done}: 组指向应实时读节点 ${JSON.stringify(faces)}，实际 ${JSON.stringify(facts.faces)}`)
  if (facts.folded) record(`${state.id} ${A.done}: 收据那一句与组指向被折进了过程行`)
  // 点了照样定位：组指向里的格子是能点的按钮（Enter 定位 → 标上「已定位」）。
  const first = receipt.locator('[data-node-pointer="card"]').first()
  await first.focus()
  await page.keyboard.press('Enter')
  await receipt.locator('[data-node-pointer-located]').first().waitFor({ timeout: 3000 }).catch(() => record(`${state.id} ${A.done}: 收据下的指向元素 Enter 没有定位`))
  await noAccentOutline(page, state, record)
}

async function expectSpendCardState(page, state, record) {
  const locale = localeOf(state.id)
  if (/-dark$/.test(state.id)) {
    const scheme = await page.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme'))
    if (scheme !== 'dark') record(`${state.id} ${A.title}: 暗色格子没有落在暗色主题上（${scheme}）`)
  }
  if (state.id.startsWith('spend-done')) {
    const generated = state.id !== 'spend-done-sending'
    await expectReceipt(page, state, record, generated ? 'generated' : 'sent', generated ? ['result', 'result', 'result'] : ['result', 'generating', 'generating'])
    return
  }
  // 真指针先做完（并重拍），下面读到的卡就是真悬停 / 真点击之后的样子（`late` 的那一格在它自己的断言末尾再做）。
  if (!REAL_POINTER[state.id]?.late) await realPointer(page, state, record)
  const facts = await cardFacts(page)
  if (!facts) { record(`${state.id} ${A.title}: 介入槽里没有卡`); return }
  const all = (count) => tr(locale, 'agentPanelV4.spendCard.generateAll', { count })
  const allImage = (count) => tr(locale, 'agentPanelV4.spendCard.generateAllImage', { count })
  switch (state.id) {
    case 'spend-one-zh-wide': {
      await expectDecide(page, state, record, facts, { asked: 3, video: false, confirm: allImage(3), total: 3 })
      expectGroup(state, record, facts, ['production', 'production', 'production'])
      expectImageTitles(state, record, facts, ['雨后纸船 · 出发', '雨后纸船 · 越过落叶', '雨后纸船 · 停在石阶'])
      expectImageSummary(state, record, facts, 'GPT Image 2（Nomi 选的） · 16:9 · 1K')
      // 真点击第 1 格（点完鼠标还停在上面）：「已定位」独占缩略图正中、画面框亮起、× 只在这一格露出来，外面没有多一圈框。
      if (!faceOf(facts, 1)?.located) record(`${state.id} ${A.located}: 真点击第 1 格后应有「已定位」中心胶囊`)
      expectOneCenter(state, record, facts, ['located', 'icon', 'icon'])
      expectToggles(state, record, facts, ['exclude', 'exclude', 'exclude'])
      expectOnlyShown(state, record, facts, 1)
      if (!faceOf(facts, 1)?.hot) record(`${state.id} ${A.p1}: 鼠标停着的第 1 格画面框应亮起`)
      if (facts.pointers.some((pointer) => pointer.titleOutsideFrame === false)) record(`${state.id} ${A.p1}: 标题行应在画面框外：${JSON.stringify(facts.pointers.map((pointer) => pointer.titleOutsideFrame))}`)
      await expectNoOuterRing(page, state, record, 1)
      break
    }
    case 'spend-one-zh-narrow': {
      await expectDecide(page, state, record, facts, { asked: 2, video: false, remaining: true, confirm: tr(locale, 'agentPanelV4.spendConfirmRemainingImage', { count: 2 }), total: 2 })
      expectGroup(state, record, facts, ['generating', 'production', 'production'])
      expectImageTitles(state, record, facts, ['雨后纸船 · 出发', '雨后纸船 · 越过落叶', '雨后纸船 · 停在石阶'])
      if (facts.cardBox.width > 301) record(`${state.id} ${A.pointers}: 图片窄卡比 300 的面板还宽：${facts.cardBox.width}`)
      if (!facts.hoverSummary?.includes('GPT Image 2') || !facts.hoverSummary?.includes('16:9') || !facts.hoverSummary?.includes('1K')) record(`${state.id} ${A.summary}: 悬停第 2 格应换成它自己的图片摘要：${facts.hoverSummary}`)
      if (/共|total/i.test(facts.hoverSummary ?? '')) record(`${state.id} ${A.summary}: 单格悬停摘要不应带总计词：${facts.hoverSummary}`)
      await expectStatusCapsules(page, state, record)
      expectOneCenter(state, record, facts, ['status', 'icon', 'icon'])
      expectToggles(state, record, facts, [null, 'exclude', 'exclude'])
      // 鼠标真停在第 2 格：它的 × 露出来（别的格藏着），画面框亮起。
      expectOnlyShown(state, record, facts, 2)
      if (!faceOf(facts, 2)?.hot) record(`${state.id} ${A.p1}: 鼠标停着的第 2 格画面框应亮起`)
      break
    }
    case 'spend-one-en-wide-dark': {
      await expectDecide(page, state, record, facts, { asked: 2, video: false, confirm: allImage(2), total: 2 })
      expectGroup(state, record, facts, ['production', 'production', 'production'])
      expectImageTitles(state, record, facts, ['Paper boat — sets off', 'Paper boat — drifts by', 'Paper boat — rests'])
      expectImageSummary(state, record, facts, "GPT Image 2 (Nomi's pick) · 16:9 · 1K")
      expectToggles(state, record, facts, ['exclude', 'exclude', 'restore'])
      // 去掉的那一格正中常驻「恢复」，这一格不再画种类图标。
      expectOneCenter(state, record, facts, ['icon', 'icon', 'restore'])
      break
    }
    case 'spend-one-en-narrow-dark': {
      await expectDecide(page, state, record, facts, { asked: 3, video: false, confirm: allImage(3), total: 3 })
      expectGroup(state, record, facts, ['production', 'production', 'production'])
      expectImageTitles(state, record, facts, ['Paper boat — sets off', 'Paper boat — drifts by', 'Paper boat — rests'])
      expectImageSummary(state, record, facts, "GPT Image 2 (Nomi's pick) · 1K · 16:9 ×2 · 9:16 ×1")
      expectOneCenter(state, record, facts, ['icon', 'icon', 'icon'])
      // 第 3 格是竖图：它的 × 在竖框自己的角上（expectToggles 里按各自画面框量）。
      expectToggles(state, record, facts, ['exclude', 'exclude', 'exclude'])
      if (facts.cardBox.width > 301) record(`${state.id} ${A.pointers}: 图片窄卡比 300 的面板还宽：${facts.cardBox.width}`)
      const ratios = facts.pointers.map((pointer) => pointer.frame?.ratio ?? 0)
      if (Math.abs(ratios[0] - 16 / 9) > 0.03 || Math.abs(ratios[1] - 16 / 9) > 0.03 || Math.abs(ratios[2] - 9 / 16) > 0.03) record(`${state.id} ${A.pointers}: 图片节点比例应为 16:9、16:9、9:16：${JSON.stringify(ratios)}`)
      break
    }
    case 'spend-single':
    case 'spend-single-en': {
      await expectDecide(page, state, record, facts, { asked: 1, confirm: tr(locale, 'agentPanelV4.spendCard.generate'), total: 1 })
      const pointer = faceOf(facts, 1)
      if (facts.pointers.length !== 1 || pointer?.face !== 'production') record(`${state.id} ${A.pointers}: 单段卡应是一个「等你确认」的指向元素：${JSON.stringify(facts.pointers.map((item) => [item.id, item.face]))}`)
      if (pointer?.text.includes(uiText(locale, 'generationCommon.production.canvasLanding.awaitingConfirmation'))) record(`${state.id} ${A.pointers}: 方案一的单格不重复显示「等你确认」：${pointer?.text}`)
      // 板 ①：画面左、摘要右（模型 / 比例 · 时长 · 清晰度），读节点。
      if (!/Seedance/.test(pointer?.text ?? '') || !pointer?.text.includes('16:9 · 4s · 480p')) record(`${state.id} ${A.summary}: 单段摘要应读节点「Seedance… / 16:9 · 4s · 480p」：${pointer?.text}`)
      if (facts.toggles.length) record(`${state.id} ${A.exclude}: 单段卡不挂「不生成 ×」（单段的不生成就是「取消」）`)
      break
    }
    case 'spend-batch':
    case 'spend-batch-en':
    case 'spend-batch-dark':
    case 'spend-batch-en-dark': {
      await expectDecide(page, state, record, facts, { asked: 3, confirm: all(3), total: 3 })
      expectGroup(state, record, facts, ['production', 'production', 'production'])
      expectToggles(state, record, facts, ['exclude', 'exclude', 'exclude'])
      if (facts.toggles.some((toggle) => toggle.opacity > 0.01)) record(`${state.id} ${A.exclude}: 没悬停 / 聚焦时「不生成 ×」应藏着：${facts.toggles.map((toggle) => toggle.opacity).join(',')}`)
      // 藏着的钮不接点击：缩略图上点哪儿都是去节点，不会误点成「不生成」。
      const catching = await page.evaluate(() => [...document.querySelectorAll('[data-spend-exclusion="exclude"]')].filter((el) => getComputedStyle(el).pointerEvents !== 'none').length)
      if (catching) record(`${state.id} ${A.exclude}: 藏着的「不生成 ×」还在接点击（${catching} 颗）——看不见的钮会挡住缩略图`)
      const seconds = tr(locale, 'agentPanelV4.spendCard.summarySeconds', { value: '13s' })
      for (const part of ['Seedance', '16:9', '480p', seconds]) {
        if (!(facts.groupSummary ?? '').includes(part)) record(`${state.id} ${A.summary}: 组下方那一行（合起来的摘要）缺「${part}」：${facts.groupSummary}`)
      }
      if (facts.groupSummaryTitle !== facts.groupSummary) record(`${state.id} ${A.summary}: 摘要行要带悬停全名`)
      await expectStatusCapsules(page, state, record)
      if (state.id !== 'spend-batch') break
      // 真悬停一格（鼠标真移过去）：「不生成 ×」露出来，组下方换成这一镜的摘要（5s），组的高度一点不变（不把「生成」钮顶下去）。
      const group = page.locator('[data-v4-block="spend-body"] [data-node-pointer-group="card"]')
      const idle = (await group.boundingBox())?.height ?? 0
      // 落在缩略图下半（人眼看着缩略图点的那一块）；藏着的「不生成 ×」此刻不接指针，挡不住这一下。
      const target = page.locator(`[data-v4-block="spend-body"] [data-node-pointer-id="${NODE(2)}"]`)
      const targetBox = await target.boundingBox()
      await target.hover({ position: { x: Math.round((targetBox?.width ?? 40) / 2), y: Math.round((targetBox?.height ?? 40) - 8) } })
      await waitForCornerX(page, 2).catch(() => record(`${state.id} ${A.exclude}: 真悬停镜 02 后「不生成 ×」没露出来`))
      const hovered = await cardFacts(page)
      if (!(hovered?.hoverSummary ?? '').includes('5s')) record(`${state.id} ${A.summary}: 悬停镜 02 后组下方应换成这一镜的摘要（5s）：${hovered?.hoverSummary}`)
      if ((hovered?.hoverSummary ?? '').includes('镜 02') || (hovered?.hoverSummary ?? '').includes('越过落叶')) record(`${state.id} ${A.summary}: 悬停摘要不应重复镜号或镜头名：${hovered?.hoverSummary}`)
      expectOnlyShown(state, record, hovered, 2)
      const others = hovered?.toggles.filter((toggle) => toggle.cell !== NODE(2)).map((toggle) => toggle.opacity) ?? []
      if (others.some((opacity) => opacity > 0.01)) record(`${state.id} ${A.exclude}: 只悬停镜 02，别的格子也露了小钮：${others.join(',')}`)
      const hot = (await group.boundingBox())?.height ?? 0
      if (Math.abs(hot - idle) > 0.5) record(`${state.id} ${A.summary}: 悬停后组的高度变了 ${idle} → ${hot}`)
      await page.mouse.move(0, 0)
      break
    }
    case 'spend-batch-narrow': {
      await expectDecide(page, state, record, facts, { asked: 3, confirm: all(3), total: 3 })
      expectGroup(state, record, facts, ['production', 'production', 'production'])
      expectNarrow(state, record, facts)
      break
    }
    case 'spend-exclude-focus': {
      await expectDecide(page, state, record, facts, { asked: 3, confirm: all(3), total: 3 })
      const visible = facts.toggles.filter((toggle) => toggle.opacity > 0.99).map((toggle) => toggle.cell)
      if (JSON.stringify(visible) !== JSON.stringify([NODE(2)])) record(`${state.id} ${A.exclude}: 聚焦镜 02 时只露它那一颗「不生成 ×」，实际 ${JSON.stringify(visible)}`)
      if (!(facts.hoverSummary ?? '').includes('5s')) record(`${state.id} ${A.summary}: 聚焦镜 02 后组下方应是这一镜的摘要：${facts.hoverSummary}`)
      // 键盘可达：从指向元素 Tab 一下就到它那一颗「不生成 ×」。
      await page.keyboard.press('Tab')
      const active = await page.evaluate(() => ({ kind: document.activeElement?.getAttribute('data-spend-exclusion') ?? null, name: document.activeElement?.getAttribute('aria-label') ?? '' }))
      if (active.kind !== 'exclude' || !pattern(locale, 'agentPanelV4.spendCard.excludeName').test(active.name)) record(`${state.id} ${A.exclude}: 从镜 02 Tab 一下没落到它的「不生成 ×」：${JSON.stringify(active)}`)
      break
    }
    case 'spend-excluded': {
      await expectDecide(page, state, record, facts, { asked: 2, confirm: all(2), total: 2 })
      expectGroup(state, record, facts, ['production', 'production', 'production'])
      expectToggles(state, record, facts, ['exclude', 'restore', 'exclude'])
      expectOneCenter(state, record, facts, ['icon', 'restore', 'icon'])
      // 去掉了的那一格读的还是节点那一份制作状态：读屏名说「已去掉，不生成」（画布节点的小标同一句；格子上是淡下去 + 「恢复」）。
      if (!faceOf(facts, 2)?.aria.includes(uiText(locale, 'generationCommon.production.canvasLanding.removedNotGenerated'))) record(`${state.id} ${A.exclude}: 去掉了的那一格读屏名应说「已去掉，不生成」（和节点同一句）：${faceOf(facts, 2)?.aria}`)
      break
    }
    case 'spend-all-removed': {
      await expectDecide(page, state, record, facts, { title: tr(locale, 'agentPanelV4.spendCard.titleNothing'), confirm: tr(locale, 'agentPanelV4.spendCard.generate'), disabled: true, picked: false })
      expectToggles(state, record, facts, ['restore', 'restore', 'restore'])
      expectOneCenter(state, record, facts, ['restore', 'restore', 'restore'])
      break
    }
    case 'spend-deleted': {
      await expectDecide(page, state, record, facts, { asked: 2, confirm: all(2), total: 2 })
      expectGroup(state, record, facts, ['production', 'production', 'removed'])
      if (!faceOf(facts, 3)?.disabled) record(`${state.id} ${A.pointers}: 已删除的那一格必须不可点（aria-disabled）`)
      expectToggles(state, record, facts, ['exclude', 'exclude', null])
      break
    }
    case 'spend-remaining': {
      await expectDecide(page, state, record, facts, { asked: 2, remaining: true, confirm: tr(locale, 'agentPanelV4.spendConfirmRemainingVideo', { count: 2 }), total: 2 })
      expectGroup(state, record, facts, ['generating', 'production', 'production'])
      expectToggles(state, record, facts, [null, 'exclude', 'exclude'])
      break
    }
    case 'spend-sending':
    case 'spend-sending-en-dark': {
      const title = tr(locale, 'agentPanelV4.spendBatchProgressVideo', { current: 2, total: 3 })
      if (facts.title !== title) record(`${state.id} ${A.progress}: 标题应是「${title}」，实际「${facts.title}」`)
      if (!facts.titleIcon) record(`${state.id} ${A.progress}: 正在发出的标题前要转圈`)
      if (facts.waiting !== 'false') record(`${state.id} ${A.progress}: 正在发出是安静框（不在等人点），waiting=${facts.waiting}`)
      if (facts.tone) record(`${state.id} ${A.progress}: 正在发出不是警示边`)
      const hint = tr(locale, 'agentPanelV4.spendBatchStopHint')
      if (facts.progress !== hint) record(`${state.id} ${A.progressStop}: 动作行应只说怎么停「${hint}」，实际「${facts.progress}」`)
      if (facts.confirm) record(`${state.id} ${A.progress}: 正在发出时不该再有主按钮`)
      const cancel = tr(locale, 'agentPanelV4.reject')
      if (!facts.dismiss || facts.dismiss.text !== cancel || facts.dismiss.disabled) record(`${state.id} ${A.progressStop}: 「${cancel}」应在且可点（立即生效，不排队）：${JSON.stringify(facts.dismiss)}`)
      expectGroup(state, record, facts, ['generating', 'generating', 'production'])
      // 每一格是那一镜节点此刻的样子，词是节点自己的：生成中 / 提交中 / 排队中（画布上同一个节点不会还写「等你确认」）。
      if (!faceOf(facts, 2)?.text.includes(uiText(locale, 'generationCommon.observability.progress.submitting'))) record(`${state.id} ${A.pointers}: 镜 02 应说「提交中」：${faceOf(facts, 2)?.text}`)
      if (!faceOf(facts, 3)?.text.includes(uiText(locale, 'generationCommon.production.canvasLanding.queued'))) record(`${state.id} ${A.pointers}: 镜 03 应说「排队中」：${faceOf(facts, 3)?.text}`)
      if (facts.pointers.some((pointer) => pointer.text.includes(uiText(locale, 'generationCommon.production.canvasLanding.awaitingConfirmation')))) record(`${state.id} ${A.pointers}: 正在发出时还有格子写着「等你确认」`)
      if (facts.toggles.length) record(`${state.id} ${A.exclude}: 正在发出时不再挂「不生成 ×」`)
      await expectStatusCapsules(page, state, record)
      expectOneCenter(state, record, facts, ['status', 'status', 'status'])
      await commonCard(page, state, record, facts)
      break
    }
    case 'spend-not-sent':
    case 'spend-not-sent-en-dark': {
      await expectFailure(page, state, record, facts, {
        shot: 2, titleKey: 'agentPanelV4.spendCard.failedTitle.notSent', reasonKey: 'agentPanelV4.spendCard.failure.provider_not_reached', retry: true, toggles: [null, null, 'exclude'],
      })
      expectGroup(state, record, facts, ['generating', 'failed', 'production'])
      await expectStatusCapsules(page, state, record)
      if (!faceOf(facts, 2)?.text.includes(tr(locale, 'agentPanelV4.spendCard.pointerFailed'))) record(`${state.id} ${A.pointers}: 没发出去的那一格状态条应说「${tr(locale, 'agentPanelV4.spendCard.pointerFailed')}」`)
      break
    }
    case 'spend-rejected':
    case 'spend-rejected-en': {
      await expectFailure(page, state, record, facts, { shot: 2, titleKey: 'agentPanelV4.spendCard.failedTitle.rejected', reasonKey: 'agentPanelV4.spendCard.failure.provider_rejected', locateKey: 'agentPanelV4.spendCard.goEdit', toggles: [null, null, 'exclude'] })
      expectGroup(state, record, facts, ['generating', 'failed', 'production'])
      await expectStatusCapsules(page, state, record)
      break
    }
    case 'spend-unclear': {
      await expectFailure(page, state, record, facts, { shot: 2, titleKey: 'agentPanelV4.spendCard.failedTitle.unclear', reasonKey: 'agentPanelV4.spendCard.failure.unclear', locateKey: 'agentPanelV4.spendCard.goCheck', unclear: true, toggles: [null, null, 'exclude'] })
      if (!faceOf(facts, 2)?.text.includes(tr(locale, 'agentPanelV4.spendCard.pointerUnclear'))) record(`${state.id} ${A.pointers}: 结果未知的那一格应说「${tr(locale, 'agentPanelV4.spendCard.pointerUnclear')}」`)
      break
    }
    case 'spend-blocked': {
      await expectFailure(page, state, record, facts, { shot: 1, titleKey: 'agentPanelV4.spendCard.failedTitle.blocked', reasonKey: 'agentPanelV4.spendCard.failure.prompt_required', locateKey: 'agentPanelV4.spendCard.goEdit' })
      break
    }
    case 'spend-blocked-one': {
      await expectDecide(page, state, record, facts, { asked: 3, confirm: all(2) })
      expectGroup(state, record, facts, ['production', 'failed', 'production'])
      const notice = facts.notices.find((item) => item.tone === 'danger')
      const ref = '镜 02'
      const line = tr(locale, 'agentPanelV4.spendCard.blockedNotice', { shot: ref, reason: tr(locale, 'agentPanelV4.spendCard.failure.prompt_required') })
      if (!notice || notice.text.trim() !== line) record(`${state.id} ${A.failure}: 应只多一行说明「${line}」，实际 ${JSON.stringify(facts.notices)}`)
      if (!faceOf(facts, 2)?.text.includes(tr(locale, 'agentPanelV4.spendCard.pointerCannotSend'))) record(`${state.id} ${A.pointers}: 发不出去的那一格应说「${tr(locale, 'agentPanelV4.spendCard.pointerCannotSend')}」`)
      break
    }
    case 'spend-price-unknown': {
      await expectDecide(page, state, record, facts, { asked: 3, confirm: all(3) })
      if (MONEY.test(facts.cardText) || /\b0\.0+\b/.test(facts.cardText)) record(`${state.id} ${A.total}: 算不出价时卡上一个钱字都不许印（更不许是 0）：${facts.cardText}`)
      break
    }
    case 'spend-mixed':
    case 'spend-mixed-en': {
      await expectDecide(page, state, record, facts, { asked: 3, confirm: all(3), total: 3, perShot: true })
      const groups = [tr(locale, 'agentPanelV4.spendCard.summaryGroup', { value: '16:9', count: 1 }), tr(locale, 'agentPanelV4.spendCard.summaryGroup', { value: '9:16', count: 2 })].join(' · ')
      if (!facts.groupSummary?.includes(groups) || facts.groupSummary.includes('逐镜不同')) record(`${state.id} ${A.summary}: 逐镜不同的摘要应只列分组「${groups}」，实际「${facts.groupSummary}」`)
      if (facts.groupSummaryTitle !== facts.groupSummary) record(`${state.id} ${A.summary}: 长摘要 title 应与可见摘要一致`)
      const label = tr(locale, 'agentPanelV4.spendParamsPerItem')
      if (!facts.perShot?.open || facts.perShot.label !== label) record(`${state.id} ${A.perShot}: 「${label}」应展开：${JSON.stringify(facts.perShot)}`)
      const rows = facts.perShot?.rows ?? []
      if (rows.length !== 3 || rows.some((row) => !/\d/.test(row[1] ?? ''))) record(`${state.id} ${A.perShot}: 展开后每镜一行带每镜价：${JSON.stringify(rows)}`)
      if (rows[1] && rows[0] && rows[1][1] === rows[0][1]) record(`${state.id} ${A.perShot}: 5 秒那一镜的价应和 4 秒的不同：${JSON.stringify(rows)}`)
      // 竖版按真比例在 16:9 槽里画（不裁不拉伸）。
      for (const shot of [2, 3]) {
        const ratio = faceOf(facts, shot)?.frame?.ratio ?? 0
        if (Math.abs(ratio - 9 / 16) > 0.03) record(`${state.id} ${A.pointers}: 镜 0${shot} 是竖版，画面框比例应是 9:16，实际 ${ratio.toFixed(3)}`)
      }
      // 竖版格的 × 在竖框自己的角上（不在格子的右缘）：expectToggles 按各格自己的画面框量。
      expectToggles(state, record, facts, ['exclude', 'exclude', 'exclude'])
      // 中文那一格鼠标真停在第 3 格（竖图）：只露它那一颗 ×，它在竖框自己的角上（上面 expectToggles 量的是位置，这里量露不露）。
      if (state.id === 'spend-mixed') {
        await realPointer(page, state, record)
        expectOnlyShown(state, record, await cardFacts(page), 3)
      }
      break
    }
    case 'spend-model-changed': {
      await expectDecide(page, state, record, facts, { asked: 3, confirm: all(3), total: 3, picked: false })
      break
    }
    case 'spend-brake-retry':
    case 'spend-brake-out-of-plan-en': {
      await expectDecide(page, state, record, facts, { asked: 1, confirm: tr(locale, 'agentPanelV4.spendCard.generate') })
      // board:AgentPermissionTiers/spend-card.brake-reason：刹车把直接档退回这张卡，标题下多那一行原因；输入框仍在直接档，上沿常驻提醒还在。
      const key = state.id === 'spend-brake-retry' ? 'agentPanelV4.brakeRetry.title' : 'agentPanelV4.brakeOutOfPlan.title'
      const reason = uiText(locale, key)
      if (!facts.cardText.includes(reason)) record(`${state.id} ${A.brake} / ${A.brakeReason}: 标题下没有刹车原因那一行「${reason}」`)
      if (!(await page.locator('[data-v4-block="auto-mode"]').first().waitFor({ state: 'visible' }).then(() => true, () => false))) record(`${state.id} ${A.brake}: 直接档的常驻提醒不在（刹车只在直接档出现）`)
      break
    }
    case 'spend-unreadable': {
      if (facts.kind !== 'missing-card') record(`${state.id} ${A.unreadable}: 读不到待决时应是那张会说话的缺卡，实际 kind=${facts.kind}`)
      const title = uiText(locale, 'agentPanelV4.missingCard.title')
      if (facts.title !== title) record(`${state.id} ${A.unreadable}: 缺卡标题应是「${title}」，实际「${facts.title}」`)
      const reason = uiText(locale, 'agentPanelV4.missingCard.reason.spend-surface-unavailable')
      if (!facts.cardText.includes(reason)) record(`${state.id} ${A.unreadable}: 缺卡没说读不到的原因「${reason}」`)
      if (facts.confirm || facts.pointers.length) record(`${state.id} ${A.unreadable}: 缺卡上不该有可点的「生成」或指向元素`)
      break
    }
    default:
      record(`${state.id}: 走查没有登记这一格的断言`)
  }
}

await walkDesignLabScreen({
  screen: 'spend-card',
  title: '付费卡（指向元素 + 只读摘要）',
  role: 'walk-spend-card',
  cellWidth: 438,
  columns: 4,
  viewport: { width: 1240, height: 900 },
  assertState: expectSpendCardState,
})
