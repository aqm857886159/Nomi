// 设计实验室 · 屏「付费确认」：SpendAskSplit 板（2026-11-15 拆开）与沿用 SpendCardQ1 板的失败 / 刹车 / 读不到 / 逐镜价格。
//
// 每一格都是真面板：数据走生产钩子 `useAgentPanelSpendCard`（和真面板同一条路），这一批镜头在对话里一行一个
// （NodePointer 列表行生产件，挂在那一条生成记录下面），输入框上方那一条确认只有共同参数 + 两颗按钮；
// 夹具只是画布节点、制作 Run 与宿主推过来的那一次出价（见 `spendCardLabKit.tsx`）。条上和行里都没有可改的东西：
// 想改点那一行去节点里改（设计系统 §1.0）。
//
// 密度：中文明 392 是默认；每一种状态至少一格换英文 / 暗色 / 窄 320 里的一两样，3 镜和 12 镜各给全四种组合里的两种。
// 价目挂在目录夹具上、走生产估价函数；这一刀条上不印预估（按钮行左侧留给 ask.cost，下一刀）。
import React, { type JSX } from 'react'
import type { LabState } from '../../labScreen'
import type { Locale } from '../../nodePointer/nodePointerLabKit'
import { SpendCardPanel, SpendCardStage, spendLabNodeId, type SpendLabScenario, type SpendLabScene, type SpendLabShot } from '../spendCardLabKit'

const SOURCE = 'docs/design/boards/2026-11-15-spend-ask-split/SpendAskSplit.board.json'
/** 失败 / 刹车 / 读不到 / 逐镜价格：结构照旧，仍按付费卡板。 */
const SOURCE_Q1 = 'docs/design/boards/2026-10-23/SpendCardQ1.board.json'
const WIDE = 392
const NARROW = 320

const undecided = (shot: number, extra: Partial<SpendLabShot> = {}): SpendLabShot => ({ shot, offer: 'undecided', ...extra })
/** 对话里那一组的第 n 行（键盘聚焦用）。 */
const row = (shot: number): string => `[data-v4-block="generation-receipt-pointers"] [data-node-pointer-id="${spendLabNodeId(shot)}"]`

const IMAGE_TITLES: readonly (readonly [string, string])[] = [
  ['雨后纸船 · 出发', 'Paper boat — sets off'],
  ['雨后纸船 · 越过落叶', 'Paper boat — drifts by'],
  ['雨后纸船 · 停在石阶', 'Paper boat — rests'],
]
const IMAGE_MESSAGE: readonly [string, string] = ['画 3 张雨后纸船的图，起草好给我确认。', 'Draw 3 rainy paper-boat images and let me confirm the drafts.']
const image = (shot: number, extra: Partial<SpendLabShot> = {}): SpendLabShot => undecided(shot, {
  kind: 'image',
  title: IMAGE_TITLES[shot - 1]!,
  resolution: '1K',
  ...extra,
})

/** 三段 16:9（4 / 5 / 4 秒）：都一样的只有模型、比例、清晰度，时长逐镜不同回到各行。 */
const THREE: readonly SpendLabShot[] = [undecided(1, { duration: 4 }), undecided(2, { duration: 5 }), undecided(3, { duration: 4 })]
/** 三段同参（每段 5 秒）：条上一行全说完，行里一个字都不多。 */
const THREE_SAME: readonly SpendLabShot[] = [1, 2, 3].map((shot) => undecided(shot, { duration: 5 }))
/** 十二段同参（每段 5 秒）。 */
const TWELVE: readonly SpendLabShot[] = Array.from({ length: 12 }, (_, index) => undecided(index + 1, { duration: 5 }))

