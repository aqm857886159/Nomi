/**
 * Onboarding Wizard — 「从中转添加模型」（Issue #8：中转优先·一次拉全·按模型分类）。
 *
 * 用户填中转地址 + key → 拉取它开放的模型（GET /v1/models）→ 每个模型按 id 自动判类型
 * （图片/视频/文本，主进程 guessKinds，可改）→ 勾选 → 一次保存。图片/视频/文本统一一条路；
 * 旧「AI 读文档抠参数」子系统已下线（各中转参数不一，读文档不可靠）。UI 不暴露 vendor/mapping
 * 等内部术语（Design.md「no decorative complexity」）。
 *
 * Backed by: nomiDesktop.onboarding.{listModels, guessKinds, testConnection, manualCommit}。
 */
import React from 'react'
import { Stack, Group, Text, PasswordInput, ActionIcon, Anchor, TagsInput, Select, Collapse } from '@mantine/core'
import { IconPlus, IconTrash, IconCheck, IconX, IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { DesignButton, DesignModal, DesignTextInput, DesignSegmentedControl } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { ProviderKind } from '../../desktop/providerKind'
import { resolveManualSaveAction } from './onboardingSaveGate'
import { PROVIDER_PRESETS } from './providerPresets'
import { resolveArchetypeForModel } from '../../config/modelArchetypes'
import { cn } from '../../utils/cn'
import { Field } from './onboardingWizardSupport'

// 接口协议的人类标签——探测成功后告诉用户「用的是 X 协议」，专家覆盖时也用它。
const PROVIDER_KIND_LABEL: Record<ProviderKind, string> = {
  'openai-compatible': 'Chat Completions',
  'openai-responses': 'Responses',
  anthropic: 'Anthropic',
}

type Phase = 'input' | 'running' | 'success' | 'error'
type ModelKind = 'text' | 'image' | 'video' | 'audio'
const KIND_OPTIONS: Array<{ value: ModelKind; label: string }> = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '配音' },
  { value: 'text', label: '文本' },
]

