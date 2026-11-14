// 设计实验室 · 指向元素（NodePointer 板，2026-10-23 D2 第②步）走查。零额度：纯本地渲染。
// 每一格截图（中英、光暗）+ 下面这些板断言。断言名就是 NodePointer.board.json 里各元素的 `assertion`（check:board-parity R4）。
// 真画布那一头（投影 → 外壳上的 data-external-highlight、闪完清掉）由 canvas-focus-composer-visible.walk.mjs 在真 Electron 里钉。
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'
import { uiText, uiTextPattern } from './full-walk/invariants.mjs'

const A = {
  p1: 'board:NodePointer/pointer.p1',
  label: 'board:NodePointer/pointer.label',
  summary: 'board:NodePointer/pointer.summary',
  waiting: 'board:NodePointer/pointer.state.waiting',
  queued: 'board:NodePointer/pointer.state.queued',
  generating: 'board:NodePointer/pointer.state.generating',
  done: 'board:NodePointer/pointer.state.done',
  failed: 'board:NodePointer/pointer.state.failed',
  deleted: 'board:NodePointer/pointer.deleted',
  vertical: 'board:NodePointer/pointer.vertical',
  group: 'board:NodePointer/pointer.group',
  more: 'board:NodePointer/pointer.group.more',
  hoverLink: 'board:NodePointer/pointer.hover-link',
  canvasHighlight: 'board:NodePointer/canvas.node.highlight',
  located: 'board:NodePointer/pointer.located',
  narrowCollapse: 'board:NodePointer/pointer.narrow.collapse',
  narrowBack: 'board:NodePointer/pointer.narrow.back',
  row: 'board:NodePointer/pointer.p2.row',
  chip: 'board:NodePointer/pointer.p2.chip',
}

const pointer = (id, scope = '') => `${scope} [data-node-pointer-id="${id}"]`.trim()

/** 不许蓝色描边：指向元素与外壳上没有一个类把强调色 / info 色用在边线、环、描边、阴影上（转圈的文字色不算）。 */
async function noAccentOutline(page, state, record) {
  const offenders = await page.evaluate(() => {
    const scope = [...document.querySelectorAll('[data-node-pointer], [data-node-pointer-return], [data-external-highlight], [data-node-pointer-group]')]
    const bad = []
    for (const root of scope) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const cls = typeof el.className === 'string' ? el.className : el.getAttribute('class') || ''
        if (/(?:border|ring|outline|shadow)-[^\s]*(?:accent|info)/.test(cls)) bad.push(cls.slice(0, 120))
      }
    }
    return bad
  })
  if (offenders.length) record(`${state.id} ${A.hoverLink}: 出现强调色描边类 ${offenders.slice(0, 3).join(' | ')}`)
}

async function faces(page, scope = '') {
  return page.evaluate((selector) => [...document.querySelectorAll(selector)].map((el) => ({
    id: el.getAttribute('data-node-pointer-id'),
    face: el.getAttribute('data-node-pointer-face'),
    density: el.getAttribute('data-node-pointer'),
    aria: el.getAttribute('aria-label') || '',
    disabled: el.getAttribute('aria-disabled') === 'true',
    text: el.textContent || '',
  })), `${scope} [data-node-pointer]`.trim())
}

