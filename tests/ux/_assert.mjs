// 走查断言层（2026-08-18）。和 _launchApp.mjs 的关系：那个管「窗口起得来」，这个管「断言骗不了人」。
//
// 为什么需要它（全量扫 143 个走查后的结论，见 docs/plan/2026-08-18-walkthrough-harness-hardening.md）：
//   · 0/143 使用 Playwright 的自动重试断言 —— 官方明确把 `expect(await x.isVisible()).toBe(true)`
//     标为反模式，因为它**立即取样**；
//   · 于是链条必然是：一次性 .count() 有竞态 → 拿 waitForTimeout 去糊（全仓 1136 处）
//     → sleep 不够长时 count 读到 0 → **而 0 恰好让「不存在」断言通过**。
//   所以「假绿」不是谁手滑，是这套写法的必然产物。
//
// 官方断言能治竞态那一半。治不了的另一半是：**在一个根本不可能出现坏东西的现场，
// 断言「没看到坏东西」**。这种空洞通过没有任何库能替你挡——只能由本文件的 API 在签名上逼出来，
// 这就是 expectAbsent 强制要 provenBy 的全部理由。
import { expect } from '@playwright/test'

/** 走查里所有等待的统一上限。比 Playwright 默认 5s 宽：Electron 冷启动 + 真模型都慢。 */
export const DEFAULT_TIMEOUT_MS = 15_000

export { expect }

export async function expectVisible(locator, message, timeout = DEFAULT_TIMEOUT_MS) {
  await expect(locator, message).toBeVisible({ timeout })
}

export async function expectHidden(locator, message, timeout = DEFAULT_TIMEOUT_MS) {
  await expect(locator, message).toBeHidden({ timeout })
}

export async function expectCount(locator, count, message, timeout = DEFAULT_TIMEOUT_MS) {
  await expect(locator, message).toHaveCount(count, { timeout })
}

export async function expectText(locator, pattern, message, timeout = DEFAULT_TIMEOUT_MS) {
  await expect(locator, message).toHaveText(pattern, { timeout })
}

/**
 * 点一个东西，点不到就**报红**。走查里所有点击都该走它。
 *
 * 为什么单独立一个 API：全仓的点击写法是
 *   `if (await el.count()) { await el.click().catch(() => {}) }`
 * 这行有两个吞：`count() > 0` 只证「DOM 里有」不证「点得着」（一次性取样，还有竞态），
 * 而 `.catch(() => {})` 把真实点击失败原地咽掉。于是**定位器过期 = 静默跳过这一步**，
 * 脚本照常往下走、照常截图、照常报绿——`dark-journey` 前三张截图字节完全相同就是这么来的
 * （两个候选定位器都是 0，「打开示例项目」整步没发生，而 stdout 只淡淡印了一行 false）。
 *
 * 这里用 toBeVisible 而不是 count>0：可见才点得着，且它是自动重试的，
 * 顺带把「元素还没渲染出来」和「元素根本不存在」区分开——前者等得到，后者等不到。
 */
export async function clickOrFail(locator, label, { timeout = DEFAULT_TIMEOUT_MS, ...clickOptions } = {}) {
  if (!label || typeof label !== 'string') {
    throw new Error('clickOrFail(locator, label)：label 必填，失败信息要说人话，别让人对着 selector 猜')
  }
  const target = locator.first()
  await expect(
    target,
    `点不到「${label}」：等满 ${timeout}ms 它都没可见。\n`
      + '要么这一屏根本没走到（上一步其实失败了），要么定位器已经过期——\n'
      + '两种都必须报红：静默跳过一步再继续截图，就是假绿。',
  ).toBeVisible({ timeout })
  await target.click({ timeout, ...clickOptions })
}

const PROOF = Symbol('nomi.walkthrough.probe-proof')

/**
 * 「这个检查确实测得到东西」的**运行时证明**。expectAbsent 只认它。
 *
 * 两种正当用法：
 *  ① 目标本身可证（首选）：先在**它会出现**的现场证明一次，再切到不该出现的现场断言它没了。
 *     例：通用模式下先证「拆镜头卡确实会浮」，再切素材规划模式断言它不浮。
 *  ② 目标已被彻底删除、无从证明（如验证某功能已下线）：那就证**探针本身在这一屏是活的**——
 *     用同屏必然存在的对照物。例：验「智能分组 tab 没了」，先证同一套文本探针找得到「全部素材」。
 *     这不是走过场：它排除的正是「面板压根没渲染出来 / 选择器写错了」这种让断言恒真的情形。
 *
 * 不接受「我觉得应该能测到」。必须真的跑一次、真的看见 ≥1 个。
 */
