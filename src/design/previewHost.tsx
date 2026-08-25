// 设计系统「预览宿主」——给**不带 App 外壳**的渲染环境用的最小 provider。
//
// 为什么需要它：src/design 里有 5 个组件（NomiWordmark / NomiBrand / NomiLoadingMark /
// NomiAILabel / NomiStepper / NomiSkeleton / NomiImage / NomiSelect / ConfirmDialogHost）
// 直接 useTranslation()，另有一半组件是 Mantine 封装、要 MantineProvider 才拿得到主题。
// 真 App 由 src/NomiAppProviders.tsx 提供这两层，但那个文件 import 了 src/i18n（→ Electron
// desktop bridge）和 ModalsProvider/Notifications，在浏览器沙箱/组件库预览里跑不起来。
//
// 这里只做**同一套配置的最小复刻**：同一份 resources（src/i18n/resources.ts 本身不碰
// Electron）、同一个 buildNomiTheme()。不是并行实现（P1）——它不参与 App 渲染路径，
// App 仍然只走 NomiAppProviders；两者共用 resources + buildNomiTheme 这两个真相源，
// 语言包或主题改了，两边同时跟着变。
//
// 用途：design-sync 组件库预览卡（cfg.provider）、以及任何需要在 App 之外单独挂载设计
// 系统组件的场景。

import React from 'react'
import { MantineProvider } from '@mantine/core'
import { I18nextProvider } from 'react-i18next'
import i18next, { type i18n as I18nInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from '../i18n/resources'
import { buildNomiTheme } from '../theme/nomiTheme'

const nomiTheme = buildNomiTheme()

/** 独立 i18next 实例：不污染 App 的全局单例，也不依赖它已被初始化。 */
let previewI18n: I18nInstance | null = null

function getPreviewI18n(locale: string): I18nInstance {
  if (!previewI18n) {
    previewI18n = i18next.createInstance()
    void previewI18n.use(initReactI18next).init({
      resources,
      lng: locale,
      fallbackLng: 'zh-CN',
      interpolation: { escapeValue: false },
      // 预览环境没有 Suspense 边界，同步拿 key，缺 key 直接回退不吊起 Suspense。
      react: { useSuspense: false },
    })
  } else if (previewI18n.language !== locale) {
    void previewI18n.changeLanguage(locale)
  }
  return previewI18n
}

export type NomiPreviewHostProps = {
  children?: React.ReactNode
  /** 预览语言，默认 zh-CN（产品默认语言）。 */
  locale?: string
  /** 'light' | 'dark'，默认 light。 */
  colorScheme?: 'light' | 'dark'
}

/**
 * 在 App 之外挂载设计系统组件时的 provider 外壳：i18n + Mantine 主题。
 * 组件库预览卡把每张卡包在它里面，所以卡上看到的文案/主题与真 App 一致。
 */
export function NomiPreviewHost({
  children,
  locale = 'zh-CN',
  colorScheme = 'light',
}: NomiPreviewHostProps): JSX.Element {
  const i18n = getPreviewI18n(locale)

  // 与真 App 的 applyColorScheme（src/theme/colorScheme.ts:57-60）落同一组属性：
  // token 暗色块钉在 :root[data-mantine-color-scheme="dark"]，Tailwind 的 dark: 变体读
  // data-theme，别只写一个——少写哪个哪层就不翻。
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    root.dataset.theme = colorScheme
    root.dataset.nomiColorScheme = colorScheme
    root.setAttribute('data-mantine-color-scheme', colorScheme)
  }, [colorScheme])

  return (
    <I18nextProvider i18n={i18n}>
      <MantineProvider theme={nomiTheme} forceColorScheme={colorScheme} defaultColorScheme={colorScheme}>
        {children}
      </MantineProvider>
    </I18nextProvider>
  )
}