/** A2 / A5 那一组状态都在、各说各的（中英、光暗共用）。 */
async function expectStatesBoard(page, state, record, english) {
  const all = await faces(page)
  const face = (id, density = 'card') => all.find((item) => item.id === id && item.density === density)
  const expectFace = (id, kind, name, density = 'card') => { if (face(id, density)?.face !== kind) record(`${state.id} ${name}: ${id}(${density}) 应是 ${kind}，实际 ${face(id, density)?.face}`) }
  expectFace('np-await', 'production', A.waiting)
  expectFace('np-queued', 'production', A.queued)
  expectFace('np-gen', 'generating', A.generating)
  expectFace('np-done', 'result', A.done)
  expectFace('np-failed', 'failed', A.failed)
  expectFace('np-gone', 'removed', A.deleted)
  expectFace('np-done', 'result', A.row, 'row')
  if (!/1\/3/.test(face('np-queued')?.text ?? '')) record(`${state.id} ${A.queued}: 排队小标没有第 k/N：${face('np-queued')?.text}`)
  if (!face('np-gone')?.disabled) record(`${state.id} ${A.deleted}: 已删除的指向元素必须不可点（aria-disabled）`)
  if (english && !/Opens it on the canvas/.test(face('np-done')?.aria ?? '')) record(`${state.id} ${A.p1}: 英文读屏名不对：${face('np-done')?.aria}`)
  if (!english && !/点了在画布上定位/.test(face('np-done')?.aria ?? '')) record(`${state.id} ${A.p1}: 读屏名不对：${face('np-done')?.aria}`)
  if (!/16:9/.test(face('np-done')?.text ?? '')) record(`${state.id} ${A.summary}: P1 摘要没带比例：${face('np-done')?.text}`)
  const more = await page.locator('[data-node-pointer-more="2"]').count()
  if (more < 2) record(`${state.id} ${A.more}: 5 个镜头的组指向（卡与句中标签）应各折出「还有 2 个 / +2」，实际 ${more}`)
  // 英文更宽：标题行不许撑破卡（名字截断，全名在悬停提示里）。
  const overflow = await page.evaluate(() => [...document.querySelectorAll('[data-node-pointer="card"] > span:first-child')]
    .filter((row) => row.scrollWidth > row.clientWidth + 1 && !row.getAttribute('title')).length)
  if (overflow) record(`${state.id} ${A.label}: ${overflow} 个标题行溢出且没有悬停全名`)
  await noAccentOutline(page, state, record)
}

