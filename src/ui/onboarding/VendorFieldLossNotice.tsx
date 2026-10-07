/**
 * 「这家的两项声明可能在旧版本里丢了」——一次性、可关掉的诚实交代（D4：缺口明着标，不藏）。
 *
 * 为什么要它：`upsertDraft.ts` 止住的是未来的丢失，**已经被抹掉的记录不会自己回来**。
 * 内置供应商有代码侧出处（`BUILTIN_VENDOR_SEEDS`），v12→v13 迁移已按种子补回；自建连接
 * 的出处只在用户手上那份接入包里，我们补不了——补不了就必须说出来，而不是让他几天后
 * 对着一张「参考图没生效」的图自己猜（见 electron/catalog/vendorFieldLossRepair.ts 的盘点）。
 *
 * 为什么长在连接卡里而不是做成全局横幅：提示要回答「哪家」，而「哪家」最省事的答法就是
 * 长在那家自己的卡上；重填的入口（改地址 / 换 key / 重新导入包）也都在这一屏（§1.5 一功能一个家）。
 * 关掉走的是现成的 upsertVendor 写回 meta，不新造 IPC、不新造通知系统（P1）。
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconInfoCircle } from '@tabler/icons-react'

type VendorFieldLossNoticeProps = {
  /** 迁移盖的时间戳；空 = 这家没被盖过，什么都不渲染。 */
  noticeAt?: string | null
  onDismiss: () => void
  disabled?: boolean
}

export function VendorFieldLossNotice({ noticeAt, onDismiss, disabled }: VendorFieldLossNoticeProps): JSX.Element | null {
  const { t } = useTranslation()
  if (!noticeAt) return null
  return (
    <div className="rounded-nomi-sm bg-nomi-ink-05 px-2.5 py-2 flex flex-col gap-2" data-vendor-field-loss-notice>
      <div className="flex gap-1.5 items-start">
        <IconInfoCircle size={14} stroke={1.7} className="shrink-0 mt-[1px] text-nomi-ink-40" />
        <span className="flex flex-col gap-1 min-w-0">
          <span className="text-caption font-semibold text-nomi-ink leading-relaxed">
            {t('onboardingProviders.customVendor.fieldLossTitle')}
          </span>
          <span className="text-caption text-nomi-ink-60 leading-relaxed">
            {t('onboardingProviders.customVendor.fieldLossBody')}
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        disabled={disabled}
        className="self-start inline-flex items-center h-7 px-2.5 rounded-nomi-sm bg-nomi-ink text-nomi-paper text-caption font-semibold hover:bg-nomi-accent disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {t('runtime.design.gotIt')}
      </button>
    </div>
  )
}
