/**
 * 自定义厂商编辑弹窗（精简版）。
 *
 * 已接入的自定义厂商点击编辑时使用，只显示配置项，不显示向导的预设选择区。
 * 复用 OnboardingWizard 的提交逻辑（manualCommit + editVendorKey）。
 */
import React from 'react'
import { Stack, Group, Text, PasswordInput, ActionIcon, Collapse, Anchor } from '@mantine/core'
import { IconCheck, IconX, IconAlertTriangle, IconChevronDown, IconChevronRight, IconTrash, IconCloudDownload } from '@tabler/icons-react'
import { DesignButton, DesignModal, DesignTextInput, DesignSegmentedControl } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { confirmDialog, alertDialog } from '../../design'
import type { ProviderKind } from '../../desktop/providerKind'

const PROVIDER_KIND_LABEL: Record<ProviderKind, string> = {
  'openai-compatible': 'Chat Completions',
  'openai-responses': 'Responses',
  anthropic: 'Anthropic',
}
import { cn } from '../../utils/cn'
import { Field } from './onboardingWizardSupport'

type ModelKind = 'text' | 'image' | 'video' | 'audio'
const KIND_OPTIONS: Array<{ value: ModelKind; label: string }> = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '配音' },
  { value: 'text', label: '文本' },
]

type EditVendorData = {
  vendorKey: string
  vendorName: string
  baseUrl: string
  apiKey: string
  providerKind: ProviderKind
  models: Array<{ id: string; kind: ModelKind }>
  headerRows: Array<{ key: string; value: string }>
}

type CustomVendorEditModalProps = {
  opened: boolean
  onClose: () => void
  onCommitted: () => void
  editData: EditVendorData
}

