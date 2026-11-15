// 反问卡**放进真面板之后**长什么样（2026-09-21 用户问「有弄我们的设计系统不？会不会格格不入？」）。
//
// 单件取景框证不了这件事：那里的卡是浅色底、孤零零一格，看不出它和邻居合不合得来。
// 这条走查把它放回真位置（上面对话流、下面 composer、外面面板壳），并且**和付费确认卡
// 用同一个取景**各拍一张，好让两张卡并排对账。
//
// 除了拍照，还**量**同槽两张卡的外壳：外框色/粗细、圆角、内边距、卡头条、按钮族、
// 卡宽是否与 composer 对齐。「用了 token」不等于「放进去不突兀」——差异要量得出来才谈得上统一。
import { chromium } from 'playwright'
import { stationTimeout } from './_station-budget.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './design-lab/labStates.mjs'
import { assertLabPortOwnership, labPortFor } from './design-lab/labServer.mjs'

// 自己的角色 = 自己的端口（原来借的是 `walk-agent-panel-v4`：三份入口并行跑会抢同一口）。
const LAB = { role: 'walk-ask-card-in-panel' }
const ROLE = LAB.role
const PORT = labPortFor(ROLE)
const BASE = `http://127.0.0.1:${PORT}`
const outDir = process.env.ASK_IN_PANEL_OUT || path.join(REPO_ROOT, 'tests/ux/shots/design-lab-ask-card-in-panel')
fs.mkdirSync(outDir, { recursive: true })

/**
 * 暗色走实验室**自己的开关** `?scheme=dark`（`designLab.tsx` → `applyNomiColorScheme`），
 * 它和真 App 同一条路：一次落三样——`data-mantine-color-scheme` 属性、`data-theme`、
 * 以及根节点的**内联** `color-scheme`。
 *
 * 这里走错过两次，都拍出了假证据：
 * ① 用 `AgentPanelV4Panel` 的 `darkMode` prop——它只换用户气泡底色，面板和卡一点不动；
 * ② 只手动翻 `data-mantine-color-scheme` 属性——token 翻了，但根上那句内联 `color-scheme: light`
 *    还在，于是**原生控件**（反问卡的单选圆点、计划卡的勾选框）照旧按浅色方案画：
 *    暗色卡面上三个实心白圆盘，看起来像三个都选中了。真 App 里不会这样，是取景方式造的假象。
 */
/**
 * 每一项：哪一屏、哪一格（按界面语言给；缺哪种语言就不拍那一种）、卡的种类、主题。
 * 反问卡 / 普通确认卡在 agent-panel-v4 屏（格子跟着页面语言走）；付费卡住自己的屏 `spend-card`（SpendCardQ1 板，D2 第③步），
 * 那一屏的格子把语言钉在格子上，所以英文用它的 `-en` 那一格。
 */
const V4 = (id) => ({ screen: 'agent-panel-v4', state: { 'zh-CN': id, en: id } })
const SPEND = (zh, en) => ({ screen: 'spend-card', state: { 'zh-CN': zh, ...(en ? { en } : {}) } })
const STATES = [
  [V4('v4-panel-question-light'), 'question', 'light'],
  [V4('v4-panel-question-light'), 'question', 'dark'],
  // 付费确认 = **真条**：共同参数一行 + 「取消」/「生成」，镜头在对话里那一组；数据由生产钩子 `useAgentPanelSpendCard` 从节点现读。
  [SPEND('spend-single'), 'spend', 'light'],
  [SPEND('spend-single'), 'spend', 'dark'],
  // 普通确认卡（可撤销档）——同族第三张，验的是「换壳是一处改、全族生效」。
  [V4('v4-panel-approval-light'), 'approval', 'light'],
  [V4('v4-panel-approval-light'), 'approval', 'dark'],
  // 收尾补的三种：多题反问卡 / 多镜付费卡 / 未知价付费卡。
  [V4('v4-panel-question-multi'), 'question-multi', 'light'],
  [V4('v4-panel-question-multi'), 'question-multi', 'dark'],
  [SPEND('spend-batch', 'spend-batch-en'), 'spend-batch', 'light'],
  [SPEND('spend-batch', 'spend-batch-en'), 'spend-batch', 'dark'],
  [SPEND('spend-price-unknown'), 'spend-unknown', 'light'],
  [SPEND('spend-price-unknown'), 'spend-unknown', 'dark'],
  // 待答态的**对照格**（2026-09-22）：同一张卡、同一个取景，只把「在等你」关掉。
  // 有了这两格，「待答 → 强调 / 答完 → 普通纸面」才是一组能并排看的证据，
  // 而不是一句只能靠读代码相信的话。上面那条兄弟对账也正是靠它们跑到 else 那一支。
  [V4('v4-panel-question-answered'), 'question-answered', 'light'],
  [V4('v4-panel-question-answered'), 'question-answered', 'dark'],
  // 付费卡的不在等那一档是「正在发出 k/N 段」（安静框：它在说进度，不在等人点）。
  [SPEND('spend-sending'), 'spend-sending', 'light'],
  [SPEND('spend-sending'), 'spend-sending', 'dark'],
  // 面板压窄到 300：指向元素只留镜号 + 缩略图，主按钮与页脚不被裁、不横向滚动。
  [SPEND('spend-batch-narrow'), 'spend-narrow', 'light'],
  // 英文长文案（逐镜不同的摘要 + 逐镜明细展开）。
  [SPEND('spend-mixed', 'spend-mixed-en'), 'spend-mixed', 'light'],
]

