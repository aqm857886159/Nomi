import { createTheme, type CSSVariablesResolver } from '@mantine/core'
import { NOMI_OVERLAY_Z_INDEX } from '../design/overlayLayers'

/**
 * Mantine 原生色板 → Nomi 语义色（设计系统 §2.1.2c）。
 *
 * 为什么要有这层：Mantine 组件（Badge / Alert / Progress / Notification…）的 `color` prop 收的是
 * **色板名**（`red` / `grape` / `teal`…），不是我们的语义 token。不重映射的话，随手写一个
 * `color="grape"` 就能绕过整套 token 体系，把 Mantine 自带的紫直接上到屏幕上——设计实验室的
 * PRO 徽章曾经就是这么在四套候选配色下岿然不动地保持紫色的。
 *
 * 根因防线在组件层（`StatusBadge` / `DesignBadge` 都只收封闭的 `tone` 词表，不透传裸 `color`）；
 * 这层是**第二道**：即使有人直接从 Mantine import 一个组件写裸色名，落地的也是 Nomi 的语义色。
 *
 * 映射只往四个语义收（不给「第五种红」留位置）。中性的 `gray`/`dark` 不映射：
 * 它们本来就是灰阶，且 `primaryColor: 'dark'` 依赖它。
 */
const MANTINE_SEMANTIC_MAP: Record<string, 'danger' | 'warning' | 'success' | 'info'> = {
  red: 'danger',
  pink: 'danger',
  yellow: 'warning',
  orange: 'warning',
  green: 'success',
  teal: 'success',
  lime: 'success',
  blue: 'info',
  cyan: 'info',
  indigo: 'info',
  violet: 'info',
  grape: 'info',
}

function semanticPalette(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [mantine, semantic] of Object.entries(MANTINE_SEMANTIC_MAP)) {
    out[`--mantine-color-${mantine}-light`] = `var(--nomi-${semantic}-soft)`
    out[`--mantine-color-${mantine}-light-hover`] = `var(--nomi-${semantic}-edge)`
    out[`--mantine-color-${mantine}-light-color`] = `var(--nomi-${semantic}-ink)`
    out[`--mantine-color-${mantine}-filled`] = `var(--nomi-${semantic})`
    out[`--mantine-color-${mantine}-filled-hover`] = `var(--nomi-${semantic}-ink)`
    out[`--mantine-color-${mantine}-outline`] = `var(--nomi-${semantic}-ink)`
    out[`--mantine-color-${mantine}-outline-hover`] = `var(--nomi-${semantic}-soft)`
    // Progress / Badge dot / Loader 直接读 -6 / -4 这两档色阶。
    out[`--mantine-color-${mantine}-6`] = `var(--nomi-${semantic})`
    out[`--mantine-color-${mantine}-4`] = `var(--nomi-${semantic})`
  }
  return out
}

/**
 * ⚠️ 必须走 Mantine 自己的 `cssVariablesResolver`，**不能**在 `tailwind.config.ts` 的 addBase 里
 * 写一份 `--mantine-color-*`（2026-09-07 试过，暗色实测被打回原生色）。两个原因叠在一起：
 *   ① Mantine 把 `-light` / `-light-hover` / `-light-color` / `-outline` 一族定义在
 *      `:root[data-mantine-color-scheme='light'|'dark']` 里，特指度 (0,2,0) 高于裸 `:root` 的 (0,1,0)；
 *   ② 这些变量是 `MantineProvider` 在**运行时**注入 `<style>` 到 head 的，永远排在我们的
 *      样式表后面——同特指度下它赢。
 * 结果是 `-filled`（Mantine 写在裸 :root）跟着我们、`-light` 跟着 Mantine，同一个 Badge 的两个
 * variant 一个 Nomi 红一个 Mantine 红并排。走 resolver 则是在 Mantine 自己的生成物里覆盖，稳。
 *
 * 三个位置都给同一张表：右边全是 `var(--nomi-*)`，而那些变量自己在暗色块翻转，
 * 所以明暗两套字面内容相同、解析结果自动不同——不需要维护两份值（P1「一份定义」）。
 */
