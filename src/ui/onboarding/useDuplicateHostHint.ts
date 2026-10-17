/**
 * 添加连接表单里那行 hint 的**接线**（issue #831）。
 *
 * 判据住 `duplicateHostConnections.ts`（纯函数、单独测）；本 hook 只干两件接线的活：
 * 从既有 bridge 读目录里已有的连接，把判据翻成那一行要显示的字 + 走查用的 marker。
 *
 * 为什么不塞回 OnboardingWizard：那个组件已经 800 行整（R9 硬上限），这段一进去就顶破。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { getDesktopBridge } from '../../desktop/bridge'
import { duplicateHostVerdict, type DuplicateHostConnection } from './duplicateHostConnections'

export type DuplicateHostHint = {
  /** 这一行要显示的字。撞域名时是动态句，否则是传进来的那句静态 hint。 */
  text: string
  /** 句子里要抬成 ink 色 + 中粗的那一段 = 已有连接的名字（拍板：只有连接名抬）。 */
  emphasis?: string
  /** 走查锚点；不撞时为 undefined（那一行就是原来那句静态 hint）。 */
  marker?: string
}

export function useDuplicateHostHint(input: {
  /** 抽屉是否打开——只在打开那一刻读一次目录，不每次输入都去问主进程。 */
  opened: boolean
  baseUrl: string
  name: string
  /** 没撞上时显示的原句。 */
  fallbackHint: string
}): DuplicateHostHint {
  const { t } = useTranslation()
  const [connections, setConnections] = React.useState<DuplicateHostConnection[]>([])

  React.useEffect(() => {
    if (!input.opened) return
    let alive = true
    // 目录读是异步 IPC（同步通道已删）。
    void Promise.resolve(getDesktopBridge()?.modelCatalog?.listVendors?.())
      .then((rows) => {
        if (!alive || !Array.isArray(rows)) return
        setConnections(
          (rows as Array<Record<string, unknown>>)
            .map((row) => ({
              vendorKey: String(row.key || ''),
              name: String(row.name || row.key || ''),
              baseUrl: String(row.baseUrlHint || ''),
            }))
            .filter((row) => row.vendorKey && row.baseUrl),
        )
      })
      .catch(() => undefined)
    return () => { alive = false }
  }, [input.opened])

  const verdict = React.useMemo(
    () => duplicateHostVerdict({ baseUrl: input.baseUrl, name: input.name, connections }),
    [input.baseUrl, input.name, connections],
  )

  if (verdict.kind === 'none') return { text: input.fallbackHint }
  return {
    text:
      verdict.kind === 'create'
        ? t('modelSetup.baseUrlDuplicateCreate', { name: verdict.existingName })
        : t('modelSetup.baseUrlDuplicateUpdate', { name: verdict.existingName }),
    emphasis: verdict.existingName,
    marker: `duplicate-host-${verdict.kind}`,
  }
}
