// 设计实验室 · 付费确认（SpendAskSplit 板，2026-11-15 拆开；失败 / 刹车 / 读不到 / 逐镜价格沿用 SpendCardQ1 板）走查。零额度：纯本地渲染，不碰任何生成 API。
//
// 每一格都是真面板（生产钩子 useAgentPanelSpendCard + 生产条体 + 生产面板）：这一批镜头在对话里一行一个（挂在那一条生成记录下面），
// 输入框上方那一条确认只有共同参数 + 两颗按钮。夹具只是画布节点、制作 Run 与宿主推过来的那一次出价。
// 每一格截图（中英、光暗、390 / 320）+ 下面这些板断言。断言名就是板里各元素的 `assertion`（check:board-parity R4）。
// 期望的字一律从词典按键取；看不见的宿主行为（点「生成」走画布那一台发动机、节点改了行跟着变、收起后小球数上它）在真 Electron 里钉：
// tests/ux/agent-spend-card.walk.mjs。
//
// 「鼠标停在」的格子用真指针（Playwright 的真鼠标：CSS :hover 才会亮，「不生成 ×」才会露出来）做完再拍、再断言。
// 驱动（walkScreen.mjs）在断言之前就拍了每一格（那时没有指针），所以走真指针的格子在这里做完动作后重拍同一个文件。
//
// 用法：node tests/ux/design-lab-spend-card.walk.mjs  （ONLY=spend-batch 只跑一格）
import path from 'node:path'
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'
import { REPO_ROOT } from './design-lab/labStates.mjs'
import { uiText, uiTextPattern, uiTextWith } from './full-walk/invariants.mjs'

const A = {
  // 拆开后的新板：条上不画标题、不画镜头；共同参数一行；两颗按钮；发出中；失败；对话里那一组。
  askTitle: 'board:SpendAskSplit/ask.title',
  askPointers: 'board:SpendAskSplit/ask.pointers',
  params: 'board:SpendAskSplit/ask.params',
  actions: 'board:SpendAskSplit/ask.actions',
  sending: 'board:SpendAskSplit/ask.sending',
  askFailure: 'board:SpendAskSplit/ask.failure',
  rows: 'board:SpendAskSplit/chat.rows',
  more: 'board:SpendAskSplit/chat.rows.more',
  exclude: 'board:SpendAskSplit/chat.rows.exclude',
  note: 'board:SpendAskSplit/chat.rows.note',
  receipt: 'board:SpendAskSplit/chat.receipt',
  // 结构照旧的那几件仍按付费卡板。
  status: 'board:SpendCardQ1/card.pointer.status',
  total: 'board:SpendCardQ1/card.total',
  perShot: 'board:SpendCardQ1/card.per-shot',
  cancel: 'board:SpendCardQ1/card.cancel',
  generate: 'board:SpendCardQ1/card.generate',
  progress: 'board:SpendCardQ1/card.progress',
  progressStop: 'board:SpendCardQ1/card.progress.stop',
  failure: 'board:SpendCardQ1/card.failure',
  decline: 'board:SpendCardQ1/card.failure.decline',
  retry: 'board:SpendCardQ1/card.failure.retry',
  goEdit: 'board:SpendCardQ1/card.failure.go-edit',
  brake: 'board:SpendCardQ1/card.brake-note',
  unreadable: 'board:SpendCardQ1/card.unreadable',
  brakeReason: 'board:AgentPermissionTiers/spend-card.brake-reason',
  located: 'board:NodePointer/pointer.located',
}

const SHOT_DIR = path.join(REPO_ROOT, 'tests/ux/shots/design-lab-spend-card')
const NODE = (shot) => `lab-spend-node-${shot}`
const MONEY = /[¥￥$€£]|\d+\.\d{2}/
/** 列表行折起的门槛（NODE_POINTER_ROW_FOLD）：超过这么多行，后面的折进「还有 N 个镜头」。 */
const FOLD = 4

const tr = (locale, key, values = {}) => uiTextWith(locale, key, values)
const pattern = (locale, key) => new RegExp(uiTextPattern(uiText(locale, key), { anchored: true }) + '$')
const localeOf = (id) => (/-en(?:-|$)/.test(id) ? 'en' : 'zh-CN')
const darkOf = (id) => /-dark(?:-|$)/.test(id)
const narrowOf = (id) => /-narrow$/.test(id)

/** 3 镜和 12 镜条的高度（中文明 390 那两格）：条上没有一样东西随段数变多，所以两个数必须一样。 */
const barHeights = {}