/** 每一格的板断言（walkDesignLabScreen 的逐格钩子）。 */
async function expectNodePointerState(page, state, record) {
    switch (state.id) {
      case 'np-anatomy': {
        // 一张脸：指向元素的镜号、制作小标、状态条原话 = 画布上同一个节点的那几样（同一个组件 / 同一句话）。
        for (const id of ['np-await', 'np-gen', 'np-done']) {
          const onCanvas = await page.locator(`[data-lab-canvas-node="${id}"] [data-shot-number]`).first().textContent()
          const inChat = await page.locator(`${pointer(id)}[data-node-pointer="card"] [data-shot-number]`).first().textContent()
          if (!onCanvas || onCanvas !== inChat) record(`${state.id} ${A.label}: ${id} 镜号两边不一致：画布「${onCanvas}」/ 聊天「${inChat}」`)
        }
        const corner = await page.locator('[data-lab-canvas-node="np-await"] [data-shot-placeholder-state]').first().textContent()
        const pointerText = await page.locator(`${pointer('np-await')}[data-node-pointer="card"]`).textContent()
        if (!corner || !pointerText?.includes(corner)) record(`${state.id} ${A.waiting}: 等你确认小标与节点不是同一句：节点「${corner}」`)
        const canvasStatus = await page.locator('[data-lab-canvas-node="np-gen"] [data-generation-message]').first().textContent()
        const chatStatus = await page.locator(`${pointer('np-gen')}[data-node-pointer="card"] [data-generation-message]`).first().textContent()
        if (!canvasStatus || canvasStatus !== chatStatus) record(`${state.id} ${A.generating}: 状态条两边不是同一句：「${canvasStatus}」/「${chatStatus}」`)
        if (await page.locator('[data-node-pointer-id] [data-shot-placeholder-state], [data-node-pointer-id] [data-production-shot-node]').count()) record(`${state.id} ${A.p1}: 指向元素带了画布占位的走查锚点`)
        await noAccentOutline(page, state, record)
        break
      }
      case 'np-p1-states': {
        const all = await faces(page)
        const byId = Object.fromEntries(all.map((item) => [item.id, item]))
        for (const [id, kind, name] of [['np-await', 'production', A.waiting], ['np-queued', 'production', A.queued], ['np-gen', 'generating', A.generating], ['np-done', 'result', A.done], ['np-failed', 'failed', A.failed], ['np-gone', 'removed', A.deleted], ['np-not-here', 'unavailable', A.deleted], ['np-stopped', 'stopped', A.p1], ['np-recoverable', 'recoverable', A.p1]]) {
          if (byId[id]?.face !== kind) record(`${state.id} ${name}: ${id} 应是 ${kind}，实际 ${byId[id]?.face}`)
        }
        if (byId['np-not-here']?.text.includes('已删除')) record(`${state.id} ${A.deleted}: 宿主没说删就不许说已删除（D4）`)
        if (!byId['np-not-here']?.disabled) record(`${state.id} ${A.deleted}: 占位不可点`)
        // 宿主给的结局只从 outcome 这一个口子进来：读屏那一句（nodePointer.ariaOutcome）念的和摘要行印的是同一个值——按它认，不在测试里抄文案。
        const failedAria = await page.locator(pointer('np-failed')).getAttribute('aria-label')
        const hostOutcome = new RegExp(`${uiTextPattern(uiText('zh-CN', 'nodePointer.ariaOutcome'), { anchored: true })}$`).exec(failedAria ?? '')?.groups?.outcome ?? null
        if (!hostOutcome || !byId['np-failed']?.text.includes(hostOutcome)) record(`${state.id} ${A.failed}: 失败摘要行没印宿主给的结局（读屏念的是「${failedAria}」）`)
        // 失败的宿主结局行是红（danger-ink）：板 markup 本意是 .bd，渲成灰是样张里 CSS 优先级被 .sum 压过的意外（V-d2-pointer 偏差 5，保留红）。
        const outcomeInk = await page.evaluate((outcome) => {
          const line = outcome ? [...document.querySelectorAll('[data-node-pointer-id="np-failed"] span')].find((el) => !el.firstElementChild && el.textContent?.includes(outcome)) : undefined
          const probe = document.createElement('span')
          probe.className = 'text-nomi-danger-ink'
          document.body.appendChild(probe)
          const danger = getComputedStyle(probe).color
          probe.remove()
          return { line: line ? getComputedStyle(line).color : null, danger }
        }, hostOutcome)
        if (!outcomeInk.line || outcomeInk.line !== outcomeInk.danger) record(`${state.id} ${A.failed}: 失败的宿主结局行必须是红（danger-ink ${outcomeInk.danger}），实际 ${outcomeInk.line}`)
        const longTitle = await page.locator(`${pointer('np-long')} > span:first-child`).getAttribute('title')
        if (!longTitle || !longTitle.includes('河湾')) record(`${state.id} ${A.label}: 长名字没有悬停全名`)
        // 键盘：聚焦一个指向元素、Enter 定位 → 它标上「已定位」。
        await page.locator(pointer('np-done')).focus()
        await page.keyboard.press('Enter')
        await page.locator(`${pointer('np-done')} [data-node-pointer-located]`).waitFor({ timeout: 3000 }).catch(() => record(`${state.id} ${A.p1}: Enter 没有定位（没标上已定位）`))
        await noAccentOutline(page, state, record)
        break
      }
      case 'np-groups': {
        const groups = page.locator('[data-node-pointer-group="card"]')
        const counts = await groups.evaluateAll((list) => list.map((group) => ({
          tiles: group.querySelectorAll('[data-node-pointer="card"]').length,
          more: group.querySelector('[data-node-pointer-more]')?.getAttribute('data-node-pointer-more') ?? null,
        })))
        if (JSON.stringify(counts.slice(0, 4)) !== JSON.stringify([{ tiles: 3, more: null }, { tiles: 3, more: null }, { tiles: 3, more: '2' }, { tiles: 3, more: '1' }])) record(`${state.id} ${A.more}: 折叠不对：${JSON.stringify(counts)}`)
        const mixed = await page.locator('[data-node-pointer-group="card"]').nth(1).locator('[data-node-pointer="card"]').evaluateAll((list) => list.map((el) => el.getAttribute('data-node-pointer-face')))
        if (JSON.stringify(mixed) !== JSON.stringify(['result', 'generating', 'failed'])) record(`${state.id} ${A.group}: 混合状态组应各自显示 完成 / 生成中 / 失败，实际 ${JSON.stringify(mixed)}`)
        // 竖版：画面框按真比例（9:16），在 16:9 槽里居中，不裁不拉伸。
        const ratio = await page.locator(`${pointer('np-tall-done')} [data-node-pointer-frame]`).first().evaluate((frame) => {
          const rect = frame.getBoundingClientRect()
          const slot = frame.parentElement.getBoundingClientRect()
          return { ratio: rect.width / rect.height, centred: Math.abs((rect.left - slot.left) - (slot.right - rect.right)) < 1.5 }
        })
        if (Math.abs(ratio.ratio - 9 / 16) > 0.03 || !ratio.centred) record(`${state.id} ${A.vertical}: 竖版框 ${JSON.stringify(ratio)}`)
        // 真悬停一格（V-d2-pointer 建议 A）：组的高度一点不变——摘要那一行常驻，悬停 / 离开不把下面的东西（第③步的「生成」钮）顶下去；
        // 摘要现算，带模型名（实验室里目录比悬停到得晚的那一类，原来拍成字符串存下来就缺模型名）。
        const firstGroup = groups.first()
        const heightIdle = (await firstGroup.boundingBox())?.height ?? 0
        await firstGroup.locator('[data-node-pointer="card"]').nth(1).hover()
        const summaryLine = firstGroup.locator('[data-node-pointer-hover-summary]')
        await summaryLine.waitFor({ timeout: 3000 }).catch(() => record(`${state.id} ${A.hoverLink}: 悬停一格后组下方没有摘要行`))
        const heightHover = (await firstGroup.boundingBox())?.height ?? 0
        if (Math.abs(heightHover - heightIdle) > 0.5) record(`${state.id} ${A.hoverLink}: 悬停一格后组的高度变了 ${heightIdle} → ${heightHover}（摘要行要预留，不能把下面顶下去）`)
        const hoverText = await summaryLine.first().textContent().catch(() => null)
        if (!/Seedance/.test(hoverText ?? '')) record(`${state.id} ${A.hoverLink}: 悬停摘要行缺模型名：「${hoverText}」`)
        await page.mouse.move(0, 0)
        await page.locator('[data-node-pointer-more="2"]').first().click()
        const expanded = await groups.nth(2).locator('[data-node-pointer="card"]').count()
        if (expanded !== 5) record(`${state.id} ${A.more}: 点「还有 2 个」后应全露 5 个，实际 ${expanded}`)
        await noAccentOutline(page, state, record)
        break
      }
      case 'np-p2': {
        const rows = await faces(page, '[data-node-pointer-group="row"]')
        if (rows.length !== 6) record(`${state.id} ${A.row}: 列表行应有 6 行，实际 ${rows.length}`)
        if (!(await page.locator(`${pointer('np-done')}[data-node-pointer="row"] [data-node-pointer-located]`).count())) record(`${state.id} ${A.located}: 点过的那一行没标「已定位」`)
        const chips = page.locator('[data-node-pointer="chip"]')
        if (await chips.count() < 7) record(`${state.id} ${A.chip}: 句中小标签数量不对：${await chips.count()}`)
        await page.locator('[data-node-pointer-group="chip"] [data-node-pointer-more="2"]').click()
        if (await page.locator('[data-node-pointer-group="chip"]').nth(1).locator('[data-node-pointer="chip"]').count() !== 5) record(`${state.id} ${A.chip}: 点「+2」没展开`)
        // 焦点环只留全局那一份（设计系统 §8；V-d2-pointer 建议 C）：键盘聚焦行 / 句中小标签 / 「+N」，各只有全局 2px outline，
        // 自己不再带 ring（box-shadow 里没有环），不再叠成双环。先按一下 Tab 让页面进入键盘模式，再聚焦才会匹配 :focus-visible。
        await page.keyboard.press('Tab')
        for (const [name, target] of [
          ['列表行', page.locator('[data-node-pointer="row"]').first()],
          ['句中小标签', page.locator('[data-node-pointer="chip"]').first()],
          ['「+N」', page.locator('[data-node-pointer-group="chip"] [data-node-pointer-more]').first()],
        ]) {
          await target.focus()
          const ring = await target.evaluate((el) => {
            const style = getComputedStyle(el)
            return { outline: `${style.outlineStyle} ${style.outlineWidth}`, shadow: style.boxShadow }
          })
          if (ring.outline !== 'solid 2px') record(`${state.id} ${A.row}: ${name} 键盘聚焦没有全局 2px 焦点环：${ring.outline}`)
          if (ring.shadow !== 'none') record(`${state.id} ${A.row}: ${name} 自己又画了一圈（box-shadow ${ring.shadow}），会和全局焦点环叠成双环`)
        }
        await noAccentOutline(page, state, record)
        break
      }
      case 'np-hover':
      case 'np-hover-en-dark': {
        for (const id of ['np-draft-1', 'np-draft-2', 'np-draft-3', 'np-control']) {
          if (await page.locator(`[data-lab-canvas-node="${id}"]`).count() !== 2) record(`${state.id} ${A.canvasHighlight}: 上下两半都应有 ${id} 画布节点外壳`)
        }
        if (!(await page.locator(`[data-lab-hover="p1"] ${pointer('np-draft-2')}[data-node-pointer-hot="true"]`).count())) record(`${state.id} ${A.hoverLink}: 悬停的 P1 没有亮`)
        if (!(await page.locator(`[data-lab-hover="p2"] ${pointer('np-draft-2')}[data-node-pointer-hot="true"]`).count())) record(`${state.id} ${A.row}: 悬停的 P2 行没有亮`)
        const lit = await page.locator('[data-external-highlight]').evaluateAll((list) => list.map((el) => [el.closest('[data-lab-canvas-node]')?.getAttribute('data-lab-canvas-node'), el.getAttribute('data-external-highlight')]))
        if (!lit.some(([id, kind]) => id === 'np-draft-2' && kind === 'hover') || lit.some(([id]) => id !== 'np-draft-2')) record(`${state.id} ${A.canvasHighlight}: 画布上亮的不是镜 02 一个：${JSON.stringify(lit)}`)
        if (await page.locator('[data-lab-canvas-node="np-control"] [data-external-highlight]').count()) record(`${state.id} ${A.canvasHighlight}: 对照节点 np-control 不应被悬停联动点亮`)
        await assertLinkBoardLayout(page, state, record)
        const shadow = await page.locator('[data-lab-canvas-node="np-draft-2"] [data-external-highlight="hover"]').first().evaluate((el) => getComputedStyle(el).boxShadow)
        if (!shadow || shadow === 'none') record(`${state.id} ${A.canvasHighlight}: 悬停没有深色细线 + 阴影`)
        if (!(await page.locator('[data-node-pointer-hover-summary]').count())) record(`${state.id} ${A.hoverLink}: 组下方没显示被悬停那一镜的摘要`)
        // 摘要行现算（V-d2-pointer 偏差 8）：实验室里自动悬停发生在模型目录载完之前，摘要仍要带上模型名。
        const hoverSummary = await page.locator('[data-node-pointer-hover-summary]').first().textContent()
        if (!/Seedance/.test(hoverSummary ?? '')) record(`${state.id} ${A.hoverLink}: 悬停摘要行缺模型名：「${hoverSummary}」`)
        await noAccentOutline(page, state, record)
        break
      }
      case 'np-located': {
        for (const id of ['np-draft-1', 'np-draft-2', 'np-draft-3', 'np-control']) {
          if (await page.locator(`[data-lab-canvas-node="${id}"]`).count() !== 2) record(`${state.id} ${A.canvasHighlight}: 上下两半都应有 ${id} 画布节点外壳`)
        }
        if (await page.locator('[data-lab-canvas-node="np-draft-2"] [data-external-highlight="flash"]').count() !== 2) record(`${state.id} ${A.canvasHighlight}: 上下两半的镜 02 都应闪一下`)
        for (const id of ['np-draft-1', 'np-draft-3', 'np-control']) {
          if (await page.locator(`[data-lab-canvas-node="${id}"] [data-external-highlight="flash"]`).count()) record(`${state.id} ${A.canvasHighlight}: ${id} 不应闪一下`)
        }
        await assertLinkBoardLayout(page, state, record)
        if (await page.locator(`[data-lab-hover="p1"] ${pointer('np-draft-2')} [data-node-pointer-located]`).count() !== 1) record(`${state.id} ${A.located}: P1 那一项没标「已定位」`)
        await noAccentOutline(page, state, record)
        break
      }
      case 'np-narrow':
      case 'np-narrow-en-dark': {
        const back = page.locator('[data-node-pointer-return]')
        if (await back.count() !== 2) record(`${state.id} ${A.narrowBack}: 「回到对话」应有 P1 / P2 两种，实际 ${await back.count()}`)
        const labelled = await back.nth(1).textContent()
        if (!/02/.test(labelled ?? '')) record(`${state.id} ${A.narrowBack}: P2 形态的「回到对话」没带那一枚标签：${labelled}`)
        // 看得见的字守设计系统 §1.8 规则 3（V-d2-pointer 建议 D）：中文 ≤4 字、英文 ≤2 词；读屏名 / 悬停名写全（词典键 backToChatName）。
        // 期望值一律从词典按键取（不在走查里再抄一份文案）。
        const locale = state.id === 'np-narrow-en-dark' ? 'en' : 'zh-CN'
        const visibleWord = uiText(locale, 'nodePointer.backToChat')
        const fullName = uiText(locale, 'nodePointer.backToChatName')
        const backFaces = await back.evaluateAll((list) => list.map((el) => ({ text: el.textContent?.trim() ?? '', name: el.getAttribute('aria-label') ?? '', title: el.getAttribute('title') ?? '' })))
        for (const item of backFaces) {
          const action = item.text.replace(/^.*·\s*/, '')
          if (action !== visibleWord) record(`${state.id} ${A.narrowBack}: 「回到对话」可见文字应是词典里的「${visibleWord}」：「${item.text}」`)
          if (locale === 'en' ? action.split(/\s+/).filter(Boolean).length > 2 : [...action].length > 4) record(`${state.id} ${A.narrowBack}: 「回到对话」可见文字超出 §1.8 规则 3（中文 ≤4 字 / 英文 ≤2 词）：「${item.text}」`)
          if (!item.name.endsWith(fullName) || item.name !== item.title) record(`${state.id} ${A.narrowBack}: 读屏名 / 悬停名应写全「${fullName}」：${item.name} / ${item.title}`)
        }
        if (!(await page.locator('[data-external-highlight="flash"]').count())) record(`${state.id} ${A.narrowCollapse}: 收起后画布目标没有闪一下`)
        if (!(await page.locator('[data-agent-ball]').count())) record(`${state.id} ${A.narrowCollapse}: 收起后的小球没画出来`)
        // Esc 也回到对话：「回到对话」那一颗消失（机器让位结束，对话回到让开前的样子；人存的形态从没被改过）。
        await page.keyboard.press('Escape')
        await back.first().waitFor({ state: 'detached', timeout: 3000 }).catch(() => record(`${state.id} ${A.narrowBack}: Esc 没有回到对话`))
        await noAccentOutline(page, state, record)
        break
      }
      case 'np-en':
        await expectStatesBoard(page, state, record, true)
        break
      case 'np-dark':
      case 'np-en-dark': {
        const scheme = await page.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme'))
        if (scheme !== 'dark') record(`${state.id} ${A.p1}: 暗色格子没有落在暗色主题上（${scheme}）`)
        await expectStatesBoard(page, state, record, state.id === 'np-en-dark')
        break
      }
      default:
        record(`${state.id}: 走查没有登记这一格的断言`)
    }
}

