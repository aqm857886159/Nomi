import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

/**
 * token 色接入 Tailwind 透明度修饰符（`/85`、`/[0.78]`…）的唯一通道。
 * 裸 var() 色 Tailwind 无法注入 alpha——带 `/` 修饰的类会被 JIT **静默丢弃**（连类都不生成，
 * 元素无背景/描边裸奔）。Issue #32（手势提示条、场景卡信息条压在图上失读）root cause 即此，
 * 当时全仓 60+ 处中招。color-mix 包一层 `<alpha-value>` 占位：不带修饰符时 calc(1*100%) 与原色
 * 恒等；带修饰符按比例向 transparent 混。新增 token 色映射必须走这里，别再写裸 var()。
 */
const tokenColor = (cssVar: string): string =>
  `color-mix(in oklch, var(${cssVar}) calc(<alpha-value> * 100%), transparent)`

const workbenchBasePlugin = plugin(({ addBase, addUtilities }) => {
  // 无边框窗口拖拽区（Windows 自绘标题栏）。.app-drag 整块可拖窗，内部交互元素自动 no-drag（否则按钮拖不动窗也点不动）。
  addUtilities({
    '.app-drag': { 'app-region': 'drag', '-webkit-app-region': 'drag' },
    '.app-no-drag': { 'app-region': 'no-drag', '-webkit-app-region': 'no-drag' },
    '.app-no-drag *': { 'app-region': 'no-drag', '-webkit-app-region': 'no-drag' },
    '.app-drag button': { 'app-region': 'no-drag', '-webkit-app-region': 'no-drag' },
    '.app-drag input': { 'app-region': 'no-drag', '-webkit-app-region': 'no-drag' },
    '.app-drag textarea': { 'app-region': 'no-drag', '-webkit-app-region': 'no-drag' },
    '.app-drag select': { 'app-region': 'no-drag', '-webkit-app-region': 'no-drag' },
    '.app-drag a': { 'app-region': 'no-drag', '-webkit-app-region': 'no-drag' },
    '.app-drag label': { 'app-region': 'no-drag', '-webkit-app-region': 'no-drag' },
    '.app-drag summary': { 'app-region': 'no-drag', '-webkit-app-region': 'no-drag' },
    '.app-drag [role="button"]': { 'app-region': 'no-drag', '-webkit-app-region': 'no-drag' },
    '.app-drag [role="toolbar"]': { 'app-region': 'no-drag', '-webkit-app-region': 'no-drag' },
    '.app-drag [role="navigation"]': { 'app-region': 'no-drag', '-webkit-app-region': 'no-drag' },
    '.app-drag [contenteditable="true"]': { 'app-region': 'no-drag', '-webkit-app-region': 'no-drag' },
  })

  addBase({
    ':root': {
      '--nomi-bg': 'oklch(0.985 0.003 90)',
      '--nomi-paper': 'oklch(1 0 0)',
      '--nomi-ink': 'oklch(0.22 0.01 80)',
      '--nomi-ink-80': 'oklch(0.32 0.01 80)',
      '--nomi-ink-60': 'oklch(0.50 0.01 80)',
      '--nomi-ink-40': 'oklch(0.68 0.01 80)',
      '--nomi-ink-30': 'oklch(0.78 0.01 80)',
      '--nomi-ink-20': 'oklch(0.88 0.005 80)',
      '--nomi-ink-10': 'oklch(0.94 0.003 80)',
      '--nomi-ink-05': 'oklch(0.97 0.003 80)',
      '--nomi-line': 'oklch(0.91 0.004 80)',
      '--nomi-line-soft': 'oklch(0.95 0.003 80)',
      '--nomi-accent': 'oklch(0.55 0.13 250)',
      // ⚠️ 必须 in srgb，别改回 in oklch：oklch 插值会对**色相走最短弧**，而 --nomi-paper 显式钉了色相
      // （浅 h=0 / 暗 h=80）。白/近中性色的色相在感知上无意义，但只要在 oklch() 里写成数字，color-mix
      // 就当真拿它插值 —— accent(h250) 被拽向 paper 的色相：浅色落 h≈347（粉）、暗色落 h≈124（橄榄绿），
      // 全 App 80+ 个选中态/chip 跟着跑色（Chromium 126 实测）。in srgb 无色相分量，结果 h≈248 稳住蓝。
      // 同类雷（有色相的色 × 钉了色相的中性色，用 in oklch 混）已由 check:tokens 门岗设闸拦住。
      '--nomi-accent-soft': 'color-mix(in srgb, var(--nomi-accent) 12%, var(--nomi-paper))',
      // 根层语义红（设计系统 ① 层）。历史注：--workbench-danger 曾只活在 .workbench-shell 作用域、
      // portal 浮层够不到（任务中心实锤 rgb(201,201,201)）；现 --workbench-* 已同在 :root（见下方
      // 工作区语义块），该病已根除，两层按语义就近取用。
      '--nomi-danger': 'oklch(0.55 0.20 27)',
      '--nomi-warning': 'oklch(0.62 0.14 75)',
      // 根层语义色的 soft 底（承载同色文字的浅底：错误行、警示横幅）。此前只有 --nomi-accent-soft 有 soft 档，
      // danger/warning 没有 → `bg-nomi-danger-soft`/`bg-nomi-warning-soft` 四处静默无底色。配比与混色空间同
      // --nomi-accent-soft（必须 in srgb，原因见上方 accent-soft 处长注：oklch 插值会对色相走最短弧）。
      '--nomi-danger-soft': 'color-mix(in srgb, var(--nomi-danger) 12%, var(--nomi-paper))',
      '--nomi-warning-soft': 'color-mix(in srgb, var(--nomi-warning) 12%, var(--nomi-paper))',
      // 根层语义绿（设计系统 ① 层）。P4 S5 补：多镜占位「完成」态、批次进度回执的成功信号要在
      // portal/画布层用（同 --nomi-danger/-warning 那类根层色的动机——作用域色 portal 够不到）。
      // 与 --workbench-success(#34c759) 同色相、走 oklch 以随明暗自动过渡。
      '--nomi-success': 'oklch(0.62 0.16 150)',
      // 全局焦点环色（accent 42%）。所有交互控件 :focus-visible 统一用它，覆盖 macOS 系统强调色的
      // outline:auto（用户设了橙/黄就冒橙环）。全局 :root → portal 到 body 的面板也生效。
      '--nomi-focus': 'color-mix(in srgb, var(--nomi-accent) 42%, transparent)',
      '--nomi-track-text': 'var(--nomi-accent)',
      '--nomi-track-image': 'oklch(0.7 0.13 200)',
      '--nomi-track-video': 'oklch(0.65 0.13 150)',
      '--nomi-snap': 'oklch(0.72 0.18 30)',
      '--nomi-snap-tag': 'oklch(0.45 0.18 30)',
      // 品牌 mark 底色（深底+白笔画 §3.9）。浅色=深底；暗色提亮到能在暗背景上看出方块轮廓（用户拍板）。
      '--nomi-logo-ground': 'oklch(0.22 0.01 80)',
      // 3D 轴向语义色(X/Y/Z)。主题无关——明暗两模式同色（用户拍板：3D 渲染色不动）。
      '--nomi-axis-x': '#ef4444',
      '--nomi-axis-y': '#16a34a',
      '--nomi-axis-z': '#3b82f6',
      // 媒体浮层（图上 scrim / 徽章 / 底部标题渐变）。此前仅存于未加载的 nomi-tokens.css → 运行时 undefined，
      // 现补进真源（live = 本 addBase），消费点：提示词库/技能库/库页 scrim、引导旅途背景。
      '--nomi-scrim': 'oklch(0.2 0.01 80 / 0.42)',
      // 图上徽章/标题遮罩承载白字，压在任意亮度媒体上（暗色卡底常是白衬衫等亮区）——opacity 提到稳定托住白字。
      // 2026-09-01 用户反馈「徽标黑底黑字 / 标题融背景」；镜像见 src/theme/nomi-tokens.css。
      '--nomi-overlay-chip': 'oklch(0.18 0.01 80 / 0.64)',
      '--nomi-overlay-chip-strong': 'oklch(0.16 0.01 80 / 0.82)',
      '--nomi-media-veil': 'oklch(0.12 0.01 80 / 0.74)',
      '--nomi-shadow-sm': '0 1px 2px oklch(0 0 0 / 0.04), 0 1px 1px oklch(0 0 0 / 0.03)',
      '--nomi-shadow-md': '0 2px 4px oklch(0 0 0 / 0.04), 0 8px 24px oklch(0 0 0 / 0.06)',
      '--nomi-shadow-lg': '0 4px 8px oklch(0 0 0 / 0.05), 0 20px 50px oklch(0 0 0 / 0.08)',
      '--nomi-radius-sm': '6px',
      '--nomi-radius': '10px',
      '--nomi-radius-lg': '16px',
      '--nomi-transition-fast': '140ms cubic-bezier(.2, .7, .3, 1)',
      '--nomi-font-sans': 'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif',
      '--nomi-font-display': 'Fraunces, Inter, serif',
      '--nomi-font-mono': 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      'color-scheme': 'light',
      // ── 工作区语义层（--workbench-*，设计系统 §2.1 ② 层）。定义在 :root 而非 .workbench-shell：
      // CSS 自定义属性沿 DOM 树继承，作用域定义让 portal 到 body / 挂在 app 根 / 库页的浮层全部
      // 解析失败、静默退回继承色（任务中心、库页确认卡勾勾两度实锤 rgb(201,201,201)），还逼出
      // 「每个 portal 补挂 workbench-shell 类」的桥（Scene3D 全屏/AI 面板/模型弹窗/toast，已删）。
      // 根层定义后解析与挂载点无关，整类根除；再写作用域定义会被 check:tokens 第 6 类当场拦。
      '--workbench-topbar-height': '56px',
      '--workbench-timeline-height': '188px',
      // 预览时间轴：标尺28 + 3×52 + 间距/内距 ≈ 222px，贴合内容高度（上手清单聚光在预览区锚此 var）。
      '--workbench-preview-timeline-height': '222px',
      '--workbench-preview-source-width': '268px',
      // 132px（原 112）：112 减掉 pr-3 后只剩 100，被类型点 + 静音钮 + 计数 chip 占去七成，
      // 「视频轨」被挤成「视…」。标尺/播放头/各行都读这一个 token，改这里就整体对齐。
      '--workbench-timeline-label-width': '132px',
      '--workbench-bg': 'var(--nomi-bg)',
      '--workbench-surface': 'var(--nomi-paper)',
      '--workbench-surface-solid': 'var(--nomi-paper)',
      '--workbench-surface-soft': 'var(--nomi-ink-05)',
      '--workbench-border': 'var(--nomi-line)',
      '--workbench-border-soft': 'var(--nomi-line-soft)',
      '--workbench-border-strong': 'var(--nomi-ink-30)',
      '--workbench-muted': 'var(--nomi-ink-60)',
      '--workbench-muted-soft': 'var(--nomi-ink-40)',
      '--workbench-ink': 'var(--nomi-ink)',
      '--workbench-accent': 'var(--nomi-accent)',
      '--workbench-accent-soft': 'var(--nomi-accent-soft)',
      '--workbench-success': '#34c759',
      '--workbench-success-soft': 'rgba(52, 199, 89, 0.12)',
      '--workbench-success-ink': '#248a3d',
      '--workbench-danger': '#ff3b30',
      '--workbench-danger-soft': 'rgba(255, 59, 48, 0.1)',
      '--workbench-video': '#00a886',
      '--workbench-video-soft': 'rgba(0, 168, 134, 0.11)',
      '--workbench-audio': '#8b5cf6',
      '--workbench-audio-soft': 'rgba(139, 92, 246, 0.11)',
      // 文字轨（字幕/标题卡）：紫，与图片轨蓝(accent)、媒体轨青(video)区分。
      '--workbench-text': 'oklch(0.56 0.17 305)',
      '--workbench-text-soft': 'oklch(0.56 0.17 305 / 0.13)',
      '--workbench-hover': 'rgba(60, 60, 67, 0.06)',
      '--workbench-pressed': 'rgba(60, 60, 67, 0.09)',
      '--workbench-overlay': 'rgba(255, 255, 255, 0.82)',
      '--workbench-overlay-strong': 'rgba(255, 255, 255, 0.94)',
      '--workbench-backdrop': 'rgba(29, 29, 31, 0.16)',
      // 顶边高光斜面/内描边：浅色是微妙立体感，暗色必须淡到几乎无——否则白高光在暗底变刺眼白线/白框。
      // 消费点：时间轴顶(TimelinePanel)、片段顶(TimelineClip)、分组框(GroupFrame/generationCanvas.css)。
      '--workbench-bevel': 'rgba(255, 255, 255, 0.7)',
      '--workbench-frame-ring': 'rgba(255, 255, 255, 0.58)',
      '--workbench-veil-chip': 'rgba(255, 255, 255, 0.3)',
      '--workbench-code-bg': '#1d1d1f',
      '--workbench-code-ink': '#f5f5f7',
      '--workbench-radius': 'var(--nomi-radius)',
      '--workbench-shadow-sm': 'var(--nomi-shadow-sm)',
      '--workbench-shadow-md': 'var(--nomi-shadow-md)',
      '--workbench-shadow-pop': 'var(--nomi-shadow-lg)',
      '--workbench-control-size': '32px',
      '--workbench-control-size-sm': '26px',
      '--workbench-control-radius': '7px',
      '--workbench-icon-size': '16px',
      '--workbench-icon-stroke': '2',
      '--canvas-surface-bg': 'var(--workbench-bg)',
      '--tc-spotlight-grid-color': 'rgba(60, 60, 67, 0.22)',
      '--workbench-ai-header-height': '60px',
      '--workbench-ai-composer-min-height': '112px',
      '--workbench-ai-panel-bg': 'var(--workbench-surface)',
      '--workbench-ai-message-bg': 'var(--workbench-surface)',
      '--workbench-ai-user-bg': 'var(--workbench-accent-soft)',
      '--workbench-ai-composer-bg': 'var(--workbench-surface-soft)',
      '--workbench-ai-border': 'var(--workbench-border-soft)',
      '--workbench-ai-border-strong': 'var(--workbench-border)',
      '--workbench-ai-radius': '8px',
      '--workbench-ai-control-radius': '7px',
      '--tc-radius-sharp': '0px',
      '--tc-radius-field': '6px',
      '--tc-radius-panel': '10px',
      '--tc-radius-modal': '14px',
      '--tc-radius-pill': '999px',
      '--tc-space-1': '4px',
      '--tc-space-2': '8px',
      '--tc-space-3': '12px',
      '--tc-space-4': '16px',
      '--tc-space-5': '20px',
      '--tc-space-6': '24px',
      '--tc-font-size-body': '14px',
      '--tc-font-size-body-sm': '13px',
      '--tc-font-size-caption': '12px',
      '--tc-font-size-title': '16px',
      '--handle-hit-outside': '20px',
      '--handle-hit-inside': '8px',
      '--handle-hit-vertical': '18px',
      '--handle-color-image': '#7dd3fc',
      '--handle-color-audio': '#34d399',
      '--handle-color-subtitle': '#facc15',
      '--handle-color-video': '#c084fc',
      '--handle-color-character': '#f472b6',
      '--handle-color-any': '#94a3b8',
      '--handle-surface': 'rgba(4, 7, 18, 0.88)',
      '--handle-border': 'rgba(255, 255, 255, 0.42)',
      '--tc-snap-outline': 'rgba(147, 197, 253, 0.55)',
      '--tc-snap-shadow': '0 0 0 3px rgba(147, 197, 253, 0.7), 0 0 30px rgba(147, 197, 253, 0.35)',
      '--tc-gen-overlay-bg': 'rgba(255, 255, 255, 0.07)',
      '--tc-gen-overlay-border': 'rgba(255, 255, 255, 0.10)',
      '--tc-gen-overlay-sheen': 'rgba(255, 255, 255, 0.28)',
      '--tc-gen-overlay-body-from': 'rgba(0, 0, 0, 0.35)',
      '--tc-gen-overlay-body-to': 'rgba(0, 0, 0, 0.05)',
      '--tc-gen-overlay-text': 'rgba(255, 255, 255, 0.85)',
      '--tc-color-app-bg': '#05070b',
      '--tc-color-app-bg-strong': '#020409',
      '--tc-color-surface': '#0b0f14',
      '--tc-color-surface-raised': '#10161d',
      '--tc-color-surface-subtle': '#131a22',
      '--tc-color-surface-inline': 'rgba(255, 255, 255, 0.035)',
      '--tc-color-surface-inline-weak': 'rgba(255, 255, 255, 0.03)',
      '--tc-color-border-subtle': 'rgba(226, 232, 240, 0.08)',
      '--tc-color-border-strong': 'rgba(125, 211, 252, 0.24)',
      '--tc-color-text-primary': '#edf3ff',
      '--tc-color-text-secondary': '#aab7ca',
      '--tc-color-text-tertiary': '#73839a',
      '--tc-color-accent-blue': '#60a5fa',
      '--tc-color-accent-cyan': '#22d3ee',
      '--tc-color-success': '#34d399',
      '--tc-color-warning': '#fbbf24',
      '--tc-color-danger': '#f87171',
      '--tc-color-info': '#38bdf8',
    },
    ':root[data-mantine-color-scheme="light"]': {
      '--handle-color-image': '#2563eb',
      '--handle-color-audio': '#0d9488',
      '--handle-color-subtitle': '#ca8a04',
      '--handle-color-video': '#7c3aed',
      '--handle-color-character': '#db2777',
      '--handle-color-any': '#475569',
      '--handle-surface': 'rgba(255, 255, 255, 0.96)',
      '--handle-border': 'rgba(15, 23, 42, 0.2)',
      '--tc-snap-outline': 'rgba(37, 99, 235, 0.22)',
      '--tc-snap-shadow': '0 0 0 3px rgba(37, 99, 235, 0.18), 0 0 26px rgba(37, 99, 235, 0.12)',
      '--tc-gen-overlay-bg': 'rgba(15, 23, 42, 0.05)',
      '--tc-gen-overlay-border': 'rgba(15, 23, 42, 0.10)',
      '--tc-gen-overlay-sheen': 'rgba(15, 23, 42, 0.10)',
      '--tc-gen-overlay-body-from': 'rgba(255, 255, 255, 0.85)',
      '--tc-gen-overlay-body-to': 'rgba(255, 255, 255, 0.35)',
      '--tc-gen-overlay-text': 'rgba(15, 23, 42, 0.72)',
    },
    // ── 深色主题（暖灰 oklch，与浅色同色相、低明度反转）。token-only → 翻这一组即翻全局。
    //    3D 轴色(--nomi-axis-*)刻意不覆盖：主题无关的渲染语义色，明暗同色（用户拍板）。
    ':root[data-mantine-color-scheme="dark"]': {
      'color-scheme': 'dark',
      '--nomi-bg': 'oklch(0.18 0.006 80)',
      '--nomi-paper': 'oklch(0.235 0.007 80)',
      '--nomi-ink': 'oklch(0.93 0.006 85)',
      '--nomi-ink-80': 'oklch(0.84 0.006 85)',
      '--nomi-ink-60': 'oklch(0.70 0.006 85)',
      // 中低档比浅色对应位整体抬一档：暗底下次级文字/占位/边框/斜纹对比不足（用户反馈+设计审），
      // 只抬 40 及以下（60 以上主文字已够，避免矫枉过正）。
      '--nomi-ink-40': 'oklch(0.62 0.006 85)',
      '--nomi-ink-30': 'oklch(0.50 0.006 85)',
      '--nomi-ink-20': 'oklch(0.42 0.006 85)',
      '--nomi-ink-10': 'oklch(0.34 0.006 85)',
      '--nomi-ink-05': 'oklch(0.30 0.006 85)',
      '--nomi-line': 'oklch(0.36 0.007 80)',
      '--nomi-line-soft': 'oklch(0.31 0.007 80)',
      '--nomi-accent': 'oklch(0.70 0.13 250)',
      // 暗底下 soft 混合比要更高，否则选中高亮(侧栏行/节点选中/上手步骤)几乎看不出（浅色 12% 够、暗色压没）。
      // in srgb 的原因见浅色块同名 token 处（暗色 paper h=80，走 oklch 会把选中态混成橄榄绿）。
      '--nomi-accent-soft': 'color-mix(in srgb, var(--nomi-accent) 26%, var(--nomi-paper))',
      '--nomi-danger': 'oklch(0.72 0.16 25)',
      '--nomi-warning': 'oklch(0.78 0.13 75)',
      // 暗底提高混入比（同 --nomi-accent-soft 的 12%→26%），否则 12% 混进暗 paper 几乎看不出底色。
      '--nomi-danger-soft': 'color-mix(in srgb, var(--nomi-danger) 26%, var(--nomi-paper))',
      '--nomi-warning-soft': 'color-mix(in srgb, var(--nomi-warning) 26%, var(--nomi-paper))',
      // 暗底提亮以保持可辨（与 --workbench-success 暗色 #45d483 同族）。
      '--nomi-success': 'oklch(0.75 0.15 150)',
      '--nomi-focus': 'color-mix(in srgb, var(--nomi-accent) 50%, transparent)',
      // 时间轴三轨：暗底提亮以保持可辨（fork 未覆盖，本次补）。
      '--nomi-track-text': 'oklch(0.75 0.15 305)',
      '--nomi-track-image': 'oklch(0.72 0.13 200)',
      '--nomi-track-video': 'oklch(0.70 0.13 150)',
      '--nomi-snap': 'oklch(0.78 0.18 30)',
      '--nomi-snap-tag': 'oklch(0.62 0.18 30)',
      '--nomi-logo-ground': 'oklch(0.30 0.01 80)',
      '--nomi-scrim': 'oklch(0.08 0.004 80 / 0.58)',
      // 媒体浮层在暗色主题下同样承载白字，且卡底媒体可能是亮区——opacity 提到托得住白字（镜像见 nomi-tokens.css）。
      '--nomi-overlay-chip': 'oklch(0.06 0.004 80 / 0.78)',
      '--nomi-overlay-chip-strong': 'oklch(0.05 0.004 80 / 0.88)',
      '--nomi-media-veil': 'oklch(0.05 0.004 80 / 0.86)',
      '--nomi-shadow-sm': '0 1px 2px oklch(0 0 0 / 0.32), 0 1px 1px oklch(0 0 0 / 0.22)',
      '--nomi-shadow-md': '0 2px 5px oklch(0 0 0 / 0.30), 0 14px 34px oklch(0 0 0 / 0.32)',
      '--nomi-shadow-lg': '0 4px 10px oklch(0 0 0 / 0.30), 0 24px 64px oklch(0 0 0 / 0.40)',
      // ── 工作区语义层深色覆盖：只重定义「硬编码字面值」那些（success/danger/video/text/hover/
      // pressed/overlay/backdrop/code/bevel/spotlight-grid）；其余派生自 --nomi-* → 随上方自动翻。
      // （audio 刻意无深色覆盖：明暗同色，沿用收口前行为。）
      '--workbench-success': '#45d483',
      '--workbench-success-soft': 'rgba(69, 212, 131, 0.16)',
      '--workbench-success-ink': '#7ee8aa',
      '--workbench-danger': '#ff6961',
      '--workbench-danger-soft': 'rgba(255, 105, 97, 0.14)',
      '--workbench-video': '#35d0b0',
      '--workbench-video-soft': 'rgba(53, 208, 176, 0.16)',
      '--workbench-text': 'oklch(0.75 0.15 305)',
      '--workbench-text-soft': 'oklch(0.75 0.15 305 / 0.17)',
      '--workbench-hover': 'oklch(1 0 0 / 0.055)',
      '--workbench-pressed': 'oklch(1 0 0 / 0.085)',
      '--workbench-overlay': 'oklch(0.24 0.007 80 / 0.86)',
      '--workbench-overlay-strong': 'oklch(0.24 0.007 80 / 0.96)',
      '--workbench-backdrop': 'oklch(0.06 0.004 80 / 0.56)',
      '--workbench-code-bg': 'oklch(0.15 0.006 80)',
      '--workbench-code-ink': 'var(--nomi-ink)',
      '--tc-spotlight-grid-color': 'rgba(255, 255, 255, 0.18)',
      // 高光斜面/内描边在暗底淡到几乎无（治时间轴顶白线那一类）。
      '--workbench-bevel': 'rgba(255, 255, 255, 0.05)',
      '--workbench-frame-ring': 'rgba(255, 255, 255, 0.08)',
      '--workbench-veil-chip': 'rgba(255, 255, 255, 0.12)',
    },
    '*': {
      'box-sizing': 'border-box',
      'scrollbar-width': 'thin',
      'scrollbar-color': 'color-mix(in srgb, var(--nomi-ink) 24%, transparent) transparent',
    },
    '*::-webkit-scrollbar': {
      width: '6px',
      height: '6px',
    },
    '*::-webkit-scrollbar-track': {
      background: 'transparent',
    },
    '*::-webkit-scrollbar-thumb': {
      background: 'color-mix(in srgb, var(--nomi-ink) 24%, transparent)',
      'border-radius': '999px',
    },
    '*::-webkit-scrollbar-thumb:hover': {
      background: 'color-mix(in srgb, var(--nomi-ink) 38%, transparent)',
    },
    '*::-webkit-scrollbar-corner': {
      background: 'transparent',
    },
    // 全局焦点环根治（P2）：默认杀掉浏览器 :focus-visible 的 outline:auto（macOS 跟系统强调色＝橙环），
    // 交互控件统一用 accent 环。没人需要再往按钮上记着加 className——漏一个就冒橙环的问题从根上没了。
    // 编辑器（contenteditable，非 button）不吃 ring；其 workbench.css 的 outline:none 仍是防御性覆盖。
    ':focus-visible': {
      outline: 'none',
    },
    'button:focus-visible, [role="button"]:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible': {
      outline: '2px solid var(--nomi-focus)',
      'outline-offset': '2px',
    },
    'html, body, #root': {
      width: '100%',
      height: '100%',
      background: 'var(--nomi-bg)',
    },
    'html, body': {
      'overscroll-behavior': 'none',
      overflow: 'hidden',
      'scrollbar-gutter': 'auto',
    },
    body: {
      margin: '0',
      'min-height': '100%',
      'font-family': "'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      'background-color': 'var(--tc-color-app-bg)',
      'background-image':
        'radial-gradient(circle at 18% 14%, rgba(34,211,238,0.07), transparent 32%), radial-gradient(circle at 82% 0%, rgba(96,165,250,0.06), transparent 28%), linear-gradient(180deg, var(--tc-color-app-bg-strong) 0%, var(--tc-color-app-bg) 52%, #06090f 100%)',
      color: 'var(--mantine-color-text, var(--tc-color-text-primary))',
    },
    ':root[data-mantine-color-scheme="light"] body': {
      'background-color': '#f7f9ff',
      'background-image':
        'radial-gradient(circle at 10% 15%, rgba(59,130,246,0.12), transparent 55%), radial-gradient(circle at 85% -5%, rgba(14,165,233,0.12), transparent 45%), linear-gradient(180deg, #f7f9ff 0%, #ecf2ff 55%, #e4ebfb 100%)',
      color: 'var(--mantine-color-text, #111321)',
    },
    // 深色 body：覆盖默认那套旧蓝黑 --tc-color-app-bg 渐变，换成暖灰 --nomi-bg（否则 dark 会掉回休眠旧主题）。
    ':root[data-mantine-color-scheme="dark"] body': {
      'background-color': 'var(--nomi-bg)',
      'background-image': 'linear-gradient(180deg, oklch(0.19 0.006 80) 0%, var(--nomi-bg) 100%)',
      color: 'var(--mantine-color-text, var(--nomi-ink))',
    },
    '#root': {
      position: 'relative',
      isolation: 'isolate',
    },
    '#root::before': {
      content: "''",
      position: 'absolute',
      inset: '0',
      'pointer-events': 'none',
      'background-image':
        'linear-gradient(120deg, rgba(255,255,255,0.026) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,0.026) 1px, transparent 1px)',
      'background-size': '60px 60px',
      opacity: '0.08',
      'z-index': '-1',
    },
    ':root[data-mantine-color-scheme="light"] #root::before': {
      opacity: '0.08',
    },
    '.nomi-loading-mark__logo': {
      display: 'block',
      width: 'var(--nomi-loading-size, 18px)',
      height: 'var(--nomi-loading-size, 18px)',
    },
    '.mantine-Tooltip-tooltip': {
      'white-space': 'nowrap !important',
      'word-break': 'normal !important',
      'overflow-wrap': 'normal !important',
      'max-width': 'min(80vw, 520px)',
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
    },
    '.tc-panel-card .mantine-Paper-root[data-with-border], .tc-panel-card .mantine-Card-root[data-with-border], .mantine-Paper-root[data-with-border] .mantine-Paper-root[data-with-border], .mantine-Paper-root[data-with-border] .mantine-Card-root[data-with-border], .mantine-Card-root[data-with-border] .mantine-Paper-root[data-with-border], .mantine-Card-root[data-with-border] .mantine-Card-root[data-with-border]': {
      'border-radius': '0 !important',
      'border-color': 'transparent !important',
      'box-shadow': 'none !important',
      background: 'var(--tc-color-surface-inline) !important',
    },
    '.mantine-Button-root[data-variant="subtle"]': {
      background: 'transparent !important',
    },
    '.asset-panel-shell .mantine-Button-root': {
      'min-height': '22px',
      'padding-inline': '8px',
    },
    '.asset-panel-shell .mantine-ActionIcon-root': {
      width: '22px',
      'min-width': '22px',
      height: '22px',
    },
    '.asset-panel-shell .mantine-SegmentedControl-root': {
      'min-height': '22px',
    },
    '.asset-panel-shell .mantine-SegmentedControl-label': {
      'min-height': '20px',
      'padding-inline': '7px',
    },
    '.asset-panel-shell .mantine-Tabs-tab': {
      'min-height': '24px',
      padding: '0 8px',
    },
    '.asset-panel-shell .mantine-Badge-root': {
      'min-height': '16px',
      'padding-inline': '6px',
    },
    '.asset-panel-shell .mantine-Input-input, .asset-panel-shell .mantine-Select-input': {
      'min-height': '24px',
      'padding-inline': '8px',
    },
    '.ai-character-library-root .mantine-ActionIcon-root, .ai-character-library-detail-root .mantine-ActionIcon-root': {
      width: '24px',
      'min-width': '24px',
      height: '24px',
    },
    '.ai-character-library-root .mantine-Input-input, .ai-character-library-detail-root .mantine-Input-input': {
      'min-height': '24px',
    },
    ':root[data-mantine-color-scheme="light"] .mantine-AppShell-main': {
      background:
        'radial-gradient(circle at 15% 15%, rgba(59,130,246,0.15), transparent 45%), radial-gradient(circle at 80% 0%, rgba(14,165,233,0.12), transparent 40%), var(--mantine-color-body) !important',
    },
    ':root[data-mantine-color-scheme="light"] .mantine-AppShell-header, :root[data-mantine-color-scheme="light"] .mantine-AppShell-navbar, :root[data-mantine-color-scheme="light"] .mantine-AppShell-aside': {
      background: 'rgba(255, 255, 255, 0.86) !important',
      border: 'none !important',
      'box-shadow': '0 18px 40px rgba(15, 23, 42, 0.12)',
      'backdrop-filter': 'blur(10px)',
      '-webkit-backdrop-filter': 'blur(10px)',
    },
    ':root[data-mantine-color-scheme="light"] .mantine-Button-root[data-variant="outline"]': {
      border: 'none !important',
      background: 'rgba(59, 130, 246, 0.06) !important',
      'box-shadow': '0 10px 20px rgba(15, 23, 42, 0.08)',
    },
    ':root[data-mantine-color-scheme="light"] .mantine-Button-root[data-variant="outline"]:hover': {
      border: 'none !important',
      background: 'rgba(59, 130, 246, 0.12) !important',
    },
    ':root[data-mantine-color-scheme="light"] .mantine-Button-root[data-variant="light"]': {
      border: 'none !important',
      background: 'rgba(15, 23, 42, 0.03) !important',
    },
    ':root[data-mantine-color-scheme="light"] .mantine-Button-root[data-variant="light"]:hover': {
      border: 'none !important',
      background: 'rgba(15, 23, 42, 0.05) !important',
    },
    ':root[data-mantine-color-scheme="light"] .mantine-Paper-root[data-with-border]:not(.template-panel-shell):not(.template-panel-card):not(.template-space):not(.template-detail)': {
      border: 'none !important',
      'box-shadow': '0 15px 40px rgba(15, 23, 42, 0.08)',
    },
    ':root[data-mantine-color-scheme="light"] [data-ux-panel]': {
      'scrollbar-width': 'thin',
      'scrollbar-color': 'color-mix(in srgb, var(--nomi-ink) 25%, transparent) transparent',
    },
    ':root[data-mantine-color-scheme="light"] [data-ux-panel] *::-webkit-scrollbar': {
      width: '6px',
      height: '6px',
    },
    ':root[data-mantine-color-scheme="light"] [data-ux-panel] *::-webkit-scrollbar-thumb': {
      background: 'rgba(15, 23, 42, 0.2)',
      'border-radius': '8px',
    },
    ':root[data-mantine-color-scheme="light"] [data-ux-panel] *::-webkit-scrollbar-thumb:hover': {
      background: 'rgba(15, 23, 42, 0.35)',
    },
    ':root[data-mantine-color-scheme="light"] [data-ux-panel] *::-webkit-scrollbar-track': {
      background: 'transparent',
    },
    '[data-compact="true"] .mantine-Button-root': {
      padding: '4px 8px !important',
    },
    '[data-compact="true"] .mantine-NumberInput-input, [data-compact="true"] .mantine-TextInput-input, [data-compact="true"] textarea': {
      padding: '6px 8px !important',
    },
    '[data-compact="true"] .mantine-Stack-root': {
      gap: '6px !important',
    },
    '[data-compact="true"] .mantine-Group-root': {
      gap: '6px !important',
    },
    '.workbench-editor__scroll > div': {
      'min-height': '100%',
      display: 'flex',
    },
    '.workbench-editor__scroll .ProseMirror, .workbench-editor__scroll .tiptap': {
      'min-height': '100%',
      width: '100%',
      'box-sizing': 'border-box',
    },
    '.workbench-editor__scroll, .workbench-creation-ai__messages': {
      'scrollbar-color': 'transparent transparent',
      'scrollbar-width': 'thin',
    },
    '.workbench-editor__scroll:hover, .workbench-editor__scroll:focus-within, .workbench-editor__scroll.workbench-scrollbar-visible, .workbench-creation-ai__messages:hover, .workbench-creation-ai__messages:focus-within, .workbench-creation-ai__messages.workbench-scrollbar-visible': {
      'scrollbar-color': 'color-mix(in srgb, var(--nomi-ink) 22%, transparent) transparent',
    },
    '.workbench-editor__scroll::-webkit-scrollbar, .workbench-creation-ai__messages::-webkit-scrollbar': {
      width: '0',
      height: '0',
    },
    '.workbench-editor__scroll:hover::-webkit-scrollbar, .workbench-editor__scroll:focus-within::-webkit-scrollbar, .workbench-editor__scroll.workbench-scrollbar-visible::-webkit-scrollbar, .workbench-creation-ai__messages:hover::-webkit-scrollbar, .workbench-creation-ai__messages:focus-within::-webkit-scrollbar, .workbench-creation-ai__messages.workbench-scrollbar-visible::-webkit-scrollbar': {
      width: '6px',
      height: '6px',
    },
    '.workbench-editor__scroll::-webkit-scrollbar-track, .workbench-creation-ai__messages::-webkit-scrollbar-track': {
      background: 'transparent',
    },
    '.workbench-editor__scroll::-webkit-scrollbar-thumb, .workbench-creation-ai__messages::-webkit-scrollbar-thumb': {
      'border-radius': '999px',
      background: 'transparent',
    },
    '.workbench-editor__scroll:hover::-webkit-scrollbar-thumb, .workbench-editor__scroll:focus-within::-webkit-scrollbar-thumb, .workbench-editor__scroll.workbench-scrollbar-visible::-webkit-scrollbar-thumb, .workbench-creation-ai__messages:hover::-webkit-scrollbar-thumb, .workbench-creation-ai__messages:focus-within::-webkit-scrollbar-thumb, .workbench-creation-ai__messages.workbench-scrollbar-visible::-webkit-scrollbar-thumb': {
      background: 'color-mix(in srgb, var(--nomi-ink) 18%, transparent)',
    },
  })
})