/** 输入框上方那一条此刻摆着的一切。 */
async function barFacts(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-v4-block="intervention"]')
    if (!bar) return null
    const confirm = bar.querySelector('[data-v4-control="confirm"]')
    const dismiss = bar.querySelector('[data-v4-control="slot-dismiss"]')
    const perShot = bar.querySelector('[data-v4-block="price-per-item"]')
    const outside = bar.cloneNode(true)
    outside.querySelectorAll('[data-v4-block="price-per-item"]').forEach((node) => node.remove())
    const title = (() => {
      const heading = bar.querySelector('[data-v4-block="slot-title"]')
      if (!heading) return null
      const clone = heading.cloneNode(true)
      clone.querySelectorAll('[data-v4-block="slot-badge"], [data-v4-block="slot-title-icon"]').forEach((node) => node.remove())
      return clone.textContent?.trim() ?? ''
    })()
    const box = bar.getBoundingClientRect()
    return {
      kind: bar.getAttribute('data-kind'),
      tone: bar.getAttribute('data-tone'),
      waiting: bar.getAttribute('data-waiting'),
      title,
      titleIcon: Boolean(bar.querySelector('[data-v4-block="slot-title-icon"]')),
      params: bar.querySelector('[data-v4-block="spend-params"]')?.textContent?.trim() ?? null,
      progress: bar.querySelector('[data-v4-block="slot-progress"]')?.textContent?.trim() ?? null,
      confirm: confirm ? { text: (confirm.textContent ?? '').replace('⏎', '').trim(), disabled: confirm.disabled, locate: Boolean(confirm.querySelector('svg')) } : null,
      dismiss: dismiss ? { text: dismiss.textContent?.trim() ?? '', disabled: dismiss.disabled } : null,
      notices: [...bar.querySelectorAll('[data-v4-block="spend-notice"]')].map((el) => ({
        tone: el.getAttribute('data-tone'),
        text: el.querySelector('span > span')?.textContent ?? el.textContent ?? '',
        detail: el.querySelector('[data-v4-block="spend-notice-detail"]')?.textContent ?? null,
      })),
      // 条上不许有镜头（指向元素 / 小钮）、不许有可改的东西。
      pointers: bar.querySelectorAll('[data-node-pointer], [data-spend-exclusion]').length,
      editors: bar.querySelectorAll('textarea, input, select, [contenteditable="true"], [data-composer-host], [data-node-composer-footer], [data-parameter-chip], [data-parameter-summary], [data-agent-parameter-panel]').length,
      perShot: perShot ? {
        open: perShot.open,
        label: perShot.querySelector('summary')?.textContent?.trim() ?? '',
        rows: [...perShot.querySelectorAll(':scope > div > div')].map((row) => [...row.children].map((cell) => cell.textContent ?? '')),
      } : null,
      text: bar.textContent ?? '',
      textOutsidePerShot: outside.textContent ?? '',
      height: box.height,
      width: box.width,
      right: box.right,
      confirmRight: confirm?.getBoundingClientRect().right ?? null,
    }
  })
}

/** 对话里那一组此刻摆着的一切。 */
async function groupFacts(page) {
  return page.evaluate(() => {
    const roots = [...document.querySelectorAll('[data-v4-block="generation-receipt-pointers"]')]
    const root = roots[0]
    if (!root) return { count: 0 }
    const opacityUpTo = (el, stop) => { let value = 1; for (let node = el; node && node !== stop; node = node.parentElement) value *= Number(getComputedStyle(node).opacity); return value }
    return {
      count: roots.length,
      operation: root.getAttribute('data-operation-id'),
      offerOpen: root.getAttribute('data-offer-open') === 'true',
      inBar: Boolean(root.closest('[data-v4-block="intervention"]')),
      folded: Boolean(root.closest('details:not([open])')),
      // 前面那一条是不是生成记录（挂在它下面）：同一个对话项里、组之前有那一条工具记录。
      afterRecord: Boolean(root.previousElementSibling || root.parentElement?.querySelector('[data-v4-block="tool"], [data-v4-tool], details')),
      rows: [...root.querySelectorAll('[data-node-pointer="row"]')].map((el) => {
        const wrap = el.closest('[data-node-pointer-row]')
        const toggle = wrap?.querySelector('[data-spend-exclusion]') ?? null
        return {
          id: el.getAttribute('data-node-pointer-id'),
          face: el.getAttribute('data-node-pointer-face'),
          hot: el.getAttribute('data-node-pointer-hot') === 'true',
          aria: el.getAttribute('aria-label') ?? '',
          disabled: el.getAttribute('aria-disabled') === 'true',
          title: el.querySelector('[data-node-pointer-title]')?.textContent?.trim() ?? '',
          detail: el.querySelector('[data-node-pointer-detail]')?.textContent?.trim() ?? null,
          located: Boolean(el.querySelector('[data-node-pointer-located]')),
          height: el.getBoundingClientRect().height,
          dimmed: Boolean(wrap?.querySelector('[data-node-pointer-row-dimmed]')),
          pinned: wrap?.getAttribute('data-accessory-pinned') === 'true',
          // 小钮是行的兄弟，不在行（按钮）里面。
          nested: Boolean(el.querySelector('button')),
          toggle: toggle ? {
            kind: toggle.getAttribute('data-spend-exclusion'),
            name: toggle.getAttribute('aria-label') ?? '',
            opacity: opacityUpTo(toggle, wrap),
            catching: getComputedStyle(toggle.closest('[data-node-pointer-row-accessory]') ?? toggle).pointerEvents !== 'none',
            shared: toggle.hasAttribute('data-thumb-corner-x'),
            disabled: toggle.disabled,
            insideRow: (() => { const a = toggle.getBoundingClientRect(); const b = el.getBoundingClientRect(); return a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5 })(),
          } : null,
        }
      }),
      more: (() => { const more = root.querySelector('[data-node-pointer-more]'); return more ? { text: more.textContent?.trim() ?? '', hidden: Number(more.getAttribute('data-node-pointer-more')) } : null })(),
      line: (() => { const line = root.querySelector('[data-v4-block="generation-receipt-line"]'); return line ? { phase: line.getAttribute('data-receipt-phase'), text: line.textContent?.trim() ?? '' } : null })(),
      text: root.textContent ?? '',
    }
  })
}