async function assertLinkBoardLayout(page, state, record) {
  const halves = await page.locator('[data-link-board-half]').evaluateAll((rows) => rows.map((row) => {
    const canvas = row.querySelector('.link-board-canvas')
    const ids = ['np-draft-1', 'np-draft-2', 'np-draft-3', 'np-control']
    const boxes = Object.fromEntries(ids.map((id) => {
      const outer = row.querySelector(`[data-lab-canvas-node="${id}"]`)
      const frame = outer?.querySelector('[data-node-id]')
      const r = frame?.getBoundingClientRect()
      const o = outer?.getBoundingClientRect()
      return [id, r && o ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, outerTop: o.top } : null]
    }))
    return { boxes, canvas: canvas?.getBoundingClientRect() }
  }))
  if (halves.length !== 2) record(`${state.id} ${A.canvasHighlight}: 上下两半画布数量不对：${halves.length}`)
  for (const half of halves) {
    const boxes = half.boxes
    const shots = ['np-draft-1', 'np-draft-2', 'np-draft-3'].map((id) => boxes[id])
    if (shots.some((box) => !box) || !boxes['np-control']) { record(`${state.id} ${A.canvasHighlight}: 四张节点缺少可测框`); continue }
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    for (let i = 0; i < shots.length; i += 1) for (let j = i + 1; j < shots.length; j += 1) if (overlaps(shots[i], shots[j])) record(`${state.id} ${A.canvasHighlight}: 镜头节点 ${i + 1}/${j + 1} 重叠`)
    for (const shot of shots) if (overlaps(shot, boxes['np-control'])) record(`${state.id} ${A.canvasHighlight}: 对照节点与镜头重叠`)
    if (!(boxes['np-control'].top > boxes['np-draft-2'].bottom && boxes['np-control'].left < boxes['np-draft-2'].right && boxes['np-control'].right > boxes['np-draft-2'].left)) record(`${state.id} ${A.canvasHighlight}: 对照节点没有在镜 02 正下方`)
    if (half.canvas && ['np-draft-1', 'np-draft-2', 'np-draft-3', 'np-control'].some((id) => boxes[id].left < half.canvas.left || boxes[id].right > half.canvas.right || boxes[id].top < half.canvas.top || boxes[id].bottom > half.canvas.bottom)) record(`${state.id} ${A.canvasHighlight}: 节点越出画布底板`)
  }
  const controlLabel = page.locator('[data-lab-canvas-node="np-control"] [data-node-label-row]')
  const visibleLabels = await controlLabel.evaluateAll((labels) => labels.filter((label) => getComputedStyle(label).visibility !== 'hidden' && label.getBoundingClientRect().width > 0).length)
  if (await controlLabel.count() !== 2 || visibleLabels !== 2) record(`${state.id} ${A.label}: 对照节点标签行不可见`)
  if ((await controlLabel.evaluateAll((labels) => labels.some((label) => !(label.textContent ?? '').trim())))) record(`${state.id} ${A.label}: 对照节点标签为空`)
  if (await page.locator('[data-lab-canvas-node="np-control"] [data-shot-number]').count()) record(`${state.id} ${A.label}: 对照节点不应有镜号胶囊`)
  const widths = await page.locator('[data-link-board-half] > [class*="rounded-r-none"]').evaluateAll((els) => els.map((el) => el.parentElement?.getBoundingClientRect().width ? (el.parentElement.getBoundingClientRect().width - el.getBoundingClientRect().width) : 0))
  if (widths.some((width) => Math.abs(width - 360) > 1)) record(`${state.id} ${A.row}: 聊天面板宽度不是 360：${widths.join(', ')}`)
}

await walkDesignLabScreen({
  screen: 'node-pointer',
  title: '指向元素',
  role: 'walk-node-pointer',
  cellWidth: 1240,
  columns: 1,
  viewport: { width: 1240, height: 780 },
  assertState: expectNodePointerState,
})
