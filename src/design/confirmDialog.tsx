// 破坏性操作确认原语（审计 A7 根治）。
// 此前全仓 11 处 window.confirm/alert/prompt：视觉脱离设计系统、Playwright 驱动
// 自动 dismiss 导致删除链路永远测不到、Electron 下原生弹窗在 macOS 有焦点丢失史。
// promise 风格 API（confirmDialog/alertDialog/promptDialog）在 confirmDialogStore.ts，
// 谁写不可逆操作都走这里——原生三件套从此禁用（设计系统 §3.5）。
import React, { type JSX } from 'react'
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react'
import { DesignModal } from './overlays'
import { DecisionBar } from './decisionBar'
import { cn } from '../utils/cn'
import { bindConfirmDialogHost, confirmDialog, type DialogRequest } from './confirmDialogStore'
import { useTranslation } from 'react-i18next'
import { NOMI_OVERLAY_Z_INDEX } from './overlayLayers'

/**
 * 全局宿主：App 根部挂一次。多请求按序排队逐个展示。
 * Confirmation is the final decision layer and must stay above every application dialog/page.
 */
export function ConfirmDialogHost(): JSX.Element {
  const { t } = useTranslation()
  const [active, setActive] = React.useState<DialogRequest | null>(null)
  const [inputValue, setInputValue] = React.useState('')
  const [toggleOn, setToggleOn] = React.useState(false)
  const pendingRef = React.useRef<DialogRequest[]>([])

  React.useEffect(() => {
    const dispatch = (request: DialogRequest): void => {
      setActive((current) => {
        if (!current) return request
        pendingRef.current.push(request)
        return current
      })
    }
    const backlog = bindConfirmDialogHost(dispatch)
    backlog.forEach(dispatch)
    return () => {
      bindConfirmDialogHost(null)
    }
  }, [])

  React.useEffect(() => {
    setInputValue(active?.kind === 'prompt' ? (active.initialValue ?? '') : '')
    // 勾选项每次都从「没勾」开始：它表达的是「这一次要不要覆盖」，不是一条会被记住的偏好。
    setToggleOn(false)
  }, [active])

  // E2E 专用桥（同 NomiStudioApp/CameraMoveCaptureHost 既有写法）：仅当 localStorage['__nomiE2E']==='1'
  // 时把**真实** confirmDialog 挂到 window，供 R13 走查在页面上下文里驱动同一条渲染管线
  // （confirmDialog → 本 Host → DesignModal → Mantine Modal）取证「弹层是否真的可见、可点」。
  // 用途见 tests/ux/hosting-consent-dialog.walk.mjs：以素材托管确认卡的真 i18n 文案复现同一棵组件树，
  // 钉死「卡可见/居中/可点、取消后遮罩清干净」（F16 那次「零高不可见」实为量错节点的假警报，
  // 详见 docs/plan/2026-08-25-f16-hosting-consent-dialog.md）。生产从不置该标志 → 永不暴露，非并行实现。
  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage?.getItem('__nomiE2E') === '1') {
        ;(window as unknown as { __nomiConfirmDialogE2E?: typeof confirmDialog }).__nomiConfirmDialogE2E = confirmDialog
      }
    } catch {
      // localStorage 不可用 → 跳过
    }
  }, [])

  const settle = (value: boolean | string | null): void => {
    active?.resolve(value)
    setActive(pendingRef.current.shift() ?? null)
  }

  const cancelValue = active?.kind === 'prompt' ? null : false
  const tone = active?.tone ?? 'default'
  const ToneIcon = tone === 'info' ? IconInfoCircle : tone === 'danger' ? IconAlertTriangle : null

  return (
    <DesignModal
      opened={Boolean(active)}
      onClose={() => settle(cancelValue)}
      title={active?.title ?? ''}
      centered
      size="sm"
      zIndex={NOMI_OVERLAY_Z_INDEX.confirmation}
      data-confirm-dialog={active ? active.kind : undefined}
    >
      {/*
        data-confirm-dialog 落在 Mantine Modal 的 **root**（静态壳，子层 position:fixed 脱流），
        故 root 的 getBoundingClientRect 天生是 {w:100vw, h:0}——这是 Mantine 结构使然、不是 bug。
        走查/工具若拿 [data-confirm-dialog] 量几何会误判「卡塌成 0 高」（F16 假警报即源于此）。
        把可量的表面标记 data-confirm-dialog-surface 放在**可见 content 内**的这个 wrapper 上，
        它带真实宽高，验可见性/居中/命中都盯它，别盯 root。
      */}
      <div className={cn('flex flex-col gap-3')} data-confirm-dialog-surface={active ? active.kind : undefined}>
        {active?.message || ToneIcon ? (
          <div className={cn('flex gap-3')}>
            {ToneIcon ? (
              <span
                className={cn(
                  'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
                  tone === 'danger'
                    ? 'bg-workbench-danger-soft text-workbench-danger'
                    : 'bg-nomi-accent-soft text-nomi-accent',
                )}
                aria-hidden="true"
              >
                <ToneIcon size={17} stroke={1.9} />
              </span>
            ) : null}
            {active?.message ? (
              <p className={cn('m-0 min-w-0 flex-1 text-caption text-nomi-ink-80 whitespace-pre-line')}>
                {active.message}
              </p>
            ) : null}
          </div>
        ) : null}
        {active?.toggle ? (
          <label className={cn('flex cursor-pointer items-start gap-2 text-caption text-nomi-ink-80')}>
            <input
              type="checkbox"
              checked={toggleOn}
              data-confirm-dialog-toggle="true"
              className={cn('mt-0.5 size-3.5 shrink-0 accent-[var(--nomi-ink)]')}
              onChange={(event) => setToggleOn(event.target.checked)}
            />
            <span className="min-w-0 flex-1">{active.toggle.label}</span>
          </label>
        ) : null}
        {active?.kind === 'prompt' ? (
          <input
            autoFocus
            value={inputValue}
            placeholder={active.placeholder}
            data-confirm-dialog-input="true"
            className={cn(
              'h-8 px-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper',
              'text-caption text-nomi-ink outline-none focus:border-nomi-ink-40',
            )}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') settle(inputValue)
            }}
          />
        ) : null}
        <DecisionBar
          cancelLabel={active?.kind !== 'alert' ? (active?.cancelLabel ?? t('runtime.design.cancel')) : undefined}
          onCancel={() => settle(cancelValue)}
          cancelProps={{ 'data-confirm-dialog-cancel': 'true' }}
          primaryLabel={active?.confirmLabel ??
            (active?.kind === 'alert' ? t('runtime.design.gotIt') : t('runtime.design.confirm'))}
          onPrimary={() => settle(
            active?.kind === 'prompt' ? inputValue : active?.toggle ? (toggleOn ? 'toggle-on' : 'toggle-off') : true,
          )}
          primaryProps={{ 'data-confirm-dialog-confirm': 'true' }}
          tone={active?.danger ? 'danger' : 'default'}
          dangerClassName="bg-[var(--nomi-snap-tag)] text-[var(--nomi-paper)] hover:bg-[var(--nomi-snap-tag)] hover:text-[var(--nomi-paper)] hover:shadow-nomi-sm"
        />
      </div>
    </DesignModal>
  )
}