/** 不许蓝色描边：条体与对话里那一组没有一个类把强调色 / info 色用在边线、环、描边、阴影上。 */
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
  if (offenders.length) record(`${state.id} ${A.rows}: 出现强调色描边类 ${offenders.slice(0, 3).join(' | ')}`)
}

/** 条上每一格都守的：不画镜头、没有可改的东西、不出钱（逐镜折叠口除外）、按钮没被裁。 */
async function commonBar(page, state, record, bar) {
  if (bar.pointers) record(`${state.id} ${A.askPointers}: 条上不许画镜头（指向元素 / 小钮 ${bar.pointers} 个）——镜头住在对话里`)
  if (bar.editors) record(`${state.id} ${A.params}: 条上出现了 ${bar.editors} 个可改的东西——改参数的家只有节点`)
  if (MONEY.test(bar.textOutsidePerShot)) record(`${state.id} ${A.total}: 条上印了钱「${bar.textOutsidePerShot}」（这一刀不印预估；逐镜折叠口除外）`)
  if (bar.confirmRight !== null && bar.confirmRight > bar.right + 1) record(`${state.id} ${A.actions}: 主按钮被裁在条外`)
  await noAccentOutline(page, state, record)
}

/** 对话里那一组：在对话流里（不在条里）、挂在生成记录下面、行数 / 折起 / 每行的样子。 */
function expectRows(state, record, group, expected) {
  const locale = localeOf(state.id)
  if (group.count !== 1) { record(`${state.id} ${A.rows}: 对话里应有一组镜头，实际 ${group.count}`); return }
  if (group.inBar) record(`${state.id} ${A.rows}: 那一组画进了条里`)
  if (group.folded) record(`${state.id} ${A.rows}: 那一组被折进了过程行`)
  if (group.operation !== 'lab-spend-op') record(`${state.id} ${A.rows}: 那一组指的不是这一次出价：${group.operation}`)
  if (group.offerOpen !== Boolean(expected.open ?? true)) record(`${state.id} ${A.rows}: 出价${expected.open === false ? '已关' : '开着'}，data-offer-open=${group.offerOpen}`)
  const shown = expected.shown ?? expected.total
  if (group.rows.length !== shown) record(`${state.id} ${A.rows}: 应露 ${shown} 行，实际 ${group.rows.length}`)
  const hidden = expected.total - shown
  if (hidden > 0) {
    const text = tr(locale, 'nodePointer.moreShots', { count: hidden })
    if (!group.more || group.more.text !== text) record(`${state.id} ${A.more}: 超过 ${FOLD} 行应折成「${text}」，实际 ${JSON.stringify(group.more)}`)
  } else if (group.more) record(`${state.id} ${A.more}: 全露了还挂着「${group.more.text}」`)
  // 行密度：一行 ≥40px、两行也不超过 56px（NodePointerGroup 行那一档）。
  const tall = group.rows.filter((row) => row.height < 39.5 || row.height > 56.5)
  if (tall.length) record(`${state.id} ${A.rows}: 行高不在行密度里：${tall.map((row) => `${row.id}=${row.height.toFixed(1)}`).join(', ')}`)
  if (group.rows.some((row) => row.nested)) record(`${state.id} ${A.exclude}: 行（按钮）里面套了按钮——小钮应是行的兄弟`)
  const hint = locale === 'en' ? /Opens it on the canvas/ : /点了在画布上定位/
  const live = group.rows.filter((row) => row.face !== 'removed')
  if (live.some((row) => !hint.test(row.aria))) record(`${state.id} ${A.rows}: 行的读屏名没说「点了去节点」：${live.map((row) => row.aria).join(' | ')}`)
  if (expected.faces) {
    const faces = group.rows.map((row) => row.face)
    if (JSON.stringify(faces) !== JSON.stringify(expected.faces)) record(`${state.id} ${A.rows}: 各行应是 ${JSON.stringify(expected.faces)}，实际 ${JSON.stringify(faces)}`)
  }
  if (expected.details) {
    const details = group.rows.map((row) => row.detail)
    if (JSON.stringify(details) !== JSON.stringify(expected.details)) record(`${state.id} ${A.note}: 各行第二行应是 ${JSON.stringify(expected.details)}，实际 ${JSON.stringify(details)}`)
  }
  // 出价开着时「等你确认」只在条上问一次，行里不重复。
  const awaiting = uiText(locale, 'generationCommon.production.canvasLanding.awaitingConfirmation')
  if ((expected.open ?? true) && group.rows.some((row) => row.detail === awaiting)) record(`${state.id} ${A.note}: 行里重复写了「${awaiting}」`)
}

/** 各行行尾小钮：可去掉的挂「不生成 ×」（藏着、不接点击）；去掉了的淡下去、常驻「恢复」；别的不挂。 */
function expectToggles(state, record, group, kinds) {
  const locale = localeOf(state.id)
  const got = group.rows.map((row) => row.toggle?.kind ?? null)
  if (JSON.stringify(got) !== JSON.stringify(kinds)) record(`${state.id} ${A.exclude}: 各行小钮应是 ${JSON.stringify(kinds)}，实际 ${JSON.stringify(got)}`)
  for (const row of group.rows) {
    const toggle = row.toggle
    if (!toggle) continue
    const key = toggle.kind === 'restore' ? 'agentPanelV4.spendCard.restoreName' : 'agentPanelV4.spendCard.excludeName'
    if (!pattern(locale, key).test(toggle.name)) record(`${state.id} ${A.exclude}: 小钮读屏名「${toggle.name}」不是词典那一句（${key}）`)
    if (!toggle.insideRow) record(`${state.id} ${A.exclude}: ${row.id} 的小钮跑出了那一行`)
    if (toggle.kind === 'restore') {
      if (!row.pinned || !row.dimmed || toggle.opacity < 0.99) record(`${state.id} ${A.exclude}: 去掉了的那一行应淡下去、「恢复」常驻：${JSON.stringify({ pinned: row.pinned, dimmed: row.dimmed, opacity: toggle.opacity })}`)
    } else if (!toggle.shared) record(`${state.id} ${A.exclude}: ${row.id} 的「不生成」没有用共用的 ThumbCornerX`)
  }
}

