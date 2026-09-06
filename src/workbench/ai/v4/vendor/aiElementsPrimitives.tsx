import React from 'react'
import { cn } from '../../../../utils/cn'

/**
 * Vercel AI Elements（Apache-2.0）**Message 一族**的 React 18 / Tailwind 3 改写。
 * 解剖出处：`docs/research/2026-09-06-ai-elements-anatomy.md`。
 *
 * 只留我们真的用到的三件（Message / Response / Actions）。原本这里还平移了
 * Tool / Task / Confirmation / Plan / Queue / PromptInput / ModelSelector / Attachments 八件，
 * 但它们在 Nomi 侧的长相与 AI Elements 差得远（状态 badge 改行尾、缩略图代替文件 chip、
 * 按钮只剩确认/不要…），实际渲染的一直是 `../AgentPanelV4*.tsx` 里的 Nomi 版本。
 * 留着就是**并行版**（P1）：两份同名件描述同一个东西，改一份漏一份。
 * 那份解剖仍完整记在上面的研究文档 + `aiElementsContract.ts` 的词表里，不靠死代码存档。
 */
export function Message({ role, children }: { role: 'user' | 'assistant'; children: React.ReactNode }): JSX.Element {
  return (
    <article
      className={cn(
        'text-body-sm leading-relaxed',
        // 助手侧**无气泡、无底色**（AI Elements Message assistant）；用户侧才是深底气泡，
        // 但那一件由 V4UserBubble 自己画（它还要装 chip），这里只负责助手侧排版。
        role === 'user' ? 'ml-auto max-w-[86%] rounded-nomi bg-nomi-ink px-3 py-2 text-nomi-paper' : 'text-nomi-ink',
      )}
      data-ai-element="message"
      data-role={role}
    >
      {children}
    </article>
  )
}

export function MessageResponse({
  children,
  streaming = false,
}: {
  children: React.ReactNode
  streaming?: boolean
}): JSX.Element {
  return (
    <div
      data-ai-element="response"
      data-streaming={streaming ? 'true' : undefined}
      // 流式光标：一个方块，不是转圈（定稿 Process 板时刻 6）。
      // 它必须**贴在最后一行文字末尾**——做成兄弟节点会被 markdown 的块级 <p> 挤到下一行，
      // 看起来像「回复完了下面还有个方块」。所以用最后一段的 ::after 画。
      className={cn(
        streaming &&
          "[&_p:last-of-type]:after:ml-0.5 [&_p:last-of-type]:after:inline-block [&_p:last-of-type]:after:h-3.5 [&_p:last-of-type]:after:w-2 [&_p:last-of-type]:after:translate-y-0.5 [&_p:last-of-type]:after:rounded-sm [&_p:last-of-type]:after:bg-nomi-ink-30 [&_p:last-of-type]:after:content-['']",
      )}
    >
      {children}
    </div>
  )
}

export function MessageActions({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): JSX.Element {
  return (
    <div className={cn('mt-1 flex items-center gap-0.5 text-nomi-ink-40', className)} data-ai-element="actions">
      {children}
    </div>
  )
}
