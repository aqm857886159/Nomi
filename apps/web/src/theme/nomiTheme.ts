import { createTheme } from '@mantine/core'

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

const sansSerifFontFamily = [
  'Inter',
  'ui-sans-serif',
  'system-ui',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'sans-serif'
].join(', ')

const monospaceFontFamily = [
  'ui-monospace',
  '"SFMono-Regular"',
  'Menlo',
  'Monaco',
  'Consolas',
  'monospace'
].join(', ')

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
          size: 'sm'
        }
      },
      MultiSelect: {
        defaultProps: {
          radius: 'xs',
          size: 'sm'
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
          shadow: 'lg'
        }
      },
      Drawer: {
        defaultProps: {
          radius: 'sm',
          shadow: 'lg'
        }
      },
      Menu: {
        defaultProps: {
          radius: 'sm',
          shadow: 'md'
        }
      },
      Popover: {
        defaultProps: {
          radius: 'sm',
          shadow: 'md'
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
      }
    }
  })
}
