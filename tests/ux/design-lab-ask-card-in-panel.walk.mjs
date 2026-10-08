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
const STATES = [
  ['v4-panel-question-light', 'question', 'light'],
  ['v4-panel-question-light', 'question', 'dark'],
  // 付费卡 = **真卡**：正文是节点参数条那个共享组件，数据由生产投影 `projectSpendCard` 算。
  ['v4-panel-spend-light', 'spend', 'light'],
  ['v4-panel-spend-light', 'spend', 'dark'],
  // 普通确认卡（可撤销档）——同族第三张，验的是「换壳是一处改、全族生效」。
  ['v4-panel-approval-light', 'approval', 'light'],
  ['v4-panel-approval-light', 'approval', 'dark'],
  // 收尾补的三种：多题反问卡 / 多镜付费卡 / 未知价付费卡。
  ['v4-panel-question-multi', 'question-multi', 'light'],
  ['v4-panel-question-multi', 'question-multi', 'dark'],
  ['v4-panel-spend-batch', 'spend-batch', 'light'],
  ['v4-panel-spend-batch', 'spend-batch', 'dark'],
  ['v4-panel-spend-unknown', 'spend-unknown', 'light'],
  ['v4-panel-spend-unknown', 'spend-unknown', 'dark'],
  // 待答态的**对照格**（2026-09-22）：同一张卡、同一个取景，只把「在等你」关掉。
  // 有了这两格，「待答 → 强调 / 答完 → 普通纸面」才是一组能并排看的证据，
  // 而不是一句只能靠读代码相信的话。上面那条兄弟对账也正是靠它们跑到 else 那一支。
  ['v4-panel-question-answered', 'question-answered', 'light'],
  ['v4-panel-question-answered', 'question-answered', 'dark'],
  ['v4-panel-spend-confirmed', 'spend-confirmed', 'light'],
  ['v4-panel-spend-confirmed', 'spend-confirmed', 'dark'],
  // 2026-10-08：带变体 chip 的 Seedance 2.0 在生产宽 390 下、以及压窄到 300 时。合同：影响报价的 chip
  // 与身份 chip（模型 / 变体）每颗整颗可见、不相压；放不下换到第二行，不横向滚动、不退进 ⚙。
  ['v4-panel-spend-seedance', 'spend-seedance', 'light'],
  ['v4-panel-spend-seedance-narrow', 'spend-seedance-narrow', 'light'],
  // 这一对格子自己把卡切到英文（上两格固定中文）：两轨各证一遍。
  ['v4-panel-spend-seedance-en', 'spend-seedance-en', 'light'],
  ['v4-panel-spend-seedance-narrow-en', 'spend-seedance-narrow-en', 'light'],
]