export const nomiCssVariablesResolver: CSSVariablesResolver = () => {
  const palette = semanticPalette()
  return { variables: palette, light: palette, dark: palette }
}

export const nomiDesignTokens = {
  radius: {
    sharp: '0px',
    field: '6px',
    panel: '10px',
    modal: '14px',
    pill: '999px'
  },
  spacing: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
    10: '40px'
  },
  fontSize: {
    micro: '11px',
    caption: '12px',
    bodySm: '13px',
    body: '14px',
    title: '16px',
    h2: '20px',
    h1: '24px'
  },
  lineHeight: {
    micro: '14px',
    caption: '16px',
    bodySm: '18px',
    body: '20px',
    title: '22px',
    h2: '26px',
    h1: '30px'
  },
  shadow: {
    subtle: '0 10px 24px rgba(0, 0, 0, 0.18)',
    panel: '0 18px 40px rgba(0, 0, 0, 0.28)',
    modal: '0 28px 64px rgba(0, 0, 0, 0.4)'
  }
} as const

// Mantine 字体与 CSS/Tailwind 共用同一真相源（nomi-tokens.css）——否则会出现
// 「Mantine 组件用系统字体、其余 UI 用打包的 Inter Variable」两套字体并排的不一致
// （2026-06-21 实测 Mantine 408px vs CSS 432px 的根因）。指向 var 后两边都吃 Inter/Fraunces Variable。
const sansSerifFontFamily = 'var(--nomi-font-sans)'
const monospaceFontFamily = 'var(--nomi-font-mono)'

