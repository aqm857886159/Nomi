import React from 'react'
import { Divider, Group, Stack, Text, Tooltip } from '@mantine/core'
import { IconEye, IconEyeOff, IconPlayerPlay, IconRefresh, IconTrash } from '@tabler/icons-react'
import { toast } from '../../toast'
import {
  DesignBadge,
  DesignButton,
  DesignSelect,
  type DesignSelectProps,
  DesignSwitch,
  DesignTextInput,
  DesignTextarea,
  IconActionButton,
  PanelCard,
} from '../../../design'

export type PublicApiDebuggerEndpoints = {
  chat: string
  draw: string
  vision: string
  video: string
  taskResult: string
}

type DebugEndpointKind = keyof PublicApiDebuggerEndpoints

const API_KEY_STORAGE_KEY = 'tapcanvas_public_api_debug_key'

function readStoredApiKey(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.sessionStorage.getItem(API_KEY_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function writeStoredApiKey(next: string) {
  if (typeof window === 'undefined') return
  try {
    if (next) window.sessionStorage.setItem(API_KEY_STORAGE_KEY, next)
    else window.sessionStorage.removeItem(API_KEY_STORAGE_KEY)
  } catch {
    // ignore
  }
}

function templateFor(kind: DebugEndpointKind): unknown {
  if (kind === 'draw') {
    return {
      vendor: 'auto',
      prompt: '一个赛博风格的透明玻璃徽章，中文“Nomi”，高细节，干净背景',
      extras: { modelAlias: 'nano-banana-pro', aspectRatio: '1:1' },
    }
  }
  if (kind === 'vision') {
    return {
      vendor: 'auto',
      imageUrl: 'https://github.com/dianping/cat/raw/master/cat-home/src/main/webapp/images/logo/cat_logo03.png',
      prompt:
        '请详细分析我提供的图片，推测可用于复现它的英文提示词，包含主体、环境、镜头、光线和风格。输出必须是纯英文提示词，不要添加中文备注或翻译。',
      modelAlias: 'gemini-1.5-pro-latest',
      temperature: 0.2,
    }
  }
  if (kind === 'video') {
    return {
      vendor: 'auto',
      prompt: '一只白猫在雨夜霓虹街头慢慢走过，电影感镜头，稳定光影',
      durationSeconds: 10,
      extras: { modelAlias: '<YOUR_VIDEO_MODEL_ALIAS>' },
    }
  }
  if (kind === 'taskResult') {
    return {
      taskId: '<TASK_ID>',
      taskKind: 'text_to_video',
    }
  }
  return {
    vendor: 'auto',
    prompt: '你好，帮我用中文回答：Nomi 是什么？',
  }
}

function prettyJson(text: string): string {
  const raw = String(text || '')
  if (!raw.trim()) return raw
  try {
    const parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

function extractErrorHint(text: string): string {
  const raw = String(text || '').trim()
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as unknown
    const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as { message?: unknown; error?: unknown; code?: unknown } : null
    const msg = record && typeof record.message === 'string' ? record.message : record && typeof record.error === 'string' ? record.error : ''
    const code = record && typeof record.code === 'string' ? record.code : ''
    const joined = [msg, code ? `(${code})` : ''].filter(Boolean).join(' ')
    return joined || raw.slice(0, 200)
  } catch {
    return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw
  }
}

export default function StatsPublicApiDebugger({
  className,
  endpoints,
}: {
  className?: string
  endpoints: PublicApiDebuggerEndpoints
}): JSX.Element {
  const rootClassName = ['stats-public-debugger', className].filter(Boolean).join(' ')

  const [enabled, setEnabled] = React.useState(false)
  const [apiKey, setApiKey] = React.useState(() => readStoredApiKey())
  const [apiKeyVisible, setApiKeyVisible] = React.useState(false)
  const [endpointKind, setEndpointKind] = React.useState<DebugEndpointKind>('draw')
  const [bodyByKind, setBodyByKind] = React.useState<Record<DebugEndpointKind, string>>(() => ({
    draw: JSON.stringify(templateFor('draw'), null, 2),
    vision: JSON.stringify(templateFor('vision'), null, 2),
    video: JSON.stringify(templateFor('video'), null, 2),
    taskResult: JSON.stringify(templateFor('taskResult'), null, 2),
    chat: JSON.stringify(templateFor('chat'), null, 2),
  }))
  const [loading, setLoading] = React.useState(false)
  const [responseText, setResponseText] = React.useState<string>('')
  const [responseMeta, setResponseMeta] = React.useState<{ status: number; ok: boolean; tookMs: number } | null>(null)

  React.useEffect(() => {
    writeStoredApiKey(apiKey.trim())
  }, [apiKey])

  const endpointOptions = React.useMemo<DesignSelectProps['data']>(
    () => [
      { value: 'draw', label: '绘图 /public/draw' },
      { value: 'vision', label: '图像理解 /public/vision' },
      { value: 'video', label: '视频 /public/video' },
      { value: 'taskResult', label: '查任务 /public/tasks/result' },
      { value: 'chat', label: '文本 /public/agents/chat' },
    ],
    [],
  )

  const currentUrl = endpoints[endpointKind]
  const bodyText = bodyByKind[endpointKind]

  const resetTemplate = React.useCallback(() => {
    setBodyByKind((prev) => ({
      ...prev,
      [endpointKind]: JSON.stringify(templateFor(endpointKind), null, 2),
    }))
    toast('已重置模板', 'success')
  }, [endpointKind])

  const clearKey = React.useCallback(() => {
    setApiKey('')
    toast('已清除 Key', 'success')
  }, [])

  const send = React.useCallback(async () => {
    const key = apiKey.trim()
    if (!key) {
      toast('请先填写 X-API-Key', 'error')
      return
    }
    let body: unknown
    try {
      body = JSON.parse(bodyText)
    } catch {
      toast('请求体不是合法 JSON', 'error')
      return
    }

    setLoading(true)
    setResponseText('')
    setResponseMeta(null)
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    try {
      const res = await fetch(currentUrl, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': key,
        },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      const tookMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt)
      setResponseMeta({ status: res.status, ok: res.ok, tookMs })
      setResponseText(prettyJson(text))
      if (!res.ok) {
        const hint = extractErrorHint(text)
        toast(`请求失败：${res.status}${hint ? ` - ${hint}` : ''}`, 'error')
      }
    } catch (err: unknown) {
      const tookMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt)
      setResponseMeta({ status: 0, ok: false, tookMs })
      const message = err instanceof Error && err.message.trim() ? err.message : 'request failed'
      setResponseText(message)
      toast(message === 'request failed' ? '请求失败（网络或 CORS）' : message, 'error')
    } finally {
      setLoading(false)
    }
  }, [apiKey, bodyText, currentUrl])

  return (
    <PanelCard className={rootClassName}>
      <Group className="stats-public-debugger-header" justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group className="stats-public-debugger-header-left" gap={8} align="center">
          <Text className="stats-public-debugger-title" fw={700} size="sm">
            在线调试
          </Text>
          <DesignBadge className="stats-public-debugger-badge" size="xs" variant="light">
            x-api-key
          </DesignBadge>
        </Group>
        <DesignSwitch
          className="stats-public-debugger-enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.currentTarget.checked)}
          label="开启"
        />
      </Group>

      <Divider className="stats-public-debugger-divider" my="sm" />

      {!enabled ? (
        <Text className="stats-public-debugger-hint" size="sm" c="dimmed">
          打开开关后可直接在页面内携带 Key 调试 /public 接口；Key 会保存在当前标签页的 sessionStorage，并作为请求头发送。
        </Text>
      ) : (
        <Stack className="stats-public-debugger-body" gap="sm">
          <Group className="stats-public-debugger-key-row" gap="sm" align="flex-end" wrap="wrap">
            <DesignTextInput
              className="stats-public-debugger-key"
              label="X-API-Key"
              placeholder="粘贴你的 key…"
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
              type={apiKeyVisible ? 'text' : 'password'}
              w={420}
              rightSection={
                <Tooltip className="stats-public-debugger-key-visibility-tooltip" label={apiKeyVisible ? '隐藏' : '显示'} withArrow>
                  <IconActionButton
                    className="stats-public-debugger-key-visibility"
                    size="sm"
                    variant="subtle"
                    aria-label="toggle-key-visibility"
                    onClick={() => setApiKeyVisible((v) => !v)}
                    icon={apiKeyVisible ? <IconEyeOff className="stats-public-debugger-key-visibility-icon" size={16} /> : <IconEye className="stats-public-debugger-key-visibility-icon" size={16} />}
                  />
                </Tooltip>
              }
            />

            <Tooltip className="stats-public-debugger-key-clear-tooltip" label="清除 Key" withArrow>
              <IconActionButton
                className="stats-public-debugger-key-clear"
                size="md"
                variant="light"
                aria-label="clear-key"
                onClick={clearKey}
                disabled={!apiKey}
                icon={<IconTrash className="stats-public-debugger-key-clear-icon" size={16} />}
              />
            </Tooltip>
          </Group>

          <Group className="stats-public-debugger-endpoint-row" gap="sm" align="flex-end" wrap="wrap">
            <DesignSelect
              className="stats-public-debugger-endpoint"
              label="接口"
              data={endpointOptions}
              value={endpointKind}
              onChange={(v) => {
                const next = (v as DebugEndpointKind) || 'draw'
                setEndpointKind(next)
              }}
              w={260}
            />
            <Stack className="stats-public-debugger-endpoint-meta" gap={2}>
              <Text className="stats-public-debugger-endpoint-label" size="xs" c="dimmed">
                URL
              </Text>
              <Text className="stats-public-debugger-endpoint-url" size="sm" style={{ wordBreak: 'break-all' }}>
                {currentUrl}
              </Text>
            </Stack>
          </Group>

          <DesignTextarea
            className="stats-public-debugger-request"
            label="请求 JSON"
            value={bodyText}
            onChange={(e) => {
              const next = e.currentTarget.value
              setBodyByKind((prev) => ({ ...prev, [endpointKind]: next }))
            }}
            minRows={8}
            autosize
            styles={{ input: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' } }}
          />

          <Group className="stats-public-debugger-actions" gap={8} justify="flex-start" wrap="wrap">
            <DesignButton
              className="stats-public-debugger-send"
              size="sm"
              variant="light"
              onClick={() => void send()}
              loading={loading}
              leftSection={<IconPlayerPlay className="stats-public-debugger-send-icon" size={14} />}
            >
              发送请求
            </DesignButton>
            <DesignButton
              className="stats-public-debugger-reset"
              size="sm"
              variant="subtle"
              onClick={resetTemplate}
              leftSection={<IconRefresh className="stats-public-debugger-reset-icon" size={14} />}
              disabled={loading}
            >
              重置模板
            </DesignButton>
          </Group>

          <Stack className="stats-public-debugger-response" gap={6}>
            <Group className="stats-public-debugger-response-header" justify="space-between" align="center" wrap="wrap">
              <Text className="stats-public-debugger-response-title" size="sm" fw={700}>
                响应
              </Text>
              {responseMeta && (
                <Group className="stats-public-debugger-response-meta" gap={10} wrap="wrap">
                  <DesignBadge className="stats-public-debugger-response-status" size="sm" variant="light" color={responseMeta.ok ? 'green' : 'red'}>
                    {responseMeta.status || 'ERR'}
                  </DesignBadge>
                  <Text className="stats-public-debugger-response-timing" size="xs" c="dimmed">
                    {responseMeta.tookMs}ms
                  </Text>
                </Group>
              )}
            </Group>
            <pre
              className="stats-public-debugger-response-pre"
              style={{ margin: 0, padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.18)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              <code className="stats-public-debugger-response-code">{responseText || (loading ? '请求中…' : '—')}</code>
            </pre>
          </Stack>
        </Stack>
      )}
    </PanelCard>
  )
}