export async function proveProbe(locator, label, timeout = DEFAULT_TIMEOUT_MS) {
  if (!label || typeof label !== 'string') {
    throw new Error('proveProbe(locator, label)：label 必填，失败信息要说人话，别让人对着 selector 猜')
  }
  await expect(
    locator,
    `基线不成立：「${label}」应当能被探针找到，但一个都没找到。`
      + '\n如果连它都找不到，说明面板没渲染 / 选择器写错了，'
      + '那么后面任何「没看到坏东西」的断言都是恒真的空话。',
  ).not.toHaveCount(0, { timeout })
  return { [PROOF]: true, label }
}

/**
 * 「不存在」必须**持续成立多久**才算数。
 *
 * 为什么需要这个窗口（2026-08-25 事故，见 docs/plan/2026-08-26-walkthrough-framework-repair.md）：
 * Playwright 的 web-first 断言是**重试到条件成立为止**。而 `toHaveCount(0)` 的期望值就是 0，
 * 现场此刻恰好也是 0 —— 于是它**第一次取样就通过**，那个 15 秒的 timeout 一秒都没用上。
 * 它证的是「此刻没有」，不是「一直没有」。任何 200ms 后才挂载的东西都能大摇大摆走过去。
 *
 * 800ms 是怎么定的：足够盖住 React 提交 + 一帧动画 + Mantine 弹层挂载（实测鬼影出现在
 * 关卡后 ~350ms），又不至于让 51 个调用点每个都白等好几秒。
 */
const ABSENCE_HOLD_MS = 800
/** 窗口内的取样间隔。50ms → 800ms 窗口里取样 ~16 次，够密到抓得住一帧的闪现。 */
const ABSENCE_SAMPLE_MS = 50

/**
 * 断言某个东西**不存在**——而且是「持续不存在」，不是「此刻恰好没看见」。
 *
 * 必须带 provenBy（一个 proveProbe 拿到的证明）。两道门挡的是**两种不同的假绿**，
 * 缺一不可，而它们在日志里长得一模一样：
 *
 *   ① provenBy 挡「瞎探针」：在一个根本不可能出现坏东西的现场断言没有坏东西。
 *      全仓 33 处「不存在」断言里 94% 没有任何基线（2026-08-18 全量扫）。我两天内栽了两次：
 *        · 在**已有分镜方案**的项目里验「专职模式下不浮拆镜头卡」——那种状态下它本来就不显示；
 *        · 在**没有多家同款模型**的目录里验「下拉没有『N 家』折叠行」——本来就不可能有。
 *
 *   ② 保持窗口挡「取样太早」：探针没问题、现场也对，但**测量发生在被测物安顿下来之前**。
 *      这是 2026-08-25 那三起事故的同一个根因。原实现在这一条上是结构性失明的（见上）。
 *
 * 两段式，为的是**别让每个调用点都白等**：
 *   第一段 settle：仍用 Playwright 的重试断言等它降到 0。东西要是**真的、持续地**在那儿，
 *                  这一段会照常耗到 timeout 报红——快速失败的语义没变。
 *   第二段 hold：  降到 0 之后，再连续取样 ABSENCE_HOLD_MS，其间**冒出来一次就报红**。
 *                 常态下这只多花 800ms；而它换来的是「异步挂载的东西再也溜不过去」。
 */
export async function expectAbsent(locator, { provenBy, message } = {}, timeout = DEFAULT_TIMEOUT_MS) {
  if (!provenBy || provenBy[PROOF] !== true) {
    throw new Error(
      'expectAbsent 需要 provenBy：先用 proveProbe() 证明这个检查测得到东西。\n'
        + '没有基线的「没看到」= 空洞的通过——它和「探针根本没生效」在观测上完全一样。\n'
        + '  const proof = await proveProbe(card, "通用模式下拆镜头卡会浮")\n'
        + '  // …切到专职模式…\n'
        + '  await expectAbsent(card, { provenBy: proof, message: "专职模式下不该浮" })',
    )
  }
  const label = `${message || '期望它不存在'}（基线已证：${provenBy.label}）`

  // 第一段：等它降到 0。真的一直在，就在这儿耗到 timeout 报红。
  await expect(locator, label).toHaveCount(0, { timeout })

  // 第二段：0 之后还要**持续是 0**。这一段才是这次修复的全部意义所在。
  await holdAbsent(locator, label)
}