const SCENARIOS = {
  /** 1 镜：一行；条上共同参数 + 取消 / 生成。 */
  single: { shots: [undecided(1, { duration: 4 })], pricing: 'flat' },
  /** 3 镜同参：一组三行，每行只有一行字；条上「生成 3 段」。 */
  batch: { shots: THREE_SAME, pricing: 'flat' },
  /** 12 镜：露前 4 行 +「还有 8 个镜头」；条和 3 镜一样高。 */
  twelve: { shots: TWELVE, pricing: 'flat' },
  /** 逐镜不同（一横两竖、时长 4 / 5 / 4）：不同的那一项写在各行第二行；条上只写共同项；「逐镜 · 3 镜」每镜价照旧。 */
  mixed: { shots: [undecided(1, { duration: 4 }), undecided(2, { ratio: '9:16', duration: 5 }), undecided(3, { ratio: '9:16', duration: 4 })], pricing: 'by-duration' },
  /** 时长逐镜不同（4 / 5 / 4）：条上不写时长，三行各写自己的。 */
  durations: { shots: THREE, pricing: 'flat' },
  /** 去掉了一镜：那一行变灰、第二行「已去掉，不生成」、行尾常驻「恢复」；按钮数跟着减。 */
  excluded: { shots: [undecided(1, { duration: 5 }), { shot: 2, duration: 5, offer: 'removed' }, undecided(3, { duration: 5 })], pricing: 'flat' },
  /** 全去掉了：主按钮置灰、条留着（还能恢复）。 */
  allRemoved: { shots: ([1, 2, 3] as const).map((shot) => ({ shot, duration: 5, offer: 'removed' })) },
  /** 节点被删：那一行「已删除」不可点，算作不生成。 */
  deleted: { shots: [undecided(1, { duration: 5 }), undecided(2, { duration: 5 }), { shot: 3, offer: 'removed', deleted: true }], pricing: 'flat' },
  /** 节点上点过 ↑：那一行写「生成中」、不挂 ×；按钮「生成剩下 2 段」。 */
  remaining: { shots: [{ shot: 1, duration: 5, offer: 'taken_by_canvas', node: 'generating' }, undecided(2, { duration: 5 }), undecided(3, { duration: 5 })], pricing: 'flat' },
  /** 三张 GPT Image 2 图片（用户原话 + 生成记录），同前缀标题。 */
  images: { shots: [image(1), image(2), image(3)], message: IMAGE_MESSAGE },
  /** 正在发出：镜 01 生成中、镜 02 正在提交、镜 03 排队等交；条上只剩「正在发出 2/3 段」+ 取消。 */
  sending: {
    shots: [
      { shot: 1, duration: 5, offer: 'sent', node: 'generating' },
      { shot: 2, duration: 5, offer: 'handing_over', bound: true, node: 'submitting' },
      { shot: 3, duration: 5, offer: 'handing_over' },
    ],
  },
  /** 发完（都出结果了）：条收走，同一组下面「✓ 已生成 3 段」。 */
  done: { done: true, shots: ([1, 2, 3] as const).map((shot) => ({ shot, duration: 5, offer: 'sent', node: 'done' })) },
  /** 发完那一刻（还在生成）：「✓ 已发出 3 段」，不替还没发生的事下结论。 */
  doneSending: { done: true, shots: [{ shot: 1, duration: 5, offer: 'sent', node: 'done' }, { shot: 2, duration: 5, offer: 'sent', node: 'generating' }, { shot: 3, duration: 5, offer: 'sent', node: 'generating' }] },
  /** 某镜没发出去（没花钱）：那一行红色第二行写原因；条上原因一行 + 「先不发了 · 再试一次」。 */
  notSent: {
    shots: [
      { shot: 1, duration: 5, offer: 'sent', node: 'generating' },
      { shot: 2, duration: 5, offer: 'not_sent', failure: { kind: 'not_sent', code: 'provider_not_reached' } },
      undecided(3, { duration: 5 }),
    ],
  },
  /** 参数被拒：条上「先不发了 · ⊙ 去改镜 02」（点了定位到那个节点）。 */
  rejected: {
    shots: [
      { shot: 1, duration: 5, offer: 'sent', node: 'generating' },
      { shot: 2, duration: 5, offer: 'not_sent', failure: { kind: 'parameter_rejected', code: 'provider_rejected' } },
      undecided(3, { duration: 5 }),
    ],
  },
  /** 结果未知：可能已经扣了钱，不说没花钱；下一步是去节点上核对。 */
  unclear: { shots: [{ shot: 1, duration: 5, offer: 'sent', node: 'generating' }, { shot: 2, duration: 5, offer: 'unknown' }, undecided(3, { duration: 5 })] },
  /** 本机就判得出发不出去（提示词空着），一段能发的都没有：失败留在条上，「去改镜 01」。 */
  blocked: { shots: [undecided(1, { emptyPrompt: true })] },
  /** 多段里有一段发不出去、其余照常可发：只多一行说明，主按钮不数它。 */
  blockedOne: { shots: [undecided(1, { duration: 5 }), undecided(2, { duration: 5, emptyPrompt: true }), undecided(3, { duration: 5 })] },
  /** 价格算不出：条上一个钱字都不印（更不许写 0）。 */
  priceUnknown: { shots: THREE_SAME },
  /** 节点里换过模型：共同参数里不再说「Nomi 选的」。 */
  modelChanged: { shots: THREE_SAME, pricing: 'flat', draftedOther: true },
  /** 「直接生成」档的刹车：同一镜连续失败（条上多一行原因）。 */
  brakeRetry: { shots: [undecided(1, { duration: 4 })], brake: 'retry-limit' },
  /** 「直接生成」档的刹车：计划外的镜头。 */
  brakeOutOfPlan: { shots: [undecided(1, { duration: 4 })], brake: 'out-of-plan' },
  /** 读不到待决出价：那张会说话的缺卡。 */
  unreadable: { shots: THREE_SAME, unreadable: true },
} satisfies Record<string, SpendLabScenario>

