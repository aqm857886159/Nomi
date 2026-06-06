/**
 * Onboarding Wizard — Apple-style minimal "add a model".
 *
 * User pastes a docs URL + their API key. The agent reads the docs,
 * extracts parameters with evidence, tests one real call, and persists
 * a verified-working catalog entry. UI never surfaces internal terms
 * like "vendor / mapping / endpoint" — those are implementation details
 * (per Design.md "no decorative complexity").
 *
 * Backed by:
 *   nomiDesktop.onboarding.start  → kicks off main-process agent loop
 *   nomiDesktop.onboarding.onEvent(trialId, cb) → streams milestones
 *
 * Auto-commits to catalog on success (the IPC handler does it).
 */
import React from 'react'
import { Stack, Group, Text, PasswordInput, ActionIcon, Anchor, TagsInput } from '@mantine/core'
import { IconPlus, IconTrash, IconCheck, IconX } from '@tabler/icons-react'
import { DesignButton, DesignModal, DesignTextInput, DesignSegmentedControl } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { ProviderKind } from '../../desktop/providerKind'
import { PROVIDER_PRESETS } from './providerPresets'
import { cn } from '../../utils/cn'

// 接口协议的人类标签——探测成功后告诉用户「用的是 X 协议」，专家覆盖时也用它。
const PROVIDER_KIND_LABEL: Record<ProviderKind, string> = {
  'openai-compatible': 'Chat Completions',
  'openai-responses': 'Responses',
  anthropic: 'Anthropic',
}

type Phase = 'input' | 'running' | 'success' | 'error'

type Milestone = {
  id: 'read' | 'kind' | 'identity' | 'fields' | 'test' | 'commit'
  label: string
  status: 'pending' | 'active' | 'done' | 'failed'
}

const INITIAL_MILESTONES: Milestone[] = [
  { id: 'read', label: '读取文档内容', status: 'pending' },
  { id: 'kind', label: '识别类型', status: 'pending' },
  { id: 'identity', label: '识别接口和认证方式', status: 'pending' },
  { id: 'fields', label: '提取参数', status: 'pending' },
  { id: 'test', label: '测试调用', status: 'pending' },
  { id: 'commit', label: '保存到模型库', status: 'pending' },
]

const MILESTONE_BY_TOOL: Record<string, Milestone['id']> = {
  fetch_raw_docs: 'read',
  set_model_kind: 'kind',
  set_vendor_info: 'identity',
  set_fields: 'fields',
  add_field_with_evidence: 'fields',
  set_mapping_request: 'identity',
  set_mapping_response: 'identity',
  execute_test_curl: 'test',
  commit_model: 'commit',
  check_completeness: 'fields',
}