/** 没有指针时「不生成 ×」都藏着，而且不接点击（看不见的钮不许挡住行尾）。 */
function expectTogglesHidden(state, record, group) {
  const shown = group.rows.filter((row) => row.toggle?.kind === 'exclude' && (row.toggle.opacity > 0.01 || row.toggle.catching))
  if (shown.length) record(`${state.id} ${A.exclude}: 没悬停 / 聚焦时「不生成 ×」应藏着且不接点击：${shown.map((row) => row.id).join(', ')}`)
}

/** 鼠标（或键盘）停在哪一行，「不生成 ×」就只在那一行露出来。 */
function expectOnlyShown(state, record, group, shot) {
  const shown = group.rows.filter((row) => row.toggle?.kind === 'exclude' && row.toggle.opacity > 0.99).map((row) => row.id)
  if (JSON.stringify(shown) !== JSON.stringify([NODE(shot)])) record(`${state.id} ${A.exclude}: 停在镜 0${shot} 上时只该露它那一颗「不生成 ×」，实际 ${JSON.stringify(shown)}`)
}

/** 等人决定那一档：没有标题、共同参数一行、取消 + 生成 N 段。 */
async function expectDecide(page, state, record, bar, expected) {
  const locale = localeOf(state.id)
  if (bar.kind !== 'spend') record(`${state.id} ${A.actions}: 介入槽里不是付费确认（kind=${bar.kind}）`)
  if (bar.tone) record(`${state.id} ${A.askFailure}: 等人决定时不该是警示边（tone=${bar.tone}）`)
  if (bar.waiting !== 'true') record(`${state.id} ${A.actions}: 等人决定时外框要是「在等你」（waiting=${bar.waiting}）`)
  if (expected.title === undefined ? bar.title !== null : bar.title !== expected.title) record(`${state.id} ${A.askTitle}: 条上${expected.title ? `标题应是「${expected.title}」` : '不画标题问话'}，实际「${bar.title}」`)
  if (expected.params !== undefined) {
    if (bar.params !== expected.params) record(`${state.id} ${A.params}: 共同参数应是「${expected.params}」，实际「${bar.params}」`)
  }
  for (const part of expected.paramsHas ?? []) if (!(bar.params ?? '').includes(part)) record(`${state.id} ${A.params}: 共同参数缺「${part}」：${bar.params}`)
  for (const part of expected.paramsLacks ?? []) if ((bar.params ?? '').includes(part)) record(`${state.id} ${A.params}: 逐镜不同的「${part}」不该写在条上：${bar.params}`)
  if (!bar.confirm || bar.confirm.text !== expected.confirm) record(`${state.id} ${A.generate}: 主按钮应是「${expected.confirm}」，实际「${bar.confirm?.text}」`)
  if (bar.confirm && bar.confirm.disabled !== Boolean(expected.disabled)) record(`${state.id} ${A.generate}: 主按钮${expected.disabled ? '应置灰' : '应可点'}（disabled=${bar.confirm.disabled}）`)
  if (bar.confirm?.locate) record(`${state.id} ${A.generate}: 「生成」前不该有定位图标`)
  const cancel = tr(locale, 'agentPanelV4.reject')
  if (!bar.dismiss || bar.dismiss.text !== cancel || bar.dismiss.disabled) record(`${state.id} ${A.cancel}: 「${cancel}」应在且可点：${JSON.stringify(bar.dismiss)}`)
  if (Boolean(bar.perShot) !== Boolean(expected.perShot)) record(`${state.id} ${A.perShot}: 逐镜折叠${expected.perShot ? '应出现（各镜价格不同）' : '不该出现'}`)
  if (bar.progress) record(`${state.id} ${A.sending}: 等人决定时不该有进度行`)
  await commonBar(page, state, record, bar)
}