/**
 * 保持窗口本身。单独拆出来，是为了让契约测试能直接驱动它——
 * Playwright 的 `expect(locator)` 只认真的 Locator 对象，喂假对象会当场抛
 * 「toHaveCount can be only used with Locator object」，于是第一段在单测里根本走不通。
 * 而这次要钉死的行为**全部在第二段**，所以让第二段可独立测，比给假对象套一层
 * Locator 协议的壳更诚实（那层壳测的就成了壳自己）。
 *
 * 只有 expectAbsent 一个生产调用方——它不是给走查直接用的 API。
 */
export async function holdAbsent(locator, label, holdMs = ABSENCE_HOLD_MS) {
  const deadline = Date.now() + holdMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, ABSENCE_SAMPLE_MS))
    const count = await locator.count()
    if (count > 0) {
      throw new Error(
        `${label}\n`
          + `→ 它先是不在，随后在 ${holdMs}ms 的保持窗口内又冒出来了（count=${count}）。\n`
          + '  这正是旧版 expectAbsent 放过去的那一族：toHaveCount(0) 的期望值就是 0，\n'
          + '  第一次取样撞上「还没挂载」就当场判绿，timeout 一秒都没用上。\n'
          + '  别把窗口调小来让它变绿——报红的是被测物晚到了，不是这把尺子太严。',
      )
    }
  }
}

/**
 * 「助手这一轮说完了」的**唯一**判定源：停止键出现（起飞）→ 消失（落地）。
 *
 * 别再用「气泡文本连续几次不变」——pending 态气泡的文本恒为作者名「Nomi」，
 * 模型还没吐第一个字判据就满足了（2026-08-18 我本人栽的，拿 4 个字的作者名当产出做了 4 条断言）。
 * 也别用固定 sleep：真模型耗时从 2 秒到 2 分钟不等。
 */
export async function waitForTurnIdle(win, { startTimeout = 20_000, doneTimeout = 240_000 } = {}) {
  const stop = win.getByRole('button', { name: '停止生成' })
  await expect(stop, '这一轮没起飞：点了发送但停止键始终没出现').toBeVisible({ timeout: startTimeout })
  await expect(stop, '这一轮没落地：停止键迟迟不消失').toBeHidden({ timeout: doneTimeout })
}

/**
 * 只读某个容器内的文本。替代 `document.body.innerText` ——
 * 全页文本会把**脚本自己 seed 的数据**也算进去（我栽过：seed 的用户消息里写着「拆成镜头」，
 * 于是「页面上有没有『拆成镜头』」这条检查必然命中，误报成产品 bug）。
 */
export async function scopedText(locator) {
  return (await locator.innerText()).replace(/\s+/g, ' ').trim()
}

/**
 * 把源码剥成「只剩代码」再做结构扫描。
 *
 * 结构测试扫源码找违禁字符串时，不剥注释会**反噬文档**：全仓 33 个结构测试里 31 个没剥。
 * 我本轮就被自己写的、专门记录该 bug 的注释打红过——不变量管的是代码行为，不是文字。
 */
export function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

// ─────────────────────────────────────────────────────────────────────────────
// EN-DOM 断言网（2026-09-01）
//
// 抓的是 check:i18n-key-parity 抓不到的那一半漏译:parity 证的是「en 词典每个键都有值」,
// 但证不了「这个键真的被用上了」——组件里一句硬编码中文、或走了错分支拿到中文串,parity 照样绿,
// 只有真把界面切到 en、真走到那条 UI,才看得见一句中文。
//
// 于是在 en 局部走查跑完、界面确实是英文之后,直接断言**整页可见文本里没有 CJK**。
// 这是运行时的兜底网:任何漏译的中文只要出现在 en 界面上就当场报红,不管它从哪条缝里漏的。
//
// 白名单 [data-user-content]:用户自己写的内容(项目名、提示词、素材文件名…)本就该是用户的语言,
// 中文素材名出现在 en 界面上是对的,不是漏译。这类节点整棵子树豁免(innerText 会把子树文本并进来,
// 所以必须在遍历时**整棵跳过**,不能只跳这一个节点)。参 _assert.mjs:184 scopedText 那条教训:
// document.body.innerText 会把 seed 数据也算进来——这里用白名单把「用户内容」那一类系统性摘掉。
// ─────────────────────────────────────────────────────────────────────────────

