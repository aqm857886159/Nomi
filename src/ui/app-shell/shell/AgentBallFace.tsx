// Agent 小球的长相（2026-10-27 拍板 docs/design/boards/2026-10-27-agent-persona/AgentPersona.board.json：
// G · 去框——logo 同一块底色、同一个圆角比例的形 + 两只眼，脸是品牌组件 NomiAgentFace）。
// 只画，不判断：状态与条数由宿主（ShellAgentHost 读 residentActivity 的角标投影）算好传进来，
// 所以设计实验室能不带宿主把每一档一格一格截出来。只换脸，不换行为：原生 button、探针、title / aria-label、
// 焦点描边、ref 与 button 属性透传全照旧；脸和角上的点全是装饰（aria-hidden、不吃指针事件）。
//   空闲：logo 形 + 两只眼；在跑：变圆、accent 弧转圈、眼睛低头扫；出错：歪倒、眼睛塌下、右上一粒 danger 点；
//   等你确认 N：同一位置长成 warning 胶囊（右缘不动往左长；要花钱的事等你点头，不自己弹开）；
//   刚做完：轻跳、眯眼笑；有未读（收起期间来了新回复 / 工具跑完）：右上一颗强调色小点（外壳共用的 DotMark），
//   空闲时眼睛还往屏幕里看。未读和其它状态叠在一起照 10-08 的规则：在跑、刚做完照样挂点；
//   「等你确认 N」优先（两者同时在时只出胶囊）；出错点占同一个角，出错时不叠未读点。
import React, { type JSX } from 'react'
import { NomiAgentFace } from '../../../design'
import { cn } from '../../../utils/cn'
import type { V4DockStatus } from '../../../workbench/ai/v4/agentPanelV4DockStatus'
import { agentBallLook, BALL_SIZE } from './agentFormStore'
import { DotMark } from './DotMark'
import { useAgentBallEyeFollow } from './useAgentBallEyeFollow'

export const AgentBallFace = React.forwardRef<HTMLButtonElement, {
  status: V4DockStatus | null
  pendingCount: number
  /** 收起期间攒下的未读条数（residentActivity 角标投影的 dockUnreadCount）。 */
  unreadCount?: number
  /** 胶囊里那句（「等你确认 2」）；不是胶囊时只进 aria-label。 */
  label: string
  title?: string
  className?: string
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'>>(function AgentBallFace({ status, pendingCount, unreadCount = 0, label, title, className, ...rest }, ref): JSX.Element {
  const look = agentBallLook(status, pendingCount, unreadCount)
  const pill = look.pose === 'confirm'
  const button = React.useRef<HTMLButtonElement | null>(null)
  const setRef = React.useCallback((node: HTMLButtonElement | null) => {
    button.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }, [ref])
  useAgentBallEyeFollow(button)
  return (
    <button
      ref={setRef}
      type="button"
      className={cn(
        // 点击区域照旧：44×44（胶囊时宿主给 132 宽）；按钮本身透明，看得见的是里面那张脸。
        'relative block h-11 rounded-pill border-0 bg-transparent p-0',
        // 焦点描边画在看得见的身体上（outline 跟着身体的圆角走），不画在透明的点击框上。
        'focus-visible:outline-none [&:focus-visible_[data-nomi-agent-body]]:outline [&:focus-visible_[data-nomi-agent-body]]:outline-2 [&:focus-visible_[data-nomi-agent-body]]:outline-offset-2 [&:focus-visible_[data-nomi-agent-body]]:outline-nomi-ink',
        pill ? undefined : 'w-11',
        className,
      )}
      // 无障碍名带上状态（出错只有一粒点，读屏得听到「有一步没成」）。
      aria-label={title ?? label}
      title={title ?? label}
      data-agent-ball={pill ? 'pending' : status ?? 'idle'}
      data-agent-dock-status={status ?? 'idle'}
      data-agent-dock-count={pendingCount}
      data-agent-dock-unread={unreadCount}
      {...rest}
    >
      <NomiAgentFace pose={look.pose} size={BALL_SIZE} text={pill ? label : undefined} ringProps={{ 'data-agent-ball-progress': true }}>
        {look.dot === 'unread' ? <DotMark className="right-[3px] top-[4px] size-2 ring-nomi-paper motion-safe:animate-nomi-badge-settle dark:ring-nomi-bg" /> : null}
        {look.dot === 'failed' ? <span className="pointer-events-none absolute right-[3px] top-[4px] size-2 rounded-full bg-nomi-danger ring-2 ring-nomi-paper dark:ring-nomi-bg" aria-hidden="true" /> : null}
      </NomiAgentFace>
    </button>
  )
})
