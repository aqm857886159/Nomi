// 设计实验室 · 宿主接入配置 · 「已修复，去重启助手」提示
//
// 这一条是给用户拍板的那一格：Nomi 启动时把某个编程助手指着旧入口的 Nomi 接入配置修回来了，
// 但那个助手的进程早就把旧配置读进内存了——不重启就一直连不上。这句话必须出现在用户眼前，
// 不是日志里（生产路径：electron/main.ts → capabilityApplyHandler 的 `host-config.repaired`）。
//
// 为什么必须在实验室里有一格：这句提示是**一闪而过**的浮层，只在「启动时刚好修好了配置」
// 那一瞬间出现。它在真机上极难复现（配置得先坏、还得坏成 Nomi 自己写过的那几种形状），
// 没有这一格就没有任何可回归、可拍板的对象。
//
// 取景为什么是 viewport：toast 走 Mantine 单容器 Portal 到 body（见 src/ui/toast.tsx），
// 根本不在舞台的 DOM 子树里，按元素截会截出一张「什么都没发生」的假证据。
import React from 'react'
import i18n from '../../../../i18n'
import { useToastStore } from '../../../../ui/toast'
import type { LabState } from '../../labScreen'

const STAGE = { width: 520, height: 320 }

/**
 * `ttl: false` 是**取景需要**，不是另一套 toast：走的仍是全仓唯一的 toast store 与
 * `buildToastNotification`，只是不让它在基线还没拍完之前自己消失（默认 info 档 3s）。
 * 自动消失的时长属于交互契约，由单测钉；这一格钉的是它长什么样。
 */
function RepairedNotice({ clients }: { clients: string }): JSX.Element {
  React.useEffect(() => {
    useToastStore.getState().push({
      message: i18n.t('studio.hostConfigRepaired', { clients }),
      type: 'info',
      ttl: false,
      id: `design-lab:host-config-repaired:${clients}`,
    })
  }, [clients])
  return (
    <div
      className="flex h-full w-full items-end rounded-nomi border border-nomi-line bg-[var(--workbench-surface)] p-4 text-caption text-nomi-ink-60"
      style={{ width: STAGE.width, height: STAGE.height }}
      data-design-lab-stage="notice"
    >
      Nomi 启动 · 已修好 {clients} 的接入配置
    </div>
  )
}

export const HOST_CONFIG_STATES: readonly LabState[] = [
  {
    id: 'host-config-01-repaired-one',
    name: '修好一个助手 · 重启提示',
    source: '现役 capabilityApplyHandler.ts `host-config.repaired` → src/ui/toast.tsx',
    coverage: 'shell',
    capture: 'viewport',
    render: () => <RepairedNotice clients="Claude Code" />,
  },
  {
    id: 'host-config-02-repaired-many',
    name: '一次修好多个助手 · 名单会换行',
    // 同一个修复函数扫的是 Claude Code / Cursor / Codex + 用户自建 profile，
    // 一次修好两个是真实存在的情况——名单一长，这条提示就是两行，得看得出来还站得住。
    source: '现役 repairStaleMcpConfigs() 一次可修多个客户端（electron/capabilityCore/mcpConfig.ts）',
    coverage: 'shell',
    capture: 'viewport',
    render: () => <RepairedNotice clients="Claude Code、Codex" />,
  },
]
