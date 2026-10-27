// PR 正文判据库（2026-10-08）：设计卡格子 / 独立验收 / 逃逸账本转 fixed 须带 detected_by 合同 / 规则生效宽限 / 整体裁决。
// 推送前（scripts/check-pr-judgement.mjs，pre-push 钩子经 scripts/pre-push-contracts.mjs 调，CI Contracts 同一个入口）
// 与合并前扫描（scripts/merge-preflight.mjs）都调这一份——#1094 的形状：设计卡不是 ★ 格式、detected_by 写错，
// 推送时放行、合并时才红，是因为两边各有一套口径。判据只此一处，两边同标准。
// 路由 / 规则与门岗范围仍在 scripts/pr-judgement-lib.mjs（本模块在它之上叠设计卡等判据，并给一个总入口 evaluatePrBody）。
import { classCheckErrors, contractErrors, escapeIdOfPath, fixedTransitions } from './escape-ledger-lib.mjs'
import { checkPrBoardClaims, parsePrBoardClaims } from './check-board-parity.mjs'
import { approvalCommand, boardApprovalSubject, describeBoardDiff, describeSuppressionGrowth, suppressionApprovalSubject, SUPPRESSIONS_FILE } from './lib/coordApprovals.mjs'
import { pinScenarioPolicy } from './perf-scenarios-lib.mjs'
import { localEvidenceInputs } from './lib/prEvidenceInputs.mjs'
import { deriveUiVerification, evaluatePrJudgement, evaluateProcessTier, evidenceJudgementEnforced, evidenceLineVerdict, extractSection, inferRoutes, loadRoutingTable, PROCESS_TIERS, processTieringEnforced } from './pr-judgement-lib.mjs'

/** 四类（花钱 / 长跑 / 可打断 / 新界面）——路由表里 pathRules.legacy 的那部分；files: [{ path, status }]，status 'A' = 新增。 */
export function classifyChange(files, addedLines = '', table = undefined) {
  const { fourClass, classes, hits } = inferRoutes(files, addedLines, table)
  return { fourClass, classes, hits }
}

export const STAR_CELLS = [1, 2, 3, 4, 9]
export const ALL_CELLS = [1, 2, 3, 4, 5, 6, 7, 8, 9]


const PLACEHOLDER = /^(?:待填|待定|tbd|todo|\.{2,}|…+|-+|n\/a)$/i

/** 在设计卡正文里找格 n（★n / n 开头的行或表格行），返回该格的内容（去掉标签）；找不到返回 null。 */
export function cellContent(section, n) {
  const pattern = new RegExp(`^\\s*(?:[-*]\\s*|\\|\\s*)?(?:★\\s*)?${n}(?![0-9])[\\s.:：、|]*(.*)$`)
  for (const line of String(section || '').split(/\r?\n/)) {
    const match = pattern.exec(line)
    if (!match) continue
    // 表格行：把行内的格分隔去掉，最后一列之前的标题也算内容的一部分——只要标签之后有实质字符就算填了
    const rest = match[1].replace(/\|/g, ' ').replace(/\s+/g, ' ').trim()
    return rest
  }
  return null
}

/** 一格是否「填了」：标签之后除了问题标题还有实质内容，或明写「不适用：理由」。 */
export function cellFilled(content) {
  if (content === null) return false
  if (PLACEHOLDER.test(content)) return false
  const na = /不适用\s*[:：]\s*(\S.*)/.exec(content)
  if (na) return na[1].trim().length >= 2
  // 只有标签（如「用户怎么用」「谁说了算」）没有后文，不算填
  return content.replace(/^\S{1,8}\s*/, '').trim().length >= 6 || content.length >= 14
}

/** 判据只认中文标题；英文写法（`## Design card`）当「没写」，但点明原因，别让人对着已经写了的一节找半天。 */
const ENGLISH_HEADINGS = {
  设计卡: /^#{2,3}\s+design[\s-]*card\s*$/im,
  独立验收: /^#{2,3}\s+independent[\s-]*(?:acceptance|verification|review)\s*$/im,
}
export const englishHeadingHint = (body, heading) =>
  (ENGLISH_HEADINGS[heading]?.test(String(body || '')) ? `（正文里是英文标题，判据只认中文标题 \`## ${heading}\`，请改成中文）` : '')

export function checkDesignCard(body, options = {}) {
  const tier = options.tier ?? PROCESS_TIERS.STRICT
  const requiresAll = options.fourClass ?? tier === PROCESS_TIERS.STRICT
  const short = tier === PROCESS_TIERS.SHORT
  const section = extractSection(body, short ? '短版设计卡' : '设计卡') ?? (short ? extractSection(body, '设计卡') : null)
  const required = requiresAll ? ALL_CELLS : STAR_CELLS
  const heading = short ? '短版设计卡' : '设计卡'
  if (section === null) return { ok: false, lines: [`✖ PR 正文没有 \`## ${heading}\` 一节（${requiresAll ? '严档 9 格' : '★ 格 1、2、3、4、9'}）${englishHeadingHint(body, heading)}`] }
  const link = /https?:\/\/\S+|docs\/\S+\.md/.exec(section)
  const missing = required.filter((n) => !cellFilled(cellContent(section, n)))
  if (missing.length === 0) return { ok: true, lines: [`✅ ${short ? '短版设计卡' : '设计卡'}：${required.length} 格都填了`] }
  if (link && missing.length === required.length) {
    return { ok: true, lines: [`⚠ 设计卡只放了链接（${link[0]}），格子内容要人工到链接里核对（${required.join('、')}）`] }
  }
  return { ok: false, lines: [`✖ ${short ? '短版设计卡' : '设计卡'}缺格：${missing.join('、')}（要求：${requiresAll ? '严档 9 格' : '★ 格 1、2、3、4、9'}；确实不适用写「不适用：理由」）`] }
}

