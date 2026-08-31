/**
 * 「Codex 本地生图」接入卡（无 key 的本机 provider，与 ComfyuiLocalCard / DreaminaMemberCard 同一模式）。
 *
 * **为什么要单独一张卡**：Codex 在 Nomi 里是两个方向相反的东西，此前被一个按钮绑在一起：
 *   - Codex **→** Nomi：Codex 当司机，经 MCP 驱动 Nomi 建项目/出图（「接入 AI 编程助手」卡）。
 *   - Nomi **→** Codex：Nomi spawn `codex exec` 帮用户出图，烧用户自己的 ChatGPT 额度（**本卡**）。
 * 旧实现里本卡不存在：codex-local 被排除在模型列表外，它唯一的开关是「接入 AI 编程助手」的**副作用**
 * （接入 MCP 顺带开生图、撤销顺带关），而且抽屉每次刷新都会把它掰回 MCP 接入状态——用户自己关掉
 * 也会被冲回去。拆成本卡后：两个方向各开各的，用户的开关是用户的。
 *
 * 接入 = 把种子 vendor（默认 enabled:false）翻成 true。生成门槛本就「authType:'none' + enabled」不要 key。
 * 不探测 codex 是否已装/已登录（无该 IPC）：如实在卡里写明前提，别假装知道（D4 诚实交付）。
 */
import React from 'react'
import { MODEL_ACCESS_ENTRY } from '../../../electron/shared/modelAccessCapabilities'
import { useTranslation } from 'react-i18next'
import { IconSparkles, IconCircleCheck } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../toast'
import { FoldableModelCard } from './FoldableModelCard'
import { CODEX_LOCAL_VENDOR_KEY } from './codexLocalProvider'

type CodexLocalImageCardProps = {
  /** vendor.enabled（父组件从 listVendors 下传，单一来源）。 */
  enabled: boolean
  /** 开/关后冒泡，父组件重查 + 重新分桶。 */
  onChanged: () => void
}

export function CodexLocalImageCard({ enabled, onChanged }: CodexLocalImageCardProps): JSX.Element | null {
  const { t } = useTranslation()
  const catalog = getDesktopBridge()?.modelCatalog
  const [busy, setBusy] = React.useState(false)

  // 老 preload（无模型目录口）：整卡不显，避免坏入口。
  if (!catalog?.upsertVendor) return null

  const toggle = (next: boolean) => {
    setBusy(true)
    try {
      // 只翻 enabled——applyVendorUpsert 保留 authType/baseUrl（同 ComfyuiLocalCard）。
      catalog.upsertVendor({ key: CODEX_LOCAL_VENDOR_KEY, enabled: next })
      onChanged()
      toast(t(next ? 'onboardingProviders.codexImage.enabledToast' : 'onboardingProviders.codexImage.disabledToast'), 'success')
    } finally {
      setBusy(false)
    }
  }

  return (
    <FoldableModelCard
      dataAccessEntry={MODEL_ACCESS_ENTRY.codexLocal}
      glyph={<IconSparkles size={16} stroke={1.6} />}
      glyphTone="ink"
      name={t('onboardingProviders.codexImage.name')}
      subtitle={t('onboardingProviders.codexImage.subtitle')}
      status={enabled ? 'ok' : 'todo'}
      statusLabel={t(enabled ? 'onboardingProviders.codexImage.status.on' : 'onboardingProviders.codexImage.status.off')}
      defaultExpanded={false}
    >
      {enabled ? (
        <div className="flex items-start gap-2 rounded-nomi-sm bg-nomi-accent-soft px-3 py-2.5">
          <IconCircleCheck size={17} className="shrink-0 mt-0.5 text-nomi-accent" />
          <div className="min-w-0">
            <div className="text-body-sm font-semibold text-nomi-ink">{t('onboardingProviders.codexImage.readyTitle')}</div>
            <div className="text-caption text-nomi-ink-60 mt-0.5">{t('onboardingProviders.codexImage.readyBody')}</div>
          </div>
        </div>
      ) : null}

      <div className="text-caption text-nomi-ink-60 leading-relaxed">{t('onboardingProviders.codexImage.requirement')}</div>
      {/* 明说和「接入 AI 编程助手」是两回事——那张卡是「助手来用 Nomi」，这张是「Nomi 用 Codex 出图」。 */}
      <div className="text-caption text-nomi-ink-40 leading-relaxed">{t('onboardingProviders.codexImage.notTheSame')}</div>

      {enabled ? (
        <button
          type="button"
          onClick={() => toggle(false)}
          disabled={busy}
          className="self-start text-caption text-nomi-ink-40 hover:text-workbench-danger disabled:opacity-50"
        >
          {t('onboardingProviders.codexImage.turnOff')}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => toggle(true)}
          disabled={busy}
          className={cn(
            'w-full h-9 rounded-nomi-sm bg-nomi-ink text-nomi-paper',
            'text-body-sm font-semibold inline-flex items-center justify-center gap-1.5',
            'hover:bg-nomi-accent disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <IconSparkles size={15} stroke={1.8} />
          {t('onboardingProviders.codexImage.turnOn')}
        </button>
      )}
    </FoldableModelCard>
  )
}
