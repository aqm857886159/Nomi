/**
 * 点中节点后弹的「这个节点在画布上当什么」菜单 —— 这页存在的理由就是它。
 * plan: docs/plan/2026-08-12-model-settings-home-and-comfyui-workflow-page.md
 *
 * 原来用户要在一条 320px 窄栏里对着下拉框猜「#110 CLIPTextEncode 是不是提示词」
 * （2026-08-11 那次反馈的体验根源）。现在：看着图上那张卡，点它，说「你是提示词」。
 *
 * 两段（§1.5「分段要有名字」——两段作用域不同，必须视觉可分）：
 *   ① 在画布上当 —— 角色。候选由分析推导，一个输入一行；再点一次取消。
 *   ② 变成画布上的可调字段 —— 把标量输入暴露成画布上的可填控件；再点一次撤掉。
 *
 * 菜单**不进被 transform 的那层**：它跟着缩放一起缩就没法读了。故坐标由调用方按
 * 「节点位置 × zoom + 位移」换算成容器坐标传进来，菜单自己保持 1:1。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import type { FieldChoice, RoleChoice, WorkflowCandidate, WorkflowRole } from '../comfyuiWorkflowBinding'
import { ROLE_TONES } from './roleTone'

export const MENU_WIDTH = 244

type WorkflowNodeMenuProps = {
  nodeId: string
  /** 容器坐标（已算过缩放/位移），左上角。 */
  position: { x: number; y: number }
  roleChoices: RoleChoice[]
  fieldChoices: FieldChoice[]
  /** 同一个输入既有多个同类候选时才显 inputKey——只有一个时显它是噪音。 */
  onPickRole: (choice: RoleChoice) => void
  onClearRole: (role: Exclude<WorkflowRole, 'output'>) => void
  onToggleField: (candidate: WorkflowCandidate) => void
  onClose: () => void
}

function needsInputSuffix(choices: RoleChoice[], role: WorkflowRole): boolean {
  return choices.filter((c) => c.role === role).length > 1
}

export function WorkflowNodeMenu({
  nodeId,
  position,
  roleChoices,
  fieldChoices,
  onPickRole,
  onClearRole,
  onToggleField,
  onClose,
}: WorkflowNodeMenuProps): JSX.Element {
  const { t } = useTranslation()
  const ref = React.useRef<HTMLDivElement>(null)

  // Esc 收菜单。capture 阶段拦下来并 stopPropagation：否则会一路冒到设置对话框那个
  // window keydown，把整张设置一起关掉（走查栽过同类）。
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  React.useEffect(() => {
    ref.current?.focus()
  }, [nodeId])

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="menu"
      aria-label={t('comfyuiWorkflowPage.menu.aria', { id: nodeId })}
      className={cn(
        'absolute z-[3] flex flex-col gap-1 rounded-nomi border border-nomi-line bg-nomi-paper p-1.5 shadow-nomi-lg outline-none',
      )}
      style={{ left: position.x, top: position.y, width: MENU_WIDTH }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-1 px-1">
        <span className="flex-1 font-nomi-mono text-micro text-nomi-ink-40">#{nodeId}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('comfyuiWorkflowPage.menu.close')}
          className="grid size-5 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink"
        >
          <IconX size={12} stroke={1.8} aria-hidden="true" />
        </button>
      </div>

      <div className="px-1 text-micro font-semibold text-nomi-ink-40">{t('comfyuiWorkflowPage.menu.roleSection')}</div>
      {roleChoices.length === 0 ? (
        <div className="px-1 pb-1 text-micro text-nomi-ink-30">{t('comfyuiWorkflowPage.menu.roleEmpty')}</div>
      ) : (
        roleChoices.map((choice) => {
          const tone = ROLE_TONES[choice.role]
          const suffix = choice.inputKey && needsInputSuffix(roleChoices, choice.role)
            ? ` ${t('comfyuiWorkflowPage.menu.inputSuffix', { key: choice.inputKey })}`
            : ''
          return (
            <button
              key={`${choice.role}:${choice.inputKey ?? ''}`}
              type="button"
              role="menuitemradio"
              aria-checked={choice.active}
              onClick={() => {
                // 成品不给取消：没有成品节点就取不回结果，摆一个能把工作流点废的选项不是自由，是坑。
                if (choice.active && choice.role !== 'output') onClearRole(choice.role)
                else onPickRole(choice)
              }}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-nomi-sm px-2 text-left text-caption',
                choice.active ? cn(tone.soft, tone.text) : 'text-nomi-ink-80 hover:bg-nomi-ink-05 hover:text-nomi-ink',
              )}
            >
              <tone.Icon size={14} stroke={1.8} aria-hidden="true" className={choice.active ? undefined : 'text-nomi-ink-40'} />
              <span className="min-w-0 flex-1 truncate">{t(tone.labelKey)}{suffix}</span>
              {choice.active ? (
                choice.role === 'output'
                  ? <IconCheck size={13} stroke={2} aria-hidden="true" />
                  : <span className="shrink-0 text-micro text-nomi-ink-40">{t('comfyuiWorkflowPage.menu.clear')}</span>
              ) : null}
            </button>
          )
        })
      )}

      <div className="mt-0.5 border-t border-nomi-line-soft pt-1.5">
        <div className="px-1 text-micro font-semibold text-nomi-ink-40">{t('comfyuiWorkflowPage.menu.fieldSection')}</div>
      </div>
      {fieldChoices.length === 0 ? (
        <div className="px-1 pb-1 text-micro text-nomi-ink-30">{t('comfyuiWorkflowPage.menu.fieldEmpty')}</div>
      ) : (
        fieldChoices.map(({ candidate, exposed }) => (
          <button
            key={candidate.inputKey}
            type="button"
            role="menuitemcheckbox"
            aria-checked={exposed}
            onClick={() => onToggleField(candidate)}
            className={cn(
              'flex h-8 w-full items-center gap-2 rounded-nomi-sm px-2 text-left text-caption',
              exposed ? 'bg-nomi-accent-soft text-nomi-accent' : 'text-nomi-ink-80 hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
          >
            <span className="min-w-0 flex-1 truncate font-nomi-mono text-micro">{candidate.inputKey}</span>
            <span className="shrink-0 truncate text-micro text-nomi-ink-40">{String(candidate.value).slice(0, 10)}</span>
            {exposed ? <IconCheck size={13} stroke={2} aria-hidden="true" /> : null}
          </button>
        ))
      )}
    </div>
  )
}
