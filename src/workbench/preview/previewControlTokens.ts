// 预览控制条共用的样式/数值 token（被播放控件与文字样式控件共享，避免重复定义）。

// 控制条圆形小图标按钮的统一样式。关键：cursor/hover 用 `enabled:` 变体门控——
// disabled 按钮仍会收到 :hover，旧写法的无条件 `cursor-pointer hover:bg…` 会让禁用态
// 仍高亮成「假可点」。整条控制条共用此常数，禁用态收口一处（不逐个补）。
// 注意 WorkbenchIconButton 基类自带「无条件」hover:bg-workbench-hover/text-workbench-ink，
// twMerge 把 base 的 `hover:` 与本处 `enabled:hover:` 视作不同键（都保留）→ 仅加 enabled:
// 杀不掉基类那条 hover。故再显式补 `disabled:hover:`（双伪类，特异性高于基类单 hover）把
// 禁用态 hover 钉回静息态——这是 R8 反复点名的 twMerge 隐藏覆盖坑。
export const CONTROL_ICON_BUTTON_CLASS =
  'w-6 h-6 inline-grid place-items-center p-0 border border-transparent rounded-full bg-transparent text-[var(--workbench-muted)] ' +
  'enabled:cursor-pointer enabled:hover:bg-[var(--workbench-hover)] enabled:hover:text-[var(--workbench-ink)] ' +
  'disabled:hover:bg-transparent disabled:hover:text-[var(--workbench-muted)]'

// 字幕/标题卡停留时长的可编辑范围：最短 0.5s（仍 ≥1 帧由 resizeTextClip 兜底），步进 0.5s。
export const TEXT_CLIP_MIN_SEC = 0.5
export const TEXT_CLIP_STEP_SEC = 0.5