const failures = []
const measured = []

function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try { const r = await fetch(url); if (r.ok || r.status === 404) return resolve() } catch { /* not up */ }
      if (Date.now() - start > timeoutMs) return reject(new Error('vite dev server 启动超时'))
      setTimeout(tick, 400)
    }
    tick()
  })
}

// 直接用 node 起 vite 本体（不经 npx 垫片）：Windows 上 spawn('npx') 找不到可执行文件，
// 而且经垫片起的 vite 在 kill 垫片后会成孤儿继续占内存。
const vite = spawn(process.execPath, [path.join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'pipe'],
})
vite.stderr?.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`))
await waitForServer(`${BASE}/design-lab.html`)
assertLabPortOwnership(ROLE)

const browser = await chromium.launch({ headless: true })
try {
  for (const locale of ['zh-CN', 'en']) {
    const context = await browser.newContext({ viewport: { width: 520, height: 960 }, deviceScaleFactor: 2 })
    await context.addInitScript(([key, value]) => { window.localStorage.setItem(key, value) }, ['nomi:locale:v1', locale])
    const page = await context.newPage()
    const tag = locale === 'zh-CN' ? 'zh' : 'en'
    for (const [where, kind, theme] of STATES) {
      const state = where.state[locale]
      if (!state) continue
      await page.goto(`${BASE}/design-lab.html?screen=${where.screen}&frame=1&state=${state}&scheme=${theme}`, { waitUntil: 'networkidle' })
      await page.waitForFunction(() => window.__designLabReady === true, null, { timeout: stationTimeout() })
      // token 翻转带 transition，不等就会读到 / 拍到插值中的那一帧（灰不灰、蓝不蓝）。
      await page.waitForTimeout(400)
      const shot = page.locator(`[data-design-lab-shot="${state}"]`)
      await shot.waitFor({ state: 'visible', timeout: stationTimeout() })
      await page.waitForTimeout(300)
      await shot.screenshot({ path: path.join(outDir, `${tag}-${theme}-${kind}.png`) })

      /**
       * 量这张卡的外壳，以及它和 composer 的关系。
       * 两张卡量的是**同一批字段**，报告里才能并排成一张表。
       */
      const shape = await shot.evaluate((element) => {
        const card = element.querySelector('[data-v4-block="intervention"]')
        if (!card) return { missing: true }
        const cs = getComputedStyle(card)
        const rect = card.getBoundingClientRect()
        const composer = element.querySelector('[data-v4-block="composer"]')
          ?? element.querySelector('textarea')?.closest('div[class]')
        const composerRect = composer?.getBoundingClientRect()
        // 卡头条 = 卡里第一个有非透明背景的块级子元素
        const head = [...card.children].find((child) => {
          const style = getComputedStyle(child)
          return style.backgroundColor !== 'rgba(0, 0, 0, 0)' && child.getBoundingClientRect().height > 0
        })
        const primary = card.querySelector('[data-v4-control="confirm"], [data-v4-control="ask-continue"]')
        const primaryRect = primary?.getBoundingClientRect()
        const close = card.querySelector('[data-v4-control="slot-dismiss"]')
        const closeRect = close?.getBoundingClientRect()
        const body = card.querySelector('[data-v4-block="ask-question"]')?.closest('div[class*="p-"]')
          ?? [...card.children].find((child) => child.querySelector('[data-v4-row]') || child.querySelector('p'))
        const composerStyle = composer ? getComputedStyle(composer) : null
        const shellOf = (style) => style ? {
          background: style.backgroundColor,
          borderColor: style.borderTopColor,
          borderWidth: style.borderTopWidth,
          radius: style.borderTopLeftRadius,
          shadow: style.boxShadow,
        } : null
        return {
          cardShell: shellOf(cs),
          composerShell: shellOf(composerStyle),
          // 这张卡此刻在不在等用户（外壳直接落的属性，两态都在）。兄弟对账按它分账。
          waiting: card.getAttribute('data-waiting'),
          width: Math.round(rect.width),
          border: `${cs.borderTopWidth} ${cs.borderTopColor}`,
          radius: cs.borderTopLeftRadius,
          shadow: cs.boxShadow === 'none' ? 'none' : 'yes',
          background: cs.backgroundColor,
          headBand: head ? getComputedStyle(head).backgroundColor : 'none',
          headPad: head ? getComputedStyle(head).padding : '—',
          bodyPad: body ? getComputedStyle(body).padding : '—',
          primary: primary ? {
            label: (primary.textContent || '').trim().slice(0, 10),
            radius: getComputedStyle(primary).borderTopLeftRadius,
            height: Math.round(primaryRect.height),
            bg: getComputedStyle(primary).backgroundColor,
            // 主按钮在卡里靠左还是靠右
            side: primaryRect.left - rect.left < rect.right - primaryRect.right ? 'left' : 'right',
          } : null,
          close: close ? {
            size: `${Math.round(closeRect.width)}×${Math.round(closeRect.height)}`,
            // × 在卡顶还是卡底
            where: closeRect.top - rect.top < rect.bottom - closeRect.bottom ? 'top' : 'bottom',
          } : null,
          scheme: document.documentElement.getAttribute('data-mantine-color-scheme'),
          // 原生单选 / 勾选控件按哪套方案画，由它**继承到的 `color-scheme`** 决定（UA 画的，
          // 没有 computed background 可读）。它必须等于当前主题，也必须等于同屏 composer 的。
          nativeSchemes: [...card.querySelectorAll('input[type="radio"], input[type="checkbox"]')].map((node) => getComputedStyle(node).colorScheme),
          composerScheme: composer ? getComputedStyle(composer).colorScheme : null,
          uncheckedChecked: [...card.querySelectorAll('input[type="radio"], input[type="checkbox"]')].filter((node) => node.checked).length,
          composerWidth: composerRect ? Math.round(composerRect.width) : null,
          composerGap: composerRect ? Math.round(composerRect.top - rect.bottom) : null,
        }
      })
      measured.push({ locale: tag, theme, kind, ...shape })
      // 付费卡（D2 第③步，SpendCardQ1 板）：卡上只有指向元素 + 一行只读摘要 + 动作行。卡里不许有编辑器零件
      // （生成框 / 参数 chip / 摘要 pill / 输入框——改参数的家只有节点，设计系统 §1.0）；指向元素、「不生成 ×」、
      // 主按钮整颗落在卡里，不靠横向滚动藏东西（窄面板与英文长文案各证一遍）。
      if (kind.startsWith('spend')) {
        const card = await shot.evaluate((element) => {
          const root = element.querySelector('[data-v4-block="intervention"]')
          if (!root) return null
          const rect = root.getBoundingClientRect()
          const members = [...root.querySelectorAll('[data-node-pointer], [data-spend-exclusion], [data-v4-control]')]
            .map((node) => ({ text: (node.textContent || '').trim().slice(0, 14), rect: node.getBoundingClientRect() }))
            .filter((member) => member.rect.width > 0 && member.rect.height > 0)
          return {
            editors: root.querySelectorAll('textarea, input, select, [data-composer-host], [data-node-composer-footer], [data-parameter-chip], [data-parameter-summary]').length,
            // 拆开后（SpendAskSplit）镜头住在对话里那一组，条上一个都不许有。
            pointers: element.querySelectorAll('[data-v4-block="generation-receipt-pointers"] [data-node-pointer]').length,
            barPointers: root.querySelectorAll('[data-node-pointer], [data-spend-exclusion]').length,
            outside: members.filter((member) => member.rect.left < rect.left - 0.5 || member.rect.right > rect.right + 0.5).map((member) => member.text),
            scrolls: [...root.querySelectorAll('*')].filter((node) => node.scrollWidth - node.clientWidth > 1 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowX)).length,
          }
        })
        if (!card) failures.push(`${tag}/${theme}/${kind}：面板里没有付费卡`)
        else {
          if (card.editors) failures.push(`${tag}/${theme}/${kind}：付费卡里出现了 ${card.editors} 个编辑器零件（生成框 / 参数 chip / 输入框）——卡上不许有可改的东西`)
          if (!card.pointers) failures.push(`${tag}/${theme}/${kind}：对话里没有这一批镜头那一组`)
          if (card.barPointers) failures.push(`${tag}/${theme}/${kind}：输入框上方那一条确认里画了 ${card.barPointers} 个镜头 / 小钮——镜头住在对话里`)
          if (card.outside.length) failures.push(`${tag}/${theme}/${kind}：这几颗伸出了卡外：${card.outside.join(' | ')}`)
          if (card.scrolls) failures.push(`${tag}/${theme}/${kind}：卡里有 ${card.scrolls} 处要横向滚动才看得全——放不下必须换行或截断带全名`)
          measured.push({ locale: tag, theme, kind: `${kind}:card`, ...card })
        }
      }
      if (kind === 'spend-unknown') {
        const enabled = await shot.locator('[data-v4-control="confirm"]').isEnabled()
        if (!enabled) failures.push(`${tag}/${theme}/${kind}：算不出价时主按钮被禁用了——用户硬性拍板：算不出价绝不拦生成`)
      }
      if (shape.missing) failures.push(`${tag}/${theme}/${kind}：面板里没渲染出介入槽`)
      if (shape.scheme !== theme) failures.push(`${tag}/${theme}/${kind}：主题没翻过去（量到 ${shape.scheme}）`)
      for (const native of shape.nativeSchemes ?? []) {
        if (native !== theme || native !== shape.composerScheme) {
          failures.push(`${tag}/${theme}/${kind}：原生圆点按「${native}」方案画，主题是 ${theme}、composer 是 ${shape.composerScheme}——暗色下会画成实心白盘，像全选中了`)
        }
      }
      if (shape.uncheckedChecked) failures.push(`${tag}/${theme}/${kind}：卡一挂上来就有 ${shape.uncheckedChecked} 个选项是选中态——「推荐」只是记号，不预选`)
      // **卡是 composer 的兄弟**（用户 2026-09-22 看真机后的验收标准）：底色、描边粗细、圆角
      // 的 computed 值必须与同屏 composer **逐字相等**，明暗都是。
      // 读之前已经等过主题 transition（上面那 400ms），否则读到的是插值中的那一帧。
      //
      // **描边色与阴影从这张对照表里挪出去了**（2026-09-22 用户追加的待答态）：等用户回答时
      // 卡的外框是 accent 发丝线 + 一层同色描边光，那是**有意**与静息 composer 不同的。
      // 兄弟这条没被推翻——用的还是 composer 自己那两句（`border-nomi-accent` /
      // `shadow-[0_0_0_Npx_var(--nomi-accent-soft)]`，它聚焦与在跑时说的就是这个），
      // 只是卡在「等你」这一刻说了出来。所以这两项改成按 `data-waiting` 分账：
      // 待答 → 必须是 accent 且必须带那层光；非待答 → 必须退回与 composer 逐字相等。
      // 这里的实验室取景全是待答态（槽里有卡 ≡ 有一条在等你），非待答那一支由单测守
      //（`agentPanelV4Blocks.test.ts`「待答态」那几条），截图归两版样张。
      if (!shape.composerShell) failures.push(`${tag}/${theme}/${kind}：同屏找不到 composer，兄弟对账做不了`)
      else {
        for (const key of ['background', 'borderWidth', 'radius']) {
          if (shape.cardShell[key] !== shape.composerShell[key]) {
            failures.push(`${tag}/${theme}/${kind}：卡与 composer 的 ${key} 不相等（卡「${shape.cardShell[key]}」/ composer「${shape.composerShell[key]}」）`)
          }
        }
        if (shape.waiting === 'true') {
          // 2026-10-10「去蓝色描边」之后，待答态是一条更深的灰线（`border-nomi-ink-40`），不再带 accent 与那层描边光。
          // 深线此刻是什么值由 token 说了算（明暗两套），所以不比字面色值，比「和静息 composer 的发丝线不是同一个色」——
          // 那正是「一眼看得出这张卡在等你」的机器判据；光晕必须没有（蓝只留在进度上）。
          if (shape.cardShell.borderColor === shape.composerShell.borderColor) {
            failures.push(`${tag}/${theme}/${kind}：卡在待答态，外框却还是 composer 那条发丝线（${shape.cardShell.borderColor}）——强调没生效`)
          }
          if (shape.cardShell.shadow !== 'none') {
            failures.push(`${tag}/${theme}/${kind}：卡在待答态还带着一层描边光（${shape.cardShell.shadow}）——10-10 起只留深色细线`)
          }
        } else {
          for (const key of ['borderColor', 'shadow']) {
            if (shape.cardShell[key] !== shape.composerShell[key]) {
              failures.push(`${tag}/${theme}/${kind}：卡已不在待答态，${key} 却没回到 composer 那一档（卡「${shape.cardShell[key]}」/ composer「${shape.composerShell[key]}」）`)
            }
          }
        }
      }
    }
    await context.close()
  }

  // 同槽两张卡的外壳必须**同族**。这几条不是审美偏好，是「一眼看出是不是一家人」的机器判据。
  for (const kind of ['question', 'spend', 'approval']) {
    const light = measured.find((row) => row.locale === 'zh' && row.theme === 'light' && row.kind === kind)
    const dark = measured.find((row) => row.locale === 'zh' && row.theme === 'dark' && row.kind === kind)
    if (light && dark && light.background === dark.background) {
      failures.push(`${kind}：亮暗两轨卡底色一样（${light.background}）——token 没翻，这张「暗色」什么都没证`)
    }
  }
  for (const theme of ['light', 'dark']) {
    const ask = measured.find((row) => row.locale === 'zh' && row.theme === theme && row.kind === 'question')
    const spend = measured.find((row) => row.locale === 'zh' && row.theme === theme && row.kind === 'spend')
    if (!ask || !spend || ask.missing || spend.missing) continue
    if (ask.width !== spend.width) failures.push(`${theme}：两张卡不一样宽（反问 ${ask.width} / 付费 ${spend.width}）——同一个槽里宽度必须一致`)
    if (ask.radius !== spend.radius) failures.push(`${theme}：圆角不一样（反问 ${ask.radius} / 付费 ${spend.radius}）`)
    if (ask.border !== spend.border) failures.push(`${theme}：外框不一样（反问「${ask.border}」/ 付费「${spend.border}」）`)
    if (ask.primary && spend.primary && ask.primary.radius !== spend.primary.radius) {
      failures.push(`${theme}：主按钮圆角不一样（反问 ${ask.primary.radius} / 付费 ${spend.primary.radius}）——按钮族要同一套`)
    }
    if (ask.primary && spend.primary && ask.primary.height !== spend.primary.height) {
      failures.push(`${theme}：主按钮高度不一样（反问 ${ask.primary.height} / 付费 ${spend.primary.height}）`)
    }
    if (ask.composerGap !== null && spend.composerGap !== null && ask.composerGap !== spend.composerGap) {
      failures.push(`${theme}：卡与 composer 的间距不一样（反问 ${ask.composerGap} / 付费 ${spend.composerGap}）`)
    }
  }
} catch (error) {
  failures.push(`走查中断：${error?.message || error}`)
} finally {
  await browser.close().catch(() => undefined)
  vite.kill('SIGTERM')
}

const report = [
  '# design lab · ask card inside the real panel',
  '',
  `result: ${failures.length ? 'failed' : 'passed'}`,
  `shots: ${outDir} (${STATES.length} rows × zh/en; spend-card cells without an English twin are shot in Chinese only)`,
  `measured: ${JSON.stringify(measured, null, 2)}`,
  'covers: the ask card rendered in its real place (conversation above, composer below, panel shell around) next to the paid confirm card in the same slot, with shell metrics (width, border, radius, shadow, head band, padding, primary button family, close button, composer gap) measured on both so they can be reconciled side by side.',
  failures.length ? `failures: ${failures.join(' | ')}` : 'failures: none',
].join('\n')
fs.writeFileSync(path.join(outDir, 'report.md'), `${report}\n`)
console.log(report)
if (failures.length) process.exit(1)