export default {
  /**
   * 扫 `.ts` 和 `.tsx` 两种后缀。**别只扫 `.tsx`**：类名字符串住在哪个后缀里，
   * 是 R9 分层的结果（纯换算函数该从壳里搬出去，搬出去就落进 `.ts`），
   * 和「这段类名要不要生成」毫无关系。只扫 `.tsx` 会把这两件事绑死——纯函数一搬进
   * `.ts`，它拼出来的类当场不再生成，而且**完全静默**：不报错、不警告，只是那几条 CSS
   * 不存在，界面掉回默认排版（2026-09-06 实测：`residentItemClassName` 一搬进
   * `resident/residentShellDisplay.ts`，用户气泡的 `ml-auto` / `max-w-[86%]` 当场消失，
   * 从右侧小卡片变成整行通栏）。防线建在构建层（R28）：让扫描面覆盖真实的类名来源，
   * 就不需要门岗去禁止搬函数，也不需要人记住这条。
   * 排除项与 `.tsx` 一一对齐——测试/规格/类型声明/第三方源码里出现的类名不是产品用的类名。
   * 守住这条不再退回去的是 `scripts/build-tailwind.test.ts`（真跑一次 Tailwind，断言只在 `.ts`
   * 出现的哨兵类进了 CSS）。全仓 4 处历史失效的盘点见
   * `docs/lessons/tailwind-content-ts-classnames-silently-dropped.md`。
   */
  content: [
    './index.html',
    './src/**/*.tsx',
    './src/**/*.ts',
    '!./src/**/*.test.tsx',
    '!./src/**/*.spec.tsx',
    '!./src/**/*.test.ts',
    '!./src/**/*.spec.ts',
    '!./src/**/*.d.ts',
    '!./src/vendor/**',
  ],
  safelist: [
    'mantine-Tooltip-tooltip',
    'tc-panel-card',
    'mantine-Paper-root',
    'mantine-Card-root',
    'mantine-Button-root',
    'asset-panel-shell',
    'mantine-ActionIcon-root',
    'mantine-SegmentedControl-root',
    'mantine-SegmentedControl-label',
    'mantine-Tabs-tab',
    'mantine-Badge-root',
    'mantine-Input-input',
    'mantine-Select-input',
    'ai-character-library-root',
    'ai-character-library-detail-root',
    'mantine-AppShell-main',
    'mantine-AppShell-header',
    'mantine-AppShell-navbar',
    'mantine-AppShell-aside',
    'mantine-NumberInput-input',
    'mantine-TextInput-input',
    'mantine-Stack-root',
    'mantine-Group-root',
  ],
  darkMode: ['selector', '[data-mantine-color-scheme="dark"]'],
  theme: {
    extend: {
      colors: {
        // 旧 --tc-color-* 暗色层已删(§14.1)+ 4 个过渡键的最后消费者(PanoramaViewer/dead surfaces)
        // 已收口到 --nomi-* 类，过渡键随之删净。新增颜色一律进 nomi-tokens.css 的 --nomi-*，
        // 映射必须走 tokenColor()（文件顶部）——否则 `/85` 类透明度类被 JIT 静默丢弃（Issue #32 根因）。
        nomi: {
          bg: tokenColor('--nomi-bg'),
          paper: tokenColor('--nomi-paper'),
          ink: tokenColor('--nomi-ink'),
          'ink-80': tokenColor('--nomi-ink-80'),
          'ink-60': tokenColor('--nomi-ink-60'),
          'ink-40': tokenColor('--nomi-ink-40'),
          'ink-30': tokenColor('--nomi-ink-30'),
          'ink-20': tokenColor('--nomi-ink-20'),
          'ink-10': tokenColor('--nomi-ink-10'),
          'ink-05': tokenColor('--nomi-ink-05'),
          line: tokenColor('--nomi-line'),
          'line-soft': tokenColor('--nomi-line-soft'),
          accent: tokenColor('--nomi-accent'),
          'accent-soft': tokenColor('--nomi-accent-soft'),
          danger: tokenColor('--nomi-danger'),
          'danger-soft': tokenColor('--nomi-danger-soft'),
          // P4 S5：根层 warning/success 映射（此前 --nomi-warning 有 CSS 变量但无 Tailwind 映射，
          // --nomi-success 根本不存在 → text-nomi-success 静默失色）。多镜占位三态用它们（warning=已停、
          // success=完成），portal/画布层都解析得到。
          warning: tokenColor('--nomi-warning'),
          'warning-soft': tokenColor('--nomi-warning-soft'),
          success: tokenColor('--nomi-success'),
          // 时间轴三轨语义色。变量早在上方 addBase，但一直没映射进 theme —— `bg-nomi-track-video` 静默无
          // 底色，另两处只能退回 `bg-[var(--nomi-track-video)]` 任意值逃生口。补映射后两者一起收口。
          'track-text': tokenColor('--nomi-track-text'),
          'track-image': tokenColor('--nomi-track-image'),
          'track-video': tokenColor('--nomi-track-video'),
          scrim: tokenColor('--nomi-scrim'),
          'overlay-chip': tokenColor('--nomi-overlay-chip'),
          'overlay-chip-strong': tokenColor('--nomi-overlay-chip-strong'),
          'media-veil': tokenColor('--nomi-media-veil'),
        },
        workbench: {
          bg: tokenColor('--workbench-bg'),
          surface: tokenColor('--workbench-surface'),
          'surface-solid': tokenColor('--workbench-surface-solid'),
          'surface-soft': tokenColor('--workbench-surface-soft'),
          border: tokenColor('--workbench-border'),
          'border-soft': tokenColor('--workbench-border-soft'),
          'border-strong': tokenColor('--workbench-border-strong'),
          ink: tokenColor('--workbench-ink'),
          muted: tokenColor('--workbench-muted'),
          'muted-soft': tokenColor('--workbench-muted-soft'),
          accent: tokenColor('--workbench-accent'),
          'accent-soft': tokenColor('--workbench-accent-soft'),
          success: tokenColor('--workbench-success'),
          'success-soft': tokenColor('--workbench-success-soft'),
          // --workbench-success-ink 明暗两套值一直都在（明 #248a3d / 暗 #7ee8aa），漏的只是这行映射 →
          // 全 App 10 处「已完成」绿字/绿勾（常驻卡、助手时间轴、生成节点、任务卡）静默掉回继承色。
          'success-ink': tokenColor('--workbench-success-ink'),
          danger: tokenColor('--workbench-danger'),
          'danger-soft': tokenColor('--workbench-danger-soft'),
          // 时间轴媒体三轨（视频青 / 音频紫 / 文字紫）。video 有类名消费者（ClipNode 时间轴段）；
          // audio/text 目前只被 `bg-[var(--workbench-audio)]` 一类任意值消费，一并映射以免同族再漏。
          video: tokenColor('--workbench-video'),
          'video-soft': tokenColor('--workbench-video-soft'),
          audio: tokenColor('--workbench-audio'),
          'audio-soft': tokenColor('--workbench-audio-soft'),
          text: tokenColor('--workbench-text'),
          'text-soft': tokenColor('--workbench-text-soft'),
          hover: tokenColor('--workbench-hover'),
          pressed: tokenColor('--workbench-pressed'),
          overlay: tokenColor('--workbench-overlay'),
          backdrop: tokenColor('--workbench-backdrop'),
          'code-bg': tokenColor('--workbench-code-bg'),
          'code-ink': tokenColor('--workbench-code-ink'),
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
      keyframes: {
        'generation-focus-pulse': {
          '0%': {
            filter: 'drop-shadow(0 0 0 rgba(80, 112, 255, 0))',
            transform: 'scale(1)',
          },
          '18%': {
            filter: 'drop-shadow(0 0 24px rgba(80, 112, 255, 0.42))',
            transform: 'scale(1.018)',
          },
          '100%': {
            filter: 'drop-shadow(0 0 0 rgba(80, 112, 255, 0))',
            transform: 'scale(1)',
          },
        },
      },
      animation: {
        'generation-focus-pulse': 'generation-focus-pulse 1.35s ease-out',
      },
      transitionTimingFunction: {
        'nomi-fast': 'var(--nomi-transition-fast)',
      },
    },
  },
  plugins: [workbenchBasePlugin],
} satisfies Config
