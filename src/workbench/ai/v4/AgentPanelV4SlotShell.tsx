/**
 * 介入槽那一格的**外壳**——卡族共用的那一件。
 *
 * ## 它为什么被抽出来（2026-09-21 用户：「有弄我们的设计系统不？会不会格格不入？」）
 *
 * 反问卡改版时自带了一套外壳（纸色底 + 一圈发丝环 + 柔影 + 全圆角药丸按钮），
 * 单件取景框里看着挺好，**放回真面板就散了**：同一个槽里，付费确认卡是「accent 描边 +
 * 浅 accent 底的卡头条 + 分隔线 + ink 方角主按钮」，而反问卡在白底面板上**一点边界都没有**
 * ——分不清对话在哪结束、卡从哪开始（真机截图 `scratchpad/lane-renderer4/in-panel/`）。
 *
 * 「用了 token」不等于「放进去不突兀」：token 保证颜色取自同一套，保证不了两张卡是一家人。
 * 所以外壳收成这一件，两张卡都从这里取——改一次描边两张一起变，不会再有一张偷偷长成别的样子。
 *
 * ## 边界：它只管**壳**
 *
 * 壳 = 外框 / 圆角 / 底色 / 内边距 / 卡头条 / 页脚上那条分隔线。
 * 壳**不管**卡里放什么、按钮排在哪、有没有卡头——那是每张卡自己的结构：
 * · 确认卡 / 付费卡 / 计划卡：有卡头条（icon + 这次要动什么 + 徽章），主按钮在页脚左端；
 * · 反问卡：**没有卡头条**（问题本身就是标题，那是 Approval Card 的形状，也是这次
 *   把「需要你定一下」那句套话删掉的原因），页脚左端是页码、右端是跳过 + 主按钮。
 * 两者的差别是**有意的**，理由写在 `AgentPanelV4AskCard.tsx` 的对照表里；
 * 而外框、圆角、内边距、按钮族这些「一眼看出是不是一家人」的东西，从此只有一份。
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { IconChevronRight, IconX } from './AgentPanelV4Icons'
import { V4Row } from './AgentPanelV4Row'
import type { V4InterventionKind, V4PagerState } from './agentPanelV4Types'

// 这个文件**不定义任何按钮长相**。卡上的按钮一律是现役组件：
// 主动作 = `WorkbenchButton variant="primary" size="sm"`、次动作 = `WorkbenchButton size="sm"`、
// 图标钮 = `WorkbenchIconButton size="sm"`（`src/design/actions.tsx`，agent 专章 §8.1 的尺寸真相源）。
// 上一版这里有过三个自写的 className 常量——那正是 actions.tsx 文件头点名的病根：
// 「各处 ad-hoc className 各覆写一套 = 明显不是一个设计风格」。

export function V4SlotShell({
  kind,
  waiting,
  tone,
  title,
  dismiss,
  footer,
  footerDivider = true,
  children,
  ...rest
}: {
  kind: V4InterventionKind
  /**
   * 页脚上那条分隔线画不画（默认画）。付费确认条不画（SpendAskSplit 板 ask.params / ask.actions：参数一行和按钮一行之间只隔 8px）；
   * 不画时内容区空着（正在发出）页脚自己的上边距照留。
   */
  footerDivider?: boolean
  /**
   * 这张卡此刻**在等用户回答**（2026-09-22 用户拍板）。
   *
   * ## 它从哪一份状态来——**不是**第二个 pending 布尔
   *
   * 「有一张卡在等你」全仓只有一个产地：`LaneProjection.pending`
   * （`electron/shared/agentLane/laneContracts.ts`）。中立契约层已经给它起过名字——
   * `laneComposerState()` 读的就是这个字段，`pending` 在就回 `'awaiting-approval'`
   * （`electron/shared/agentLane/laneComposerIntent.ts`）。渲染层这一侧，
   * `laneViewModel` 把同一个字段投影成 `slot`，而面板**只在 `slot` 在时才挂这张卡**
   * （`AgentPanelV4Panel.tsx`：`{slot ? <V4Intervention …/> : null}`）。
   *
   * 也就是说，生产里「卡挂着」≡「`projection.pending` 在」≡「`laneComposerState()`
   * 回 `'awaiting-approval'`」——三句话是同一件事。所以这只外壳**不问第二遍**：
   * 默认就是 `true`，答完 / 收回 / 已确认时卡本身会从槽里消失（它在流里变成一行
   * 「已回答 · …」收据，`ToolReceipt.answered`），不是留在原地换一身皮。
   *
   * 那这个参数为什么还要存在？因为「普通纸面」这一态必须**画得出来**：
   * 设计实验室是静态取景，没有宿主投影可翻；两版样张（待答 / 常驻）也要在同一只壳上对照。
   * 同一个理由下 `answerDraft`、`reject-reason` 早就是这么做的——把一个只在真机上
   * 一闪而过的状态固定下来，好让它有地方被看见、被断言。
   *
   * **外壳这一层必填**（R28：能让编译器拦的别留给门岗）。上一版 `onPlanToggle` 做成可选
   * 的代价已经付过一次：宿主一根都没接，承诺在界面上点不动而没人报错。
   */
  waiting: boolean
  /**
   * 这张卡在说一件没成的事（付费卡失败留在卡里，SpendCardQ1 板 card.failure）：外框换警示色那一条发丝线，
   * 压过「在等你」那一档——没成这件事比「在等你」更要紧，两个颜色只能有一个。
   */
  tone?: 'danger'
  /**
   * 卡头那**一句话**（Recommendation Card 的形状：标题就是一句问话，
   * 「生成这 1 段视频？」）。缺席 = 这张卡自己在 `children` 里画标题——
   * 反问卡就是这一档：多题时标题要跟着题轨一起滑，钉在壳上就滑不动了。
   */
  title?: React.ReactNode
  /** 右上那颗 ×。**位置由外壳定死**，卡自己不摆——这是这次统一的重点之一。 */
  dismiss?: Readonly<{ label: string; onClick: () => void }>
  /**
   * 页脚。给的是一整块而不是「左/右」两个槽：动作行放不下一行时要折成两行（左边的整颗换到上一行、右边这一组保持一组），
   * 拆成两个槽就折不了。左元信息 / 右动作那条排布由卡自己用一根 `flex-1` 垫片实现，写法三张卡一致。
   */
  footer?: React.ReactNode
  children: React.ReactNode
  // `title` 在这里是**卡头那句话**（可以是 JSX），不是 HTML 那个字符串 tooltip 属性；
  // 不 Omit 掉，两个同名字段会打架（tsc 当场报，不是运行时才发现）。
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>): JSX.Element {
  return (
    <aside
      {...rest}
      // **卡是 composer 的兄弟**（2026-09-22 用户看真机后的更正）：卡面底色、描边色与粗细、
      // 圆角，和同屏 composer 的外壳**逐字相同**——`AgentPanelV4Composer.tsx` 根节点就是
      // `rounded-nomi border border-nomi-line bg-nomi-paper`，没有阴影。
      //
      // 这里走过一次弯路：为了让白卡在白面板上有边界，上一版把卡面「抬一档」成 `ink-05`
      // 再加一层柔影。真机上一看就不对——亮色下卡成了一块发灰的禁用区，而正文里复用的
      // 节点参数条是按「放在白纸面上」设计的，白 chip 浮在灰卡上，和画布节点下那同一条
      // 参数条观感两样。设计系统 §2.1.1 写得很明白：`--nomi-paper` ＝ 卡片 / 浮层 / 面板表面。
      // 边界就用 composer 今天站得住的那同一条发丝线，不另造。
      //
      // 相比旧外壳删掉的两样不变：**常驻**彩色描边、带底色的卡头条。
      // `overflow-hidden` 仍要：页脚铺满宽度，不裁会在圆角处戳出方角。
      //
      // ── 待答态（2026-09-22 用户拍板）───────────────────────────────────────
      // 「等你回答」这一刻外框换成 accent 发丝线 + 一层极轻的同色描边光；答完 / 收回 /
      // 已确认回到普通纸面（paper + `border-nomi-line`，与同屏 composer 逐字相同）。
      //
      // **这两样都不是新造的**：同一屏的 composer 早就用这套词汇说同一件事——
      // 聚焦时 `border-nomi-accent shadow-[0_0_0_3px_var(--nomi-accent-soft)]`、
      // 在跑时 `shadow-[0_0_0_1px_var(--nomi-accent-soft)]`
      // （`AgentPanelV4Composer.tsx`）。卡取 1px 那一档：卡比 composer 大得多，
      // 3px 在 390px 的面板里会读成一块发光的底，而这里要的是「一圈」不是「一团」。
      // 于是 09-21 那条「卡是 composer 的兄弟」没有被推翻——**连强调的说法都是兄弟的那一句**。
      //
      // 暗色不另写一支：`--nomi-accent` / `--nomi-accent-soft` 两个 token 在
      // `tailwind.config.ts` 的暗色块里自己翻（accent 0.55→0.70，soft 12%→26% 混纸色）。
      // 手写一份 `dark:` 覆写等于给同一件事造第二份真相，而且它会和 token 的翻法各走各的。
      //
      // 两支**互斥**地给 `border-color`，不叠着写：`border-nomi-line` 与 `border-nomi-accent`
      // 是同一个属性，谁赢由它们在生成的样式表里的先后决定，不是由这个字符串的顺序决定
      //（cn/twMerge 之外那条路，用户是看不见自己写的顺序不算数的）。
      // 动效不加：出现/消失本身已经是那一下变化，再补一段 transition 就是让一张等人答的卡自己动。
      className={cn(
        // 内容区一个字都没有时（付费确认条正在发出：只剩页脚那一行进度 +「取消」）内容区不画、页脚顶上那条线也不画。
        'relative overflow-hidden rounded-nomi border bg-nomi-paper [&>div:empty+footer]:border-t-0',
        tone === 'danger'
          ? 'border-nomi-danger-edge'
          : waiting
            ? 'border-nomi-ink-40'
            : 'border-nomi-line',
        rest.className,
      )}
      data-v4-block="intervention"
      data-kind={kind}
      data-tone={tone}
      // 待答与否**两态都落属性**（不是「待答时才有」）：走查与单测要能断言「这一张确实回到了
      // 普通纸面」，而属性缺席既可能是「不在等」，也可能是「这一版根本没接这条线」。
      data-waiting={waiting ? 'true' : 'false'}
    >
      {dismiss ? (
        // 现役图标钮（28×28 · 7px 圆角 · 图标 16/stroke-2，agent 专章 §8.1）。否定动作全站统一是这颗 ×
        //（设计系统 §1.8 规则 4），文字只当无障碍名与 tooltip。
        <WorkbenchIconButton
          size="sm"
          icon={<IconX aria-hidden="true" />}
          label={dismiss.label}
          onClick={dismiss.onClick}
          data-v4-control="slot-dismiss"
          className="absolute right-1.5 top-1.5 z-10"
        />
      ) : null}
      <div className="peer flex flex-col gap-1.5 px-2.5 py-2 text-caption text-nomi-ink empty:hidden" data-v4-block="slot-content">
        {title ? (
          // `pr-8` 给右上那颗 × 让位——两者同一行，不让位就会压在字上。
          <h3 className="m-0 pr-8 text-body-sm font-semibold text-nomi-ink" data-v4-block="slot-title">{title}</h3>
        ) : null}
        {children}
      </div>
      {footer ? (
        <footer className={cn('flex flex-col gap-1.5 px-2.5 py-2 text-caption', footerDivider ? 'border-t border-nomi-line-soft' : 'pt-0 peer-empty:pt-2')}>{footer}</footer>
      ) : null}
    </aside>
  )
}