function Cell({ scenario, locale = 'zh-CN', scene, width = WIDE }: { scenario: SpendLabScenario; locale?: Locale; scene?: SpendLabScene; width?: number }): JSX.Element {
  return (
    <SpendCardStage scenario={scenario} locale={locale} {...(scene ? { scene } : {})}>
      <SpendCardPanel scenario={scenario} locale={locale} width={width} />
    </SpendCardStage>
  )
}

type Spec = Readonly<{ id: string; name: string; scenario: SpendLabScenario; locale?: Locale; dark?: boolean; narrow?: boolean; scene?: SpendLabScene; source?: string }>

const SPECS: readonly Spec[] = [
  { id: 'spend-single', name: '1 镜：一行；条上共同参数 + 取消 · 生成', scenario: SCENARIOS.single },
  { id: 'spend-single-en-dark-narrow', name: '1 镜（English · dark · 320）', scenario: SCENARIOS.single, locale: 'en', dark: true, narrow: true },
  { id: 'spend-batch', name: '3 镜同参：三行各一行字；条上「生成 3 段」', scenario: SCENARIOS.batch },
  { id: 'spend-batch-en', name: '3 镜（English）', scenario: SCENARIOS.batch, locale: 'en' },
  { id: 'spend-batch-dark', name: '3 镜（暗色）', scenario: SCENARIOS.batch, dark: true },
  { id: 'spend-batch-en-dark', name: '3 镜（English · dark）', scenario: SCENARIOS.batch, locale: 'en', dark: true },
  { id: 'spend-batch-narrow', name: '3 镜 · 窄 320', scenario: SCENARIOS.batch, narrow: true },
  { id: 'spend-twelve', name: '12 镜折起：露前 4 行 +「还有 8 个镜头」；条和 3 镜一样高', scenario: SCENARIOS.twelve },
  { id: 'spend-twelve-en-dark-narrow', name: '12 镜折起（English · dark · 320）', scenario: SCENARIOS.twelve, locale: 'en', dark: true, narrow: true },
  { id: 'spend-twelve-open', name: '12 镜展开：点了「还有 8 个镜头」全露，条不变', scenario: SCENARIOS.twelve, scene: { unfold: true } },
  { id: 'spend-twelve-open-en-dark', name: '12 镜展开（English · dark）', scenario: SCENARIOS.twelve, locale: 'en', dark: true, scene: { unfold: true } },
  { id: 'spend-durations', name: '时长逐镜不同：条上不写时长，三行各写自己的', scenario: SCENARIOS.durations },
  { id: 'spend-mixed', name: '逐镜参数不同（一横两竖）：不同的写在各行第二行；「逐镜 · 3 镜」每镜价展开', scenario: SCENARIOS.mixed, scene: { openPerShot: true } },
  { id: 'spend-mixed-en', name: '逐镜参数不同（English）', scenario: SCENARIOS.mixed, locale: 'en', scene: { openPerShot: true } },
  { id: 'spend-exclude-focus', name: '键盘聚焦镜 02 那一行：行尾露「不生成 ×」', scenario: SCENARIOS.batch, scene: { focus: row(2) } },
  { id: 'spend-excluded', name: '去掉镜 02：那一行变灰「已去掉，不生成」+ 常驻「恢复」；生成 2 段', scenario: SCENARIOS.excluded },
  { id: 'spend-excluded-en-dark-narrow', name: '去掉一镜（English · dark · 320）', scenario: SCENARIOS.excluded, locale: 'en', dark: true, narrow: true },
  { id: 'spend-all-removed', name: '全去掉：主按钮置灰、条留着还能恢复', scenario: SCENARIOS.allRemoved },
  { id: 'spend-deleted', name: '镜 03 的节点被删：那一行「已删除」不可点', scenario: SCENARIOS.deleted },
  { id: 'spend-remaining', name: '节点上点过 ↑：那一行「生成中」，生成剩下 2 段', scenario: SCENARIOS.remaining },
  { id: 'spend-images', name: '3 张图片（用户原话 + 生成记录）：同前缀标题', scenario: SCENARIOS.images },
  { id: 'spend-images-en-dark-narrow', name: '3 张图片（English · dark · 320）', scenario: SCENARIOS.images, locale: 'en', dark: true, narrow: true },
  { id: 'spend-sending', name: '发出中：各行自己的状态；条上「正在发出 2/3 段」+ 取消', scenario: SCENARIOS.sending },
  { id: 'spend-sending-en-dark', name: '发出中（English · dark）', scenario: SCENARIOS.sending, locale: 'en', dark: true },
  { id: 'spend-done', name: '发完（都出结果）：条收走，同一组下面「✓ 已生成 3 段」', scenario: SCENARIOS.done },
  { id: 'spend-done-sending', name: '发完那一刻（还在生成）：「✓ 已发出 3 段」', scenario: SCENARIOS.doneSending },
  { id: 'spend-done-en-dark', name: '发完（English · dark）', scenario: SCENARIOS.done, locale: 'en', dark: true },
  { id: 'spend-not-sent', name: '镜 02 没发出去：那一行写原因；条上原因 + 先不发了 · 再试一次', scenario: SCENARIOS.notSent, source: SOURCE_Q1 },
  { id: 'spend-not-sent-en-dark', name: '没发出去（English · dark）', scenario: SCENARIOS.notSent, locale: 'en', dark: true, source: SOURCE_Q1 },
  { id: 'spend-rejected', name: '镜 02 参数被拒：先不发了 · ⊙ 去改镜 02', scenario: SCENARIOS.rejected, source: SOURCE_Q1 },
  { id: 'spend-rejected-en', name: '参数被拒（English）', scenario: SCENARIOS.rejected, locale: 'en', source: SOURCE_Q1 },
  { id: 'spend-unclear', name: '结果未知：不说没花钱，先不发了 · ⊙ 去看镜 02', scenario: SCENARIOS.unclear, source: SOURCE_Q1 },
  { id: 'spend-blocked', name: '本机就判得出发不出去（提示词空着）：去改镜 01', scenario: SCENARIOS.blocked, source: SOURCE_Q1 },
  { id: 'spend-blocked-one', name: '三段里一段发不出去：只多一行说明，生成 2 段', scenario: SCENARIOS.blockedOne, source: SOURCE_Q1 },
  { id: 'spend-price-unknown', name: '价格算不出：条上不印钱字，主按钮照常可点', scenario: SCENARIOS.priceUnknown },
  { id: 'spend-model-changed', name: '节点里换过模型：共同参数不再说「Nomi 选的」', scenario: SCENARIOS.modelChanged },
  { id: 'spend-brake-retry', name: '「直接生成」档刹车：同一镜连续失败（条上多一行原因）', scenario: SCENARIOS.brakeRetry, source: SOURCE_Q1 },
  { id: 'spend-brake-out-of-plan-en', name: '「直接生成」档刹车：计划外的镜头（English）', scenario: SCENARIOS.brakeOutOfPlan, locale: 'en', source: SOURCE_Q1 },
  { id: 'spend-unreadable', name: '读不到待决出价：会说话的缺卡（不是「没有」）', scenario: SCENARIOS.unreadable, source: SOURCE_Q1 },
]

export const SPEND_CARD_STATES: readonly LabState[] = SPECS.map((spec) => ({
  id: spec.id,
  name: spec.name,
  source: spec.source ?? SOURCE,
  coverage: 'shell',
  ...(spec.dark ? { scheme: 'dark' as const } : {}),
  render: () => <Cell scenario={spec.scenario} {...(spec.locale ? { locale: spec.locale } : {})} {...(spec.scene ? { scene: spec.scene } : {})} width={spec.narrow ? NARROW : WIDE} />,
}))
