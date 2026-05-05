import React from 'react'
import { IconCheck, IconClipboard } from '@tabler/icons-react'
import { WorkbenchIconButton } from '../../design'
import { useWorkbenchStore } from '../workbenchStore'

type AiReplyActionButtonProps = {
  className: string
  content: string
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return true
  }
  if (typeof document === 'undefined') return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  return copied
}

export function AiReplyActionButton({ className, content }: AiReplyActionButtonProps): JSX.Element | null {
  const documentTools = useWorkbenchStore((state) => state.creationDocumentTools)
  const [done, setDone] = React.useState(false)
  const text = content.trim()

  React.useEffect(() => {
    if (!done) return undefined
    const timer = window.setTimeout(() => setDone(false), 1200)
    return () => window.clearTimeout(timer)
  }, [done])

  const handleClick = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!text) return
    if (documentTools) {
      documentTools.insertAtCursor(text)
      setDone(true)
      return
    }
    void copyTextToClipboard(text).then((copied) => {
      if (copied) setDone(true)
    })
  }, [documentTools, text])

  if (!text) return null

  const label = documentTools
    ? done ? '已粘贴到文档' : '粘贴到文档'
    : done ? '已复制' : '复制回复'

  return (
    <WorkbenchIconButton
      className={`ai-reply-action ${className}`}
      label={label}
      onClick={handleClick}
      icon={done ? <IconCheck size={13} /> : <IconClipboard size={13} />}
    />
  )
}