/** Seedance 2.0 文生视频在付费卡上必须摆出来的报价 chip（档案 derive 的主参数）。 */
const SEEDANCE_PRICED_CHIPS = ['aspect_ratio', 'duration', 'resolution']

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
    for (const [state, kind, theme] of STATES) {
      await page.goto(`${BASE}/design-lab.html?screen=agent-panel-v4&frame=1&state=${state}&scheme=${theme}`, { waitUntil: 'networkidle' })
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
      // 参数条：**任意两颗控件不许相互压住**（EN 下「Kling 3.0」盖住「16:9」、390px 下「16:9」压在
      // 变体「标准」上都是这个）。量的是真矩形两两相交——付费卡的 chips 允许换行，只比左右会把
      // 第二行的 chip 误判成压住第一行的。
      const overlaps = await shot.locator('[data-node-composer-footer]').evaluateAll((rows) => {
        const hits = []
        for (const row of rows) {
          const boxes = [...row.querySelectorAll('button, [data-parameter-chip]')]
            .map((node) => ({ node, rect: node.getBoundingClientRect() }))
            .filter(({ rect }) => rect.width > 0 && rect.height > 0)
            // 只比最外层的可点块：chip 的 span 里包着它自己的 button，父子不算相压。
            .filter(({ node }, _, all) => !all.some((other) => other.node !== node && other.node.contains(node)))
          for (let i = 0; i < boxes.length; i += 1) {
            for (let j = i + 1; j < boxes.length; j += 1) {
              const a = boxes[i].rect
              const b = boxes[j].rect
              const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
              const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
              if (overlapX > 1 && overlapY > 1) {
                hits.push(`${(boxes[i].node.textContent || '').trim().slice(0, 14)} ↔ ${(boxes[j].node.textContent || '').trim().slice(0, 14)}`)
              }
            }
          }
        }
        return hits
      })
      if (overlaps.length) failures.push(`${tag}/${theme}/${kind}：参数条里控件相互压住：${overlaps.join(' | ')}`)
      // 付费卡底栏：每颗 chip（参数 chip + 模型 / 变体）整颗落在卡里；参数行不横向滚动、不靠滚动藏东西。
      if (kind.startsWith('spend')) {
        const bar = await shot.evaluate((element) => {
          const card = element.querySelector('[data-v4-block="intervention"]')
          const row = card?.querySelector('[data-node-composer-footer] .generation-canvas-v2-node__params--parameters')
          if (!card || !row) return null
          const cardRect = card.getBoundingClientRect()
          const members = [...row.querySelectorAll('[data-parameter-chip], button')]
            .filter((node, _, all) => !all.some((other) => other !== node && other.contains(node)))
            .map((node) => ({ text: (node.textContent || '').trim().slice(0, 14), rect: node.getBoundingClientRect() }))
            .filter(({ rect }) => rect.width > 0 && rect.height > 0)
          return {
            chips: [...row.querySelectorAll('[data-parameter-chip]')].map((node) => node.getAttribute('data-parameter-chip')),
            variant: Boolean(row.querySelector('button[aria-label="变体"], button[aria-label="Variant"]')),
            overflowX: getComputedStyle(row).overflowX,
            scrolls: row.scrollWidth - row.clientWidth > 1,
            outside: members.filter(({ rect }) => rect.left < cardRect.left - 0.5 || rect.right > cardRect.right + 0.5).map(({ text }) => text),
            rows: new Set(members.map(({ rect }) => Math.round(rect.top))).size,
          }
        })
        if (!bar) failures.push(`${tag}/${theme}/${kind}：付费卡里找不到参数行`)
        else {
          if (bar.scrolls || ['auto', 'scroll'].includes(bar.overflowX)) failures.push(`${tag}/${theme}/${kind}：参数行要横向滚动才看得全（overflow-x: ${bar.overflowX}）——放不下必须换行`)
          if (bar.outside.length) failures.push(`${tag}/${theme}/${kind}：这几颗伸出了卡外：${bar.outside.join(' | ')}`)
          if (kind.startsWith('spend-seedance')) {
            const missing = SEEDANCE_PRICED_CHIPS.filter((key) => !bar.chips.includes(key))
            if (missing.length) failures.push(`${tag}/${theme}/${kind}：报价参数没摆在底栏上（退进了 ⚙ 或丢了）：${missing.join(', ')}`)
            if (!bar.variant) failures.push(`${tag}/${theme}/${kind}：Seedance 2.0 的变体 chip 不在底栏上`)
          }
          if (kind.startsWith('spend-seedance-narrow') && bar.rows < 2) failures.push(`${tag}/${theme}/${kind}：压窄到 300 却仍是一行（${bar.rows} 行）——这一格要证的「换行」没发生`)
          measured.push({ locale: tag, theme, kind: `${kind}:bar`, ...bar })
        }
      }
      // 页脚左下那一格（合计 / 价格未知那句）不许被省略号截断——EN 串长，截断只有眼睛看得出，
      // 所以量它：内容宽不许超过自己的盒子。
      const leadClipped = await shot.locator('[data-v4-block="slot-total"]').evaluateAll((nodes) =>
        nodes.filter((node) => node.scrollWidth - node.clientWidth > 1).length)
      if (leadClipped) failures.push(`${tag}/${theme}/${kind}：页脚左下那句被截断了`)
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
          // accent 此刻是什么值由 token 说了算（明暗两套），所以不比字面色值，比「和静息
          // composer 的发丝线不是同一个色」——那正是「一眼看得出这张卡在等你」的机器判据。
          if (shape.cardShell.borderColor === shape.composerShell.borderColor) {
            failures.push(`${tag}/${theme}/${kind}：卡在待答态，外框却还是 composer 那条发丝线（${shape.cardShell.borderColor}）——强调没生效`)
          }
          if (shape.cardShell.shadow === 'none') {
            failures.push(`${tag}/${theme}/${kind}：卡在待答态却没有那层同色描边光`)
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
  `shots: ${outDir} (8 kinds × light/dark × zh/en = 32)`,
  `measured: ${JSON.stringify(measured, null, 2)}`,
  'covers: the ask card rendered in its real place (conversation above, composer below, panel shell around) next to the paid confirm card in the same slot, with shell metrics (width, border, radius, shadow, head band, padding, primary button family, close button, composer gap) measured on both so they can be reconciled side by side.',
  failures.length ? `failures: ${failures.join(' | ')}` : 'failures: none',
].join('\n')
fs.writeFileSync(path.join(outDir, 'report.md'), `${report}\n`)
console.log(report)
if (failures.length) process.exit(1)