export function buildNomiTheme() {
  return createTheme({
    focusRing: 'auto',
    cursorType: 'pointer',
    defaultRadius: 'xs',
    primaryColor: 'dark',
    primaryShade: { light: 6, dark: 4 },
    fontFamily: sansSerifFontFamily,
    fontFamilyMonospace: monospaceFontFamily,
    radius: {
      xs: nomiDesignTokens.radius.field,
      sm: nomiDesignTokens.radius.panel,
      md: nomiDesignTokens.radius.modal,
      lg: nomiDesignTokens.radius.modal,
      xl: nomiDesignTokens.radius.modal
    },
    spacing: {
      xs: nomiDesignTokens.spacing[2],
      sm: nomiDesignTokens.spacing[3],
      md: nomiDesignTokens.spacing[4],
      lg: nomiDesignTokens.spacing[5],
      xl: nomiDesignTokens.spacing[6]
    },
    fontSizes: {
      xs: nomiDesignTokens.fontSize.micro,
      sm: nomiDesignTokens.fontSize.caption,
      md: nomiDesignTokens.fontSize.bodySm,
      lg: nomiDesignTokens.fontSize.body,
      xl: nomiDesignTokens.fontSize.title
    },
    lineHeights: {
      xs: nomiDesignTokens.lineHeight.micro,
      sm: nomiDesignTokens.lineHeight.caption,
      md: nomiDesignTokens.lineHeight.bodySm,
      lg: nomiDesignTokens.lineHeight.body,
      xl: nomiDesignTokens.lineHeight.title
    },
    headings: {
      fontFamily: sansSerifFontFamily,
      fontWeight: '700',
      textWrap: 'balance',
      sizes: {
        h1: {
          fontSize: nomiDesignTokens.fontSize.h1,
          lineHeight: nomiDesignTokens.lineHeight.h1
        },
        h2: {
          fontSize: nomiDesignTokens.fontSize.h2,
          lineHeight: nomiDesignTokens.lineHeight.h2,
          fontWeight: '650'
        },
        h3: {
          fontSize: nomiDesignTokens.fontSize.title,
          lineHeight: nomiDesignTokens.lineHeight.title,
          fontWeight: '650'
        },
        h4: {
          fontSize: nomiDesignTokens.fontSize.body,
          lineHeight: nomiDesignTokens.lineHeight.body,
          fontWeight: '650'
        },
        h5: {
          fontSize: nomiDesignTokens.fontSize.bodySm,
          lineHeight: nomiDesignTokens.lineHeight.bodySm,
          fontWeight: '600'
        },
        h6: {
          fontSize: nomiDesignTokens.fontSize.caption,
          lineHeight: nomiDesignTokens.lineHeight.caption,
          fontWeight: '600'
        }
      }
    },
    shadows: {
      xs: nomiDesignTokens.shadow.subtle,
      sm: nomiDesignTokens.shadow.subtle,
      md: nomiDesignTokens.shadow.panel,
      lg: nomiDesignTokens.shadow.modal,
      xl: nomiDesignTokens.shadow.modal
    },
    other: {
      design: nomiDesignTokens
    },
    components: {
      Button: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        },
        styles: {
          root: {
            fontWeight: 600,
            letterSpacing: '0.01em'
          }
        }
      },
      ActionIcon: {
        defaultProps: {
          radius: 'xs',
          size: 'md',
          variant: 'subtle'
        }
      },
      TextInput: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        }
      },
      PasswordInput: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        }
      },
      NumberInput: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
        }
      },
      Textarea: {
        defaultProps: {
          radius: 'xs',
          size: 'sm',
          autosize: true,
          minRows: 3
        }
      },
      Select: {
        defaultProps: {
          radius: 'xs',
          size: 'sm',
          comboboxProps: { zIndex: NOMI_OVERLAY_Z_INDEX.popover }
        }
      },
      MultiSelect: {
        defaultProps: {
          radius: 'xs',
          size: 'sm',
          comboboxProps: { zIndex: NOMI_OVERLAY_Z_INDEX.popover }
        }
      },
      Card: {
        defaultProps: {
          radius: 'sm',
          padding: 'md'
        },
      },
      Paper: {
        defaultProps: {
          radius: 'sm'
        }
      },
      Modal: {
        defaultProps: {
          radius: 'md',
          shadow: 'lg',
          zIndex: NOMI_OVERLAY_Z_INDEX.dialog
        }
      },
      Drawer: {
        defaultProps: {
          radius: 'sm',
          shadow: 'lg',
          zIndex: NOMI_OVERLAY_Z_INDEX.dialog
        }
      },
      Menu: {
        defaultProps: {
          radius: 'sm',
          shadow: 'md',
          zIndex: NOMI_OVERLAY_Z_INDEX.popover
        }
      },
      Popover: {
        defaultProps: {
          radius: 'sm',
          shadow: 'md',
          zIndex: NOMI_OVERLAY_Z_INDEX.popover
        }
      },
      Tabs: {
        defaultProps: {
          radius: 'sm'
        }
      },
      Badge: {
        defaultProps: {
          radius: 999
        },
        styles: {
          root: {
            fontWeight: 600,
            letterSpacing: '0.02em'
          }
        }
      },
      Tooltip: {
        defaultProps: {
          openDelay: 140
        }
      },
      Notification: {
        defaultProps: {
          radius: 'sm',
          withBorder: true
        },
        styles: {
          root: {
            minHeight: '44px',
            padding: '10px 10px 10px 12px',
            backgroundColor: 'var(--nomi-paper)',
            borderColor: 'var(--nomi-line)',
            boxShadow: 'var(--nomi-shadow-md)'
          },
          icon: {
            width: '20px',
            height: '20px',
            minWidth: '20px',
            marginInlineEnd: nomiDesignTokens.spacing[2],
            backgroundColor: 'transparent',
            color: 'var(--notification-color, var(--nomi-accent))'
          },
          body: {
            marginInlineEnd: nomiDesignTokens.spacing[1]
          },
          description: {
            color: 'var(--nomi-ink-80)',
            fontSize: nomiDesignTokens.fontSize.bodySm,
            lineHeight: nomiDesignTokens.lineHeight.bodySm
          },
          closeButton: {
            color: 'var(--nomi-ink-40)',
            borderRadius: nomiDesignTokens.radius.field
          }
        }
      }
    }
  })
}