export function OnboardingWizard({ opened, onClose, onCommitted }: {
  opened: boolean
  onClose: () => void
  /** Called once a model is committed to the catalog. */
  onCommitted?: (model: unknown) => void
}): JSX.Element {
  const bridge = getDesktopBridge()
  const [phase, setPhase] = React.useState<Phase>('input')
  // input has two branches: 'manual' is the primary path (BaseURL + key + models,
  // breaks the bootstrap deadlock, works for local/text models); 'docs' is the
  // secondary path (AI reads docs) for image/video models with non-standard APIs.
  const [inputMode, setInputMode] = React.useState<'manual' | 'docs'>('manual')
  // Whether the catalog already has a text model. Drives the adaptive default:
  // none → open on "add text model" (manual); has one → open on "add image/video"
  // (docs). Also gates the image/video entry, which needs a text model to read docs.
  const [hasTextModel, setHasTextModel] = React.useState(false)
  const [docsUrl, setDocsUrl] = React.useState('')
  const [userApiKey, setUserApiKey] = React.useState('')
  // manual-form state
  const [vendorName, setVendorName] = React.useState('')
  // Selected provider preset ('' = none yet). Drives auto-fill + whether to show
  // the 接口类型 toggle (only for custom/none — named presets imply their type).
  const [presetId, setPresetId] = React.useState('')
  // When a named preset auto-fills BaseURL, we hide that field (correct value,
  // jargon-y for non-coders). This flag reveals it for the rare custom-gateway case.
  const [editBaseUrl, setEditBaseUrl] = React.useState(false)
  // 接口协议（wire protocol）。默认让主进程 auto-probe 替用户判断（P4）：用户不必懂
  // chat/responses/anthropic 的区别。这个 state 存「当前解析出的协议」——预设内置值 /
  // hostname 猜测 / 探测结果 / 专家手选，任一来源。
  const [providerKind, setProviderKind] = React.useState<ProviderKind>('openai-compatible')
  // 专家是否手动锁定了协议。true → 测试时按它强制走（autoProbe 关），且 BaseURL 输入不再
  // 用 hostname 自动覆盖（解决「自动探测 vs 手选打架」）。
  const [kindForced, setKindForced] = React.useState(false)
  // 「接口协议」覆盖区是否展开。默认收起（auto-probe 兜底）；专家点开、或测试失败时自动展开（逃生口）。
  const [showKindOverride, setShowKindOverride] = React.useState(false)
  const [baseUrl, setBaseUrl] = React.useState('')
  // Model ids only (display name dropped — it defaulted to the id, nobody filled it).
  // Entered via TagsInput: type+enter for any endpoint, or pick from auto-fetched list.
  const [models, setModels] = React.useState<string[]>([])
  // Auto-fetched model ids (GET /models) used as TagsInput autocomplete suggestions.
  const [fetchedModels, setFetchedModels] = React.useState<string[]>([])
  const [fetchingModels, setFetchingModels] = React.useState(false)
  const [fetchModelsMsg, setFetchModelsMsg] = React.useState('')
  // Custom request headers (key/value) for relay/proxy gateways. Empty by default
  // so the common case stays clean; the "添加请求头" button reveals a row on demand.
  const [headerRows, setHeaderRows] = React.useState<Array<{ key: string; value: string }>>([])
  const [saving, setSaving] = React.useState(false)
  const [testState, setTestState] = React.useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testMessage, setTestMessage] = React.useState('')
  const [milestones, setMilestones] = React.useState<Milestone[]>(INITIAL_MILESTONES)
  const [activeMessage, setActiveMessage] = React.useState('正在阅读文档…')
  const [fieldsCount, setFieldsCount] = React.useState(0)
  const [detectedKind, setDetectedKind] = React.useState<string | null>(null)
  const [resultLabel, setResultLabel] = React.useState('')
  const [errorReason, setErrorReason] = React.useState('')
  const [errorHint, setErrorHint] = React.useState('')
  const [traceJson, setTraceJson] = React.useState<unknown>(null)
  const trialIdRef = React.useRef<string | null>(null)
  const unsubRef = React.useRef<(() => void) | null>(null)

  // Clean up event subscription on unmount.
  React.useEffect(() => {
    return () => {
      unsubRef.current?.()
      unsubRef.current = null
      trialIdRef.current = null
    }
  }, [])

  // On open, pick the smart default: if a text model already exists, start on the
  // image/video flow; otherwise start on adding a text model (and disable the
  // image/video entry, which can't run without a text model to read docs).
  React.useEffect(() => {
    if (!opened) return
    let textCount = 0
    try {
      const list = bridge?.modelCatalog?.listModels?.({ kind: 'text' }) as unknown[] | undefined
      textCount = Array.isArray(list) ? list.length : 0
    } catch { /* catalog unavailable → treat as none */ }
    setHasTextModel(textCount > 0)
    setInputMode(textCount > 0 ? 'docs' : 'manual')
  }, [opened, bridge])

  const resetToInput = React.useCallback(() => {
    setPhase('input')
    setMilestones(INITIAL_MILESTONES)
    setFieldsCount(0)
    setDetectedKind(null)
    setResultLabel('')
    setErrorReason('')
    setErrorHint('')
    setTraceJson(null)
    // Keep credentials (vendorName/baseUrl/userApiKey) so "再添加一个" under the
    // same endpoint is one step; only clear the per-add model picks + test result.
    setModels([])
    setTestState('idle')
    setTestMessage('')
  }, [])

  const updateHeader = React.useCallback((index: number, patch: Partial<{ key: string; value: string }>) => {
    setHeaderRows(prev => prev.map((h, i) => (i === index ? { ...h, ...patch } : h)))
    setTestState('idle')
  }, [])
  const addHeaderRow = React.useCallback(() => {
    setHeaderRows(prev => [...prev, { key: '', value: '' }])
  }, [])
  const removeHeaderRow = React.useCallback((index: number) => {
    setHeaderRows(prev => prev.filter((_, i) => i !== index))
    setTestState('idle')
  }, [])
  // Collapse the header rows into a clean {key: value} map (dropping blanks).
  const buildHeadersObject = React.useCallback((): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const h of headerRows) {
      const k = h.key.trim()
      const v = h.value.trim()
      if (k && v) out[k] = v
    }
    return out
  }, [headerRows])

  const handlePickPreset = React.useCallback((id: string) => {
    const preset = PROVIDER_PRESETS.find(p => p.id === id)
    if (!preset) return
    setPresetId(id)
    setProviderKind(preset.providerKind)
    setBaseUrl(preset.baseUrl)
    setVendorName(preset.custom ? '' : preset.label)
    setEditBaseUrl(false)
    // 切预设 = 重置协议判断：具名预设内置了正确协议（视为已锁定，不再 auto-probe 覆盖）；
    // 自定义/中转站则交回 auto-probe（kindForced=false），覆盖区收起。
    setKindForced(!preset.custom)
    setShowKindOverride(false)
    // Endpoint changed → previously fetched models / test result no longer apply.
    setFetchedModels([])
    setFetchModelsMsg('')
    setTestState('idle')
  }, [])

  const handleFetchModels = React.useCallback(async () => {
    if (!bridge?.onboarding?.listModels) return
    setFetchingModels(true)
    setFetchModelsMsg('')
    try {
      const res = await bridge.onboarding.listModels({
        baseUrl: baseUrl.trim(),
        apiKey: userApiKey.trim(),
        providerKind,
        headers: buildHeadersObject(),
      })
      if (res.ok && res.models && res.models.length > 0) {
        setFetchedModels(res.models)
        setFetchModelsMsg(`找到 ${res.models.length} 个，点下方输入框选择`)
      } else if (res.ok) {
        setFetchedModels([])
        setFetchModelsMsg('这个地址没返回模型列表，手填 id 即可')
      } else {
        setFetchedModels([])
        setFetchModelsMsg('拉取不到，手填 id 即可')
      }
    } finally {
      setFetchingModels(false)
    }
  }, [bridge, baseUrl, userApiKey, providerKind, buildHeadersObject])

  const handleTestConnection = React.useCallback(async () => {
    if (!bridge?.onboarding?.testConnection) return
    setTestState('testing')
    setTestMessage('')
    const firstModelId = models.map(m => m.trim()).find(Boolean)
    const res = await bridge.onboarding.testConnection({
      baseUrl: baseUrl.trim(),
      apiKey: userApiKey.trim(),
      modelId: firstModelId,
      // 专家锁定 → 强制走该协议；否则交主进程 auto-probe（chat↔responses，anthropic 按 hostname）。
      ...(kindForced ? { providerKind } : { autoProbe: true }),
      headers: buildHeadersObject(),
    })
    if (res.ok) {
      // 探测出的协议存回 state → 保存时就用它；并显式告诉用户「替你选对了哪个」。
      if (res.detectedKind) setProviderKind(res.detectedKind)
      setTestState('ok')
      setTestMessage(res.detectedKind ? `已连上 · 用的是 ${PROVIDER_KIND_LABEL[res.detectedKind]} 协议` : '连接正常')
    } else {
      setTestState('fail')
      // 失败指路（设计/真实用户评审）：把「可能是协议不对，手动指定」摆出来，并展开覆盖区当逃生口。
      setShowKindOverride(true)
      setTestMessage(res.error
        ? `连不上：${res.error}。可在下方「接口协议」手动指定再试`
        : '连不上。可在下方「接口协议」手动指定，或检查地址 / Key')
    }
  }, [bridge, baseUrl, userApiKey, models, providerKind, kindForced, buildHeadersObject])

  const handleManualSave = React.useCallback(async () => {
    if (!bridge?.onboarding?.manualCommit) {
      setErrorReason('当前环境没有桌面端模块，无法运行。')
      setPhase('error')
      return
    }
    const cleanModels = models
      .map(m => ({ id: m.trim() }))
      .filter(m => m.id.length > 0)
    if (cleanModels.length === 0) return
    setSaving(true)
    try {
      const res = await bridge.onboarding.manualCommit({
        vendorName: vendorName.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: userApiKey.trim(),
        providerKind,
        headers: buildHeadersObject(),
        models: cleanModels,
      })
      if (res.ok) {
        const n = res.committed?.length ?? cleanModels.length
        setResultLabel(n === 1 ? (res.committed?.[0]?.displayName || cleanModels[0].id) : `${n} 个模型`)
        setPhase('success')
        if (res.committed) onCommitted?.(res.committed)
      } else {
        setErrorReason('没能保存')
        setErrorHint(res.error || '请检查接入地址和 API Key')
        setPhase('error')
      }
    } finally {
      setSaving(false)
    }
  }, [bridge, vendorName, baseUrl, userApiKey, models, providerKind, buildHeadersObject, onCommitted])

  const handleStart = React.useCallback(async () => {
    if (!bridge?.onboarding) {
      setErrorReason('当前环境没有桌面端模块，无法运行。')
      setPhase('error')
      return
    }
    if (!docsUrl.trim() || !userApiKey.trim()) return
    setPhase('running')
    setMilestones(prev => prev.map(m => m.id === 'read' ? { ...m, status: 'active' } : m))
    setActiveMessage('正在阅读文档…')
    try {
      const { trialId } = await bridge.onboarding.start({ docsUrl: docsUrl.trim(), userApiKey: userApiKey.trim() })
      trialIdRef.current = trialId
      unsubRef.current = bridge.onboarding.onEvent(trialId, ev => handleEvent(ev))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Most common cause: no text model configured to read the docs.
      const isAgentMissing = /Onboarding agent not configured/.test(msg)
      setErrorReason(isAgentMissing ? '还没有配置用来阅读文档的 AI' : '没能启动')
      setErrorHint(isAgentMissing
        ? '请先在「模型设置」里添加一个文本模型（如 GPT、Kimi），它会负责读文档。'
        : msg)
      setPhase('error')
    }
  }, [bridge, docsUrl, userApiKey])

  const handleEvent = React.useCallback((raw: unknown) => {
    const ev = raw as { type: string; [k: string]: unknown }
    if (ev.type === 'tool-call' && typeof ev.toolName === 'string') {
      const milestoneId = MILESTONE_BY_TOOL[ev.toolName]
      if (milestoneId) {
        setMilestones(prev => bumpToActive(prev, milestoneId))
        setActiveMessage(activeMessageFor(milestoneId))
      }
    }
    if (ev.type === 'tool-result' && typeof ev.toolName === 'string') {
      const milestoneId = MILESTONE_BY_TOOL[ev.toolName]
      const result = ev.result as { ok?: boolean; value?: Record<string, unknown> } | undefined
      const ok = result?.ok !== false
      if (milestoneId) {
        setMilestones(prev => markStatus(prev, milestoneId, ok ? 'done' : 'failed'))
      }
      // Side-effects: pick up field count, detected kind from set_fields/set_model_kind results.
      if (ev.toolName === 'set_fields' && ok) {
        const total = Number(result?.value?.totalFields || 0)
        setFieldsCount(total)
      }
      if (ev.toolName === 'set_model_kind' && ok) {
        const kind = result?.value?.kind
        if (typeof kind === 'string') setDetectedKind(kind)
      }
    }
    if (ev.type === 'trial-end') {
      const outcome = (ev as { outcome?: { status?: string; failureReason?: string; draft?: { modelDisplayName?: string; targetKind?: string } } }).outcome
      if (outcome?.draft?.targetKind) setDetectedKind(outcome.draft.targetKind)
      if (outcome?.status === 'success') {
        setResultLabel(outcome.draft?.modelDisplayName || '新模型')
      }
    }
    if (ev.type === 'result') {
      const data = ev as { outcome?: { status?: string; failureReason?: string; draft?: { modelDisplayName?: string } }; committedModel?: unknown }
      if (data.outcome?.status === 'success') {
        setMilestones(prev => markStatus(prev, 'commit', 'done'))
        setResultLabel(data.outcome.draft?.modelDisplayName || resultLabel || '新模型')
        setPhase('success')
        if (data.committedModel) onCommitted?.(data.committedModel)
      } else {
        setErrorReason(failureLabelFor(data.outcome?.failureReason))
        setErrorHint(humanHintFor(data.outcome?.failureReason))
        setTraceJson(data.outcome)
        setPhase('error')
      }
    }
    if (ev.type === 'error') {
      const msg = (ev as { message?: string }).message || '出了点问题'
      setErrorReason('运行过程中出错')
      setErrorHint(msg)
      setPhase('error')
    }
  }, [onCommitted, resultLabel])

  const handleCopyLog = React.useCallback(async () => {
    if (!traceJson) return
    try { await navigator.clipboard.writeText(JSON.stringify(traceJson, null, 2)) } catch { /* ignore */ }
  }, [traceJson])

  const canStart = docsUrl.trim().length > 0 && userApiKey.trim().length > 0 && phase === 'input'
  // Anthropic has a hosted default, so a blank BaseURL is allowed there (we fill in
  // the official host); an OpenAI-compatible endpoint must be supplied.
  const baseUrlTrimmed = baseUrl.trim()
  const baseUrlValid = providerKind === 'anthropic'
    ? (baseUrlTrimmed === '' || /^https?:\/\//i.test(baseUrlTrimmed))
    : /^https?:\/\//i.test(baseUrlTrimmed)
  const canTest = baseUrlValid && (providerKind === 'anthropic' || baseUrlTrimmed.length > 0)
  const hasModelId = models.some(m => m.trim().length > 0)
  const canSaveManual = baseUrlValid && userApiKey.trim().length > 0 && hasModelId && !saving
  const selectedPreset = PROVIDER_PRESETS.find(p => p.id === presetId)
  const isNamedPreset = Boolean(selectedPreset && !selectedPreset.custom)
  // Named preset already filled a correct BaseURL → hide the jargon-y field unless
  // the user explicitly wants to point at a custom gateway.
  const showBaseUrlField = !isNamedPreset || editBaseUrl

  return (
    <DesignModal
      opened={opened}
      onClose={onClose}
      title="添加一个 AI 模型"
      size={480}
      centered
      closeOnClickOutside={phase !== 'running'}
      closeOnEscape={phase !== 'running'}
    >
      <Stack gap="md">
        {phase === 'input' && (
          <Stack gap={12}>
            {/* 两个入口都可见、可一键切；系统只「猜默认」。无文本模型时图片/视频置灰（读文档需先有文本模型）。 */}
            <Group gap={10} align="center">
              <button
                type="button"
                onClick={() => setInputMode('manual')}
                className={cn('text-[14px] transition-colors duration-150',
                  inputMode === 'manual' ? 'font-semibold text-nomi-ink' : 'text-nomi-ink-60 hover:text-nomi-ink')}
              >
                文本模型
              </button>
              <span className="text-nomi-ink-20">·</span>
              <button
                type="button"
                disabled={!hasTextModel}
                onClick={() => { if (hasTextModel) setInputMode('docs') }}
                title={hasTextModel ? undefined : '需先添加一个文本模型来读文档'}
                className={cn('text-[14px] transition-colors duration-150',
                  !hasTextModel ? 'text-nomi-ink-40 cursor-not-allowed'
                    : inputMode === 'docs' ? 'font-semibold text-nomi-ink' : 'text-nomi-ink-60 hover:text-nomi-ink')}
              >
                图片 / 视频模型
              </button>
            </Group>

            {inputMode === 'manual' && (
              <>
            <Field label="供应商" hint="选一个自动填地址；中转站选「自定义」粘贴地址">
              <div className="flex flex-wrap gap-1.5">
                {PROVIDER_PRESETS.map(p => {
                  const active = presetId === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handlePickPreset(p.id)}
                      className={cn(
                        'inline-flex items-center gap-1 px-3 py-1 rounded-full text-[13px] border',
                        'transition-[background,color,border-color] duration-150',
                        active
                          ? 'bg-nomi-accent-soft text-nomi-accent border-nomi-accent'
                          : 'bg-nomi-paper text-nomi-ink-80 border-nomi-line hover:bg-nomi-ink-05',
                      )}
                    >
                      {p.label}
                      {active && <IconCheck size={13} stroke={2} />}
                    </button>
                  )
                })}
              </div>
            </Field>
            {showBaseUrlField ? (
              <Field
                label="接入地址（BaseURL）"
                hint={providerKind === 'anthropic' ? '留空用官方地址；中转站填它给你的地址' : '到 /v1 为止'}
              >
                <DesignTextInput
                  value={baseUrl}
                  onChange={e => {
                    const v = e.currentTarget.value
                    setBaseUrl(v)
                    setTestState('idle')
                    // hostname 仅作「初始猜测」：anthropic-native 网关 host 带 anthropic。
                    // 一旦专家手选过协议（kindForced），就不再覆盖——否则手选会被下次输入吞掉。
                    // chat vs responses 无法靠 hostname 区分，交由保存前的 auto-probe 定夺。
                    if (presetId === 'custom' && !kindForced) {
                      try {
                        setProviderKind(/anthropic/i.test(new URL(v).hostname) ? 'anthropic' : 'openai-compatible')
                      } catch { /* partial url while typing */ }
                    }
                  }}
                  placeholder={providerKind === 'anthropic' ? 'https://api.anthropic.com（可留空）' : 'https://api.openai.com/v1'}
                  error={baseUrlTrimmed.length > 0 && !baseUrlValid ? '需以 http:// 或 https:// 开头' : undefined}
                />
              </Field>
            ) : (
              <Text size="xs" c="var(--nomi-ink-60)">
                接入地址已自动填好 ·{' '}
                <Anchor component="button" type="button" onClick={() => setEditBaseUrl(true)} c="var(--nomi-accent)" inherit>
                  自定义
                </Anchor>
              </Text>
            )}
            <Field label="你的 API Key" hint="只存在你的电脑上，加密保存">
              <PasswordInput
                value={userApiKey}
                onChange={e => { setUserApiKey(e.currentTarget.value); setTestState('idle') }}
                placeholder="sk-..."
                autoFocus
              />
              {selectedPreset?.keyUrl && (
                <Anchor href={selectedPreset.keyUrl} target="_blank" rel="noreferrer" c="var(--nomi-accent)" size="xs">
                  没有 Key？去 {selectedPreset.label} 官网获取 →
                </Anchor>
              )}
            </Field>

            <Stack gap={4}>
              <Group justify="space-between" align="center">
                <Text size="sm" c="var(--nomi-ink)">模型</Text>
                <DesignButton
                  variant="subtle"
                  onClick={handleFetchModels}
                  disabled={!canTest || fetchingModels}
                  loading={fetchingModels}
                >
                  拉取可用模型
                </DesignButton>
              </Group>
              <TagsInput
                value={models}
                onChange={value => { setModels(value); setTestState('idle') }}
                data={fetchedModels}
                placeholder={models.length === 0 ? '输入模型 id 回车，或先拉取可用模型' : undefined}
                splitChars={[',', ' ', '\n']}
              />
              {fetchModelsMsg && <Text size="xs" c="var(--nomi-ink-60)">{fetchModelsMsg}</Text>}
            </Stack>

            {presetId === 'custom' && (
            <Stack gap={4}>
              {/* 接口协议：默认收起，保存时 auto-probe 替用户判断（P4）。专家可展开强制指定；
                  测试失败时自动展开当逃生口（见 handleTestConnection）。 */}
              {!showKindOverride ? (
                <Text size="xs" c="var(--nomi-ink-60)">
                  接口协议：{kindForced ? PROVIDER_KIND_LABEL[providerKind] : '保存时自动探测'} ·{' '}
                  <Anchor component="button" type="button" onClick={() => setShowKindOverride(true)} c="var(--nomi-accent)" inherit>
                    手动指定
                  </Anchor>
                </Text>
              ) : (
                <Field label="接口协议" hint="不确定就留给自动探测；codex 类中转选 Responses；Claude 官转选 Anthropic">
                  <DesignSegmentedControl
                    value={providerKind}
                    onChange={(v: string) => { setProviderKind(v as ProviderKind); setKindForced(true); setTestState('idle') }}
                    data={[
                      { label: 'Chat Completions', value: 'openai-compatible' },
                      { label: 'Responses', value: 'openai-responses' },
                      { label: 'Anthropic', value: 'anthropic' },
                    ]}
                    fullWidth
                  />
                  {kindForced && (
                    <Anchor component="button" type="button" size="xs" c="var(--nomi-ink-60)"
                      onClick={() => { setKindForced(false); setShowKindOverride(false); setTestState('idle') }}>
                      改回自动探测
                    </Anchor>
                  )}
                </Field>
              )}
            </Stack>
            )}

            {presetId === 'custom' && (
            <Stack gap={4}>
              {headerRows.length > 0 && <Text size="sm" c="var(--nomi-ink)">自定义请求头</Text>}
              {headerRows.length > 0 && (
                <Stack gap={6}>
                  {headerRows.map((h, i) => (
                    <Group key={i} gap={6} wrap="nowrap" align="flex-start">
                      <DesignTextInput
                        value={h.key}
                        onChange={e => updateHeader(i, { key: e.currentTarget.value })}
                        placeholder="Header 名，如 HTTP-Referer"
                        style={{ flex: 1 }}
                      />
                      <DesignTextInput
                        value={h.value}
                        onChange={e => updateHeader(i, { value: e.currentTarget.value })}
                        placeholder="值"
                        style={{ flex: 1 }}
                      />
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        onClick={() => removeHeaderRow(i)}
                        aria-label="删除这一行请求头"
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  ))}
                </Stack>
              )}
              <Group justify="flex-start">
                <DesignButton variant="subtle" leftSection={<IconPlus size={14} />} onClick={addHeaderRow}>
                  添加请求头（可选）
                </DesignButton>
              </Group>
            </Stack>
            )}

            <Group justify="space-between" align="center">
              <Group gap={8} align="center">
                <DesignButton
                  variant="subtle"
                  onClick={handleTestConnection}
                  disabled={!canTest || testState === 'testing'}
                  loading={testState === 'testing'}
                >
                  测试连接
                </DesignButton>
                {testState === 'ok' && (
                  <Group gap={4} align="center" wrap="nowrap" c="var(--workbench-success)">
                    <Text size="xs" c="var(--workbench-success)">{testMessage}</Text>
                    <IconCheck size={14} stroke={1.5} />
                  </Group>
                )}
                {testState === 'fail' && (
                  <Group gap={4} align="center" wrap="nowrap" c="var(--workbench-danger)">
                    <Text size="xs" c="var(--workbench-danger)" lineClamp={1}>{testMessage}</Text>
                    <IconX size={14} stroke={1.5} />
                  </Group>
                )}
              </Group>
              <DesignButton variant="filled" onClick={handleManualSave} disabled={!canSaveManual} loading={saving}>
                保存
              </DesignButton>
            </Group>
              </>
            )}

            {inputMode === 'docs' && (
              <>
            <Text size="xs" c="var(--nomi-ink-60)">
              适合图片 / 视频等非标准接口：AI 读官方文档，自动抠出参数并配置。
            </Text>
            <Field label="文档地址" hint="粘贴这个模型的官方 API 文档页">
              <DesignTextInput
                value={docsUrl}
                onChange={e => setDocsUrl(e.currentTarget.value)}
                placeholder="https://docs.example.com/api/..."
                autoFocus
              />
            </Field>
            <Field label="你的 API Key" hint="只存在你的电脑上，加密保存">
              <PasswordInput
                value={userApiKey}
                onChange={e => setUserApiKey(e.currentTarget.value)}
                placeholder="sk-..."
              />
            </Field>
            <Group justify="flex-end">
              <DesignButton onClick={handleStart} disabled={!canStart}>
                开始
              </DesignButton>
            </Group>
              </>
            )}
          </Stack>
        )}

        {phase === 'running' && (
          <Stack gap="sm">
            <Text size="sm" c="var(--nomi-ink)">{activeMessage}</Text>
            <Stack gap={4}>
              {milestones.map(m => (
                <MilestoneRow
                  key={m.id}
                  milestone={m}
                  detail={m.id === 'kind' && detectedKind ? `已识别为：${kindLabel(detectedKind)}` : m.id === 'fields' && fieldsCount > 0 ? `已提取 ${fieldsCount} 个参数` : undefined}
                />
              ))}
            </Stack>
            <Text size="xs" c="var(--nomi-ink-60)">预计还需 30-60 秒</Text>
            <Group justify="flex-start">
              <DesignButton variant="subtle" onClick={onClose}>取消</DesignButton>
            </Group>
          </Stack>
        )}

        {phase === 'success' && (
          <Stack gap={12} align="center" py={8}>
            <div className="flex items-center justify-center size-12 rounded-full bg-workbench-success-soft text-workbench-success">
              <IconCheck size={26} stroke={1.8} />
            </div>
            <Stack gap={2} align="center">
              <Text size="md" fw={600} c="var(--nomi-ink)">{resultLabel} 已添加</Text>
              <Text size="sm" c="var(--nomi-ink-60)">现在可以在节点里选择这个模型</Text>
            </Stack>
            <Group justify="center" gap={8} w="100%" mt={4}>
              <DesignButton variant="subtle" onClick={() => { resetToInput() }}>再添加一个</DesignButton>
              <DesignButton variant="filled" onClick={onClose}>完成</DesignButton>
            </Group>
          </Stack>
        )}

        {phase === 'error' && (
          <Stack gap="sm">
            <Text size="md" c="var(--nomi-ink)">没能完成添加</Text>
            <Text size="sm" c="var(--nomi-ink)">{errorReason}</Text>
            {errorHint && <Text size="sm" c="var(--nomi-ink-60)">{errorHint}</Text>}
            <Group justify="space-between">
              <DesignButton variant="subtle" onClick={handleCopyLog} disabled={!traceJson}>复制日志</DesignButton>
              <Group>
                <DesignButton variant="subtle" onClick={resetToInput}>改一改重试</DesignButton>
                <DesignButton onClick={onClose}>关闭</DesignButton>
              </Group>
            </Group>
          </Stack>
        )}
      </Stack>
    </DesignModal>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <Stack gap={4}>
      <Text size="sm" c="var(--nomi-ink)">{label}</Text>
      {children}
      {hint && <Text size="xs" c="var(--nomi-ink-60)">{hint}</Text>}
    </Stack>
  )
}