export function OnboardingWizard({ opened, onClose, onCommitted, initialPreset }: {
  opened: boolean
  onClose: () => void
  /** Called once a model is committed to the catalog. */
  onCommitted?: (model: unknown) => void
  /** 打开时预选的预设（如面板「接入你的中转站」卡传 'newapi'，直接进中转拉取流，Issue #8）。 */
  initialPreset?: string
}): JSX.Element {
  const bridge = getDesktopBridge()
  const [phase, setPhase] = React.useState<Phase>('input')
  // input has two branches: 'manual' is the primary path (BaseURL + key + models,
  // breaks the bootstrap deadlock, works for local/text models); 'docs' is the
  // 统一一条手填路径（图片/视频/文本都走它）；inputMode 保留单值 'manual'（旧 docs 分支已删，Issue #8）。
  const [inputMode] = React.useState<'manual'>('manual')
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
  // 「高级设置」整段（接口协议 + 自定义请求头）是否展开。默认收起；测试失败自动展开当逃生口。
  const [showAdvanced, setShowAdvanced] = React.useState(false)
  const [baseUrl, setBaseUrl] = React.useState('')
  // Model ids only (display name dropped — it defaulted to the id, nobody filled it).
  // Entered via TagsInput: type+enter for any endpoint, or pick from auto-fetched list.
  // 模型携带 per-model 类型（图片/视频/文本，Issue #8）：拉取/输入后由主进程 guessKinds 预填，用户可改。
  const [models, setModels] = React.useState<Array<{ id: string; kind: ModelKind }>>([])
  // Auto-fetched model ids (GET /models) used as TagsInput autocomplete suggestions.
  const [fetchedModels, setFetchedModels] = React.useState<string[]>([])
  // 中转「只导认得的」：拉到的里 Nomi 认不出档案的（多为杂牌）默认不自动添加，折叠在这，可手动加。
  const [unrecognizedModels, setUnrecognizedModels] = React.useState<string[]>([])
  const [showUnrecognized, setShowUnrecognized] = React.useState(false)
  const [fetchingModels, setFetchingModels] = React.useState(false)
  const [fetchModelsMsg, setFetchModelsMsg] = React.useState('')
  // Custom request headers (key/value) for relay/proxy gateways. Empty by default
  // so the common case stays clean; the "添加请求头" button reveals a row on demand.
  const [headerRows, setHeaderRows] = React.useState<Array<{ key: string; value: string }>>([])
  const [saving, setSaving] = React.useState(false)
  const [testState, setTestState] = React.useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testMessage, setTestMessage] = React.useState('')
  // 「仍要保存」二次确认态（非阻断门槛，R3 用户拍板）：未测/测试失败时首次点保存先 arm，
  // 再次点才强行提交。任何输入或测试态变化都自动解除 arm（下方 effect），避免残留误触。
  const [forceSaveArmed, setForceSaveArmed] = React.useState(false)
  const [resultLabel, setResultLabel] = React.useState('')
  const [errorReason, setErrorReason] = React.useState('')
  const [errorHint, setErrorHint] = React.useState('')

  const resetToInput = React.useCallback(() => {
    setPhase('input')
    setResultLabel('')
    setErrorReason('')
    setErrorHint('')
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
    setShowAdvanced(false)
    // Endpoint changed → previously fetched models / test result no longer apply.
    setFetchedModels([])
    setFetchModelsMsg('')
    setTestState('idle')
  }, [])

  // 打开时按 initialPreset 预选（面板「接入你的中转站」卡 → 'newapi'，直接进中转拉取流）。
  React.useEffect(() => {
    if (opened && initialPreset) handlePickPreset(initialPreset)
    // 仅在打开瞬间执行一次（initialPreset/handlePickPreset 稳定）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, initialPreset])

  // 把一组模型 id 收敛进 models（去重；保留已选类型；新 id 由主进程 guessKinds 预填，用户可改）。
  const applyModelIds = React.useCallback(async (ids: string[]) => {
    const uniq = Array.from(new Set(ids.map(s => s.trim()).filter(Boolean)))
    const existing = new Map(models.map(m => [m.id, m.kind]))
    const newIds = uniq.filter(id => !existing.has(id))
    let guessed: Record<string, ModelKind> = {}
    if (newIds.length > 0 && bridge?.onboarding?.guessKinds) {
      try { guessed = (await bridge.onboarding.guessKinds({ ids: newIds })).kinds || {} } catch { /* 退回 text */ }
    }
    setModels(uniq.map(id => ({ id, kind: existing.get(id) ?? guessed[id] ?? 'text' })))
    setTestState('idle')
  }, [models, bridge])

  const setModelKind = React.useCallback((id: string, kind: ModelKind) => {
    setModels(prev => prev.map(m => (m.id === id ? { ...m, kind } : m)))
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
        // 只导认得的（用户拍板）：能匹配 Nomi 档案身份的自动添加；认不出的（中转杂牌）折叠、默认不勾。
        const already = new Set(models.map(m => m.id))
        const recognized = res.models.filter(id => resolveArchetypeForModel({ modelKey: id }))
        const unrecognized = res.models.filter(id => !resolveArchetypeForModel({ modelKey: id }) && !already.has(id))
        await applyModelIds([...models.map(m => m.id), ...recognized])
        setUnrecognizedModels(unrecognized)
        setShowUnrecognized(false)
        setFetchModelsMsg(
          unrecognized.length > 0
            ? `拉到 ${res.models.length} 个：自动添加 ${recognized.length} 个 Nomi 认得的；其余 ${unrecognized.length} 个未识别已折叠，可手动添加`
            : `拉到 ${res.models.length} 个，已按类型自动分好（可改 / 删）`,
        )
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
  }, [bridge, baseUrl, userApiKey, providerKind, buildHeadersObject, applyModelIds, models])

  const handleTestConnection = React.useCallback(async () => {
    if (!bridge?.onboarding?.testConnection) return
    setTestState('testing')
    setTestMessage('')
    const firstModelId = models.map(m => m.id.trim()).find(Boolean)
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
      // 失败指路（设计/真实用户评审）：把「可能是协议不对，手动指定」摆出来，展开高级区+覆盖区当逃生口。
      setShowAdvanced(true)
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
      .map(m => ({ id: m.id.trim(), kind: m.kind }))
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

  // 输入或测试态一变 → 解除「仍要保存」二次确认（防 arm 后改了地址/Key 还沿用旧确认）。
  React.useEffect(() => {
    setForceSaveArmed(false)
  }, [testState, baseUrl, userApiKey, models, providerKind])

  // handleStart / handleEvent / handleCopyLog / canStart（AI 读文档流）已随子系统删除（Issue #8）。
  // Anthropic has a hosted default, so a blank BaseURL is allowed there (we fill in
  // the official host); an OpenAI-compatible endpoint must be supplied.
  const baseUrlTrimmed = baseUrl.trim()
  const baseUrlValid = providerKind === 'anthropic'
    ? (baseUrlTrimmed === '' || /^https?:\/\//i.test(baseUrlTrimmed))
    : /^https?:\/\//i.test(baseUrlTrimmed)
  const canTest = baseUrlValid && (providerKind === 'anthropic' || baseUrlTrimmed.length > 0)
  const hasModelId = models.some(m => m.id.trim().length > 0)
  // 非阻断门槛（R3 拍板）：字段齐即可保存；测试未通过走二次确认（arm→confirm），不死拦。
  const manualFieldsReady = baseUrlValid && userApiKey.trim().length > 0 && hasModelId && !saving
  const manualSaveAction = resolveManualSaveAction({
    fieldsReady: manualFieldsReady,
    testPassed: testState === 'ok',
    forceArmed: forceSaveArmed,
  })
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
            {/* 中转优先·一次拉全·按模型分类（Issue #8）：填中转地址 + key → 拉取它开放的模型 →
                每个自动判好类型(图片/视频/文本，可改) → 一次加多类型。文本/图片/视频统一一条路。 */}
            <Text size="xs" c="var(--nomi-ink-60)">
              填中转地址 + Key，拉取它开放的模型；图片 / 视频 / 文本一次接入，类型自动判好可改。
            </Text>

            {inputMode === 'manual' && (
              <>
            {/* Issue #8 可发现性：中转站（含图片/视频）拎到最上、点名 new-api；官方厂商（文本）弱化为次组。 */}
            {([
              { key: 'relay', label: '中转站（文本 / 图片 / 视频）' },
              { key: 'official', label: '官方厂商（文本）' },
            ] as const).map(grp => {
              const items = PROVIDER_PRESETS.filter(p => (p.group ?? 'official') === grp.key)
              if (items.length === 0) return null
              return (
                <Field key={grp.key} label={grp.label} hint={grp.key === 'relay' ? '填你中转后台的地址 + key，拉取它开放的全部模型' : undefined}>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map(p => {
                      const active = presetId === p.id
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handlePickPreset(p.id)}
                          className={cn(
                            'inline-flex items-center gap-1 px-3 py-1 rounded-full text-body-sm border',
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
              )
            })}
            {showBaseUrlField ? (
              <Field
                label="接入地址（BaseURL）"
                hint={providerKind === 'anthropic' ? '留空用官方地址；中转站填它给你的地址' : '中转后台那个地址，带不带 /v1 都行'}
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
                    if (selectedPreset?.custom && !kindForced) {
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
                value={models.map(m => m.id)}
                onChange={value => { void applyModelIds(value) }}
                data={fetchedModels}
                placeholder={models.length === 0 ? '输入模型 id 回车，或先拉取可用模型' : undefined}
                splitChars={[',', ' ', '\n']}
              />
              {fetchModelsMsg && <Text size="xs" c="var(--nomi-ink-60)">{fetchModelsMsg}</Text>}
              {/* 每个模型一行：id + 类型（自动判，可改）。删除经上方 TagsInput 的标签 x。 */}
              {models.length > 0 && (
                <Stack gap={6} mt={4}>
                  {models.map(m => (
                    <Group key={m.id} gap={8} wrap="nowrap" align="center" justify="space-between">
                      <Text size="sm" c="var(--nomi-ink)" style={{ fontFamily: 'var(--nomi-font-mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.id}
                      </Text>
                      <Select
                        value={m.kind}
                        onChange={v => { if (v) setModelKind(m.id, v as ModelKind) }}
                        data={KIND_OPTIONS}
                        size="xs"
                        allowDeselect={false}
                        style={{ width: 88, flexShrink: 0 }}
                      />
                    </Group>
                  ))}
                </Stack>
              )}
              {/* 「只导认得的」其余折叠：未识别模型默认不勾，点开手动添加（不丢任何模型）。 */}
              {unrecognizedModels.length > 0 && (
                <Stack gap={6}>
                  <Anchor
                    component="button"
                    type="button"
                    onClick={() => setShowUnrecognized(v => !v)}
                    style={{ fontSize: 12, color: 'var(--nomi-ink-60)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    {showUnrecognized ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
                    其余 {unrecognizedModels.length} 个未识别模型（多为中转杂牌）
                  </Anchor>
                  <Collapse in={showUnrecognized}>
                    <Group gap={6} wrap="wrap">
                      {unrecognizedModels.map(id => (
                        <DesignButton
                          key={id}
                          variant="subtle"
                          size="xs"
                          leftSection={<IconPlus size={12} />}
                          onClick={() => {
                            void applyModelIds([...models.map(m => m.id), id])
                            setUnrecognizedModels(prev => prev.filter(x => x !== id))
                          }}
                        >
                          {id}
                        </DesignButton>
                      ))}
                    </Group>
                  </Collapse>
                </Stack>
              )}
            </Stack>

            {selectedPreset?.custom && (
            <Stack gap={6}>
              {/* 高级设置（接口协议 + 自定义请求头）：默认收起——主流程只剩 选→填地址+Key→拉模型→保存。
                  专家点开、或测试失败时自动展开当逃生口（见 handleTestConnection）。 */}
              <Anchor
                component="button"
                type="button"
                size="xs"
                c="var(--nomi-ink-60)"
                onClick={() => setShowAdvanced((v) => !v)}
                style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                {showAdvanced ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
                高级设置（接口协议 / 自定义请求头）
              </Anchor>

              <Collapse in={showAdvanced}>
                <Stack gap={12}>
                  {/* 接口协议：保存时 auto-probe 替用户判断；专家可强制指定。 */}
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

                  {/* 自定义请求头 */}
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
                </Stack>
              </Collapse>
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
              <DesignButton
                variant="filled"
                onClick={() => {
                  // arm = 首次点击（未测/失败）→ 进二次确认，不提交；其余 → 直接保存。
                  if (manualSaveAction === 'arm') setForceSaveArmed(true)
                  else void handleManualSave()
                }}
                disabled={manualSaveAction === 'disabled'}
                loading={saving}
                title={
                  manualSaveAction === 'arm'
                    ? '建议先点「测试连接」确认可连上；也可直接保存'
                    : manualSaveAction === 'confirm'
                      ? '未验证连接，再次点击将直接保存'
                      : undefined
                }
              >
                {manualSaveAction === 'arm'
                  ? '仍要保存'
                  : manualSaveAction === 'confirm'
                    ? '确认保存（未验证连接）'
                    : '保存'}
              </DesignButton>
            </Group>
              </>
            )}
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
            <Group justify="flex-end">
              <DesignButton variant="subtle" onClick={resetToInput}>改一改重试</DesignButton>
              <DesignButton onClick={onClose}>关闭</DesignButton>
            </Group>
          </Stack>
        )}
      </Stack>
    </DesignModal>
  )
}

