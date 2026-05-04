import React from 'react'
import { CopyButton, Group, Stack, Text, Tooltip } from '@mantine/core'
import { IconCheck, IconCopy } from '@tabler/icons-react'
import { VIDEO_REALISM_RULES, VIDEO_REALISM_PROMPT_SNIPPET } from '../../../creative/videoRealism'
import { DesignBadge, DesignButton, PanelCard } from '../../../design'

export type VideoRealismTipsProps = {
  onInsertSnippet?: (snippet: string) => void
}

export function VideoRealismTips({ onInsertSnippet }: VideoRealismTipsProps) {
  const handleInsert = React.useCallback(() => {
    if (!onInsertSnippet) return
    onInsertSnippet(VIDEO_REALISM_PROMPT_SNIPPET)
  }, [onInsertSnippet])

  return (
    <PanelCard
      className="video-realism-tips"
      style={{
        background: 'rgba(241, 245, 249, 0.85)',
        borderColor: 'rgba(59, 130, 246, 0.4)',
      }}
    >
      <Group className="video-realism-tips__header" justify="space-between" mb="xs" align="center">
        <div className="video-realism-tips__title">
          <Text className="video-realism-tips__title-text" fw={600} size="sm">
            AI 视频真实感九大法则
          </Text>
          <Text className="video-realism-tips__subtitle" size="xs" c="dimmed">
            直接应用到 composeVideo / Storyboard 提示词中，维持统一的光影与镜头语言。
          </Text>
        </div>
        <Group className="video-realism-tips__actions" gap={6}>
          <DesignButton className="video-realism-tips__insert" size="xs" variant="light" onClick={handleInsert}>
            注入模板
          </DesignButton>
          <CopyButton className="video-realism-tips__copy" value={VIDEO_REALISM_PROMPT_SNIPPET} timeout={1800}>
            {({ copied, copy }) => (
              <Tooltip className="video-realism-tips__tooltip" label={copied ? '已复制' : '复制英文模板'} withArrow>
                <DesignButton
                  className="video-realism-tips__copy-button"
                  size="xs"
                  variant="subtle"
                  leftSection={
                    copied
                      ? <IconCheck className="video-realism-tips__copy-icon" size={14} />
                      : <IconCopy className="video-realism-tips__copy-icon" size={14} />
                  }
                  onClick={copy}
                >
                  {copied ? '已复制' : '复制'}
                </DesignButton>
              </Tooltip>
            )}
          </CopyButton>
        </Group>
      </Group>
      <Stack className="video-realism-tips__list" gap={6}>
        {VIDEO_REALISM_RULES.map(rule => (
          <Group className="video-realism-tips__item" key={rule.id} align="flex-start" gap={8}>
            <DesignBadge className="video-realism-tips__badge" radius="sm" variant="light" color="blue" size="xs" style={{ flexShrink: 0 }}>
              {rule.title}
            </DesignBadge>
            <Text className="video-realism-tips__summary" size="xs" c="dimmed" style={{ lineHeight: 1.4 }}>
              {rule.summary}
            </Text>
          </Group>
        ))}
      </Stack>
    </PanelCard>
  )
}
