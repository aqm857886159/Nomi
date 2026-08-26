/**
 * 模型勾选第二屏（OnboardingWizard 的换屏，非新弹窗）。
 *
 * 为什么：中转 `/v1/models` 常拉到上百个模型，旧流程全量灌库（opt-out，再逐个删）——污染所有
 * 模型下拉。这里改成 opt-in：拉到的池按 文本/图片/视频/配音 分组列清单，用户**默认不勾**、勾谁接谁
 * （用户拍板 2026-06-29 方案 A）。分组复用单一真相源 groupModelsByKind（Issue #23 防白屏不变量）。
 *
 * 无 wizard state：选择态本地持有，确认时回吐给宿主（R9 分层，宿主只管落库）。端点没列出模型时
 * （candidates 为空）靠底部「手填 id」补充，保留手动录入逃生口（P1 不丢能力）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Stack, Group, Text } from '@mantine/core'
import {
  IconArrowLeft,
  IconRefresh,
  IconMessage,
  IconPhoto,
  IconVideo,
  IconMicrophone,
  IconCube,
  IconPlus,
  IconCheck,
  IconCloudDownload,
} from '@tabler/icons-react'
import {
  DesignButton,
  DesignCheckbox,
  DesignSearchInput,
  DesignTextInput,
  IconActionButton,
  NomiSelect,
} from '../../design'
import { groupModelsByKind, isKnownModelChipKind, MODEL_CHIP_KINDS } from './modelChipGrouping'
import { cn } from '../../utils/cn'

export type PickerModel = { id: string; kind: string }

const KIND_ICON: Record<string, typeof IconMessage> = {
  text: IconMessage,
  image: IconPhoto,
  video: IconVideo,
  audio: IconMicrophone,
  model3d: IconCube,
}

export function ModelPickerScreen({
  candidates,
  initialSelected,
  sourceName,
  host,
  total,
  fetching,
  hasFetched = false,
  confirming = false,
  onRefetch,
  onBack,
  onConfirm,
  onResolveKind,
  alreadyAddedIds = [],
  emptyHint,
  statusHint,
  blocked = false,
}: {
  candidates: PickerModel[]
  /** 已选中的模型（带类型）——重开第二屏时预勾，且确保手填过的 id 仍在池里渲染。 */
  initialSelected: PickerModel[]
  sourceName: string
  host: string
  /** 拉到的总数（= candidates.length，单独传以便文案稳定）。 */
  total: number
  fetching: boolean
  /** Whether the user has explicitly attempted a remote model-list request in this visit. */
  hasFetched?: boolean
  /** 正在将连接和所选模型写入本地目录；防止重复提交。 */
  confirming?: boolean
  onRefetch: () => void
  onBack: () => void
  onConfirm: (selected: PickerModel[]) => void
  /** 手填未列出的 id 时，向宿主问类型（宿主包 bridge.guessKinds）；缺省按 text。 */
  onResolveKind?: (id: string) => Promise<string>
  /** 已属于当前连接的模型只展示状态，不允许重复提交或覆盖原配置。 */
  alreadyAddedIds?: string[]
  /** 列表真正为空时的占位说明；请求状态必须走 statusHint，不能藏在这里。 */
  emptyHint?: string
  /** 本次拉取的独立状态；列表里已有模型时也必须显示，不能退化成空态文案。 */
  statusHint?: string
  /** 地址或凭据缺失时禁止继续，用户返回连接页修复。 */
  blocked?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const alreadyAdded = React.useMemo(() => new Set(alreadyAddedIds), [alreadyAddedIds])
  const controlsBlocked = blocked || confirming
  const [selected, setSelected] = React.useState<Map<string, PickerModel>>(
    () => new Map(initialSelected.filter((m) => !alreadyAdded.has(m.id)).map((m) => [m.id, m])),
  )
  const [manual, setManual] = React.useState<PickerModel[]>([])
  const [manualInput, setManualInput] = React.useState('')
  const [query, setQuery] = React.useState('')
  /**
   * 就地改类型。分组本身是「猜的结果」，但用户读不出那是**自己在拍板**——行上只有 id 和勾选框，
   * 猜错了根本看不出来，落库之后又只能在模型抽屉里改。把类型摆到行上并可改，猜测才真正
   * 「可见可改」（这也是 modelKindHeuristic 注释里承诺过、却一直只在下一屏兑现的那个纠错口）。
   */
  const [overrides, setOverrides] = React.useState<Map<string, string>>(() => new Map())
  const setKind = React.useCallback((id: string, kind: string) => {
    setOverrides((prev) => new Map(prev).set(id, kind))
    // 改了类型多半就是要它——顺手勾上，省一次点击（改完还要自己再勾一下是纯摩擦）。
    setSelected((prev) => new Map(prev).set(id, { id, kind }))
  }, [])

  // 池 = 手填 ∪ 已选 ∪ 拉到的（去重保首次）。已选放在拉取之前，保证手动加过的 id 仍渲染、
  // 且用户改过的类型优先于启发式猜测。overrides 是本屏的就地改类型——最后一道，永远压过猜测。
  const pool = React.useMemo(() => {
    const seen = new Set<string>()
    const out: PickerModel[] = []
    for (const m of [...manual, ...selected.values(), ...initialSelected, ...candidates]) {
      const id = m.id.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push({ id, kind: overrides.get(id) ?? m.kind })
    }
    return out
  }, [candidates, manual, selected, initialSelected, overrides])

  const q = query.trim().toLowerCase()
  const visible = q ? pool.filter((m) => m.id.toLowerCase().includes(q)) : pool
  const groups = groupModelsByKind(visible)

  const toggle = React.useCallback(
    (id: string) => {
      if (alreadyAdded.has(id) || controlsBlocked) return
      setSelected((prev) => {
        const next = new Map(prev)
        if (next.has(id)) next.delete(id)
        else {
          const model = pool.find((item) => item.id === id)
          if (model) next.set(id, model)
        }
        return next
      })
    },
    [alreadyAdded, controlsBlocked, pool],
  )

  const toggleGroup = React.useCallback(
    (ids: string[]) => {
      if (controlsBlocked) return
      const available = ids.filter((id) => !alreadyAdded.has(id))
      const byId = new Map(pool.map((model) => [model.id, model]))
      setSelected((prev) => {
        const next = new Map(prev)
        const allOn = available.length > 0 && available.every((id) => next.has(id))
        for (const id of available) {
          if (allOn) next.delete(id)
          else {
            const model = byId.get(id)
            if (model) next.set(id, model)
          }
        }
        return next
      })
    },
    [alreadyAdded, controlsBlocked, pool],
  )

  const addManual = React.useCallback(async () => {
    const id = manualInput.trim()
    if (!id || controlsBlocked || alreadyAdded.has(id)) return
    setManualInput('')
    const existing = pool.find((m) => m.id === id)
    if (existing) {
      setSelected((prev) => new Map(prev).set(id, existing))
      return
    }
    let kind = 'text'
    if (onResolveKind) {
      try {
        kind = await onResolveKind(id)
      } catch {
        /* 退回 text */
      }
    }
    setManual((prev) => [{ id, kind }, ...prev])
    setSelected((prev) => new Map(prev).set(id, { id, kind }))
  }, [manualInput, pool, onResolveKind, controlsBlocked, alreadyAdded])

  const confirm = React.useCallback(() => {
    onConfirm(pool.filter((m) => selected.has(m.id) && !alreadyAdded.has(m.id)))
  }, [pool, selected, alreadyAdded, onConfirm])

  const count = [...selected.keys()].filter((id) => !alreadyAdded.has(id)).length

  return (
    <Stack gap={10}>
      {/* 头：返回 + 标题 + 重新拉取 */}
      <Group justify="space-between" align="center" wrap="nowrap">
        <Group gap={8} align="center" wrap="nowrap">
          <IconActionButton
            onClick={onBack}
            aria-label={t('common.back')}
            title={t('common.back')}
            className="size-11 text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink sm:size-8"
            icon={<IconArrowLeft size={18} stroke={1.6} aria-hidden="true" />}
          />
          <Text size="md" fw={600} c="var(--nomi-ink)">
            {t('onboardingProviders.modelControls.pickerTitle')}
          </Text>
        </Group>
        <DesignButton
          variant="subtle"
          leftSection={
            hasFetched ? (
              <IconRefresh size={14} stroke={1.8} aria-hidden="true" />
            ) : (
              <IconCloudDownload size={14} stroke={1.8} aria-hidden="true" />
            )
          }
          onClick={onRefetch}
          loading={fetching}
          disabled={controlsBlocked}
          className="min-h-11 shrink-0 sm:min-h-8"
        >
          {t(hasFetched ? 'onboardingProviders.modelControls.refetch' : 'onboardingProviders.modelControls.fetch')}
        </DesignButton>
      </Group>

      {/* 来源行：来源名 · host · 拉到 N 个 */}
      <Text
        size="xs"
        c="var(--nomi-ink-60)"
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {sourceName ? `${sourceName} · ` : ''}
        {host}
        {total > 0 ? ` · ${t('onboardingProviders.modelControls.fetchedCount', { count: total })}` : ''}
      </Text>

      {statusHint ? (
        <Text
          data-model-picker-status
          role="status"
          size="xs"
          c="var(--nomi-ink-60)"
          className="break-words border-l-2 border-nomi-warning bg-nomi-ink-05 px-2.5 py-2 leading-relaxed"
        >
          {statusHint}
        </Text>
      ) : null}

      <DesignSearchInput
        value={query}
        onChange={setQuery}
        placeholder={t('onboardingProviders.modelControls.searchIdPlaceholder')}
        className="w-full"
      />

      {/* 计数 + 清空 */}
      <Group justify="space-between" align="center">
        <Text size="sm" c="var(--nomi-ink-60)">
          {t('onboardingProviders.modelControls.pickerSelected', { count })}
          {total > 0 ? t('onboardingProviders.modelControls.pickerTotal', { count: total }) : ''}
        </Text>
        {count > 0 && (
          <button
            type="button"
            onClick={() => setSelected(new Map())}
            disabled={controlsBlocked}
            className="min-h-11 px-2 text-body-sm text-nomi-ink-40 hover:text-nomi-ink-60 sm:min-h-8"
          >
            {t('onboardingProviders.modelControls.clear')}
          </button>
        )}
      </Group>

      {/* 分组是猜的结果——明说一句，否则用户读不出这是自己该核对的东西（猜错的代价：模型直接
          从对应下拉里消失，且事后很难联想到是类型问题）。 */}
      <Text size="xs" c="var(--nomi-ink-40)">
        {t('onboardingProviders.modelControls.kindGuessNote')}
      </Text>

      {/* 分组清单 */}
      <Stack gap={4} mah={260} style={{ overflowY: 'auto' }}>
        {groups.length === 0 ? (
          <Text size="sm" c="var(--nomi-ink-40)" py={16} ta="center">
            {pool.length === 0
              ? emptyHint || t('onboardingProviders.modelControls.endpointEmpty')
              : t('onboardingProviders.modelControls.noMatchingModels')}
          </Text>
        ) : (
          groups.map(({ kind, models }) => {
            const ids = models.map((m) => m.id)
            const availableIds = ids.filter((id) => !alreadyAdded.has(id))
            const allOn = availableIds.length > 0 && availableIds.every((id) => selected.has(id))
            const Icon = KIND_ICON[kind] ?? IconMessage
            return (
              <Stack key={kind} gap={2}>
                <Group justify="space-between" align="center" px={2} pt={6}>
                  <Group gap={5} align="center" wrap="nowrap">
                    <Icon size={14} stroke={1.6} style={{ color: 'var(--nomi-ink-60)' }} />
                    <Text size="xs" fw={600} c="var(--nomi-ink-60)">
                      {isKnownModelChipKind(kind)
                        ? t(
                            `onboardingProviders.modelControls.kind.${kind}` as 'onboardingProviders.modelControls.kind.text',
                          )
                        : kind}{' '}
                      <Text span fw={400} c="var(--nomi-ink-40)">
                        {models.length}
                      </Text>
                    </Text>
                    {/* 3D 能被正确登记（不再冒充文本模型），但中转侧没有通用 3D 调用端点——
                        接进来暂时跑不了。明着标出来，别让用户勾完才发现（D4 缺口明标）。 */}
                    {kind === 'model3d' ? (
                      <Text size="xs" fw={400} c="var(--nomi-warning)">
                        {t('onboardingProviders.modelControls.model3dNoChannel')}
                      </Text>
                    ) : null}
                  </Group>
                  {availableIds.length > 0 && !controlsBlocked ? (
                    <button
                      type="button"
                      onClick={() => toggleGroup(ids)}
                      className="min-h-11 px-2 text-micro text-nomi-accent hover:underline sm:min-h-8"
                    >
                      {allOn
                        ? t('onboardingProviders.modelControls.deselectGroup')
                        : t('onboardingProviders.modelControls.selectGroup')}
                    </button>
                  ) : null}
                </Group>
                {models.map((m) => {
                  const on = selected.has(m.id)
                  const isAlreadyAdded = alreadyAdded.has(m.id)
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        'flex items-center gap-2.5 px-2.5 py-1.5 rounded-nomi w-full',
                        'transition-colors duration-100 hover:bg-nomi-ink-05',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggle(m.id)}
                        disabled={isAlreadyAdded || controlsBlocked}
                        className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left sm:min-h-0"
                      >
                        <DesignCheckbox checked={isAlreadyAdded || on} readOnly tabIndex={-1} aria-hidden />
                        <span
                          className="text-body-sm text-nomi-ink truncate"
                          style={{ fontFamily: 'var(--nomi-font-mono, monospace)' }}
                        >
                          {m.id}
                        </span>
                      </button>
                      {isAlreadyAdded ? (
                        <Text size="xs" c="var(--nomi-ink-40)" style={{ flexShrink: 0 }}>
                          {t('onboardingProviders.modelControls.alreadyAdded')}
                        </Text>
                      ) : null}
                      {/* 类型摆在行上、就地可改：分组只暗示「我们猜的」，这个控件才让用户知道
                          「这是可以改的」。猜错在这里改一下，比落库后再去别处找便宜得多。 */}
                      <NomiSelect
                        value={m.kind}
                        options={MODEL_CHIP_KINDS.map((k) => ({
                          value: k,
                          label: t(
                            `onboardingProviders.modelControls.kind.${k}` as 'onboardingProviders.modelControls.kind.text',
                          ),
                        }))}
                        onChange={(next) => {
                          if (next !== m.kind) setKind(m.id, next)
                        }}
                        ariaLabel={t('onboardingProviders.modelControls.retypeAria', { name: m.id })}
                        size="xs"
                        className="min-h-11 shrink-0 sm:min-h-6"
                        disabled={isAlreadyAdded || controlsBlocked}
                      />
                    </div>
                  )
                })}
              </Stack>
            )
          })
        )}
      </Stack>

      {/* 手填未列出的 id（逃生口） */}
      <Group gap={6} wrap="nowrap" align="center">
        <DesignTextInput
          value={manualInput}
          onChange={(e) => setManualInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void addManual()
            }
          }}
          placeholder={t('onboardingProviders.modelControls.manualPlaceholder')}
          style={{ flex: 1 }}
          disabled={controlsBlocked}
        />
        <DesignButton
          variant="subtle"
          leftSection={<IconPlus size={14} />}
          onClick={() => void addManual()}
          disabled={controlsBlocked || !manualInput.trim() || alreadyAdded.has(manualInput.trim())}
          className="min-h-11 shrink-0 sm:min-h-8"
        >
          {t('onboardingProviders.modelControls.add')}
        </DesignButton>
      </Group>

      <Text data-model-picker-save-disclosure size="xs" c="var(--nomi-ink-40)" className="leading-relaxed">
        {t('onboardingProviders.modelControls.saveModelsDisclosure')}
      </Text>

      {/* 底：取消 + 保存 N */}
      <Group justify="flex-end" gap={8} pt={2}>
        <DesignButton variant="subtle" onClick={onBack} disabled={confirming} className="min-h-11 sm:min-h-8">
          {t('common.cancel')}
        </DesignButton>
        <DesignButton
          variant="filled"
          leftSection={<IconCheck size={14} />}
          onClick={confirm}
          disabled={controlsBlocked || count === 0}
          loading={confirming}
          className="min-h-11 sm:min-h-8"
        >
          {t('onboardingProviders.modelControls.addModels', { count })}
        </DesignButton>
      </Group>
    </Stack>
  )
}