/** 失败留在条上（板 ask.failure：结构照旧——⚠ 标题、原因、先不发了 · 再试一次 / 去改）；那一镜的那一行第二行写原因。 */
async function expectFailure(page, state, record, bar, group, expected) {
  const locale = localeOf(state.id)
  if (bar.kind !== 'spend') record(`${state.id} ${A.askFailure}: 介入槽里不是付费确认（kind=${bar.kind}）`)
  if (bar.tone !== 'danger') record(`${state.id} ${A.askFailure}: 失败时外框应是警示边（tone=${bar.tone}）`)
  if (!bar.titleIcon) record(`${state.id} ${A.failure}: 失败的标题前要有 ⚠`)
  const titleMatch = pattern(locale, expected.titleKey).exec(bar.title ?? '')
  if (!titleMatch) record(`${state.id} ${A.failure}: 标题「${bar.title}」不是 ${expected.titleKey} 那一句`)
  const shotRef = titleMatch?.groups?.shot
  const danger = bar.notices.find((notice) => notice.tone === 'danger')
  const reason = tr(locale, expected.reasonKey)
  if (!danger || !danger.text.includes(reason)) record(`${state.id} ${A.failure}: 原因行应是「${reason}」，实际 ${JSON.stringify(bar.notices)}`)
  const decline = tr(locale, 'agentPanelV4.spendCard.decline')
  if (!bar.dismiss || bar.dismiss.text !== decline || bar.dismiss.disabled) record(`${state.id} ${A.decline}: 失败时否定钮应是「${decline}」且可点：${JSON.stringify(bar.dismiss)}`)
  const name = expected.retry ? A.retry : A.goEdit
  const confirm = expected.retry ? tr(locale, 'agentPanelV4.spendCard.retry') : tr(locale, expected.locateKey, { shot: shotRef ?? '' })
  if (!bar.confirm || bar.confirm.text !== confirm || bar.confirm.disabled) record(`${state.id} ${name}: 主按钮应是可点的「${confirm}」，实际 ${JSON.stringify(bar.confirm)}`)
  if (bar.confirm && bar.confirm.locate === Boolean(expected.retry)) record(`${state.id} ${name}: ${expected.retry ? '「再试一次」前不该有定位图标' : '「去改 / 去看」前要有定位图标（点了是去节点）'}`)
  if (expected.unclear && /没有花钱|没花钱|not charged|no charge|wasn.t charged|nothing was charged/i.test(bar.text)) record(`${state.id} ${A.failure}: 结果未知却说了没花钱：${bar.text}`)
  // 出问题的那一镜在对话里那一行也看得到（第二行写它自己的结局），不是只在条上说。
  if (expected.rowDetail) {
    const row = group.rows?.find((item) => item.id === NODE(expected.shot))
    if (!row?.detail?.includes(expected.rowDetail)) record(`${state.id} ${A.askFailure}: 镜 0${expected.shot} 那一行第二行应说「${expected.rowDetail}」，实际「${row?.detail}」`)
  }
  await commonBar(page, state, record, bar)
}

/** 驱动在断言之前拍过这一格（没有指针）；走真指针的格子做完动作后重拍同一个文件。 */
async function reshoot(page, state) {
  await page.locator(`[data-design-lab-shot="${state.id}"]`).screenshot({ path: path.join(SHOT_DIR, `${state.id}.png`), animations: 'disabled' })
}

const rowAt = (page, shot) => page.locator(`[data-v4-block="generation-receipt-pointers"] [data-node-pointer-id="${NODE(shot)}"]`)

