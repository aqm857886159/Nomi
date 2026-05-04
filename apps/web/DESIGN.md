# Nomi Web Design Standard

> Source of truth: repository root `Design.md`
>
> 本文件只负责把根目录 `Design.md` 落到 `apps/web` 的执行检查。若冲突，以根目录 `Design.md` 为准。

## 1. Web Direction

`apps/web` 当前默认产品形态是 Nomi AI 影像生产工作台：

- `创作`：写作、AI 改写、派生节点。
- `生成`：画布 frame 节点、AI 助手、compact 时间轴。
- `预览`：真实 timeline 播放、剪辑检查、导出入口。

新增 UI 不得重新发明一套工作流壳层。

## 2. Light-Only Rule

- Web 工作台只维护 light-only。
- 不新增 `dark` selector、主题 toggle、auto color scheme 或 dark fallback。
- `main.tsx` 固定 Mantine `forceColorScheme="light"`。
- 旧 dark CSS 只能作为历史清理对象，不能作为新组件依赖。

## 3. Tokens

新增样式优先使用：

```css
var(--nomi-bg)
var(--nomi-paper)
var(--nomi-ink)
var(--nomi-ink-80)
var(--nomi-ink-60)
var(--nomi-ink-40)
var(--nomi-line)
var(--nomi-line-soft)
var(--nomi-accent)
var(--nomi-radius-sm)
var(--nomi-radius)
var(--nomi-radius-lg)
var(--nomi-shadow-sm)
var(--nomi-shadow-md)
var(--nomi-shadow-lg)
```

Token 文件：

```txt
apps/web/src/theme/nomi-tokens.css
```

## 4. Component Rules

- AppBar 高度 56px，品牌为 `Nomi`。
- Stepper 必须与 `workbenchStore.workspaceMode` 和 URL `?step=` 同步。
- Generation frame 节点主宽 320px，媒体区 180px。
- 主生成按钮在节点卡上；详情面板只放高级配置、历史、错误和引用细节。
- 时间轴操作必须改真实 store，不做纯视觉状态。
- 预览必须跟随真实 playhead，不显示假进度。

## 5. JSX/Class Rules

- 新增 TSX 标签必须有描述性 `className`。
- 不新增 `any` 或 `as any`。
- 不硬编码模型候选列表；模型来自 model catalog / provider config。
- 不新增 mock 生成结果、mock 播放结果、mock 导出结果。

## 6. Visual Review

每个 UI 改动完成前检查：

- 没有暗色模式分支。
- 没有圆角套圆角。
- 没有无意义边框。
- 同屏有效信息密度足够。
- 操作按钮都有真实动作或明确 disabled。
- 用户路径仍然是：创作 -> 生成 -> 剪辑 -> 预览 -> 导出。