export function CustomVendorEditModal({ opened, onClose, onCommitted, editData }: CustomVendorEditModalProps): JSX.Element {
  const bridge = getDesktopBridge()
  const [vendorName, setVendorName] = React.useState(editData.vendorName)
  const [baseUrl, setBaseUrl] = React.useState(editData.baseUrl)
  const [apiKey, setApiKey] = React.useState(editData.apiKey)
  const [providerKind, setProviderKind] = React.useState<ProviderKind>(editData.providerKind)
  const [models, setModels] = React.useState<Array<{ id: string; kind: ModelKind }>>(editData.models)
  const [headerRows, setHeaderRows] = React.useState<Array<{ key: string; value: string }>>(editData.headerRows)
  const [showAdvanced, setShowAdvanced] = React.useState(editData.headerRows.length > 0)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  const [testState, setTestState] = React.useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testMessage, setTestMessage] = React.useState('')
  const [fetchingModels, setFetchingModels] = React.useState(false)
  const [candidateModels, setCandidateModels] = React.useState<Array<{ id: string; kind: ModelKind }>>([])
  const [fetchMsg, setFetchMsg] = React.useState('')

  // Sync with external editData changes
  React.useEffect(() => {
    if (!opened || !editData) return
    setVendorName(editData.vendorName)
    setBaseUrl(editData.baseUrl)
    setApiKey(editData.apiKey)
    setProviderKind(editData.providerKind)
    setModels(editData.models)
    setHeaderRows(editData.headerRows)
    setShowAdvanced(editData.headerRows.length > 0)
    setError('')
  }, [editData, opened])

  const updateHeader = (index: number, patch: Partial<{ key: string; value: string }>) => {
    setHeaderRows(prev => prev.map((h, i) => (i === index ? { ...h, ...patch } : h)))
  }
  const addHeaderRow = () => {
    setHeaderRows(prev => [...prev, { key: '', value: '' }])
  }
  const removeHeaderRow = (index: number) => {
    setHeaderRows(prev => prev.filter((_, i) => i !== index))
  }
  const buildHeadersObject = (): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const h of headerRows) {
      const k = h.key.trim()
      const v = h.value.trim()
      if (k && v) out[k] = v
    }
    return out
  }

  const removeModel = (id: string) => {
    setModels(prev => prev.filter(m => m.id !== id))
  }

  const handleTestConnection = async () => {
    if (!bridge?.onboarding?.testConnection) return
    setTestState('testing')
    setTestMessage('')
    const firstModelId = models.map(m => m.id.trim()).find(Boolean)
    const res = await bridge.onboarding.testConnection({
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      modelId: firstModelId,
      providerKind,
      headers: buildHeadersObject(),
    })
    if (res.ok) {
      setTestState('ok')
      setTestMessage('连接正常')
    } else {
      setTestState('fail')
      setTestMessage(res.error ? `连不上：${res.error}` : '连不上，请检查地址 / Key')
    }
  }

  const handleFetchModels = async () => {
    if (!bridge?.onboarding?.listModels || !bridge?.onboarding?.guessKinds) return
    setFetchingModels(true)
    setFetchMsg('')
    try {
      const res = await bridge.onboarding.listModels({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        providerKind,
        headers: buildHeadersObject(),
      })
      if (res.ok && res.models && res.models.length > 0) {
        const ids = Array.from(new Set(res.models.map((s: string) => s.trim()).filter(Boolean)))
        const kinds: Record<string, string> = {}
        try {
          const guessed = await bridge.onboarding.guessKinds({ ids })
          Object.assign(kinds, guessed.kinds || {})
        } catch { /* 退回 text */ }
        const fetched = ids.map(id => ({ id, kind: (kinds[id] || 'text') as ModelKind }))
        setCandidateModels(fetched)
        // 自动合并：已有模型保留，新模型追加
        setModels(prev => {
          const existing = new Set(prev.map(m => m.id))
          const merged = [...prev]
          for (const m of fetched) {
            if (!existing.has(m.id)) merged.push(m)
          }
          return merged
        })
        setFetchMsg(`已拉取 ${fetched.length} 个模型，已自动合并到下方列表`)
      } else if (res.ok) {
        setCandidateModels([])
        setFetchMsg('这个地址没列出模型，可手动输入模型 ID')
      } else {
        setCandidateModels([])
        setFetchMsg(res.error || '拉取失败，请检查地址和 Key')
      }
    } catch (e) {
      setCandidateModels([])
      setFetchMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setFetchingModels(false)
    }
  }

  const handleSave = async () => {
    if (!bridge?.onboarding?.manualCommit) {
      setError('当前环境没有桌面端模块，无法运行。')
      return
    }
    if (!vendorName.trim()) { setError('请填写来源名称'); return }
    if (!baseUrl.trim()) { setError('请填写接入地址'); return }
    if (!apiKey.trim()) { setError('请填写 API Key'); return }
    if (models.length === 0) { setError('至少需要一个模型'); return }
    setSaving(true)
    setError('')
    try {
      const res = await bridge.onboarding.manualCommit({
        vendorName: vendorName.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        providerKind,
        headers: buildHeadersObject(),
        models: models.map(m => ({ id: m.id.trim(), kind: m.kind })),
        editVendorKey: editData.vendorKey,
      })
      if (res.ok) {
        onCommitted()
      } else {
        setError(res.error || '保存失败，请检查配置')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteVendor = async () => {
    const ok = await confirmDialog({
      title: '删除厂商',
      message: `删除「${editData.vendorName}」及其所有模型？此操作不可恢复。`,
      confirmLabel: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      bridge.modelCatalog.deleteVendor(editData.vendorKey)
      onCommitted()
    } catch (e) {
      void alertDialog({ title: '删除失败', message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <DesignModal opened={opened} onClose={onClose} title="编辑自定义厂商" size={480} centered>
      <Stack gap="md">
        <Field label="来源名称" hint="给这个上游起个名，方便区分">
          <DesignTextInput value={vendorName} onChange={e => setVendorName(e.currentTarget.value)} placeholder="如：TOAPI 中转" />
        </Field>

        <Field label="接入地址（BaseURL）" hint="中转后台那个地址，带不带 /v1 都行">
          <DesignTextInput
            value={baseUrl}
            onChange={e => { setBaseUrl(e.currentTarget.value); setError('') }}
            placeholder="https://api.openai.com/v1"
            error={baseUrl.trim().length > 0 && !/^https?:\/\//i.test(baseUrl.trim()) ? '需以 http:// 或 https:// 开头' : undefined}
          />
        </Field>

        <Field label="你的 API Key" hint="只存在你的电脑上，加密保存">
          <PasswordInput value={apiKey} onChange={e => { setApiKey(e.currentTarget.value); setError(''); setTestState('idle'); setTestMessage('') }} placeholder="sk-..." />
        </Field>

        <Group gap={8} align="center">
          <DesignButton
            variant="subtle"
            size="xs"
            onClick={handleTestConnection}
            disabled={!baseUrl.trim() || !apiKey.trim() || testState === 'testing'}
            loading={testState === 'testing'}
            leftSection={<IconCloudDownload size={14} />}
          >
            测试连接
          </DesignButton>
          {testState === 'ok' && (
            <Group gap={4} align="center" c="var(--workbench-success)" wrap="nowrap">
              <IconCheck size={14} stroke={1.5} />
              <Text size="xs" c="var(--workbench-success)">{testMessage}</Text>
            </Group>
          )}
          {testState === 'fail' && (
            <Group gap={4} align="flex-start" c="var(--workbench-danger)" wrap="nowrap">
              <IconX size={14} stroke={1.5} className="mt-0.5 shrink-0" />
              <Text size="xs" c="var(--workbench-danger)">{testMessage}</Text>
            </Group>
          )}
        </Group>

        <Field label="接口协议" hint="不确定就留给自动探测；阶跃星辰必须选 Chat Completions">
          <DesignSegmentedControl
            value={providerKind}
            onChange={v => { setProviderKind(v as ProviderKind); setError('') }}
            data={[
              { label: 'Chat Completions', value: 'openai-compatible' },
              { label: 'Responses', value: 'openai-responses' },
              { label: 'Anthropic', value: 'anthropic' },
            ]}
            fullWidth
          />
        </Field>

        <Anchor
          component="button"
          type="button"
          size="xs"
          c="var(--nomi-ink-60)"
          onClick={() => setShowAdvanced(v => !v)}
          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          {showAdvanced ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
          高级设置（自定义请求头）
        </Anchor>

        <Collapse in={showAdvanced}>
          <Stack gap={4}>
            {headerRows.length > 0 && (
              <Stack gap={6}>
                {headerRows.map((h, i) => (
                  <Group key={i} gap={6} wrap="nowrap" align="flex-start">
                    <DesignTextInput
                      value={h.key}
                      onChange={e => updateHeader(i, { key: e.currentTarget.value })}
                      placeholder="Header 名"
                      style={{ flex: 1 }}
                    />
                    <DesignTextInput
                      value={h.value}
                      onChange={e => updateHeader(i, { value: e.currentTarget.value })}
                      placeholder="值"
                      style={{ flex: 1 }}
                    />
                    <ActionIcon variant="subtle" color="gray" onClick={() => removeHeaderRow(i)} aria-label="删除请求头">
                      <IconX size={14} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            )}
            <DesignButton variant="subtle" size="xs" leftSection={<IconChevronRight size={12} />} onClick={addHeaderRow}>
              添加请求头（可选）
            </DesignButton>
          </Stack>
        </Collapse>

        {/* 拉取模型 */}
        <Group gap={8} align="center">
          <DesignButton
            variant="light"
            size="xs"
            onClick={handleFetchModels}
            disabled={fetchingModels || !baseUrl.trim() || !apiKey.trim()}
            loading={fetchingModels}
            leftSection={<IconCloudDownload size={14} />}
          >
            拉取模型
          </DesignButton>
          {fetchMsg && <Text size="xs" c={fetchMsg.includes('失败') || fetchMsg.includes('没列出') ? 'var(--nomi-ink-40)' : 'var(--workbench-success)'}>{fetchMsg}</Text>}
        </Group>

        {/* 模型列表（可逐条删除 / 改类型，拉取的新模型自动合并进来） */}
        <Stack gap={6}>
          <Text size="sm" c="var(--nomi-ink)" fw={500}>已接入模型</Text>
          {models.length === 0 && (
            <Text size="xs" c="var(--nomi-ink-40)">暂无模型，保存时需至少保留一个</Text>
          )}
          {models.map(m => (
            <Group key={m.id} gap={8} wrap="nowrap" align="center" justify="space-between">
              <Text size="sm" c="var(--nomi-ink)" style={{ fontFamily: 'var(--nomi-font-mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.id}
              </Text>
              <Group gap={4} wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
                <select
                  value={m.kind}
                  onChange={e => {
                    const v = e.currentTarget.value
                    if (v === 'text' || v === 'image' || v === 'video' || v === 'audio') {
                      setModels(prev => prev.map(x => x.id === m.id ? { ...x, kind: v } : x))
                    }
                  }}
                  className="h-7 px-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-body-sm text-nomi-ink"
                >
                  {KIND_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => removeModel(m.id)} aria-label={`移除 ${m.id}`}>
                  <IconX size={14} />
                </ActionIcon>
              </Group>
            </Group>
          ))}
        </Stack>

        {error && (
          <div className="border border-workbench-danger/30 bg-workbench-danger/5 rounded-nomi p-2.5">
            <Group gap={4} align="flex-start" mb={error.length > 80 ? 4 : undefined}>
              <IconAlertTriangle size={14} className="mt-0.5 shrink-0" c="var(--workbench-danger)" />
              <Text size="xs" c="var(--workbench-danger)" fw={500}>连接测试失败</Text>
            </Group>
            <textarea
              readOnly
              value={error}
              className="w-full bg-nomi-paper border border-nomi-line rounded-nomi-sm px-2.5 py-2 text-caption text-nomi-ink-80 resize-y"
              style={{ minHeight: 60, maxHeight: 200 }}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            />
            <Text size="xs" c="var(--nomi-ink-30)" mt={2}>点击上方内容可全选复制</Text>
          </div>
        )}

        <Group justify="space-between" align="center" mt={4}>
          <DesignButton variant="subtle" c="workbench-danger" onClick={handleDeleteVendor}>
            删除厂商
          </DesignButton>
          <Group gap={8}>
            <DesignButton variant="subtle" onClick={onClose}>取消</DesignButton>
            <DesignButton variant="filled" onClick={handleSave} loading={saving} disabled={models.length === 0}>
              保存修改
            </DesignButton>
          </Group>
        </Group>
      </Stack>
    </DesignModal>
  )
}
