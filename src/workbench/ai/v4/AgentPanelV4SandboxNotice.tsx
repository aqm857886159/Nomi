// Agent 面板 v4 · 「命令沙箱没起来」的一行微字。
//
// 它住在 composer 上沿（`composerBanner` 插槽），和档位钮同一块地方——因为它说的正是
// 「档位这一刻不算数」：没有沙箱时 `codingCommandPolicy` 的自动放行整档消失，
// 哪怕用户选的是「全自动」，命令仍然一条一条问。把这句话放在头部或设置里，
// 用户就得在「它为什么一直问我」和「我明明开了全自动」之间自己连线。
//
// 形态刻意比「全自动」那条更轻：那条是**提醒**（你正开着一个会自己动手的档），
// 这条是**交代**（这台机器少了一层保护，所以要你点头）。交代不该抢眼，
// 所以用 ink-60 微字而不是 warning 底色，也没有任何按钮——用户在这里无事可做，
// 给一颗按不出结果的钮只会更糟（§1.5 控件层级：没有动作就不要长出控件）。
import React from 'react'
import { V4Row } from './AgentPanelV4Row'

export function V4SandboxNotice({ text }: { text: string }): JSX.Element {
  return (
    <V4Row
      as="div"
      className="h-5 shrink-0 px-0.5 text-micro text-nomi-ink-60"
      data-v4-block="sandbox-notice"
    >
      <span className="size-1.5 shrink-0 rounded-pill bg-nomi-ink-20" aria-hidden="true" />
      <span className="min-w-0 truncate">{text}</span>
    </V4Row>
  )
}
