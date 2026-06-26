# 时间轴轨道主次分层 + 空轨收起（方案 B）

> 2026-06-25 · 用户拍板方案 B（样张已批准）。承接音频成一等公民后，4 条等高轨道让底部「又长又重」。

## 根因 / 逻辑
4 条轨道视觉权重相同，但层级不平等：**画面（图片/视频）= 主角镜头序列**；**声音/文字 = 配角叠加层**（通常一两个 clip）。底部重 = 配角和主角一样高一样重。

## 改法（方案 B = 主次分层 + 空轨收起）
- **主轨（image/video）**：不变（row 52 / clips 46）。
- **副轨（audio/text，有内容时）**：压矮变淡（row 40 / clips 34 / 标签更淡）。
- **空副轨收起**：audio 或 text 为空 → 不渲染整行，收成一条细窄条「叠加层 [+ 配乐] [+ 字幕]」。两个都空 → 一条窄条带两 chip；只空一个 → 有内容的渲染副轨 + 空的那个的 chip。

## 关键实现点（derive 不 hardcode）
- **clip 高度自适应**：TimelineClip / 拖拽预览 / 文字 clip 的 `top-[5px] h-9`(36px) → `top-[5px] bottom-[5px]`（填满 lane 高度）。主轨 46px 容器结果仍 36px（零视觉变化），副轨 34px 容器 → 24px。一处改动两档自适应。
- **TimelineTrack 加 `variant?: 'primary'|'secondary'`**：参数化 row/clips 高度 + 标签淡化。
- **TimelineTextTrack 恒 secondary**：同套压矮。
- **新 TimelineSecondaryAddRow**：窄条 + 「+ 配乐」(dispatch `nomi-open-asset-library`) / 「+ 字幕」(`addTimelineTextClip('caption', playhead)`)。
- **TimelinePanel 编排**：primary tracks map → 有内容副轨 → 收起窄条；非预览（生成画布）只有 audio 副轨/配乐 chip，无字幕。

## 不动项 / 验收
- clip 内部 flex items-center 自动居中，缩短不破内容（audio=图标+名/text=图标+字，24px 够）。
- 主轨视觉零变化（对账样张）。
- 五门 + R13：空项目底部显著变矮（量高度）+ 加配乐/字幕后副轨展开 + 真机截图人眼判断主次分层。