function MilestoneRow({ milestone, detail }: { milestone: Milestone; detail?: string }): JSX.Element {
  const color = milestone.status === 'pending' ? 'var(--nomi-ink-40)' : 'var(--nomi-ink-80)'
  return (
    <Group gap={8} wrap="nowrap" align="center" justify="space-between">
      <Text size="sm" c={color}>{detail || milestone.label}</Text>
      <span className="inline-flex items-center justify-center" style={{ width: 14 }}>
        {milestone.status === 'done' ? (
          <IconCheck size={14} stroke={1.8} color="var(--workbench-success)" />
        ) : milestone.status === 'failed' ? (
          <IconX size={14} stroke={1.8} color="var(--workbench-danger)" />
        ) : (
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: milestone.status === 'active' ? 'var(--nomi-accent)' : 'var(--nomi-ink-20)',
          }} />
        )}
      </span>
    </Group>
  )
}

function bumpToActive(milestones: Milestone[], id: Milestone['id']): Milestone[] {
  return milestones.map(m =>
    m.id === id ? { ...m, status: m.status === 'pending' ? 'active' : m.status } : m,
  )
}

function markStatus(milestones: Milestone[], id: Milestone['id'], status: Milestone['status']): Milestone[] {
  return milestones.map(m => m.id === id ? { ...m, status } : m)
}

