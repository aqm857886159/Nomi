// F3 + F16b 真 UI 走查：选区入口与合并后的单张确认卡。
// 这条走查只用本地文稿与 E2E spend bridge，不调用供应商；四路隔离目录由启动器统一注入。
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectAbsent, expectVisible, proveProbe } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-f3-f16b-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const projectRoot = path.join(projectsDir, 'f3-f16b-project')
const shotsDir = path.resolve('tests/ux/shots/f3-f16b')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

const story = '林薇在雨夜的老码头被人追赶，她穿过积水的巷子，霓虹灯牌在水面上碎成一片。'
const project = {
  id: 'f3-f16b-project', name: 'F3 F16b 走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocument: { version: 1, title: 'F3 F16b', updatedAt: 1, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: story }] }] } },
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null, storyboardPlanCommitted: false,
  },
}
for (const file of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) fs.writeFileSync(file, JSON.stringify(project))

const { app, win } = await launchNomiApp({ name: 'f3-f16b', userDataDir: path.join(root, 'user-data'), settingsDir, projectsDir, settleMs: 900 })

/**
 * 等 ConfirmDialogHost 那张常驻 Modal 的整棵弹层树**离开 DOM**。
 *
 * Host 是单例 Modal（src/design/confirmDialog.tsx:70），opened 由 Boolean(active) 驱动。
 * 关卡时 active→null 会让 data-confirm-dialog-surface 立刻消失，但 Mantine 的退场过渡
 * 仍在渲染，且此刻按钮文案回落成默认的「取消/确认」（runtime.design.*）——那就是鬼影的来源。
 * 所以判据必须是「节点没了」，不是「属性没了」，也不是「淡得看不见了」。
 */
async function waitForConfirmHostUnmounted(label) {
  await win
    .waitForFunction(
      () => !document.querySelector('.mantine-Modal-inner, .mantine-Modal-overlay'),
      undefined,
      { timeout: 5000 },
    )
    .catch(() => {
      throw new Error(`${label}：Mantine 弹层树 5 秒内没退干净，截图会带鬼影`)
    })
}