/**
 * 翻页器（`‹ 2/4 ›`）：反问卡多题时用。
 *
 * 付费卡的多镜翻页随 D2 第③步删了（组指向把所有段同时摆出来，SpendCardQ1 板）；键盘提示「←→」跟着翻页一起走了。
 * 排布仍守 2026-09-09 的通用规则：两件都在内容流里紧跟彼此，**不靠自动外边距顶到右缘**
 * （`check:tokens` 对 `src/workbench/ai/` 是硬零——连注释里写出那个类名都会被它数进去）。
 *
 * 只有一项时调用方不传 `pager`，整行不渲染——「1/1」是一句废话。
 */
export function V4Pager({
  pager,
  onPage,
}: {
  pager: V4PagerState
  onPage?: (index: number) => void
}): JSX.Element {
  const { t } = useTranslation()
  const step = (delta: number): void => onPage?.((pager.index + delta + pager.total) % pager.total)
  const arrow = 'flex size-5 shrink-0 items-center justify-center rounded-nomi-sm text-nomi-accent hover:bg-nomi-accent-soft disabled:opacity-40'
  return (
    <V4Row as="div" className="shrink-0 gap-0.5 font-normal" data-v4-block="pager">
      <button type="button" className={arrow} aria-label={t('agentPanelV4.pagerPrev')} disabled={pager.total < 2} onClick={() => step(-1)} data-v4-control="pager-prev">
        <IconChevronRight size={12} className="rotate-180" aria-hidden="true" />
      </button>
      <span className="tabular-nums text-micro">{`${pager.index + 1}/${pager.total}`}</span>
      <button type="button" className={arrow} aria-label={t('agentPanelV4.pagerNext')} disabled={pager.total < 2} onClick={() => step(1)} data-v4-control="pager-next">
        <IconChevronRight size={12} aria-hidden="true" />
      </button>
    </V4Row>
  )
}
