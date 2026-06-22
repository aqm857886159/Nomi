import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-mantine-color-scheme="dark"]'],
  theme: {
    extend: {
      colors: {
        // 旧 --tc-color-* 暗色层已删(§14.1)+ 4 个过渡键的最后消费者(PanoramaViewer/dead surfaces)
        // 已收口到 --nomi-* 类，过渡键随之删净。新增颜色一律进 nomi-tokens.css 的 --nomi-*。
        nomi: {
          bg: 'var(--nomi-bg)',
          paper: 'var(--nomi-paper)',
          ink: 'var(--nomi-ink)',
          'ink-80': 'var(--nomi-ink-80)',
          'ink-60': 'var(--nomi-ink-60)',
          'ink-40': 'var(--nomi-ink-40)',
          'ink-30': 'var(--nomi-ink-30)',
          'ink-20': 'var(--nomi-ink-20)',
          'ink-10': 'var(--nomi-ink-10)',
          'ink-05': 'var(--nomi-ink-05)',
          line: 'var(--nomi-line)',
          'line-soft': 'var(--nomi-line-soft)',
          accent: 'var(--nomi-accent)',
          'accent-soft': 'var(--nomi-accent-soft)',
          scrim: 'var(--nomi-scrim)',
          'overlay-chip': 'var(--nomi-overlay-chip)',
          'overlay-chip-strong': 'var(--nomi-overlay-chip-strong)',
          'media-veil': 'var(--nomi-media-veil)',
        },
        workbench: {
          bg: 'var(--workbench-bg)',
          surface: 'var(--workbench-surface)',
          'surface-solid': 'var(--workbench-surface-solid)',
          'surface-soft': 'var(--workbench-surface-soft)',
          border: 'var(--workbench-border)',
          'border-soft': 'var(--workbench-border-soft)',
          'border-strong': 'var(--workbench-border-strong)',
          ink: 'var(--workbench-ink)',
          muted: 'var(--workbench-muted)',
          'muted-soft': 'var(--workbench-muted-soft)',
          accent: 'var(--workbench-accent)',
          'accent-soft': 'var(--workbench-accent-soft)',
          success: 'var(--workbench-success)',
          'success-soft': 'var(--workbench-success-soft)',
          danger: 'var(--workbench-danger)',
          'danger-soft': 'var(--workbench-danger-soft)',
          hover: 'var(--workbench-hover)',
          pressed: 'var(--workbench-pressed)',
          overlay: 'var(--workbench-overlay)',
          backdrop: 'var(--workbench-backdrop)',
          focus: 'var(--workbench-focus)',
          'code-bg': 'var(--workbench-code-bg)',
          'code-ink': 'var(--workbench-code-ink)',
        },
      },
      borderRadius: {
        // 旧 --tc-radius-* 已删(§14.1)；恢复为字面值（与 nomiTheme.ts nomiDesignTokens.radius 一致）。
        sharp: '0px',
        field: '6px',
        panel: '10px',
        modal: '14px',
        pill: '999px',
        nomi: 'var(--nomi-radius)',
        'nomi-sm': 'var(--nomi-radius-sm)',
        'nomi-lg': 'var(--nomi-radius-lg)',
        workbench: 'var(--workbench-radius)',
        'workbench-control': 'var(--workbench-control-radius)',
      },
      fontSize: {
        // 旧 --tc-font-size-* 已删(§14.1)；恢复为字面值（与 nomiTheme.ts nomiDesignTokens.fontSize 一致）。
        // 仅 font-size、不带 line-height，与原 --tc-* 行为一致，避免改动既有布局。
        micro: '11px',
        body: '14px',
        'body-sm': '13px',
        caption: '12px',
        title: '16px',
        h2: '20px',
        h1: '24px',
        display: '28px',
      },
      fontFamily: {
        'nomi-sans': 'var(--nomi-font-sans)',
        'nomi-display': 'var(--nomi-font-display)',
        'nomi-mono': 'var(--nomi-font-mono)',
      },
      boxShadow: {
        'nomi-sm': 'var(--nomi-shadow-sm)',
        'nomi-md': 'var(--nomi-shadow-md)',
        'nomi-lg': 'var(--nomi-shadow-lg)',
        'workbench-sm': 'var(--workbench-shadow-sm)',
        'workbench-md': 'var(--workbench-shadow-md)',
        'workbench-pop': 'var(--workbench-shadow-pop)',
      },
      transitionTimingFunction: {
        'nomi-fast': 'var(--nomi-transition-fast)',
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        sheen: {
          '0%': { transform: 'translateX(-60%) rotate(12deg)', opacity: '0.35' },
          '50%': { transform: 'translateX(0%) rotate(12deg)', opacity: '0.55' },
          '100%': { transform: 'translateX(60%) rotate(12deg)', opacity: '0.35' },
        },
        'slide-right': {
          '0%': { left: '-30%' },
          '100%': { left: '100%' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'status-pulse': {
          '0%, 100%': { transform: 'scale(0.92)', opacity: '0.72' },
          '50%': { transform: 'scale(1.1)', opacity: '1' },
        },
        'aura-pulse': {
          '0%, 100%': { transform: 'scale(0.99) translate3d(-2px,-1px,0) rotate(-0.5deg)', filter: 'blur(32px) saturate(1.18) hue-rotate(-6deg)', opacity: '0.9' },
          '25%': { transform: 'scale(1.015) translate3d(2px,-1px,0) rotate(1deg)', filter: 'blur(35px) saturate(1.26) hue-rotate(10deg)', opacity: '0.86' },
          '50%': { transform: 'scale(1.01) translate3d(-1px,3px,0) rotate(-1deg)', filter: 'blur(34px) saturate(1.22) hue-rotate(-4deg)', opacity: '0.9' },
          '75%': { transform: 'scale(1.005) translate3d(1px,2px,0) rotate(0.5deg)', filter: 'blur(33px) saturate(1.2) hue-rotate(4deg)', opacity: '0.88' },
        },
        'thinking-breathe': {
          '0%, 100%': { opacity: '0.38', transform: 'translate3d(0,0,0) scale(0.96)' },
          '50%': { opacity: '0.78', transform: 'translate3d(10%,0,0) scale(1.08)' },
        },
        'bubble-breath': {
          '0%, 100%': { transform: 'scale(0.96)' },
          '50%': { transform: 'scale(1.04)' },
        },
        'bubble-halo': {
          '0%, 100%': { transform: 'scale(0.92)', opacity: '0.62' },
          '50%': { transform: 'scale(1.1)', opacity: '0.96' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.2s ease-in-out infinite',
        sheen: 'sheen 1.2s ease-in-out infinite',
        'slide-right': 'slide-right 1.8s ease-in-out infinite',
        'fade-in-up': 'fade-in-up 260ms ease forwards',
        'status-pulse': 'status-pulse 1.6s ease-in-out infinite',
        'aura-pulse': 'aura-pulse 2.6s cubic-bezier(0.42,0,0.38,1) infinite',
        'thinking-breathe': 'thinking-breathe 2.8s ease-in-out infinite',
        'bubble-breath': 'bubble-breath 2.8s ease-in-out infinite',
        'bubble-halo': 'bubble-halo 2.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config