try {
  await win.evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload()
  const projectCard = win.locator('[data-project-card]', { hasText: 'F3 F16b 走查' }).first()
  await expectVisible(projectCard, 'F3/F16b 走查项目存在')
  await projectCard.dblclick()
  const creationNav = win.getByRole('button', { name: '创作', exact: true })
  await expectVisible(creationNav, '创作入口可见')
  await creationNav.click()

  const editor = win.locator('.ProseMirror').first()
  await expectVisible(editor, '创作编辑器可见')
  await editor.evaluate((el) => {
    const textNode = el.firstChild?.firstChild
    if (!textNode) throw new Error('文稿文本节点不存在')
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, Math.min(12, textNode.textContent?.length || 0))
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
  })
  const popover = win.locator('[role="toolbar"][aria-label="选中文本工具"]')
  await expectVisible(popover, '选中文字后浮条出现')
  const splitButton = popover.getByRole('button', { name: '拆成镜头', exact: true })
  const splitProof = await proveProbe(splitButton, '选中浮条上的「拆成镜头」探针可测到')
  await expectVisible(splitButton, '选中浮条上「拆成镜头」可见')
  await clickOrFail(splitButton, '选中浮条「拆成镜头」')
  await expectVisible(win.getByText(/正在拆镜头|拆镜头/, { exact: false }).first(), '点击选区入口后进入同一拆镜流程')
  await win.screenshot({ path: path.join(shotsDir, '01-f3-selection-light.png') })

  // ── F16b 第一腿：**旧卡的阳性对照** ──────────────────────────────────────────
  //
  // 这一腿存在的唯一理由：让「确认后不再弹第二张卡」这句话真的被测量到。
  //
  // 之前这条走查断言的是 [data-hosting-disclosure] 不见了——那是**新卡自己的披露块**，
  // 卡一关它必然消失，所以哪怕旧卡还在天天弹，这条也照样绿。真正要盯的是**旧卡的身份**：
  // 标题「KIE 视频上传 / 公共托管确认」+ confirmDialog 的表面（data-confirm-dialog-surface）。
  //
  // 而「旧卡没出现」要有意义，先得证明这个探针**测得到旧卡**。旧卡的代码已被删除（F16b），
  // 没法再让它真的弹一次，于是走 _assert.mjs 里 proveProbe 的第 ② 种用法：
  // 用同一棵组件树、同一个 E2E 桥、同一套选择器**造一张一模一样的卡**，证明探针在这一屏是活的。
  // 这排除的正是「选择器写错 / 弹层根本没挂载」这种让 expectAbsent 恒真的情形。
  const legacyCardSurface = win.locator('[data-confirm-dialog-surface="confirm"]')
  const legacyCardTitle = win.getByText('KIE 视频上传 / 公共托管确认', { exact: true })
  await win.evaluate(() => {
    // 用真 confirmDialog 桥造一张与旧卡同构的卡（同组件树、同 data 属性、同标题文案）。
    window.__nomiLegacyProbeResult = undefined
    window.__nomiConfirmDialogE2E({
      title: 'KIE 视频上传 / 公共托管确认',
      message: '探针：证明本走查测得到这张卡的存在。',
      confirmLabel: '继续上传',
      cancelLabel: '取消生成',
    }).then((value) => { window.__nomiLegacyProbeResult = value })
  })
  const legacySurfaceProof = await proveProbe(legacyCardSurface, '旧托管卡的表面选择器在本屏测得到（阳性对照）')
  const legacyTitleProof = await proveProbe(legacyCardTitle, '旧托管卡的标题文案在本屏测得到（阳性对照）')
  // 收掉探针卡，回到干净现场——否则后面「没有旧卡」是在一张开着旧卡的屏上断言，必红且没意义。
  await clickOrFail(win.locator('[data-confirm-dialog-cancel="true"]'), '关掉阳性对照探针卡')
  await expectAbsent(legacyCardSurface, { provenBy: legacySurfaceProof, message: '探针卡应已关闭，现场需干净' })
  // 再等探针卡的 Mantine 弹层**整棵树离开 DOM**，然后才允许开下一张卡。
  //
  // 为什么不能只等 [data-confirm-dialog-surface] 消失（2026-08-26 第三次修才找对根因）：
  // ConfirmDialogHost 是**一个常驻的 Modal**，靠 opened={Boolean(active)} 开合，不是每张卡
  // 新建一棵树。active 一变 null，surface 的 data 属性立刻没了（断言当场就绿），但 Mantine 的
  // 退场过渡还在跑，此时卡里两个按钮**回落到默认文案**——恰好就是「取消 / 确认」，右上角还有个 ×。
  // 于是浅色证据里透出一层半透明鬼影，压在披露正文上。运行时探针实测到的元凶：
  //   div.mantine-Modal-inner  z-index 9300  opacity 1  textContent "取消确认"
  //   div.mantine-Modal-overlay opacity 0.354547（正淡出到一半）
  // 注意 inner 自己 opacity 是 1、且类名里**没有** fixed/inset-0——所以上一版「屏上不再有
  // 非本卡的 div.fixed.inset-0」那个门根本没盯住它，等于没等（假绿）。
  // 判据改成确定性的「节点不在 DOM 里」：不是淡到看不见，是真的没了。
  await waitForConfirmHostUnmounted('阳性对照探针卡')

  // ── F16b 第二腿：**真实漏斗**（不再手写字符串） ─────────────────────────────
  //
  // 之前这一腿用 __nomiSpendConfirmE2E 塞手写的 title/message/hostingDisclosure，
  // 等于把策略解析、KIE 探测、resolveHostingDisclosure、i18n 键全绕过去了——那几处任何一个
  // 回归，这条走查都还是绿的。现在改成驱动**生产自己的**确认漏斗：
  // 把托管策略设成 ask、放一个本地素材参考，让 confirmAndRunNode 自己去解析、自己决定弹什么。
  // 托管策略 = ask（默认值，显式写死以免本机设置漂移让这条恒不弹），并确认 KIE 没配 key
  // ——两者任一不成立，生产就**正确地**不弹披露，这一腿会变成在验一个不会发生的场景。
  await win.evaluate(async () => {
    const policy = window.nomiDesktop?.settings?.automationPolicy
    if (!policy) throw new Error('nomiDesktop.settings.automationPolicy 不可用：走查拿不到真策略')
    const current = await policy.get()
    await policy.set({ ...current, anonymousAssetHosting: 'ask' })
  })
  // 真漏斗：往画布放一个带**本地素材**参考的付费节点，再调生产入口 confirmAndRunPlan 本尊。
  // 这一路的托管策略解析、KIE 探测、披露文案的 i18n 键、花钱卡组装，全是生产自己的代码；
  // 走查一个字符串都不手写，所以其中任何一处回归都会在这里报红。
  await win.evaluate(() => {
    const store = window.__nomiCanvasStore
    if (!store) throw new Error('__nomiCanvasStore 未挂载：走查拿不到真画布 store')
    store.getState().addNode({
      kind: 'video',
      title: 'F16b 托管节点',
      prompt: '雨夜码头',
      references: ['nomi-local://asset/f3-f16b-project/clip.mp4'],
      meta: {
        modelVendor: 'kie',
        modelKey: 'kie/veo',
        referenceVideoUrls: ['nomi-local://asset/f3-f16b-project/clip.mp4'],
      },
    })
  })
  const hostingNodeId = await win.evaluate(() => {
    const nodes = window.__nomiCanvasStore.getState().nodes
    return nodes[nodes.length - 1]?.id
  })
  if (!hostingNodeId) throw new Error('托管测试节点没建出来')
  await win.evaluate((nodeId) => {
    const plan = window.__nomiBuildDependencyWaves([nodeId], window.__nomiCanvasStore.getState())
    // 不 await：确认卡要先渲染出来给我们看，resolve 发生在点「生成」之后。
    window.__nomiF16bRun = window.__nomiConfirmAndRunPlan(plan)
      .catch((error) => { window.__nomiF16bError = String(error?.message || error) })
  }, hostingNodeId)

  const hostingBlock = win.locator('[data-hosting-disclosure="true"]')
  const spendCard = win.locator('div.fixed.inset-0').filter({ has: hostingBlock }).first()
  const cardProof = await proveProbe(hostingBlock, '真实漏斗下合并确认卡与披露块确实出现')
  await expectVisible(hostingBlock, '花钱卡内含完整公共托管披露')
  // 披露文案取自 i18n（generationCommon.spendHostingDisclosure.*），不是走查手写的串——
  // 这样文案/键名回归会在这里报红，而不是被脚本里的副本掩盖。
  await expectVisible(win.getByText('记住我的选择，以后不再问', { exact: true }), '卡内含记住选择勾选')
  // 「记住我的选择」必须住在**披露块内部**（2026-08-26 用户拍板）：它管的是托管（永久改
  // anonymousAssetHosting），和管花钱的「本次会话不再提示」作用域不同。两者曾并排且同款样式，
  // 误勾一次 = 以后本机素材静默上传。断言「在披露块的子树里」，不是「在卡上某处」——
  // 后者在它被挪回并排时照样绿，等于没测。
  await expectVisible(hostingBlock.locator('[data-hosting-remember="true"]'), '「记住我的选择」住在托管披露块内部（作用域可见）')
  // 反向：披露块**外面**不许再有第二个同文案勾选（P1 加新必删旧——旧的那个并排勾选必须已删）。
  const rememberOutside = await win.evaluate(() => {
    const block = document.querySelector('[data-hosting-disclosure="true"]')
    return [...document.querySelectorAll('label')].filter(
      (el) => el.textContent?.trim() === '记住我的选择，以后不再问' && !block?.contains(el),
    ).length
  })
  if (rememberOutside !== 0) {
    throw new Error(`披露块外还有 ${rememberOutside} 个「记住我的选择」勾选——旧的并排勾选没删干净`)
  }
  // 截图前再把关一次：这一屏除了本卡，不许有**任何**其它浮层在画。
  //
  // 真正的鬼影源已经在上面「开卡之前」按构造消掉了（探针卡的 Mantine 树等到彻底 unmount 才继续，
  // 两张卡在时间上不再重叠）。这里留一道独立的收口，盯的是**渲染出来的东西**而不是某个选择器：
  // 遍历全屏 fixed/absolute 元素，凡是不属于本卡、又还看得见（opacity>0.01 且 visibility 可见
  // 且有面积）的，一律判为鬼影并报红——不管它叫 mantine-Modal-inner 还是别的什么。
  // 上一版只数 div.fixed.inset-0，而元凶 .mantine-Modal-inner 既不是 inset-0、自身 opacity 还是 1，
  // 于是那道门恒绿（假绿）。判据要跟着「所见」走，别跟着「某个类名」走。
  const strayOverlays = await win.evaluate(() => {
    const block = document.querySelector('[data-hosting-disclosure="true"]')
    const card = block?.closest('div.fixed.inset-0')
    const ghosts = []
    for (const el of document.querySelectorAll('body *')) {
      if (card && (card.contains(el) || el.contains(card))) continue
      const style = getComputedStyle(el)
      if (style.position !== 'fixed' && style.position !== 'absolute') continue
      if (style.visibility === 'hidden' || Number(style.opacity) <= 0.01) continue
      const rect = el.getBoundingClientRect()
      if (rect.width < 40 || rect.height < 20) continue
      const text = (el.textContent || '').trim()
      if (!text) continue
      ghosts.push(`${el.tagName}.${String(el.className).slice(0, 60)} opacity=${style.opacity} text="${text.slice(0, 30)}"`)
    }
    return ghosts
  })
  if (strayOverlays.length > 0) {
    throw new Error(`浅色截图前仍有非本卡的可见浮层（鬼影）：\n${strayOverlays.join('\n')}`)
  }
  await win.screenshot({ path: path.join(shotsDir, '02-f16b-hosting-light.png') })
  // 勾它：点披露块**内部**那个（上面刚断言过它就住在这儿），不靠全局文案匹配碰运气。
  await clickOrFail(hostingBlock.locator('[data-hosting-remember="true"] input[type="checkbox"]'), '披露块内「记住我的选择」勾选')

  // ── 同一张卡切换暗色截图（避免为视觉对账再开第二个 pending 请求）──────────────
  //
  // 这里踩过两个坑，都会让暗色截图变成**无效证据**（2026-08-26 修）：
  //
  // ① 只写了 data-mantine-color-scheme 一个属性。生产切主题走 applyNomiColorScheme
  //    （src/theme/colorScheme.ts:54）写**四个**：dataset.theme / dataset.nomiColorScheme /
  //    data-mantine-color-scheme / style.colorScheme。少写 = 截的不是用户会看到的那一屏
  //    （验证物必须等于用户所见物）。改成照抄那四行。
  // ② 没等过渡收敛就截图。token 是 --nomi-transition-fast=140ms 的 transition-colors，
  //    截到的是**插值中间帧**：正文已经变色、而取消/生成两个按钮的文字被洗成一片灰白方块，
  //    肉眼看像按钮没有标签。这正是本次要修的假证据。
  //
  // 不用裸 sleep，改等**确定性信号**：轮询「生成」按钮的实际计算色，连续两次采样一致即判定收敛。
  // ⚠️ 计算色会序列化成 oklch()/oklab()/rgb() 等多种形式，字面串比较不可靠（同一个颜色不同写法）——
  // 所以抽出数字通道比较，不比字符串。
  await win.evaluate(() => {
    const root = document.documentElement
    root.dataset.theme = 'dark'
    root.dataset.nomiColorScheme = 'dark'
    root.setAttribute('data-mantine-color-scheme', 'dark')
    root.style.colorScheme = 'dark'
  })
  const settleReport = await win.evaluate(async () => {
    const channels = (value) => (value.match(/-?\d*\.?\d+/g) || []).map(Number)
    const same = (a, b) => a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < 0.001)
    // 必须从**这张卡内部**取按钮：全局 querySelectorAll('button') 会先撞上背景里同名的「生成」
    // （画布/侧栏都有），量到的根本不是卡上那个主按钮 —— 那正是「量错对象」式假红/假绿。
    const read = () => {
      const block = document.querySelector('[data-hosting-disclosure="true"]')
      const card = block?.closest('div.fixed.inset-0')
      if (!card) return null
      const button = [...card.querySelectorAll('button')].find((el) => el.textContent?.trim() === '生成')
      if (!button) return null
      const style = getComputedStyle(button)
      return channels(`${style.backgroundColor} ${style.color}`)
    }
    let previous = read()
    if (!previous) return { settled: false, reason: '找不到「生成」按钮，无法判定主题过渡是否收敛' }
    // 140ms 过渡；每 50ms 采一次，连续两次一致即收敛。上限 2s 兜底防死等。
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50)))
      const current = read()
      if (!current) return { settled: false, reason: '轮询期间「生成」按钮消失' }
      if (same(previous, current)) return { settled: true, samples: i + 1, color: current }
      previous = current
    }
    return { settled: false, reason: '2 秒内主题过渡仍未收敛' }
  })
  if (!settleReport.settled) throw new Error(`暗色截图前主题过渡未收敛：${settleReport.reason}`)
  // 收敛后再断言按钮**真的换到了暗色**（不是浅色残留、也不是被洗白的中间帧）。
  const darkButtonColor = await win.evaluate(() => {
    const block = document.querySelector('[data-hosting-disclosure="true"]')
    const card = block?.closest('div.fixed.inset-0')
    const button = [...(card?.querySelectorAll('button') || [])].find((el) => el.textContent?.trim() === '生成')
    if (!button) throw new Error('卡内找不到「生成」按钮')
    const style = getComputedStyle(button)
    return { bg: style.backgroundColor, fg: style.color }
  })
  // 主按钮是 bg-nomi-ink text-nomi-paper：暗色下 paper 变暗，字色不该还是纯白，底色也不该透明。
  const whiteish = /^(?:oklch\(1 0 0\)|oklab\(1 0 0\)|rgb\(255, 255, 255\)|color\(srgb 1 1 1\))$/
  if (darkButtonColor.bg === 'rgba(0, 0, 0, 0)' || whiteish.test(darkButtonColor.bg)) {
    throw new Error(`暗色下「生成」按钮底色异常（${darkButtonColor.bg}）——疑似截到过渡中间帧或主题没生效`)
  }
  await win.screenshot({ path: path.join(shotsDir, '03-f16b-hosting-dark.png') })
  await expectVisible(hostingBlock, '暗模式下同一张合并卡仍可见')
  await expectVisible(win.getByText('记住我的选择，以后不再问', { exact: true }), '暗模式下披露块内的「记住选择」仍可见')
  await clickOrFail(spendCard.getByRole('button', { name: '生成', exact: true }), '合并确认卡「生成」')

  // ── 核心断言：确认之后，**旧卡**不该出现 ────────────────────────────────────
  //
  // 盯的是旧卡的身份（表面 + 标题），基线是上面那两个阳性对照。这才是 F16b 的真正判据：
  // 旧路径若还活着，这里就会冒出第二张「KIE 视频上传 / 公共托管确认」。
  //
  // ⚠️ 顺序很重要，这里踩过一次：`expectAbsent` 内部是 **toHaveCount(0) 的自动重试**断言——
  // 它会一直轮询直到计数变 0 就通过。而旧卡（若复活）是**异步渲染**的，点完「生成」立刻断言，
  // 会在卡挂上来之前就采到 0 → 恒绿。我用注入一张假旧卡的变异测试实测到了这个假绿：
  // 卡确实弹了出来，走查照样报通过。
  //
  // 所以必须**先把生成这一轮跑完**（confirmAndRunPlan 的 promise 落地 = 旧路径该弹的都弹过了），
  // 再断言「一张都没有」。这样断言才是在「坏东西有充分机会出现之后」做的。
  await win.evaluate(async () => {
    try { await window.__nomiF16bRun } catch { /* 生成本身失败无所谓——这条走查只关心弹了几张卡 */ }
  })
  // 再证一次探针此刻仍然是活的：如果这一屏的弹层宿主整个没挂载，下面的「没看到」同样是空话。
  // 造一张、看得见、收掉——然后才断言旧卡不在。
  await win.evaluate(() => {
    window.__nomiConfirmDialogE2E({
      title: 'KIE 视频上传 / 公共托管确认',
      message: '第二次探针：证明生成结束后这一屏仍测得到旧卡。',
      confirmLabel: '继续上传',
      cancelLabel: '取消生成',
    })
  })
  await expectVisible(legacyCardSurface, '生成结束后探针卡仍能弹出（证明此刻探针是活的）')
  await expectVisible(legacyCardTitle, '生成结束后仍能测到旧卡标题（证明文案探针是活的）')
  await clickOrFail(win.locator('[data-confirm-dialog-cancel="true"]'), '关掉第二次阳性对照探针卡')
  await expectAbsent(legacyCardSurface, { provenBy: legacySurfaceProof, message: '第二次探针卡应已关闭' })

  // 现在才是真判据。**故意不用 expectAbsent**：它是自动重试的 toHaveCount(0)，
  // 对「已经稳定存在的坏东西」会一直等到它消失才罢休，而对「稍后才冒出来的坏东西」则会
  // 抢在它出现前采到 0 —— 两头都能给出假绿（本轮变异测试实测到了后者）。
  // 这里要的是相反的语义：**连续观察一段时间，期间一次都不许出现**。
  const legacyAppearances = await win.evaluate(async () => {
    let seen = 0
    for (let i = 0; i < 30; i += 1) {
      if (document.querySelector('[data-confirm-dialog-surface="confirm"]')) seen += 1
      const titles = [...document.querySelectorAll('*')].some(
        (el) => el.children.length === 0 && el.textContent?.trim() === 'KIE 视频上传 / 公共托管确认',
      )
      if (titles) seen += 1
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return seen
  })
  if (legacyAppearances !== 0) {
    throw new Error(
      `确认之后又出现了独立的「KIE 视频上传 / 公共托管确认」卡（3 秒内命中 ${legacyAppearances} 次）——`
        + '旧路径没删干净，F16b 的第二张卡复活了。',
    )
  }
  // 读真策略确认「记住我的选择」落了盘。桥名必须写死 window.nomiDesktop（preload 暴露的那个）：
  // 写错名字 + 可选链 = 恒 undefined，看起来和「真没写进去」一模一样，会把人往错方向带。
  const remembered = await win.evaluate(async () => {
    const policy = window.nomiDesktop?.settings?.automationPolicy
    if (!policy) throw new Error('nomiDesktop.settings.automationPolicy 不可用')
    return (await policy.get())?.anonymousAssetHosting
  })
  if (remembered !== 'allow') {
    throw new Error(`记住选择后 anonymousAssetHosting 应为 allow，实际为 ${JSON.stringify(remembered)}`)
  }
  console.log('✅ F3/F16b 走查通过（选区拆镜入口、真漏斗单卡披露、旧卡确证不再出现、记住=allow、光/暗截图）')
} finally {
  await app.close().catch(() => {})
  fs.rmSync(root, { recursive: true, force: true })
}
