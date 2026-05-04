import React from 'react'
import { Paper, Text } from '@mantine/core'
import { formatErrorMessage } from '../../../utils/formatErrorMessage'

function resolveTaskErrorDisplay(_error: { status?: number; message: string }, fallback: string): string {
  return fallback
}

type StatusBannerProps = {
  status: string
  lastError?: unknown
  httpStatus?: number | null
}

export function StatusBanner({ status, lastError, httpStatus }: StatusBannerProps) {
  const message = formatErrorMessage(lastError).trim()
  if (!(status === 'error' && message)) return null
  const display = resolveTaskErrorDisplay({ status: httpStatus ?? undefined, message }, message)
  return (
    <Paper
      className="task-node-status-banner"
      radius="md"
      p="xs"
      mb="xs"
      style={{
        background: 'rgba(239,68,68,0.1)',
        borderColor: 'rgba(239,68,68,0.3)',
        border: 'none',
      }}
    >
      <Text className="task-node-status-banner__title" size="xs" c="red.4" style={{ fontWeight: 500 }}>
        执行错误
      </Text>
      <Text className="task-node-status-banner__message" size="xs" c="red.3" mt={4} style={{ wordBreak: 'break-word' }}>
        {message}
      </Text>
      {display.isQuotaLike429 ? (
        <Text className="task-node-status-banner__hint" size="xs" c="red.3" mt={4}>
          💡 提示：API 配额已用尽，请稍后重试或升级您的服务计划
        </Text>
      ) : null}
    </Paper>
  )
}
