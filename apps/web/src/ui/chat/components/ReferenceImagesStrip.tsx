import React from 'react'
import { Group } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { IconActionButton } from '../../../design'
import { $ } from '../../../shared/i18n'

export default function ReferenceImagesStrip({
  urls,
  onClear,
  disabled,
  className,
}: {
  urls: string[]
  onClear: () => void
  disabled?: boolean
  className?: string
}): JSX.Element | null {
  if (!urls.length) return null

  const refsClassName = ['tc-ai-chat__refs', className].filter(Boolean).join(' ')

  return (
    <Group className={refsClassName} gap={8} mt={8} align="center" wrap="wrap">
      {urls.map((url, idx) => (
        <div key={url} className="tc-ai-chat__ref">
          <button
            type="button"
            className="tc-ai-chat__ref-button"
            aria-label={`参考图-${idx + 1}`}
            onClick={() => {
              try {
                window.open(url, '_blank', 'noopener,noreferrer')
              } catch {
                // ignore
              }
            }}
            disabled={disabled}
          >
            <img className="tc-ai-chat__ref-thumb" src={url} alt={`参考图-${idx + 1}`} loading="lazy" />
          </button>
        </div>
      ))}

      <IconActionButton
        className="tc-ai-chat__refs-clear"
        size={42}
        radius="xs"
        variant="subtle"
        icon={<IconTrash className="tc-ai-chat__refs-clear-icon" size={14} />}
        aria-label={$('清空参考图')}
        onClick={onClear}
        disabled={disabled}
      />
    </Group>
  )
}