function waitForToggle(page, shot) {
  return page.waitForFunction((id) => {
    const wrap = document.querySelector(`[data-node-pointer-row] [data-node-pointer-id="${id}"]`)?.closest('[data-node-pointer-row]')
    const toggle = wrap?.querySelector('[data-spend-exclusion]')
    if (!toggle) return false
    let opacity = 1
    for (let node = toggle; node && node !== wrap; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
    return opacity > 0.99
  }, NODE(shot), { timeout: 3000 })
}

async function expectSpendCardState(page, state, record) {
  const locale = localeOf(state.id)
  if (darkOf(state.id)) {
    const scheme = await page.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme'))
    if (scheme !== 'dark') record(`${state.id} ${A.rows}: 暗色格子没有落在暗色主题上（${scheme}）`)
  }
  const all = (count) => tr(locale, 'agentPanelV4.spendCard.generateAll', { count })
  const allImage = (count) => tr(locale, 'agentPanelV4.spendCard.generateAllImage', { count })
  const each = (value) => tr(locale, 'agentPanelV4.spendCard.perShotSeconds', { value })
  const removedLine = uiText(locale, 'generationCommon.production.canvasLanding.removedNotGenerated')

  if (state.id.startsWith('spend-done')) {
    // 发完：条收走，同一组还在原处，下面「✓ 已发出 / 已生成 N 段」。
    if (await page.locator('[data-v4-block="intervention"]').count()) record(`${state.id} ${A.receipt}: 发完后条应离开输入框上方`)
    const group = await groupFacts(page)
    const generated = state.id !== 'spend-done-sending'
    expectRows(state, record, group, { total: 3, open: false, faces: generated ? ['result', 'result', 'result'] : ['result', 'generating', 'generating'] })
    const key = generated ? 'agentPanelV4.spendCard.receiptGeneratedVideo' : 'agentPanelV4.spendCard.receiptSentVideo'
    const line = tr(locale, key, { count: 3 })
    if (!group.line || group.line.phase !== (generated ? 'generated' : 'sent') || group.line.text !== line) record(`${state.id} ${A.receipt}: 同一组下面应是「${line}」，实际 ${JSON.stringify(group.line)}`)
    if (MONEY.test(group.line?.text ?? '')) record(`${state.id} ${A.receipt}: 那一句印了钱`)
    if (group.rows.some((row) => row.toggle)) record(`${state.id} ${A.receipt}: 发完后行尾不再挂小钮`)
    // 点了照样定位：Enter 定位 → 那一行标上「已定位」。
    await rowAt(page, 1).focus()
    await page.keyboard.press('Enter')
    await page.locator('[data-v4-block="generation-receipt-pointers"] [data-node-pointer-located]').first().waitFor({ timeout: 3000 }).catch(() => record(`${state.id} ${A.located}: 那一组的行 Enter 没有定位`))
    await noAccentOutline(page, state, record)
    return
  }

  const bar = await barFacts(page)
  if (!bar) { record(`${state.id} ${A.actions}: 输入框上方没有那一条确认`); return }
  const group = await groupFacts(page)

  switch (state.id) {
    case 'spend-single':
    case 'spend-single-en-dark-narrow': {
      await expectDecide(page, state, record, bar, { confirm: tr(locale, 'agentPanelV4.spendCard.generate'), paramsHas: ['Seedance', '16:9', '480p', '4s'], paramsLacks: [each('4s')] })
      expectRows(state, record, group, { total: 1, faces: ['production'], details: [null] })
      // 单段的不生成就是「取消」：行尾不挂 ×。
      expectToggles(state, record, group, [null])
      break
    }
    case 'spend-batch':
    case 'spend-batch-en':
    case 'spend-batch-dark':
    case 'spend-batch-en-dark':
    case 'spend-batch-narrow': {
      await expectDecide(page, state, record, bar, { confirm: all(3), paramsHas: ['Seedance', '16:9', '480p', each('5s')] })
      if (!(bar.params ?? '').includes(uiText(locale, 'agentPanelV4.spendParamsModelPicked'))) record(`${state.id} ${A.params}: 模型是 Nomi 选的，共同参数要说出来：${bar.params}`)
      expectRows(state, record, group, { total: 3, faces: ['production', 'production', 'production'], details: [null, null, null] })
      expectToggles(state, record, group, ['exclude', 'exclude', 'exclude'])
      expectTogglesHidden(state, record, group)
      if (state.id === 'spend-batch') barHeights[3] = bar.height
      if (narrowOf(state.id) && bar.width > 321) record(`${state.id} ${A.actions}: 窄面板里条比 320 还宽：${bar.width}`)
      if (state.id !== 'spend-batch') break
      // 真悬停镜 02：只它的 × 露出来、那一行亮起、条一点不变。
      await rowAt(page, 2).hover()
      await waitForToggle(page, 2).catch(() => record(`${state.id} ${A.exclude}: 真悬停镜 02 后「不生成 ×」没露出来`))
      const hovered = await groupFacts(page)
      expectOnlyShown(state, record, hovered, 2)
      if (!hovered.rows[1]?.hot) record(`${state.id} ${A.rows}: 鼠标停着的镜 02 那一行应亮起`)
      const after = await barFacts(page)
      if (Math.abs((after?.height ?? 0) - bar.height) > 0.5) record(`${state.id} ${A.actions}: 悬停一行后条的高度变了 ${bar.height} → ${after?.height}`)
      await reshoot(page, state)
      await page.mouse.move(0, 0)
      break
    }
    case 'spend-twelve':
    case 'spend-twelve-en-dark-narrow': {
      await expectDecide(page, state, record, bar, { confirm: all(12), paramsHas: ['Seedance', '16:9', '480p', each('5s')] })
      expectRows(state, record, group, { total: 12, shown: FOLD })
      expectToggles(state, record, group, ['exclude', 'exclude', 'exclude', 'exclude'])
      if (state.id === 'spend-twelve') {
        barHeights[12] = bar.height
        console.log(`[bar-height] 3 镜=${barHeights[3]?.toFixed(1) ?? '?'}px · 12 镜=${bar.height.toFixed(1)}px`)
        if (barHeights[3] !== undefined && Math.abs(barHeights[3] - bar.height) > 0.5) record(`${state.id} ${A.actions}: 12 镜的条（${bar.height}px）和 3 镜（${barHeights[3]}px）不一样高`)
      }
      break
    }
    case 'spend-twelve-open':
    case 'spend-twelve-open-en-dark': {
      await expectDecide(page, state, record, bar, { confirm: all(12) })
      expectRows(state, record, group, { total: 12, shown: 12 })
      expectToggles(state, record, group, Array.from({ length: 12 }, () => 'exclude'))
      if (state.id === 'spend-twelve-open' && barHeights[12] !== undefined && Math.abs(barHeights[12] - bar.height) > 0.5) record(`${state.id} ${A.more}: 展开后条的高度变了 ${barHeights[12]} → ${bar.height}`)
      break
    }
    case 'spend-durations': {
      await expectDecide(page, state, record, bar, { confirm: all(3), paramsHas: ['Seedance', '16:9', '480p'], paramsLacks: ['4s', '5s'] })
      expectRows(state, record, group, { total: 3, details: ['4s', '5s', '4s'] })
      break
    }
    case 'spend-mixed':
    case 'spend-mixed-en': {
      await expectDecide(page, state, record, bar, { confirm: all(3), perShot: true, paramsHas: ['Seedance', '480p'], paramsLacks: ['16:9', '9:16'] })
      expectRows(state, record, group, { total: 3, details: ['16:9 · 4s', '9:16 · 5s', '9:16 · 4s'] })
      const label = tr(locale, 'agentPanelV4.spendParamsPerItem')
      if (!bar.perShot?.open || !bar.perShot.label.startsWith(label)) record(`${state.id} ${A.perShot}: 「${label}」应展开：${JSON.stringify(bar.perShot)}`)
      const rows = bar.perShot?.rows ?? []
      if (rows.length !== 3 || rows.some((row) => !/\d/.test(row[1] ?? ''))) record(`${state.id} ${A.perShot}: 展开后每镜一行带每镜价：${JSON.stringify(rows)}`)
      break
    }
    case 'spend-exclude-focus': {
      await expectDecide(page, state, record, bar, { confirm: all(3) })
      expectOnlyShown(state, record, group, 2)
      // 键盘可达：从那一行 Tab 一下就到它的「不生成 ×」（看得见才点得到，对键盘也一样）。
      await page.keyboard.press('Tab')
      const active = await page.evaluate(() => ({ kind: document.activeElement?.getAttribute('data-spend-exclusion') ?? null, name: document.activeElement?.getAttribute('aria-label') ?? '' }))
      if (active.kind !== 'exclude' || !pattern(locale, 'agentPanelV4.spendCard.excludeName').test(active.name)) record(`${state.id} ${A.exclude}: 从镜 02 Tab 一下没落到它的「不生成 ×」：${JSON.stringify(active)}`)
      const focused = await groupFacts(page)
      expectOnlyShown(state, record, focused, 2)
      break
    }
    case 'spend-excluded':
    case 'spend-excluded-en-dark-narrow': {
      await expectDecide(page, state, record, bar, { confirm: all(2) })
      expectRows(state, record, group, { total: 3, details: [null, removedLine, null] })
      expectToggles(state, record, group, ['exclude', 'restore', 'exclude'])
      break
    }
    case 'spend-all-removed': {
      await expectDecide(page, state, record, bar, { title: tr(locale, 'agentPanelV4.spendCard.titleNothing'), confirm: tr(locale, 'agentPanelV4.spendCard.generate'), disabled: true })
      expectRows(state, record, group, { total: 3, details: [removedLine, removedLine, removedLine] })
      expectToggles(state, record, group, ['restore', 'restore', 'restore'])
      break
    }
    case 'spend-deleted': {
      await expectDecide(page, state, record, bar, { confirm: all(2) })
      expectRows(state, record, group, { total: 3, faces: ['production', 'production', 'removed'] })
      if (!group.rows[2]?.disabled) record(`${state.id} ${A.rows}: 已删除的那一行必须不可点（aria-disabled）`)
      expectToggles(state, record, group, ['exclude', 'exclude', null])
      break
    }
    case 'spend-remaining': {
      await expectDecide(page, state, record, bar, { confirm: tr(locale, 'agentPanelV4.spendConfirmRemainingVideo', { count: 2 }) })
      expectRows(state, record, group, { total: 3, faces: ['generating', 'production', 'production'] })
      if (!group.rows[0]?.detail) record(`${state.id} ${A.status}: 生成中的那一行第二行要说它此刻的状态`)
      expectToggles(state, record, group, [null, 'exclude', 'exclude'])
      break
    }
    case 'spend-images':
    case 'spend-images-en-dark-narrow': {
      await expectDecide(page, state, record, bar, { confirm: allImage(3), paramsHas: ['GPT Image 2', '16:9', '1K'] })
      expectRows(state, record, group, { total: 3 })
      const titles = group.rows.map((row) => row.title)
      if (titles.some((title) => !title)) record(`${state.id} ${A.rows}: 图片行没有标题：${JSON.stringify(titles)}`)
      break
    }
    case 'spend-sending':
    case 'spend-sending-en-dark': {
      // 发出中：条上只剩「正在发出 k/N 段」+ 取消，不画标题；各行写自己的状态。
      const progress = tr(locale, 'agentPanelV4.spendBatchProgressVideo', { current: 2, total: 3 })
      if (bar.title !== null) record(`${state.id} ${A.askTitle}: 发出中条上不画标题，实际「${bar.title}」`)
      if (!(bar.progress ?? '').includes(progress)) record(`${state.id} ${A.sending}: 条上应是「${progress}」，实际「${bar.progress}」`)
      if (bar.waiting !== 'false') record(`${state.id} ${A.progress}: 正在发出是安静框（不在等人点），waiting=${bar.waiting}`)
      if (bar.tone) record(`${state.id} ${A.progress}: 正在发出不是警示边`)
      if (bar.confirm) record(`${state.id} ${A.progress}: 正在发出时不该再有主按钮`)
      const cancel = tr(locale, 'agentPanelV4.reject')
      if (!bar.dismiss || bar.dismiss.text !== cancel || bar.dismiss.disabled) record(`${state.id} ${A.progressStop}: 「${cancel}」应在且可点：${JSON.stringify(bar.dismiss)}`)
      expectRows(state, record, group, { total: 3, faces: ['generating', 'generating', 'production'] })
      if (!(group.rows[1]?.detail ?? '').includes(uiText(locale, 'generationCommon.observability.progress.submitting'))) record(`${state.id} ${A.note}: 镜 02 应说「提交中」：${group.rows[1]?.detail}`)
      if (!(group.rows[2]?.detail ?? '').includes(uiText(locale, 'generationCommon.production.canvasLanding.queued'))) record(`${state.id} ${A.note}: 镜 03 应说「排队中」：${group.rows[2]?.detail}`)
      if (group.rows.some((row) => row.toggle)) record(`${state.id} ${A.exclude}: 正在发出时不再挂小钮`)
      await commonBar(page, state, record, bar)
      break
    }
    case 'spend-not-sent':
    case 'spend-not-sent-en-dark': {
      await expectFailure(page, state, record, bar, group, { shot: 2, titleKey: 'agentPanelV4.spendCard.failedTitle.notSent', reasonKey: 'agentPanelV4.spendCard.failure.provider_not_reached', retry: true })
      expectRows(state, record, group, { total: 3, faces: ['generating', 'failed', 'production'] })
      expectToggles(state, record, group, [null, null, 'exclude'])
      break
    }
    case 'spend-rejected':
    case 'spend-rejected-en': {
      await expectFailure(page, state, record, bar, group, { shot: 2, titleKey: 'agentPanelV4.spendCard.failedTitle.rejected', reasonKey: 'agentPanelV4.spendCard.failure.provider_rejected', locateKey: 'agentPanelV4.spendCard.goEdit' })
      expectRows(state, record, group, { total: 3, faces: ['generating', 'failed', 'production'] })
      break
    }
    case 'spend-unclear': {
      await expectFailure(page, state, record, bar, group, { shot: 2, titleKey: 'agentPanelV4.spendCard.failedTitle.unclear', reasonKey: 'agentPanelV4.spendCard.failure.unclear', locateKey: 'agentPanelV4.spendCard.goCheck', unclear: true, rowDetail: tr(locale, 'agentPanelV4.spendCard.failure.unclear') })
      break
    }
    case 'spend-blocked': {
      await expectFailure(page, state, record, bar, group, { shot: 1, titleKey: 'agentPanelV4.spendCard.failedTitle.blocked', reasonKey: 'agentPanelV4.spendCard.failure.prompt_required', locateKey: 'agentPanelV4.spendCard.goEdit' })
      break
    }
    case 'spend-blocked-one': {
      await expectDecide(page, state, record, bar, { confirm: all(2) })
      expectRows(state, record, group, { total: 3, faces: ['production', 'failed', 'production'] })
      const notice = bar.notices.find((item) => item.tone === 'danger')
      const line = tr(locale, 'agentPanelV4.spendCard.blockedNotice', { shot: '镜 02', reason: tr(locale, 'agentPanelV4.spendCard.failure.prompt_required') })
      if (!notice || notice.text.trim() !== line) record(`${state.id} ${A.askFailure}: 应只多一行说明「${line}」，实际 ${JSON.stringify(bar.notices)}`)
      // 那一行第二行写原因（和条上那一句同一个产地，设计卡 ★4「那一行红色第二行写原因」）。
      const reason = tr(locale, 'agentPanelV4.spendCard.failure.prompt_required')
      if (!(group.rows[1]?.detail ?? '').includes(reason)) record(`${state.id} ${A.note}: 发不出去的那一行第二行应写原因「${reason}」：${group.rows[1]?.detail}`)
      break
    }
    case 'spend-price-unknown': {
      await expectDecide(page, state, record, bar, { confirm: all(3) })
      if (MONEY.test(bar.text) || /\b0\.0+\b/.test(bar.text)) record(`${state.id} ${A.total}: 算不出价时条上一个钱字都不许印（更不许是 0）：${bar.text}`)
      break
    }
    case 'spend-model-changed': {
      await expectDecide(page, state, record, bar, { confirm: all(3) })
      if ((bar.params ?? '').includes(uiText(locale, 'agentPanelV4.spendParamsModelPicked'))) record(`${state.id} ${A.params}: 节点里换过模型，共同参数不该再说「${uiText(locale, 'agentPanelV4.spendParamsModelPicked')}」：${bar.params}`)
      break
    }
    case 'spend-brake-retry':
    case 'spend-brake-out-of-plan-en': {
      await expectDecide(page, state, record, bar, { confirm: tr(locale, 'agentPanelV4.spendCard.generate') })
      // 刹车把直接档退回这一条确认：多一行原因；输入框仍在直接档，上沿常驻提醒还在。
      const key = state.id === 'spend-brake-retry' ? 'agentPanelV4.brakeRetry.title' : 'agentPanelV4.brakeOutOfPlan.title'
      const reason = uiText(locale, key)
      if (!bar.text.includes(reason)) record(`${state.id} ${A.brake} / ${A.brakeReason}: 条上没有刹车原因那一行「${reason}」`)
      if (!(await page.locator('[data-v4-block="auto-mode"]').count())) record(`${state.id} ${A.brake}: 直接档的常驻提醒不在（刹车只在直接档出现）`)
      break
    }
    case 'spend-unreadable': {
      if (bar.kind !== 'missing-card') record(`${state.id} ${A.unreadable}: 读不到待决时应是那张会说话的缺卡，实际 kind=${bar.kind}`)
      const title = uiText(locale, 'agentPanelV4.missingCard.title')
      if (bar.title !== title) record(`${state.id} ${A.unreadable}: 缺卡标题应是「${title}」，实际「${bar.title}」`)
      const reason = uiText(locale, 'agentPanelV4.missingCard.reason.spend-surface-unavailable')
      if (!bar.text.includes(reason)) record(`${state.id} ${A.unreadable}: 缺卡没说读不到的原因「${reason}」`)
      if (bar.confirm || bar.pointers) record(`${state.id} ${A.unreadable}: 缺卡上不该有可点的「生成」或镜头`)
      if (group.count) record(`${state.id} ${A.unreadable}: 读不到出价时对话里不该凭空画出一组镜头`)
      break
    }
    default:
      record(`${state.id}: 走查没有登记这一格的断言`)
  }
}

await walkDesignLabScreen({
  screen: 'spend-card',
  title: '付费确认（镜头在对话里 + 输入框上方一条确认）',
  role: 'walk-spend-card',
  cellWidth: 438,
  columns: 4,
  viewport: { width: 1240, height: 900 },
  assertState: expectSpendCardState,
})