function activeMessageFor(id: Milestone['id']): string {
  switch (id) {
    case 'read': return '正在阅读文档…'
    case 'kind': return '正在识别模型类型…'
    case 'identity': return '正在识别接口和认证方式…'
    case 'fields': return '正在提取参数…'
    case 'test': return '正在做一次测试调用…'
    case 'commit': return '正在保存到模型库…'
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'image': return '图片生成'
    case 'video': return '视频生成'
    case 'audio': return '音频生成'
    case 'text': return '文本'
    default: return kind
  }
}

function failureLabelFor(reason?: string): string {
  if (!reason) return '出了点问题'
  if (/401|403|auth/i.test(reason)) return 'API Key 被服务器拒绝'
  if (/404/.test(reason)) return '找不到这个接口'
  if (/gave up/i.test(reason)) return '读不懂这份文档'
  if (/No successful test/i.test(reason)) return '测试调用一直没通过'
  if (/fetch/i.test(reason)) return '打不开这个文档链接'
  return '没能完成添加'
}

function humanHintFor(reason?: string): string {
  if (!reason) return ''
  if (/401|403|auth/i.test(reason)) return '可能是 key 拷贝时多了空格，或这个 key 没开通这个模型。'
  if (/404/.test(reason)) return '文档地址可能不完整，或者这个模型已经下线。'
  if (/gave up/i.test(reason)) return '可能文档结构特殊。你可以换个更直接的端点说明页试试。'
  if (/No successful test/i.test(reason)) return '可能是参数不对，或者这个 key 余额不足。'
  if (/fetch/i.test(reason)) return '检查链接是否能在浏览器里打开。'
  return reason
}