export function checkStandardReview(body, { tier } = {}) {
  if (tier !== PROCESS_TIERS.STANDARD) return { ok: true, lines: [] }
  const section = extractSection(body, '单线评审')
  // 在途正文仍可能只写旧严档的「独立验收」；宽档必须单调兼容，沿用其中的报告和验收线作为单线评审。
  if (section === null) {
    const legacyAcceptance = extractSection(body, '独立验收')
    if (legacyAcceptance && /(?:报告|验收线|https?:\/\/|docs\/)/.test(legacyAcceptance)) return { ok: true, lines: ['✅ 单线评审：复用旧正文 `## 独立验收`（宽档兼容）'] }
    return { ok: false, lines: ['✖ 标准档缺 `## 单线评审`（评审线编号 + 结论 / 证据）'] }
  }
  const line = /评审线\s*[:：]\s*([^\n]+)/.exec(section)?.[1]?.trim()
  if (!line) return { ok: false, lines: ['✖ 标准档 `## 单线评审` 缺评审线编号'] }
  if (!/(?:通过|有条件通过|报告|docs\/|https?:\/\/)/.test(section)) return { ok: false, lines: ['✖ 标准档单线评审没有结论或证据'] }
  const evidence = extractSection(body, '验收证据')
  const evidenceLines = (evidence ?? '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  if (!evidenceLines.length || !evidenceLines.some((item) => evidenceLineVerdict(item).ok)) return { ok: false, lines: ['✖ 标准档缺 `## 验收证据` 的有效证据行'] }
  return { ok: true, lines: [`✅ 单线评审：${line}`, '✅ 标准档验收证据：至少一条有效证据'] }
}

/** 实现线编号：设计卡里的「线/负责人：X」或正文里的「实现线：X」。 */
export function implementationLine(body) {
  const match = /(?:实现线|线\/负责人)\s*[:：]\s*([^，,；;|\r\n]+)/.exec(String(body || ''))
  return match ? match[1].trim() : null
}

/**
 * 判据跑在哪一步：'push'（推送前钩子）或 'merge'（CI 的 check:pr-judgement、合并前扫描）。
 * 独立验收的报告要等分支推上去、验收线跑完才有，推送时只能写「待出」——推送前只提醒，CI / 合并前照旧要链接。
 * CI 里一律按 'merge'：继承来的环境变量不能在那里放宽判据。
 */
export function resolveJudgementStage(env = process.env) {
  if (env.CI) return 'merge'
  return env.NOMI_PR_JUDGEMENT_STAGE === 'push' ? 'push' : 'merge'
}

/**
 * 独立验收的结论怎么分（看报告第一行）：不通过 → fail；有条件通过 / 通过 → conditional / pass；认不出 → unknown。
 * 通过类的结论里写着仍有未解除的阻断（「仍有阻断」「阻断：B1 …」）算 blocked——写「通过」也不能放行。
 */
const OPEN_BLOCKER = /(?:仍有|尚有|还有|存在|未解除的?|未关闭的?)\s*阻断|阻断\s*[:：]\s*(?!无|0|没有)\S/
export function classifyAcceptanceVerdict(text) {
  const t = String(text || '')
  if (/不通过|未通过|不予通过/.test(t)) return { verdict: 'fail', blocked: true }
  const verdict = /有条件通过/.test(t) ? 'conditional' : /通过/.test(t) ? 'pass' : 'unknown'
  return { verdict, blocked: verdict !== 'unknown' && OPEN_BLOCKER.test(t) }
}

const ACCEPTANCE_LINK = /https?:\/\/\S+|docs\/\S+\.md|[A-Za-z]:[\\/][^\s|，,；;）)]*\.md|(?:^|\s)\/[^\s|，,；;）)]*\.md/
const stripMark = (text) => String(text).replace(/^[\s#>*`「」-]+|[\s*`「」]+$/g, '').trim()
const squash = (text) => String(text).replace(/[\s*#`「」>-]/g, '')
export const shaMatches = (a, b) => {
  const x = String(a || '').toLowerCase()
  const y = String(b || '').toLowerCase()
  return x.length >= 7 && y.length >= 7 && (x.startsWith(y) || y.startsWith(x))
}
const reportHead = (text) => (/验收\s*HEAD[^0-9a-fA-F\n]{0,12}([0-9a-f]{7,40})/i.exec(text) ?? /(?:验收头|HEAD)[^0-9a-fA-F\n]{0,12}([0-9a-f]{7,40})/i.exec(text))?.[1] ?? null
/** 验收线编号规范化后精确比较：去掉括注 / 「·」后缀，不分大小写——不用子串（V-x 不能冒充 V-x-unrelated，S3）。 */
const lineKey = (text) => String(text ?? '').replace(/[（(·].*$/, '').trim().toLowerCase()
const reportVerifier = (text) => /验收线\s*[:：]\s*([^（(，,；;|\r\n]+)/.exec(text)?.[1]?.trim() ?? null

/**
 * 独立验收。旧判据只看「贴了链接 + 验收线 ≠ 实现线」——#1264 的报告结论是「不通过」时也能全绿。
 * strict（2026-10-22 起开的 PR，evidenceJudgementEnforced）再核报告说了什么：
 *   · 正文贴「报告首行：<报告第一行原文>」——结论必须是通过 / 有条件通过，不通过、认不出、仍有阻断都不行；
 *   · 正文写「验收 HEAD：<提交号>」——必须等于 PR 当前 head（headSha）；head 变了就要重验；
 *   · 读得到报告本体（readReport(引用) → 文本；null = 读不到 → 红；undefined = 这个环境不读本机报告 → 只核正文并提示本机核）时，
 *     报告第一行要和正文贴的一致、结论过关、报告里的验收 HEAD 等于 PR head、报告里的验收线和正文一致且不等于实现线。
 * CI 读不到协调目录的报告，所以 CI 只能核正文贴的这些；合并前扫描在协调会话本机读报告本体（scripts/merge-preflight.mjs）。
 * 推送档（报告推送后才有）这些新增项只提醒。
 */
export function checkIndependentAcceptance(body, { stage = 'merge', strict = false, headSha = null, readReport = undefined, headRelation = undefined } = {}) {
  const section = extractSection(body, '独立验收')
  if (section === null) return { ok: false, lines: [`✖ 四类改动缺 \`## 独立验收\` 一节（报告链接 + 验收线编号${strict ? ' + 报告首行 + 验收 HEAD' : ''}）${englishHeadingHint(body, '独立验收')}`] }
  const lines = []
  let ok = true
  const report = ACCEPTANCE_LINK.exec(section)?.[0]?.trim() ?? null
  if (!report) {
    if (stage === 'push') lines.push('⚠ 独立验收还没有报告链接：推送时允许（报告要推送后才有），CI 的 check:pr-judgement 与合并前扫描会一直红到补上链接')
    else {
      ok = false
      lines.push('✖ 独立验收没有带报告链接')
    }
  }
  const verifier = /验收线\s*(?:编号)?\s*[:：]\s*([^，,；;|\r\n]+)/.exec(section)
  const implementer = implementationLine(body)
  const verifierId = verifier ? verifier[1].trim() : null
  if (!verifier) {
    ok = false
    lines.push('✖ 独立验收没写验收线编号（格式：验收线：<编号>）')
  } else if (!implementer) lines.push(`⚠ 验收线 ${verifierId}：正文里没找到实现线编号（设计卡「线/负责人」或「实现线：」），无法核对是否同一条，请人工核`)
  else if (lineKey(implementer) === lineKey(verifierId)) {
    ok = false
    lines.push(`✖ 验收线编号 ${verifierId} 和实现线相同——验收必须另一条线做`)
  } else lines.push(`✅ 验收线 ${verifierId} ≠ 实现线 ${implementer}`)
  if (strict) {
    // 新增项：推送档只提醒，合并档判红
    const flag = (message) => {
      if (stage === 'push') lines.push(`⚠ ${message}（推送时只提醒，CI / 合并前扫描要求）`)
      else { ok = false; lines.push(`✖ ${message}`) }
    }
    const first = /(?:报告首行|报告第一行|结论原文)\s*[:：]\s*(.+)/.exec(section)?.[1]
    const quoted = first ? stripMark(first) : null
    const claimedHead = /验收\s*HEAD\s*[:：]\s*`?([0-9a-fA-F]{7,40})/.exec(section)?.[1] ?? null
    if (!quoted) flag('独立验收没贴报告第一行的结论原文（格式：报告首行：<原文>）——只贴链接不算实证')
    else {
      const verdict = classifyAcceptanceVerdict(quoted)
      if (verdict.verdict === 'fail') flag(`独立验收的报告结论是不通过（${quoted.slice(0, 60)}）：不通过不能合`)
      else if (verdict.verdict === 'unknown') flag(`认不出独立验收的结论（${quoted.slice(0, 60)}）：报告第一行要写 通过 / 有条件通过 / 不通过`)
      else if (verdict.blocked) flag(`独立验收的结论里仍有未解除的阻断（${quoted.slice(0, 60)}）：阻断解除、报告更新后再合`)
      else lines.push(`✅ 报告结论：${verdict.verdict === 'pass' ? '通过' : '有条件通过'}`)
    }
    // 验收的版本 vs PR 当前 head：相等；或祖先 + 之后只有干净合 main / docs/evidence 提交（headRelation，见 scripts/lib/prEvidenceInputs.mjs）
    const versionLine = (label, sha) => {
      if (shaMatches(sha, headSha)) return lines.push(`✅ ${label} ${sha.slice(0, 12)} = PR 当前 head`)
      const relation = typeof headRelation === 'function' ? headRelation(sha, headSha) : undefined
      if (relation?.ok) return lines.push(`✅ ${label} ${sha.slice(0, 12)}：${relation.note}`)
      if (relation && relation.ok === false) return flag(`${label} ${sha.slice(0, 12)} 和 PR 当前 head ${String(headSha).slice(0, 12)} 对不上：${relation.reason}`)
      return lines.push(`⚠ ${label} ${sha.slice(0, 12)} 不等于 PR 当前 head ${String(headSha).slice(0, 12)}，这个环境算不了历史（${relation?.reason ?? '没有历史'}）：只核了正文，是否只多了干净合 main / docs/evidence 提交由合并前扫描在本机核`)
    }
    if (!claimedHead) flag('独立验收没写「验收 HEAD：<提交号>」——要说清验收的是哪个版本')
    else if (!headSha) flag('拿不到 PR 当前 head，核不了验收的是不是这一版（不拿算不出来当通过）')
    else versionLine('验收 HEAD', claimedHead)
    if (report) {
      const text = typeof readReport === 'function' ? readReport(report) : undefined
      if (text === null) flag(`独立验收的报告读不到（${report}）：读不到不能当通过——报告放仓库里，或让合并前扫描在本机读得到`)
      else if (text === undefined) lines.push(`⚠ 报告 ${report} 在这个环境读不到：只核了正文贴的首行 / HEAD / 验收线，报告本体由合并前扫描在本机核`)
      else {
        const reportFirst = stripMark(text.split(/\r?\n/).find((row) => row.trim()) ?? '')
        if (quoted && squash(reportFirst) !== squash(quoted)) flag(`正文贴的报告首行和报告本体第一行对不上（报告写的是「${reportFirst.slice(0, 60)}」）`)
        const real = classifyAcceptanceVerdict(reportFirst)
        if (real.verdict === 'fail') flag(`报告本体写的结论是不通过（${reportFirst.slice(0, 60)}）`)
        else if (real.verdict === 'unknown') flag(`报告本体第一行认不出结论（${reportFirst.slice(0, 60)}）`)
        else if (real.blocked) flag(`报告本体的结论里仍有未解除的阻断（${reportFirst.slice(0, 60)}）`)
        const inReport = reportHead(text)
        if (!inReport) flag('报告里没写验收 HEAD：要写清验收的是哪个版本')
        else if (headSha) versionLine('报告里的验收 HEAD', inReport)
        const reportLine = reportVerifier(text)
        if (!reportLine) flag('报告里没写「验收线：<编号>」')
        else if (verifierId && lineKey(reportLine) !== lineKey(verifierId)) flag(`报告里的验收线 ${reportLine} 和正文写的 ${verifierId} 不同`)
        else if (implementer && lineKey(reportLine) === lineKey(implementer)) flag(`报告里的验收线 ${reportLine} 和实现线相同`)
      }
    }
  }
  if (ok && lines.every((line) => !line.startsWith('✖'))) lines.unshift(strict ? '✅ 独立验收：带报告链接、结论、验收 HEAD 和验收线编号' : '✅ 独立验收：带报告链接和验收线编号')
  return { ok, lines }
}

/**
 * 拍板清单的批准范围：默认全拦（2026-10-22 用户拍板方案 A，V-gates R2-B1 / R2-B2）。
 * 板文件按 base 与 head 的整份规范化内容对比（先剥掉元素的 status / assertion / owner），任何差异——新增板、整张删板、新增 / 删除 / 改了合同的元素、
 * 板级字段（decor / functionCensus / 设计来源 / stage 等）——都要协调确认，哈希绑整份规范化后的 head 内容。
 * 要确认的集合由真实 diff 构造：不看正文认领了什么，也不看 PR 是不是界面改动、有没有写 `## 拍板图` 一节。
 * CI 读不到本机确认记录，只提示「待协调确认」；合并前扫描没有记录就红。boards / baseBoards = loadManifests() 形状（对象，或返回它的函数；null = 取不到）。
 */
export function checkBoardContracts({ strict = false, boards = null, baseBoards = null, approvals = null } = {}) {
  if (!strict) return { ok: true, lines: [] }
  const resolve = (value) => (typeof value === 'function' ? value() : value)
  const head = resolve(boards)
  const base = resolve(baseBoards)
  if (!head || !base) return { ok: true, lines: ['⚠ 拍板清单：取不到 PR head 或 base 上的清单，没法对比哪些板被改了（待协调确认，本机 merge-preflight 核）'] }
  const lines = []
  let ok = true
  const local = approvals?.mode === 'local'
  for (const name of [...new Set([...Object.keys(base), ...Object.keys(head)])].sort()) {
    const subject = boardApprovalSubject(name, base[name] ?? null, head[name] ?? null)
    if (!subject.needsApproval) continue
    if (approvals?.lookup?.('board', name, subject.fingerprint) === true) { lines.push(`✅ 拍板图 ${name}：${describeBoardDiff(subject)}——协调已确认（哈希对上）`); continue }
    const command = approvalCommand(approvals?.pr, 'board', name)
    if (local) {
      ok = false
      lines.push(`✖ 拍板图 ${name} ${describeBoardDiff(subject)}：清单的批准身份不能由 PR 自己给，没有协调确认记录${approvals?.unavailable ? `（${approvals.unavailable}）` : ''}。协调会话确认后跑 ${command}`)
    } else lines.push(`⚠ 拍板图 ${name} ${describeBoardDiff(subject)}：待协调确认（本机 merge-preflight 核；确认命令 ${command}）`)
  }
  return { ok, lines }
}

/**
 * ESLint 批量抑制的冻结数上涨（2026-10-22 协调定，同拍板图 / 性能政策）：冻结数只许减少，涨了要协调确认，哈希绑上涨那部分 diff。
 * 推送前（lint:changed）读本机确认记录直接判；这里给 CI 和合并前扫描：CI 读不到记录只提示「待协调确认」，合并前扫描没有记录就红。
 * suppressions / baseSuppressions = eslint-suppressions.json 的内容（对象，或返回它的函数；null = 取不到；文件不存在 = {}）；
 * 两个都没给（undefined）= 调用方不提供这项输入（只判别的证据的回放 / 夹具），不判。
 */
export function checkSuppressionContracts({ strict = false, suppressions = undefined, baseSuppressions = undefined, approvals = null } = {}) {
  if (!strict || (suppressions === undefined && baseSuppressions === undefined)) return { ok: true, lines: [] }
  const resolve = (value) => (typeof value === 'function' ? value() : value)
  const head = resolve(suppressions)
  const base = resolve(baseSuppressions)
  if (!head || !base) {
    // 合并前扫描在本机必须算得出：取不到不能当通过
    if (approvals?.mode === 'local') return { ok: false, lines: [`✖ ${SUPPRESSIONS_FILE}：取不到 PR head 或 base 上的内容，没法对比冻结数`] }
    return { ok: true, lines: [`⚠ ${SUPPRESSIONS_FILE}：取不到 PR head 或 base 上的内容，没法对比冻结数（待协调确认，本机 merge-preflight 核）`] }
  }
  const subject = suppressionApprovalSubject(base, head)
  if (!subject.needsApproval) return { ok: true, lines: [] }
  if (approvals?.lookup?.('eslint-suppressions', SUPPRESSIONS_FILE, subject.fingerprint) === true) return { ok: true, lines: [`✅ ${SUPPRESSIONS_FILE}：${describeSuppressionGrowth(subject)}——协调已确认（哈希对上）`] }
  const command = approvalCommand(approvals?.pr, 'eslint-suppressions')
  if (approvals?.mode === 'local') {
    return { ok: false, lines: [`✖ ${SUPPRESSIONS_FILE}：${describeSuppressionGrowth(subject)}，没有协调确认记录${approvals?.unavailable ? `（${approvals.unavailable}）` : ''}。冻结数只许减少；确需冻进存量，协调看过 diff 后跑 ${command}`] }
  }
  return { ok: true, lines: [`⚠ ${SUPPRESSIONS_FILE}：${describeSuppressionGrowth(subject)}——待协调确认（本机 merge-preflight 核；确认命令 ${command}）`] }
}

/**
 * 改界面的 PR 必须认领拍板图清单，或给已登记的例外（2026-10-22 起开的 PR，evidenceJudgementEnforced）。
 * 旧判据：没有 `## 拍板图` 一节就当没认领、照常过——#1264 改了界面，一张清单也没有，门岗全绿。
 *   · 路径推出「新界面 / 改交互」（inferred 里有 ui 类）才要求；不碰界面的 PR 不问；
 *   · 认领：`- <板名>: <元素 id>, …`，每条至少一个合法的元素 id（空认领不算，V-gates B2）；板必须存在、元素必须 implemented（或带用户原话的 deferred / dropped）——同 check-board-parity 的 R8，同一份实现；
 *   · 批准身份（V-gates B4）：认领只对 base 上已有的板和元素直接有效；PR 新增的板、或给已有板新增 / 改了合同的元素，要协调确认（approvals，哈希对上）才算。
 *     只改实现状态（status / assertion / owner）不用确认。CI 读不到本机确认记录，只提示「待协调确认」；合并前扫描没有记录就红；
 *   · 例外：`- 不适用：<例外 id>：<具体理由>`，例外 id 必须在路由政策表 evidenceJudgement.boardClaimExceptions 里已登记，理由至少 8 个字且不是重复字符；
 *   · 新增了生产 .tsx（文件状态 A，含 src/design/components/**）不许用例外：新界面必须有清单；只改令牌、样式的可以用例外（V-gates B3）。
 * boards / baseBoards = loadManifests() 形状的清单（对象，或返回它的函数；null = 取不到）：boards 是 PR head 上的，baseBoards 是 base 上的。
 * 非严格口径（旧 PR）下只在写了认领时核认领本身，和以前一样。
 */
const PRODUCTION_TSX = /^src\/(?!devlab\/).*\.tsx$/
const TEST_TSX = /(?:\.(?:test|spec)\.tsx$|(?:^|\/)__tests__\/)/
export function checkBoardClaim(body, { inferred, files = [], strict = false, table = undefined, boards = null, baseBoards = null, approvals = null } = {}) {
  const claims = parsePrBoardClaims(body)
  const lines = []
  let ok = true
  const resolve = (value) => (typeof value === 'function' ? value() : value)
  if (claims.length) {
    const headBoards = resolve(boards)
    const empty = claims.filter((claim) => !claim.ids.length)
    if (empty.length) {
      ok = false
      lines.push(`✖ 拍板图认领没有元素 id：${empty.map((claim) => claim.board).join('、')}（写成 \`- <板名>: <元素 id>, …\`；空串、只有逗号 / 顿号 / 空白都不算认领）`)
    }
    if (headBoards) {
      const errors = checkPrBoardClaims(body, headBoards)
      if (errors.length) {
        ok = false
        lines.push(`✖ 拍板图认领未过（${errors.length} 条）：`, ...errors.map((error) => `    ✗ ${error}`))
      } else if (!empty.length) lines.push(`✅ 拍板图：认领的元素都有去处（${claims.map((claim) => claim.board).join('、')}）`)
    } else if (strict) lines.push('⚠ 拍板图：这个环境取不到清单目录，认领的元素没核')
  }
  // 清单合同的批准：真实 diff，不看认领（认领只用来关联实现验收）
  const contracts = checkBoardContracts({ strict, boards, baseBoards, approvals })
  lines.push(...contracts.lines)
  ok = ok && contracts.ok
  if (!strict) return { ok, lines }
  const touchesUi = (inferred?.categories ?? []).some((category) => category.id === 'ui')
  if (!touchesUi) return { ok, lines }
  if (claims.length) return { ok, lines }
  const registered = table?.evidenceJudgement?.boardClaimExceptions ?? []
  const registry = registered.map((item) => `${item.id}（${item.label}）`).join('；') || '（还没有登记）'
  const exception = /^\s*[-*]\s*不适用\s*[:：]\s*([a-z][a-z0-9-]*)\s*[:：]\s*(\S.*)$/im.exec(extractSection(body, '拍板图') ?? '')
  // 新增的生产 .tsx 看文件状态 A（不再按目录豁免 src/design）；改令牌、样式（改动已有文件）可以用例外
  const newUiFiles = files.filter((file) => (file.status === 'A' || file.status === 'added') && PRODUCTION_TSX.test(String(file.path).split('\\').join('/')) && !TEST_TSX.test(String(file.path))).map((file) => file.path)
  if (!exception) {
    lines.push(`✖ 改了界面，但 \`## 拍板图\` 既没认领清单元素（\`- <板名>: <元素 id>\`，清单在 docs/design/boards/），也没写已登记的例外（\`- 不适用：<例外 id>：<具体理由>\`）。已登记的例外：${registry}`)
    return { ok: false, lines }
  }
  const [, id, reason] = exception
  if (!registered.some((item) => item.id === id)) {
    lines.push(`✖ 拍板图写了「不适用：${id}」，但 ${id} 不在已登记的例外里。已登记的例外：${registry}`)
    return { ok: false, lines }
  }
  const compact = reason.replace(/\s/g, '')
  if (compact.length < 8 || new Set(compact).size < 4) {
    lines.push(`✖ 拍板图的例外「${id}」理由太空（至少 8 个字、不是重复字符，说清这次具体改了什么）`)
    return { ok: false, lines }
  }
  if (newUiFiles.length) {
    lines.push(`✖ 新增了界面文件（${newUiFiles.slice(0, 3).join('、')}${newUiFiles.length > 3 ? ' …' : ''}），新界面必须认领拍板图清单，不能用例外「${id}」`)
    return { ok: false, lines }
  }
  lines.push(`✅ 拍板图：用已登记的例外「${id}」——${reason.trim().slice(0, 60)}`)
  return { ok, lines }
}

/**
 * 本 PR 动到的逃逸账本条目 → { transitions, removed }。账本一条一个文件（2026-10-07），所以只取**本 PR 改动的条目文件**
 * 在 base / head 两版，不拉整个目录。纯函数、可测：
 *   files: [{ path, status }]（status 用本地 git 的 A / D / M / T 等单字母状态）；
 *   fetch(path, side) → 文本 | null（side = 'base' | 'head'；取不到 = null）。
 * 「被删」= 条目文件在 base 有、head 没有（D，或 head 取不到而 base 取得到）。
 * 转换怎么算只有一份实现：fixedTransitions（check:escape-ledger 同源）。
 */
export function ledgerChanges(files, fetch) {
  const parse = (text) => { try { return text ? JSON.parse(text) : null } catch { return null } }
  const touched = []
  for (const file of files) {
    if (escapeIdOfPath(file.path)) touched.push({ path: file.path, status: file.status })
  }
  const base = []
  const head = []
  const removed = []
  for (const file of touched) {
    const before = file.status === 'added' || file.status === 'A' ? null : parse(fetch(file.path, 'base'))
    const after = file.status === 'removed' ? null : parse(fetch(file.path, 'head'))
    if (before) base.push(before)
    if (after) head.push(after)
    else if (before) removed.push(escapeIdOfPath(file.path))
  }
  return { transitions: fixedTransitions({ entries: base }, { entries: head }), removed }
}

/** base 账本里已结账（fixed）条目指向的根因合同文件。纯函数、可测。 */
export function settledContracts(baseLedger) {
  return (baseLedger?.entries ?? []).filter((entry) => entry.status === 'fixed' && entry.rootCauseContract).map((entry) => entry.rootCauseContract)
}

/** Only changed, committed reviewed entries with real structural/class evidence can prepare a first push. */
export function reviewedContracts(files, fetchHead, { hasCommit = () => false } = {}) {
  const read = (file) => fetchHead(file)
  const exists = (file) => typeof read(file) === 'string'
  return files.flatMap((file) => {
    const id = escapeIdOfPath(file.path)
    if (!id || ['D', 'removed'].includes(file.status)) return []
    let entry
    try { entry = JSON.parse(read(file.path)) } catch { return [] }
    if (!entry || entry.id !== id || entry.status !== 'reviewed' || entry.manualReview !== 'reviewed') return []
    if (!Array.isArray(entry.evidence) || !entry.evidence.some((value) => typeof value === 'string' && value.trim())) return []
    if (!Array.isArray(entry.completionCommits) || !entry.completionCommits.some((commit) => typeof commit === 'string' && /^[a-f0-9]{7,40}$/.test(commit) && hasCommit(commit))) return []
    if (contractErrors(entry, { exists, read }).length || classCheckErrors(entry, { exists, read }).length) return []
    return [entry.rootCauseContract]
  })
}

export function checkEscapeContract(body, contracts, transitions = [], ledgerIds = [], settled = [], { stage = 'merge', reviewed = [] } = {}) {
  const withField = contracts.filter((contract) => ['user', 'post-release', 'walkthrough', 'ci', 'review'].includes(contract.detected_by))
  const userFound = contracts.filter((contract) => ['user', 'post-release'].includes(contract.detected_by))
  const mentioned = ledgerIds.filter((id) => String(body || '').includes(id) && !transitions.includes(id))
  const hint = mentioned.length ? [`· 正文提到了账本条目 ${mentioned.join('、')}，但本 PR 没把它们改成 fixed——只是引用，不要求合同`] : []
  if (transitions.length === 0 && userFound.length === 0) {
    return { applicable: false, ok: true, lines: ['· 本 PR 没有让任何逃逸账本条目转成 fixed，合同检查跳过', ...hint] }
  }
  if (transitions.length === 0) {
    // 修订已结账的合同（例：用户后来改了拍板，合同不变量跟着改）：条目在 base 已是 fixed，本 PR 只修订合同，不要求再转换一次。
    // 新增的合同、或对应条目还没结账的，照旧要进账本。
    const unsettled = userFound.filter((contract) => contract.added || !settled.includes(contract.file))
    if (unsettled.length === 0) {
      return { applicable: true, ok: true, lines: [`· 修订已结账的根因合同（${userFound.map((contract) => contract.file).join('、')}）：对应逃逸账本条目在 base 已是 fixed，不要求再转换`, ...hint] }
    }
    if (stage === 'push' && unsettled.every((contract) => contract.added && reviewed.includes(contract.file))) {
      return { applicable: true, ok: true, lines: [`⚠ 新增用户根因合同已有 reviewed 账本、真实提交和类级检查（${unsettled.map((contract) => contract.file).join('、')}）：首次推送允许待结账；CI / 合并前仍要求 fixed 与真实 PR 号`, ...hint] }
    }
    return { applicable: true, ok: false, lines: [`✖ 根因合同声明 detected_by 为用户 / 发版后发现（${unsettled.map((contract) => contract.file).join('、')}），但本 PR 没有把对应的逃逸账本条目（tests/ux/full-walk/escapeLedger/）转成 fixed——用户发现的问题要进账本并带类级检查结账`] }
  }
  if (withField.length === 0) {
    return { applicable: true, ok: false, lines: [`✖ 本 PR 把逃逸账本条目 ${transitions.join('、')} 转成 fixed，但没带含 detected_by 的根因合同（docs/fixes/*.root-cause.json）`] }
  }
  return { applicable: true, ok: true, lines: [`✅ 逃逸账本 ${transitions.join('、')} → fixed：带了含 detected_by 的合同（${withField.map((contract) => contract.file).join('、')}）`, ...hint] }
}

/**
 * 规则生效时刻 = 引入本套规则的 PR（#961）的合并时间（2026-10-03T06:49:25Z，写死：推送前没有 gh 也得判）。
 * 比它更早开的 PR（#947、#962 等）没有机会照新模板写，只给警告、不判红。effectiveAt 显式传 null = 规则尚未生效（测试用）。
 */
/**
 * 正文里的「承诺」：写下「后续提交 / 等 X 合入后再做」，合并时没人回头核对——#1136 正文自己写了「加节点条等 #1133 合入后作为本 PR 后续提交」，
 * 结果没做就合进去了，用户看真 App 才发现（2026-10-10，逃逸账本 FB-20261010-shell-canvas-chrome-parity）。
 * 判据：正文某一行出现承诺措辞，且这一行没有标「已完成 <提交号>」或「移交 <PR / 待办 / 文档>」，合并档判红（推送档只警告）。
 * 标法只认这两种——「已完成」要带提交号（让人能核）；「移交」要有去处（#PR、待办编号、docs/ 路径），不许一句「以后再说」。
 */
export const DEFERRED_PROMISE = /后续提交|后续\s*PR|后面(?:再)?(?:补|做|提交)|之后(?:再)?(?:补|做)|稍后(?:补|提交)|(?:等|待)\s*[^。\n;；]{0,30}?(?:合入|合并|落地)\s*后/
const PROMISE_SETTLED = /已完成\s*[`(（]?\s*[0-9a-f]{7,40}\b|移交\s*[：:]?\s*(?:#\d+|PR\s*#?\d+|待办\s*\S+|docs\/\S+)/
/** 这条规则生效日：之前开的 PR 只警告（它们的正文不是按这条写的）。 */
export const PROMISE_RULE_EFFECTIVE_AT = '2026-10-10T00:00:00Z'

export function checkDeferredPromises(body, { stage = 'merge', createdAt = null, enforce = false } = {}) {
  const offending = []
  let inFence = false
  for (const raw of String(body || '').split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) { inFence = !inFence; continue }
    if (inFence) continue
    if (DEFERRED_PROMISE.test(raw) && !PROMISE_SETTLED.test(raw)) offending.push(raw.trim().slice(0, 120))
  }
  if (offending.length === 0) return { ok: true, lines: [] }
  const grandfathered = !enforce && createdAt && new Date(createdAt) < new Date(PROMISE_RULE_EFFECTIVE_AT)
  const soft = stage === 'push' || grandfathered
  const head = soft ? '⚠' : '✖'
  return {
    ok: soft,
    lines: [
      `${head} PR 正文里有没落实的承诺（「后续提交 / 等 … 合入后」这类），每一条要标「已完成 <提交号>」或「移交 <#PR / 待办编号 / docs 路径>」：${grandfathered ? '（规则生效前开的 PR，只警告）' : stage === 'push' ? '（推送时只警告，合并前扫描判红）' : ''}`,
      ...offending.map((line) => `    - ${line}`),
    ],
  }
}

export const RULES_INTRODUCED_BY_PR = 961
export const RULES_EFFECTIVE_AT = '2026-10-03T06:49:25Z'

export function isGrandfathered({ createdAt, effectiveAt = RULES_EFFECTIVE_AT }) {
  if (!effectiveAt) return true
  if (!createdAt) return false
  return new Date(createdAt) < new Date(effectiveAt)
}

/** 正文判据的逐行输出与是否判红；renderReport（合并前）和推送前各自加抬头 / 结论。 */
export function renderBodyLines({ classification, process, design, standardReview = { ok: true, lines: [] }, acceptance, escape, promises = { ok: true, lines: [] }, scope = { ok: true, lines: [] }, routing = { blocking: false, lines: [], ok: true }, board = { ok: true, lines: [] }, perfPolicy = { ok: true, lines: [] }, suppressions = { ok: true, lines: [] }, grandfathered = false }) {
  const lines = []
  lines.push(...(process?.lines ?? [classification.fourClass ? `· 路径命中旧四类：${classification.classes.join('、')}` : '· 路径未命中旧四类（未命中，只查设计卡 ★ 格）']))
  const soften = (list) => (grandfathered ? list.map((line) => line.replace(/^✖/, '⚠')) : list)
  lines.push(...soften(design.lines))
  lines.push(...soften(standardReview.lines))
  const showAcceptance = process ? process.tier === PROCESS_TIERS.STRICT && (!process.legacy || classification.fourClass) : classification.fourClass
  if (showAcceptance) lines.push(...soften(acceptance.lines))
  lines.push(...soften(escape.lines))
  lines.push(...promises.lines)
  // 路由（功能分类 / 验收证据）：生效日之前开的 PR 已在 routing.lines 里降成警告
  lines.push(...routing.lines)
  // 拍板图（改界面必须认领清单或给已登记的例外）：只对生效日之后的 PR 出判，旧 PR 在 evaluatePrBody 里就没有这些行
  lines.push(...board.lines)
  lines.push(...perfPolicy.lines)
  lines.push(...suppressions.lines)
  // 规则与门岗的改动范围不吃「规则生效前开的 PR」那条宽限：#1032 这种回退正是旧分支带出来的。
  lines.push(...scope.lines)
  if (grandfathered) lines.push('· 这是规则生效（#961 合并）之前开的 PR：缺项只给警告，不判红')
  const needsLegacyAcceptance = process ? process.legacy && classification.fourClass : classification.fourClass
  const blocked = !scope.ok || !promises.ok || routing.blocking || !board.ok || !perfPolicy.ok || !suppressions.ok || (!grandfathered && ((process && !process.ok) || !design.ok || (!process?.legacy && process?.tier === PROCESS_TIERS.STANDARD && !standardReview.ok) || ((process?.tier === PROCESS_TIERS.STRICT && !process.legacy || needsLegacyAcceptance) && !acceptance.ok) || !escape.ok))
  return { lines, blocked }
}

/** 合并前扫描的完整报告：抬头 + 判据行 + 结论。 */
export function mergeReport(pr, { lines, blocked }) {
  const out = [`合并前扫描 · PR #${pr}`, ...lines]
  out.push(blocked ? '结论：✖ 有项没过，先别合（脚本只打印结论，不合并）' : '结论：✅ 扫描干净（脚本只打印结论，不合并；其余合并条件仍看 CI 与收据）')
  return { text: out.join('\n'), blocked }
}

export const renderReport = ({ pr, ...rest }) => mergeReport(pr, renderBodyLines(rest))

/**
 * 正文判据的总入口（推送前的 check-pr-judgement 与合并前扫描都从这里判）：
 *   files: [{ path, status }]（A / M / D 或 added / modified / removed）；addedByFile: Map(路径 → 新增行)；
 *   contracts / ledger（transitions、ids、removed、settledContracts）见 checkEscapeContract / ledgerChanges；
 *   createdAt: PR 创建时间（拿不到 = 不宽限，fail-closed）；enforce: 假设规则已生效（回放用）；
 *   paidStrict: 合并前扫描传 true——花钱类的 spend-paid-sample 按严格口径判（pr-judgement-lib 的 paidSampleVerdict），CI / 推送前不传。
 */
export function evaluatePrBody({ body, files, addedLines = '', addedByFile = null, packageRemovedLines = [], contracts = [], ledger = {}, createdAt = null, enforce = false, stage = 'merge', scenarios = null, table = undefined, paidStrict = false, evidence = undefined, uiVerification = null }) {
  const normalized = files.map((file) => ({ ...file, status: file.status === 'added' ? 'A' : file.status }))
  const withAdded = addedByFile ? normalized.map((file) => ({ ...file, added: addedByFile.get(file.path) ?? '' })) : normalized
  const classification = classifyChange(withAdded, addedLines, table)
  // 证据判「对不对」（独立验收的报告 / HEAD、性能原始结果、拍板图）：生效日之后开的 PR；回放（enforce）按已生效。
  // evidence = { headSha, readReport, readRaw, boards }：合并前扫描用 gh 取数注入；CI / 推送前不注入时用本地 git 的默认取法（scripts/lib/prEvidenceInputs.mjs）。
  const policy = table ?? loadRoutingTable()
  const strictEvidence = evidenceJudgementEnforced(policy, enforce ? null : createdAt)
  const inputs = evidence ?? (strictEvidence ? localEvidenceInputs() : {})
  // 性能场景的政策字段（预算 / 统计层级 / 尾部预算 / 欠账 / 基线……）不能由 PR 自己批准：判定用 base 的值，PR 改了要协调确认（V-gates B1）
  const pinned = strictEvidence && scenarios ? pinScenarioPolicy(scenarios, inputs.approvals) : { known: scenarios, lines: [], blocked: false }
  const judgement = evaluatePrJudgement({
    body,
    files: normalized,
    addedLines,
    addedByFile,
    packageRemovedLines,
    ledgerRemovedIds: ledger.removed ?? [],
    createdAt: enforce ? null : createdAt,
    scenarios: pinned.known,
    table: policy,
    paidStrict,
    readRaw: inputs.readRaw ?? null,
  })
  const evidenceInputs = inputs
  const process = processTieringEnforced(createdAt, enforce)
    ? evaluateProcessTier({
      body,
      files: normalized,
      inferred: judgement.inferred,
      ledgerTransitions: ledger.transitions ?? [],
      uiVerification: uiVerification ?? evidenceInputs.uiVerification ?? deriveUiVerification({ files: normalized, baseBoards: evidenceInputs.baseBoards, headBoards: evidenceInputs.boards }),
    })
    : {
      tier: classification.fourClass ? PROCESS_TIERS.STRICT : 'legacy',
      candidate: null,
      hard: [],
      declaration: { present: false },
      uiVerification: null,
      legacy: true,
      ok: true,
      lines: [classification.fourClass
        ? `· 四类：命中（${classification.classes.join('、')}）——${classification.hits.slice(0, 5).map((hit) => hit.path).join('、')}${classification.hits.length > 5 ? ' …' : ''}\n· 流程档位：旧规则宽限（路径命中四类，沿用 9 格 + 独立验收）`
        : '· 流程档位：旧规则宽限（仅查 ★ 格）'],
    }
  const shortOrStandard = !process.legacy && process.tier !== PROCESS_TIERS.STRICT
  const routing = shortOrStandard
    ? (process.tier === PROCESS_TIERS.SHORT
      ? { ok: true, lines: ['· 验收证据：短档不要求四类证据；由声明与 base/head 界面清单核实覆盖'], gaps: [], categories: [] }
      : judgement.routing)
    : judgement.routing
  const result = renderBodyLines({
    classification,
    process,
    design: checkDesignCard(body, { tier: process.tier }),
    standardReview: checkStandardReview(body, { tier: process.tier }),
    acceptance: checkIndependentAcceptance(body, { stage, strict: strictEvidence, headSha: evidenceInputs.headSha ?? null, readReport: evidenceInputs.readReport, headRelation: evidenceInputs.headRelation }),
    escape: checkEscapeContract(body, contracts, ledger.transitions ?? [], ledger.ids ?? [], ledger.settledContracts ?? [], { stage, reviewed: ledger.preparedContracts ?? [] }),
    promises: checkDeferredPromises(body, { stage, createdAt, enforce }),
    scope: judgement.scope,
    routing,
    board: checkBoardClaim(body, { inferred: judgement.inferred, files: normalized, strict: strictEvidence && process.tier !== PROCESS_TIERS.SHORT, table: policy, boards: evidenceInputs.boards ?? null, baseBoards: evidenceInputs.baseBoards ?? null, approvals: evidenceInputs.approvals ?? null }),
    perfPolicy: { ok: !pinned.blocked, lines: pinned.lines },
    suppressions: checkSuppressionContracts({ strict: strictEvidence, suppressions: inputs.suppressions, baseSuppressions: inputs.baseSuppressions, approvals: inputs.approvals ?? null }),
    grandfathered: !enforce && isGrandfathered({ createdAt }),
  })
  return { ...result, classification, judgement }
}
