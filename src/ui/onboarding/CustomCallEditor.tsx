/**
 * 自定义调用编辑器（样张 docs/design/mockups/2026-08-04-custom-call-editor.html §2）。
 * 一屏三步：贴材料 → AI 生成脚本（复用创作助手同文本脑，prompt_refine 通道）→ 试跑（真调、
 * 花一次最小额度、把实际请求/响应摊开——参考图闸对脚本失明的补偿）。保存即接管该模型调用；
 * 留空/删除=恢复默认。弹窗走 DesignModal（同 OnboardingWizard），content 挂 workbench-shell
 * 接回 --workbench-* token 域（Portal 脱域陷阱，见 OnboardingFloatingPanel 头注释）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconCheck, IconCopy, IconPlayerPlay, IconPlus, IconSparkles, IconTrash } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { DesignModal, confirmDialog } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { getTextBrain } from '../../workbench/api/promptLibraryApi'
import { runWorkbenchTextTaskStream } from '../../workbench/api/taskApi'
import { stripCodeFences } from './customCallIntent'
import { configRecordFromRows, configRowsFromRecord, hasCustomConfig, type CustomConfigRow } from './customCallConfig'
import { formatCustomCallDiagnosticContext, parseCustomCallTestParams } from './customCallDiagnostics'

export type CustomCallTarget = {
  vendorKey: string
  modelKey: string
  label: string
  /** 已存的脚本（无则空串）。 */
  script: string
}

type TestRunState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | {
      phase: 'done'
      ok: boolean
      assets: string[]
      text?: string
      errorMessage?: string
      transcript: Array<{
        method: string
        url: string
        status: 'ok' | 'error'
        durationMs: number
        requestPreview?: string
        responsePreview?: string
        errorMessage?: string
      }>
      durationMs: number
    }

/** listVendors() 是 unknown[]；这里只用到 key 与 meta.customConfig，就地窄化，别把 any 放进来。 */
type VendorRow = { key?: string; meta?: Record<string, unknown> & { customConfig?: unknown } }

const inputCls =
  'w-full rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 py-2 text-body-sm text-nomi-ink placeholder:text-nomi-ink-40 outline-none focus:border-nomi-accent'