/** CJK 统一表意文字(含扩展 A 起始)。够覆盖 UI 文案里的中文;不纠结日文假名(我们不支持日文)。 */
const CJK_RE = /[㐀-鿿]/

/**
 * 断言 en 界面上没有漏译的中文。**只在界面确实已切到 en 之后调**(否则必然满屏中文报红)。
 *
 * 判据是「用户所见的可见文本」:隐藏元素、[data-user-content] 子树都排除。命中就把那几段中文
 * 连同最近的可定位祖先一起报出来,让人一眼看到是哪块漏了。
 *
 * 为什么不直接 `document.body.innerText` 再 test CJK:innerText 会把 [data-user-content] 里的
 * 用户中文(项目名/提示词)并进来,恒假红;必须在 DOM 遍历时整棵跳过白名单子树。
 */
export async function expectNoCjkInEnglishDom(win, { message, allowSelectors = [] } = {}) {
  const offenders = await win.evaluate(
    ({ cjkSource, allow }) => {
      const cjk = new RegExp(cjkSource)
      const skipSelectors = ['[data-user-content]', 'style', 'script', 'noscript', ...allow]
      const isSkipped = (el) => skipSelectors.some((sel) => el.matches?.(sel))
      // 剪枝只认「必然连累整棵子树」的属性:display:none / opacity≈0 / visibility:hidden。
      // **元素自己盒子是 0 不算**——布局包装层(子元素绝对定位、overflow 可见、display:contents)
      // 经常自身 0 高而内容满屏。2026-09-02 实测:设置→模型 的供应商列表外面套着一个 1440x0 的
      // div,旧写法把它判成 hidden 直接 return,于是整份供应商列表(含肉眼可见的「火山方舟」)
      // 从网里被摘掉——截图上明晃晃是中文,断言却报「无残留中文」全绿。假绿比不测更坏。
      const isPrunedSubtree = (el) => {
        const style = getComputedStyle(el)
        return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.01
      }
      // 真正「这段字用户看不见」的判据,只对**承载中文的那个元素自己**用。
      const isInvisibleSelf = (el) => {
        const r = el.getBoundingClientRect()
        return r.width < 1 || r.height < 1
      }
      const describe = (el) => {
        const id = el.id ? `#${el.id}` : ''
        const testid = el.getAttribute?.('data-testid')
        const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(/\s+/).slice(0, 2).join('.')}` : ''
        return `${el.tagName.toLowerCase()}${id}${testid ? `[data-testid=${testid}]` : ''}${cls}`
      }
      const hits = []
      const walk = (el) => {
        if (isSkipped(el) || isPrunedSubtree(el)) return
        // 只看**直接**文本子节点的中文(子元素各自递归判,避免把整棵子树的文本重复归到父节点)。
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && cjk.test(node.nodeValue || '')) {
            const text = (node.nodeValue || '').replace(/\s+/g, ' ').trim()
            if (text && !isInvisibleSelf(el)) hits.push({ where: describe(el), text: text.slice(0, 60) })
          }
        }
        for (const child of el.children) walk(child)
      }
      if (document.body) walk(document.body)
      // 还要查 title/aria-label/placeholder 这类可见但不在文本节点里的字。
      for (const el of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
        if (isSkipped(el) || isPrunedSubtree(el) || isInvisibleSelf(el)) continue
        for (const attr of ['title', 'aria-label', 'placeholder']) {
          const v = el.getAttribute(attr)
          if (v && cjk.test(v)) hits.push({ where: `${describe(el)}@${attr}`, text: v.replace(/\s+/g, ' ').trim().slice(0, 60) })
        }
      }
      // 去重(同一段中文可能被多个祖先命中)。
      const seen = new Set()
      return hits.filter((h) => { const k = `${h.where}\0${h.text}`; if (seen.has(k)) return false; seen.add(k); return true })
    },
    { cjkSource: CJK_RE.source, allow: allowSelectors },
  )
  if (offenders.length > 0) {
    const lines = offenders.slice(0, 20).map((o) => `  · ${o.where}  “${o.text}”`).join('\n')
    throw new Error(
      `${message || 'en 界面上出现了未翻译的中文'}（EN-DOM 断言网）：找到 ${offenders.length} 处 CJK 文本。\n${lines}\n`
        + '  → 界面已切到 en,这些中文就是漏译(硬编码中文 / 走错分支拿到中文串 / 键缺 en 值)。\n'
        + '  用户自己写的内容(项目名/提示词/素材名)应包在 [data-user-content] 里豁免——如果上面是这类,给它加这个标记。',
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RAW-KEY 断言网（2026-09-01）—— 运行时抓「组件引用了不存在的键 → 界面渲染出原始 key」
//
// 这是今天那个 class bug 的**运行时兜底**:`t('sidebar.workflows')` 引用了两个词典都没有的键,
// i18next 找不到就把 key 字符串本身('sidebar.workflows')原样渲染出来。它长得像英文、一个中文没有,
// zh 界面里一眼看不出——EN-DOM 的 CJK 网也抓不到(它一个汉字都没有)。静态门岗 check:i18n-key-refs
// 从源码这头拦;这道从**运行时界面**这头兜:任何 raw-key 形态的可见文本 = 报红。两头夹。
//
// raw-key 形态:`^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$` —— 小写字母起头的点分标识符(≥1 个点)。
// 单独一段文本节点就是这形状,才算(整句话里带个点的正常文案不会命中:必须整段 ≡ 这个正则)。
//
// 误报排除用**清单**不靠猜(任务要求):合法的技术文案里确有这形状——版本号(0.21.0)、
// 文件名(project.json)、代码/URL 示例、模型 id(gpt-4o.something)。这些多半住在
// [data-user-content](用户内容)或就是我们自己要展示的技术串;白名单选择器整棵子树豁免,
// 再加一个「已知合法 raw-key 文本」literal 清单兜掉剩下的。命中清单外的 = 真 raw key。
// ─────────────────────────────────────────────────────────────────────────────

/** raw-key 形态:小写起头的点分标识符,整段文本必须完全等于它。 */
const RAW_KEY_RE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/

/**
 * 已知合法、会以「点分标识符」形态出现在界面上的技术文案(不是漏解析的键)。
 * 用**字面清单**而非「猜哪些像键」——每加一条都得是真在界面上见过的合法串。
 * 目前为空:现存界面里没有已知的合法裸点分标识符文本节点(版本号带数字段、文件名多在 user-content)。
 * 将来若真有(如某处要显示 `foo.bar` 作为示例),把那个确切串加进来并注明它是什么。
 */
const ALLOWED_RAW_KEY_TEXTS = new Set([])

/**
 * 断言界面上没有 raw-key 形态的可见文本(未解析的 i18n 键被原样渲染)。
 * zh / en 两种语言都该调——这个洞与语言无关(键在两边都缺时,两种语言都渲染 raw key)。
 *
 * 只看**直接文本子节点**且**整段 ≡ raw-key 正则**;[data-user-content]/隐藏元素/白名单子树排除;
 * 命中 ALLOWED_RAW_KEY_TEXTS 的放过。同时扫 title/aria-label/placeholder。
 */
export async function expectNoRawI18nKeysInDom(win, { message, allowSelectors = [], allowTexts = [] } = {}) {
  const offenders = await win.evaluate(
    ({ rawKeySource, allow, allowedTexts }) => {
      const rawKey = new RegExp(rawKeySource)
      const allowedSet = new Set(allowedTexts)
      const skipSelectors = ['[data-user-content]', 'style', 'script', 'noscript', 'code', 'pre', ...allow]
      const isSkipped = (el) => skipSelectors.some((sel) => el.matches?.(sel))
      const isHidden = (el) => {
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.01) return true
        const r = el.getBoundingClientRect()
        return r.width < 1 || r.height < 1
      }
      const describe = (el) => {
        const id = el.id ? `#${el.id}` : ''
        const testid = el.getAttribute?.('data-testid')
        const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(/\s+/).slice(0, 2).join('.')}` : ''
        return `${el.tagName.toLowerCase()}${id}${testid ? `[data-testid=${testid}]` : ''}${cls}`
      }
      const looksRaw = (text) => {
        const t = (text || '').trim()
        return t.length > 0 && !allowedSet.has(t) && rawKey.test(t)
      }
      const hits = []
      const walk = (el) => {
        if (isSkipped(el) || isHidden(el)) return
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && looksRaw(node.nodeValue)) {
            hits.push({ where: describe(el), text: (node.nodeValue || '').trim().slice(0, 80) })
          }
        }
        for (const child of el.children) walk(child)
      }
      if (document.body) walk(document.body)
      for (const el of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
        if (isSkipped(el) || isHidden(el)) continue
        for (const attr of ['title', 'aria-label', 'placeholder']) {
          const v = el.getAttribute(attr)
          if (v && looksRaw(v)) hits.push({ where: `${describe(el)}@${attr}`, text: v.trim().slice(0, 80) })
        }
      }
      const seen = new Set()
      return hits.filter((h) => { const k = `${h.where} ${h.text}`; if (seen.has(k)) return false; seen.add(k); return true })
    },
    { rawKeySource: RAW_KEY_RE.source, allow: allowSelectors, allowedTexts: [...ALLOWED_RAW_KEY_TEXTS, ...allowTexts] },
  )
  if (offenders.length > 0) {
    const lines = offenders.slice(0, 20).map((o) => `  · ${o.where}  “${o.text}”`).join('\n')
    throw new Error(
      `${message || '界面上出现了未解析的 i18n 键(原始 key 被渲染)'}（RAW-KEY 断言网）：找到 ${offenders.length} 处。\n${lines}\n`
        + '  → 这些点分标识符是 t() 引用了不存在的键、i18next 兜底把 key 本身渲染出来的(今天 sidebar.workflows 那一类)。\n'
        + '  修法:把键补进它真正该住的命名空间(zh+en),或改用已存在的键。静态门岗 check:i18n-key-refs 应已从源码这头拦到——\n'
        + '  若这里报了它没报,可能是动态键(模板拼接);去看那个 t(`...${x}`) 的枚举来源缺了这一项。\n'
        + '  确属合法技术文案(极少见)才加进 ALLOWED_RAW_KEY_TEXTS,并注明它是什么。',
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 截图证据的安定门（2026-08-26）
//
// 三起事故同一个根因：**在被测物安顿之前就把证据拍下来了**。截图这一族有三个变种：
//   (a) 主题翻转——走查只写了 data-mantine-color-scheme 一个属性，而生产路径走的是
//       applyNomiColorScheme（src/theme/colorScheme.ts:54），它要写**四个**：
//       dataset.theme / dataset.nomiColorScheme / data-mantine-color-scheme / style.colorScheme。
//       只写一个 = 半翻的主题，再叠上 ~140ms 的 --nomi-transition-fast 过渡；
//   (b) 已关闭的弹窗还在画退场动画（Mantine 的常驻 Modal，见 src/design/confirmDialog.tsx:70）；
//   (c) toast 被拍在滑入动画中途，让视口边缘切掉一半。
//
// (c) 最能说明问题：**同一个走查、同一个 commit，一次拍出被裁的图，另一次拍出安定的图**。
// 也就是说证据本身是不确定的——而不确定的证据，人眼对账时会对着假象下结论。
//
// 判据必须盯**所见之物**，不盯某个类名：类名会变、会新增，而「还在动」这件事不会。
// ─────────────────────────────────────────────────────────────────────────────

/** 视觉安定的判据：连续这么多帧几何/动画都没变化，才算不动了。 */
const QUIESCENCE_STABLE_FRAMES = 3
/** 等安定的上限。超了就报红——拍一张还在动的图，比报红更糟。 */
const QUIESCENCE_TIMEOUT_MS = 5_000

/**
 * 等这一页**视觉上不动了**：没有在跑的 transition/animation，没有正在淡入淡出的浮层，
 * 布局几何连续多帧不变。
 *
 * 为什么不是 `waitForTimeout(500)`：固定 sleep 和「安定」没有因果关系——机器快的时候白等，
 * 机器忙的时候仍然不够（(c) 那个变种就是这么间歇复现的）。这里等的是**条件**，不是时长。
 */
export async function waitForVisualQuiescence(win, { timeout = QUIESCENCE_TIMEOUT_MS } = {}) {
  const started = Date.now()
  await win
    .waitForFunction(
      (stableFramesNeeded) => {
        const w = /** @type {any} */ (window)
        // 只数**会结束**的动画。无限循环的那些（loading 转圈、脉冲呼吸灯）永远不会停，
        // 把它们算进来 = 这一屏永远等不到安定，helper 就从「防假绿」变成「制造假红」。
        // 2026-08-26 实测栽过：canvas 节点的 .nomi-loading-mark 一直在转，
        // 于是每张截图都卡满 5 秒超时。判据要盯「这次动作引发的过渡」，不盯「屏上有没有东西在动」。
        const isTransient = (a) => {
          if (a.playState !== 'running') return false
          const iterations = /** @type {any} */ (a).effect?.getComputedTiming?.().iterations
          return iterations !== Infinity
        }
        // 永动元素（loading 转圈等）的子树要整个排除在指纹之外：转圈的 transform 每帧都在变，
        // 留在指纹里会让「连续 N 帧不变」这个判据永远不成立——和上面数动画是同一个坑。
        const perpetual = new Set()
        if (document.getAnimations) {
          for (const a of document.getAnimations()) {
            const iterations = /** @type {any} */ (a).effect?.getComputedTiming?.().iterations
            if (iterations !== Infinity) continue
            const target = /** @type {any} */ (a).effect?.target
            if (target) perpetual.add(target)
          }
        }
        const insidePerpetual = (el) => {
          for (const node of perpetual) {
            if (node === el || node.contains(el) || el.contains(node)) return true
          }
          return false
        }
        // 采一帧「这一屏此刻长什么样」的指纹：会结束的动画数 + 所有浮层的几何与透明度。
        const sample = () => {
          const running = document.getAnimations
            ? document.getAnimations().filter(isTransient).length
            : 0
          const parts = [`anim:${running}`]
          for (const el of document.querySelectorAll('body *')) {
            const style = getComputedStyle(el)
            if (style.position !== 'fixed' && style.position !== 'absolute') continue
            if (style.visibility === 'hidden' || style.display === 'none') continue
            const opacity = Number(style.opacity)
            if (opacity <= 0.01) continue
            const r = el.getBoundingClientRect()
            if (r.width < 1 || r.height < 1) continue
            if (insidePerpetual(el)) continue
            // 位置/尺寸/透明度都进指纹：滑入中的 toast 位置在变，淡出中的遮罩 opacity 在变。
            parts.push(`${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)},${opacity.toFixed(2)}`)
          }
          return parts.join('|')
        }
        const now = sample()
        // 有动画在跑就直接判「没安定」——不用等指纹，动画本身就是证据。
        if (now.startsWith('anim:') && !now.startsWith('anim:0')) {
          w.__nomiQuiescence = { fingerprint: now, stable: 0 }
          return false
        }
        const prev = w.__nomiQuiescence
        if (!prev || prev.fingerprint !== now) {
          w.__nomiQuiescence = { fingerprint: now, stable: 1 }
          return false
        }
        prev.stable += 1
        return prev.stable >= stableFramesNeeded
      },
      QUIESCENCE_STABLE_FRAMES,
      { timeout, polling: 'raf' },
    )
    .catch(async () => {
      // 超时要说清**是什么还在动**，否则下一个人只会把 timeout 调大。
      const stillMoving = await win
        .evaluate(() => {
          const running = document.getAnimations
            ? document.getAnimations().filter((a) => {
              if (a.playState !== 'running') return false
              // 无限循环的（转圈）已经被判据排除了，这里也别报——否则诊断信息会把人引偏。
              const iterations = /** @type {any} */ (a).effect?.getComputedTiming?.().iterations
              return iterations !== Infinity
            })
            : []
          return running.slice(0, 5).map((a) => {
            const target = /** @type {any} */ (a).effect?.target
            return target ? `${target.tagName}.${String(target.className).slice(0, 50)}` : '(未知元素)'
          })
        })
        .catch(() => [])
      throw new Error(
        `等了 ${Date.now() - started}ms 这一屏仍未视觉安定，拒绝截图。\n`
          + (stillMoving.length > 0
            ? `→ 仍在跑的（会结束的）动画：\n   ${stillMoving.join('\n   ')}\n`
            : '→ 没有未结束的动画，那就是**几何一直在变**：多半有浮层在反复重排。\n')
          + '  拍一张还在动的图，比报红更糟：证据不确定，人眼对账会对着假象下结论。\n'
          + '  别调大 timeout 了事——先弄清是谁一直在动（无限循环的转圈已排除，不会是它）。',
      )
    })
  // 清掉指纹缓存，免得下一次调用读到上一次的残留而误判「已经稳了」。
  await win.evaluate(() => { delete (/** @type {any} */ (window)).__nomiQuiescence }).catch(() => {})
}

/**
 * 截图前先等视觉安定。走查里**所有**证据截图都该走它，而不是 .screenshot 裸调。
 *
 * 两种接收者都收（和裸 .screenshot 的用法保持一致，迁移时不用改调用形状）：
 *   · Page（win）——整屏证据；
 *   · Locator（某个面板/弹窗）——裁到局部的证据，走查里是合法且常用的写法。
 * Locator 没有 waitForFunction，所以先从它身上取回所属的 Page 再等安定：
 * **安定是整页的属性**，只盯被裁的那一块会漏掉压在它上面的浮层（鬼影正是这么来的）。
 *
 * 失败路径的截图（catch 里那些 *-FAIL.png）**不要**用它：那时 app 可能已经卡住，
 * 等安定只会把真正的错误拖成一个超时，把现场盖掉。失败图要的是「当场什么样」。
 */
export async function screenshotSettled(target, options = {}) {
  const { quiescenceTimeout, ...shotOptions } = options
  // Page 自己就有 waitForFunction；Locator 没有，但能用 .page() 拿到所属页面。
  const page = typeof target.waitForFunction === 'function' ? target : target.page?.()
  if (!page) {
    throw new Error(
      'screenshotSettled(target)：target 既不是 Page 也不是 Locator，拿不到页面就等不了安定。\n'
        + '  传 win（整屏）或某个 locator（裁到局部）都行。',
    )
  }
  await waitForVisualQuiescence(page, { timeout: quiescenceTimeout ?? QUIESCENCE_TIMEOUT_MS })
  return target.screenshot(shotOptions)
}

/**
 * 按**生产路径**翻主题，然后等安定。
 *
 * 为什么必须有这个 helper：走查手写 `setAttribute('data-mantine-color-scheme', x)` 只翻了
 * 四个属性里的一个（生产路径见 src/theme/colorScheme.ts:54 applyNomiColorScheme）。
 * 剩下三个没翻 = 半翻的主题：一部分 token 走暗色、一部分还在浅色，拍出来的「暗色证据」
 * 根本不是用户会看到的那一屏（R13 的眼见链：验证物必须 = 用户所见物）。
 */
export async function applyColorSchemeForShot(win, scheme) {
  if (scheme !== 'light' && scheme !== 'dark') {
    throw new Error(`applyColorSchemeForShot(win, scheme)：scheme 只能是 'light' | 'dark'，收到 ${JSON.stringify(scheme)}`)
  }
  await win.evaluate((value) => {
    // 和 applyNomiColorScheme 一字不差地对齐——四个属性一个都不能少。
    const root = document.documentElement
    root.dataset.theme = value
    root.dataset.nomiColorScheme = value
    root.setAttribute('data-mantine-color-scheme', value)
    root.style.colorScheme = value
  }, scheme)
  // 翻完还有 ~140ms 的 --nomi-transition-fast 在跑，等它跑完再让调用方截图。
  await waitForVisualQuiescence(win)
}

/**
 * 读计算色并解析成数值通道。
 *
 * 别拿字面串比：现代浏览器把颜色序列化成 `oklch(...)` / `oklab(...)`，
 * 而且过渡中途的插值帧会给出一个既不等于起点也不等于终点的第三种串（2026-08 栽过两次）。
 * 要比就比解析后的数值，并且**先等安定**（上面那个 helper）再读。
 */
export async function readComputedColorChannels(locator, property = 'color') {
  const raw = await locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property)
  const channels = (raw.match(/-?\d*\.?\d+/g) ?? []).map(Number)
  return { raw, channels }
}