export function CustomCallEditor({
  target,
  onClose,
  onSaved,
}: {
  target: CustomCallTarget | null
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [material, setMaterial] = React.useState('')
  const [script, setScript] = React.useState('')
  const [aiRunning, setAiRunning] = React.useState(false)
  const [aiError, setAiError] = React.useState('')
  const [test, setTest] = React.useState<TestRunState>({ phase: 'idle' })
  const [saveError, setSaveError] = React.useState('')
  const [configRows, setConfigRows] = React.useState<CustomConfigRow[]>([])
  const [briefCopied, setBriefCopied] = React.useState(false)
  const [testPrompt, setTestPrompt] = React.useState('')
  const [testParamsText, setTestParamsText] = React.useState('')
  const abortRef = React.useRef<AbortController | null>(null)

  // 打开时装载既有脚本 + 该供应商已存的自定义配置；关闭清态。
  React.useEffect(() => {
    if (target) {
      setScript(target.script)
      setMaterial('')
      setAiError('')
      setSaveError('')
      setBriefCopied(false)
      setTestPrompt('')
      setTestParamsText('')
      setTest({ phase: 'idle' })
      // 配置存在 vendor 上（同一供应商下所有模型共用），所以从 vendor 读、不从 model 读。
      const vendors = (getDesktopBridge()?.modelCatalog.listVendors?.() ?? []) as VendorRow[]
      const vendor = vendors.find((v) => v.key === target.vendorKey)
      setConfigRows(configRowsFromRecord(vendor?.meta?.customConfig))
    }
    return () => abortRef.current?.abort()
  }, [target])

  const bridge = getDesktopBridge()
  const contract = React.useMemo(() => {
    try {
      return bridge?.modelCatalog.customCallContract?.() ?? null
    } catch {
      return null
    }
  }, [bridge])

  const runAi = React.useCallback(
    async (repair?: { lastError: string }) => {
      if (!target || !bridge) return
      if (aiRunning) {
        abortRef.current?.abort()
        return
      }
      setAiError('')
      setAiRunning(true)
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        const brain = await getTextBrain()
        if (!brain) {
          setAiError(t('onboardingProviders.customCall.aiNeedTextModel'))
          return
        }
        const instruction = bridge.modelCatalog.customCallAiInstruction?.({
          vendorKey: target.vendorKey,
          modelKey: target.modelKey,
          material: material.trim(),
          ...(repair ? { currentScript: script, lastError: repair.lastError } : {}),
        })
        if (!instruction) return
        let acc = ''
        await runWorkbenchTextTaskStream(
          brain.vendor,
          { kind: 'prompt_refine', prompt: instruction, extras: { modelKey: brain.modelKey } },
          {
            signal: ctrl.signal,
            onDelta: (delta) => {
              acc += delta
              setScript(stripCodeFences(acc))
            },
          },
        )
        const final = stripCodeFences(acc)
        if (final) setScript(final)
        else setAiError(t('onboardingProviders.customCall.aiEmpty'))
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setAiError(e instanceof Error ? e.message : String(e))
      } finally {
        setAiRunning(false)
        abortRef.current = null
      }
    },
    [target, bridge, aiRunning, material, script, t],
  )

  const runTest = React.useCallback(async () => {
    if (!target || !bridge?.modelCatalog.customCallTestRun || test.phase === 'running') return
    setTest({ phase: 'running' })
    try {
      const params = parseCustomCallTestParams(testParamsText)
      const customConfig = configRecordFromRows(configRows)
      const result = await bridge.modelCatalog.customCallTestRun({
        vendorKey: target.vendorKey,
        modelKey: target.modelKey,
        script,
        ...(testPrompt.trim() ? { prompt: testPrompt.trim() } : {}),
        ...(Object.keys(params).length ? { params } : {}),
        ...(customConfig ? { customConfig } : {}),
      })
      setTest({ phase: 'done', ...result })
    } catch (e) {
      setTest({
        phase: 'done',
        ok: false,
        assets: [],
        errorMessage: e instanceof Error ? e.message : String(e),
        transcript: [],
        durationMs: 0,
      })
    }
  }, [target, bridge, script, test.phase, testPrompt, testParamsText, configRows])

  const save = React.useCallback(() => {
    if (!target || !bridge) return
    setSaveError('')
    try {
      // 自定义配置存 vendor（同供应商所有模型共用），脚本存 model —— 但用户只点一次「保存」，
      // 就该把这个弹窗里做的一切都存下，不该逼他理解两者存在不同地方。
      const vendors = (bridge.modelCatalog.listVendors?.() ?? []) as VendorRow[]
      const vendor = vendors.find((v) => v.key === target.vendorKey)
      if (vendor) {
        const meta: Record<string, unknown> = { ...(vendor.meta ?? {}) }
        const config = configRecordFromRows(configRows)
        if (config) meta.customConfig = config
        else delete meta.customConfig // 清空 = 删掉键，别留个 {} 占位
        bridge.modelCatalog.upsertVendor({ ...vendor, meta })
      }
      const trimmed = script.trim()
      bridge.modelCatalog.upsertModel({
        vendorKey: target.vendorKey,
        modelKey: target.modelKey,
        customCall: trimmed ? { script: trimmed } : null,
      })
      onSaved()
      onClose()
    } catch (e) {
      setSaveError(
        t('onboardingProviders.customCall.saveFailed', { message: e instanceof Error ? e.message : String(e) }),
      )
    }
  }, [target, bridge, script, configRows, onSaved, onClose, t])

  const removeScript = React.useCallback(async () => {
    if (!target || !bridge) return
    const ok = await confirmDialog({
      title: t('onboardingProviders.customCall.removeConfirmTitle'),
      message: t('onboardingProviders.customCall.removeConfirmMessage', { name: target.label }),
      confirmLabel: t('onboardingProviders.customCall.removeScript'),
      danger: true,
    })
    if (!ok) return
    try {
      bridge.modelCatalog.upsertModel({ vendorKey: target.vendorKey, modelKey: target.modelKey, customCall: null })
      onSaved()
      onClose()
    } catch (e) {
      setSaveError(
        t('onboardingProviders.customCall.saveFailed', { message: e instanceof Error ? e.message : String(e) }),
      )
    }
  }, [target, bridge, onSaved, onClose, t])

  /**
   * 把「给 AI 的题面」复制到剪贴板，供用户粘给 Codex / Claude / ChatGPT。
   * **复用 customCallAiInstruction**——内建 AI 用的就是这份指令，题面只有一个真相源；
   * 另写一份迟早和注入变量表漂移（正是 customCallContract 头注释警告的那类事）。
   */
  const copyBrief = React.useCallback(async () => {
    if (!target || !bridge) return
    const lastError = test.phase === 'done' && !test.ok ? formatCustomCallDiagnosticContext(test) : ''
    const instruction = bridge.modelCatalog.customCallAiInstruction?.({
      vendorKey: target.vendorKey,
      modelKey: target.modelKey,
      material: material.trim(),
      ...(script.trim() ? { currentScript: script } : {}),
      ...(lastError ? { lastError } : {}),
    })
    if (!instruction) return
    try {
      await navigator.clipboard.writeText(String(instruction))
      setBriefCopied(true)
    } catch {
      setSaveError(t('onboardingProviders.customCall.saveFailed', { message: 'clipboard' }))
    }
  }, [target, bridge, material, script, test, t])

  const insertTemplate = React.useCallback(
    (id: string) => {
      const tpl = contract?.templates.find((item) => item.id === id)
      if (tpl) setScript(tpl.script)
    },
    [contract],
  )

  const varNames = contract?.variables.map((v) => v.name) ?? []

  return (
    <DesignModal
      opened={target !== null}
      onClose={onClose}
      centered
      size={640}
      title={
        <span className="flex items-baseline gap-2">
          <span className="text-body font-semibold text-nomi-ink">{t('onboardingProviders.customCall.title')}</span>
          <span className="text-caption text-nomi-ink-60">{target?.label}</span>
        </span>
      }
      classNames={{ content: 'workbench-shell' }}
      closeButtonProps={{ 'aria-label': t('onboardingProviders.customCall.closeAria') }}
    >
      {target ? (
        <div className="flex flex-col gap-3">
          <div className="text-caption text-nomi-ink-60 -mt-1">{t('onboardingProviders.customCall.subtitle')}</div>

          {/* ① 贴材料 + AI 生成 */}
          <div className="flex flex-col gap-1.5">
            <div className="text-body-sm font-semibold text-nomi-ink">
              {t('onboardingProviders.customCall.materialLabel')}
              <span className="ml-1.5 font-normal text-caption text-nomi-ink-40">
                {t('onboardingProviders.customCall.materialHint')}
              </span>
            </div>
            <textarea
              rows={3}
              className={cn(inputCls, 'resize-y font-nomi-mono text-caption leading-relaxed')}
              placeholder={t('onboardingProviders.customCall.materialPlaceholder')}
              aria-label={t('onboardingProviders.customCall.materialLabel')}
              value={material}
              onChange={(e) => setMaterial(e.currentTarget.value)}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void runAi()}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-nomi-sm px-3 text-body-sm font-semibold',
                  aiRunning
                    ? 'bg-nomi-ink-05 text-nomi-ink-60'
                    : 'bg-nomi-ink text-nomi-paper hover:bg-nomi-accent',
                )}
              >
                <IconSparkles size={14} stroke={1.7} />
                {aiRunning ? t('onboardingProviders.customCall.aiStop') : t('onboardingProviders.customCall.aiGenerate')}
              </button>
              {aiError ? <span className="min-w-0 flex-1 text-caption text-workbench-danger">{aiError}</span> : null}
            </div>
          </div>

          {/*
            ② 自定义配置。默认**折叠**：绝大多数服务一个密钥就够，空表格摊开只是噪音；
            已经填过的才展开（open 由 hasCustomConfig 决定）。折叠标题写用途不写功能名——
            没打开的人也得看懂这里是干嘛的。
          */}
          <details open={hasCustomConfig(configRows)} className="flex flex-col gap-1.5">
            <summary className="cursor-pointer select-none text-body-sm font-semibold text-nomi-ink">
              {hasCustomConfig(configRows)
                ? t('onboardingProviders.customCall.configLabelFilled', { count: configRows.filter((r) => r.name.trim()).length })
                : t('onboardingProviders.customCall.configLabel')}
            </summary>
            <div className="mt-1.5 flex flex-col gap-1.5">
              <div className="text-caption leading-relaxed text-nomi-ink-60">
                {t('onboardingProviders.customCall.configHint')}
                <span className="ml-1 text-nomi-ink-40">{t('onboardingProviders.customCall.configScope')}</span>
              </div>
              {configRows.map((row, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <input
                    className={cn(inputCls, 'flex-1 font-nomi-mono text-caption')}
                    placeholder={t('onboardingProviders.customCall.configNamePlaceholder')}
                    aria-label={t('onboardingProviders.customCall.configNameAria')}
                    value={row.name}
                    onChange={(e) => {
                      const name = e.currentTarget.value
                      setConfigRows((rows) => rows.map((r, i) => (i === index ? { ...r, name } : r)))
                    }}
                  />
                  <input
                    className={cn(inputCls, 'flex-[1.3] font-nomi-mono text-caption')}
                    placeholder={t('onboardingProviders.customCall.configValuePlaceholder')}
                    aria-label={t('onboardingProviders.customCall.configValueAria', { name: row.name })}
                    value={row.value}
                    onChange={(e) => {
                      const value = e.currentTarget.value
                      setConfigRows((rows) => rows.map((r, i) => (i === index ? { ...r, value } : r)))
                    }}
                  />
                  <button
                    type="button"
                    aria-label={t('onboardingProviders.customCall.configRemoveAria', { name: row.name })}
                    onClick={() => setConfigRows((rows) => rows.filter((_, i) => i !== index))}
                    className="shrink-0 rounded-nomi-sm p-1.5 text-nomi-ink-30 hover:text-workbench-danger"
                  >
                    <IconTrash size={14} stroke={1.7} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setConfigRows((rows) => [...rows, { name: '', value: '' }])}
                className="self-start rounded-full border border-nomi-line px-2.5 py-[3px] text-micro text-nomi-ink-60 hover:border-nomi-ink-20 hover:text-nomi-ink"
              >
                <IconPlus size={12} stroke={1.8} className="mr-1 inline align-[-1px]" />
                {t('onboardingProviders.customCall.configAdd')}
              </button>
            </div>
          </details>

          {/* ③ 脚本 */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-body-sm font-semibold text-nomi-ink">
                {t('onboardingProviders.customCall.scriptLabel')}
              </span>
              <span className="min-w-0 flex-1" />
              <span className="text-micro text-nomi-ink-40">{t('onboardingProviders.customCall.templatesLabel')}</span>
              {(contract?.templates ?? []).map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => insertTemplate(tpl.id)}
                  className="rounded-full border border-nomi-line px-2 py-[2px] text-micro text-nomi-ink-60 hover:border-nomi-ink-20 hover:text-nomi-ink"
                >
                  {t(`onboardingProviders.customCall.template.${tpl.id}` as 'onboardingProviders.customCall.template.openaiImage')}
                </button>
              ))}
            </div>
            <textarea
              rows={10}
              spellCheck={false}
              className={cn(inputCls, 'resize-y font-nomi-mono text-caption leading-relaxed')}
              placeholder={t('onboardingProviders.customCall.scriptPlaceholder')}
              aria-label={t('onboardingProviders.customCall.scriptAria', { name: target.label })}
              value={script}
              onChange={(e) => setScript(e.currentTarget.value)}
            />
            <details className="text-caption text-nomi-ink-60">
              <summary className="cursor-pointer select-none text-micro text-nomi-ink-40">
                {t('onboardingProviders.customCall.varsLabel')}：{varNames.join(' · ')}
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1 pl-1">
                {varNames.map((name) => (
                  <li key={name} className="leading-snug">
                    <code className="rounded-nomi-sm bg-nomi-ink-05 px-1 py-[1px] font-nomi-mono text-micro text-nomi-ink-80">
                      {name}
                    </code>{' '}
                    {t(`onboardingProviders.customCall.vars.${name}` as 'onboardingProviders.customCall.vars.prompt')}
                  </li>
                ))}
              </ul>
            </details>
          </div>

          {/* ③ 试跑 */}
          <div className="flex flex-col gap-2">
            <details className="text-caption text-nomi-ink-60">
              <summary className="cursor-pointer select-none text-micro text-nomi-ink-40">
                {t('onboardingProviders.customCall.testInputLabel')}
              </summary>
              <div className="mt-1.5 flex flex-col gap-1.5">
                <input
                  className={cn(inputCls, 'font-nomi-mono text-caption')}
                  placeholder={t('onboardingProviders.customCall.testPromptPlaceholder')}
                  aria-label={t('onboardingProviders.customCall.testPromptAria')}
                  value={testPrompt}
                  onChange={(e) => setTestPrompt(e.currentTarget.value)}
                />
                <textarea
                  rows={4}
                  spellCheck={false}
                  className={cn(inputCls, 'resize-y font-nomi-mono text-caption leading-relaxed')}
                  placeholder={t('onboardingProviders.customCall.testParamsPlaceholder')}
                  aria-label={t('onboardingProviders.customCall.testParamsAria')}
                  value={testParamsText}
                  onChange={(e) => setTestParamsText(e.currentTarget.value)}
                />
              </div>
            </details>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={test.phase === 'running' || !script.trim()}
                onClick={() => void runTest()}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-nomi-sm border border-nomi-line px-3 text-body-sm font-semibold text-nomi-ink',
                  'hover:border-nomi-accent hover:text-nomi-accent disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <IconPlayerPlay size={14} stroke={1.7} />
                {test.phase === 'running'
                  ? t('onboardingProviders.customCall.testRunning')
                  : t('onboardingProviders.customCall.testRun')}
              </button>
            </div>

            {test.phase === 'done' ? (
              <div
                className={cn(
                  'flex flex-col gap-2 rounded-nomi-sm border p-2.5',
                  test.ok
                    ? 'border-[var(--workbench-success-soft)] bg-workbench-success-soft'
                    : 'border-[var(--workbench-danger-soft)] bg-[color-mix(in_srgb,var(--workbench-danger)_6%,var(--nomi-paper))]',
                )}
              >
                <div
                  className={cn(
                    'flex items-center gap-1.5 text-body-sm font-semibold',
                    test.ok ? 'text-workbench-success' : 'text-workbench-danger',
                  )}
                >
                  {test.ok ? <IconCheck size={15} stroke={2} /> : <IconAlertTriangle size={15} stroke={1.8} />}
                  {test.ok
                    ? test.text !== undefined
                      ? t('onboardingProviders.customCall.testTextOk', { seconds: (test.durationMs / 1000).toFixed(1) })
                      : t('onboardingProviders.customCall.testOk', {
                          count: test.assets.length,
                          seconds: (test.durationMs / 1000).toFixed(1),
                        })
                    : t('onboardingProviders.customCall.testFailed')}
                </div>
                {test.ok && test.text !== undefined ? (
                  <div className="select-text whitespace-pre-wrap break-words rounded-nomi-sm bg-nomi-ink-05 p-2 font-nomi-mono text-micro text-nomi-ink-80">
                    {test.text}
                  </div>
                ) : null}
                {!test.ok && test.errorMessage ? (
                  <div className="select-text break-words rounded-nomi-sm bg-nomi-ink-05 p-2 font-nomi-mono text-micro text-nomi-ink-80">
                    {test.errorMessage}
                  </div>
                ) : null}
                {test.ok && test.assets.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {test.assets.slice(0, 4).map((asset, i) =>
                      /^data:image|\.(png|jpe?g|webp)(\?|$)/i.test(asset) || asset.startsWith('data:image') ? (
                        <img
                          key={i}
                          src={asset}
                          alt=""
                          className="h-16 w-16 rounded-nomi-sm border border-nomi-line object-cover"
                        />
                      ) : (
                        <span
                          key={i}
                          className="max-w-full truncate rounded-nomi-sm bg-nomi-ink-05 px-2 py-1 font-nomi-mono text-micro text-nomi-ink-60"
                        >
                          {asset}
                        </span>
                      ),
                    )}
                  </div>
                ) : null}
                {test.transcript.length === 0 ? (
                  <div className="text-micro text-nomi-ink-40">{t('onboardingProviders.customCall.transcriptEmpty')}</div>
                ) : (
                  test.transcript.map((entry, i) => (
                    <details key={i} className="text-caption text-nomi-ink-80">
                      <summary className="cursor-pointer select-none truncate text-micro text-nomi-ink-60">
                        {t('onboardingProviders.customCall.transcriptRequest', {
                          index: i + 1,
                          method: entry.method,
                          url: entry.url,
                        })}
                        {entry.status === 'error' ? ' ✗' : ''}
                      </summary>
                      <div className="mt-1 flex flex-col gap-1">
                        {entry.requestPreview ? (
                          <div className="select-text break-all rounded-nomi-sm bg-nomi-ink-05 p-1.5 font-nomi-mono text-micro">
                            <span className="text-nomi-ink-40">{t('onboardingProviders.customCall.transcriptRequestBody')}：</span>
                            {entry.requestPreview}
                          </div>
                        ) : null}
                        {entry.responsePreview ? (
                          <div className="select-text break-all rounded-nomi-sm bg-nomi-ink-05 p-1.5 font-nomi-mono text-micro">
                            <span className="text-nomi-ink-40">{t('onboardingProviders.customCall.transcriptResponse')}：</span>
                            {entry.responsePreview}
                          </div>
                        ) : null}
                        {entry.errorMessage ? (
                          <div className="select-text break-all rounded-nomi-sm bg-nomi-ink-05 p-1.5 font-nomi-mono text-micro text-workbench-danger">
                            <span className="text-nomi-ink-40">{t('onboardingProviders.customCall.transcriptError')}：</span>
                            {entry.errorMessage}
                          </div>
                        ) : null}
                      </div>
                    </details>
                  ))
                )}
                {!test.ok ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void runAi({ lastError: formatCustomCallDiagnosticContext(test) })}
                      className="inline-flex h-7 items-center gap-1.5 rounded-nomi-sm bg-nomi-ink px-2.5 text-caption font-semibold text-nomi-paper hover:bg-nomi-accent"
                    >
                      <IconSparkles size={13} stroke={1.7} />
                      {t('onboardingProviders.customCall.aiRepair')}
                    </button>
                    {/*
                      「复制题面」是内建 AI 改不动之后的下一步，不是与它并列的第二个入口
                      （设计系统 §1.5 一功能一个家）。所以：只在失败块里出现、排在 aiRepair 之后、
                      前面加一句引导词把先后关系说出来。
                    */}
                    <span className="text-micro text-nomi-ink-40">{t('onboardingProviders.customCall.copyBriefLead')}</span>
                    <button
                      type="button"
                      onClick={() => void copyBrief()}
                      className="inline-flex h-7 items-center gap-1.5 rounded-nomi-sm border border-nomi-line px-2.5 text-caption text-nomi-ink-60 hover:border-nomi-accent hover:text-nomi-accent"
                    >
                      <IconCopy size={13} stroke={1.7} />
                      {briefCopied
                        ? t('onboardingProviders.customCall.copyBriefDone')
                        : t('onboardingProviders.customCall.copyBrief')}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="text-micro leading-relaxed text-nomi-ink-40">
            {t('onboardingProviders.customCall.honestNote')}
            {/* 做不到的明着标（D4）：让人早点掉头，别照着试半天才发现此路不通。 */}
            <span className="ml-1 text-[color:var(--nomi-warning)]">{t('onboardingProviders.customCall.limitNote')}</span>
          </div>
          {saveError ? <div className="text-caption text-workbench-danger">{saveError}</div> : null}

          {/* footer */}
          <div className="flex items-center gap-3 border-t border-nomi-line-soft pt-3">
            <button
              type="button"
              onClick={save}
              className="inline-flex h-8 items-center rounded-nomi-sm bg-nomi-ink px-4 text-body-sm font-semibold text-nomi-paper hover:bg-nomi-accent"
            >
              {t('onboardingProviders.customCall.save')}
            </button>
            <button type="button" onClick={onClose} className="text-caption text-nomi-ink-40 hover:text-nomi-ink-60">
              {t('common.cancel')}
            </button>
            <span className="min-w-0 flex-1" />
            {target.script ? (
              <button
                type="button"
                onClick={() => void removeScript()}
                className="text-caption text-workbench-danger hover:underline"
              >
                {t('onboardingProviders.customCall.removeScript')}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <span />
      )}
    </DesignModal>
  )
}
