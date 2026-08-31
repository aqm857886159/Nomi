# 剪辑节点无限时间轴样章 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将剪辑节点样章改成与现有真实时间轴一致的“可横向滚动、向右增长”的无限时间轴，并让视频预览固定浮在剪辑轴上方。

**Architecture:** 样章使用“固定视口 + 可增长内容层”。内容层以秒为单位计算宽度，标尺、播放头、轨道和片段都使用同一套 `frame ↔ pixel` 映射；片段的 `data-start/data-end` 是唯一时间真相，DOM 的 `left/width` 只负责渲染。新增/复制片段默认追加到当前末尾，不重排已有片段；超过初始 30 秒后只增加内容层宽度并出现横向滚动。预览使用绝对定位覆盖在轴上方，不参与布局流。

**Tech Stack:** 单文件 HTML 样章、原生 DOM Pointer Events、CSS overflow-x scrolling；参考实现：`src/workbench/timeline/TimelinePanel.tsx`、`src/workbench/timeline/TimelineTrack.tsx`、`src/workbench/timeline/TimelineClip.tsx`、`src/workbench/timeline/timelineEdit.ts`。

---

### Task 1: 对齐样章结构与真实时间轴几何

**Files:**
- Modify: `.superpowers/brainstorm/55006-1786648951/content/clip-node-branch-output-v1.html`

- [ ] **Step 1: 添加固定视口与可增长内容层**

把 `#axis` 内的 ruler 与 track 放入 `#axisContent`，保持 `#axis` 为固定视口：

```html
<div class="axis" id="axis">
  <div class="axis-content" id="axisContent">
    <div class="ruler" id="ruler" aria-label="时间标尺">…</div>
    <div class="track">…</div>
  </div>
</div>
```

- [ ] **Step 2: 写入初始片段帧数据并保持初始 00:00–00:26**

为 4 个片段补齐 `data-start`、`data-end`、`data-duration`，初始值分别为 `0–5`、`5–12`、`12–18`、`18–26`。DOM 几何不再作为时间数据源。

- [ ] **Step 3: 运行浏览器结构检查**

验证命令：启动样章服务器后，用浏览器检查 `#axis`、`#axisContent`、`.ruler`、`.track` 的嵌套关系；预期 `#axis` 只有一个横向滚动内容层，预览不在内容层内。

### Task 2: 实现单一 frame/pixel 映射与无限向右增长

**Files:**
- Modify: `.superpowers/brainstorm/55006-1786648951/content/clip-node-branch-output-v1.html`

- [ ] **Step 1: 用固定初始视窗和动态尾部定义轴宽**

在脚本中使用以下常量与函数：

```js
const INITIAL_VIEW_SECONDS = 30
const TRAILING_SECONDS = 4
const PIXELS_PER_SECOND = 16
const LEADING_SLOT_PIXELS = 64
let timelineEnd = 26

function axisEndSeconds() {
  return Math.max(INITIAL_VIEW_SECONDS, timelineEnd + TRAILING_SECONDS)
}

function frameToPixel(frame) {
  return LEADING_SLOT_PIXELS + Math.max(0, Number(frame) || 0) * PIXELS_PER_SECOND
}

function pixelToFrame(pixel) {
  return Math.max(0, (pixel - LEADING_SLOT_PIXELS) / PIXELS_PER_SECOND)
}
```

- [ ] **Step 2: 让内容层、标尺、轨道、片段共享几何**

`updateTimelineLayout()` 根据 `axisEndSeconds()` 设置 `#axisContent` 的 `width`；按 `data-start/data-end` 设置片段的 `left/width`；标尺 tick 和 playhead 同样使用 `frameToPixel()`。新增内容只改变 `timelineEnd` 和内容层宽度，已有片段的秒位置不变。

- [ ] **Step 3: 让标尺动态生成 10 秒刻度**

每次布局更新时清理并重建 00:00、00:10、00:20…直到轴尾的 tick；轴从 26 秒增长到 35 秒时，原刻度位置不变，只新增 00:30 刻度和右侧空白。

- [ ] **Step 4: 运行映射验收**

浏览器断言：初始轴内容至少覆盖 30 秒；添加 3 秒片段后 `timelineEnd=29` 且内容宽度不缩放原片段；复制 8 秒片段后 `timelineEnd=34`、出现 00:30 tick、`.axis.scrollWidth > .axis.clientWidth`。

### Task 3: 复用真实时间轴的追加、拖动、裁切与播放头语义

**Files:**
- Modify: `.superpowers/brainstorm/55006-1786648951/content/clip-node-branch-output-v1.html`

- [ ] **Step 1: 以 `data-start/data-end` 驱动文案和输出映射**

`updateClipTime()` 只读取数据属性，不从百分比反推时间；片段移动/裁切后更新数据属性，再调用 `updateTimelineLayout()`。输出节点的标题和连接仍按同一片段 id 对账。

- [ ] **Step 2: 新增/复制默认追加到末尾**

追加起点使用当前片段最大 `data-end`，不调用会压缩全部片段的 `reflowClips()`。新增 3 秒或复制原片段时只增加 `timelineEnd`；结果节点按片段起点排序插入。

- [ ] **Step 3: 让拖动使用合法空位和吸附式落位**

参考 `timelineEdit.ts` 的 `nearestLegalStart`：拖动时排除当前片段，寻找离目标最近的合法空隙；无限轴末尾始终可放置，不因“固定容器满了”弹回。松手后更新数据属性并刷新连接线。

- [ ] **Step 4: 让 ruler scrub 使用同一像素映射**

标尺 pointer 位置先减去标尺内容层的 `getBoundingClientRect().left`，再经过 `pixelToFrame()` 写入 `playheadFrame`；剪刀分割直接读取这个 `playheadFrame`，不再混用百分比。

### Task 4: 固定上方预览并做真实任务走查

**Files:**
- Modify: `.superpowers/brainstorm/55006-1786648951/content/clip-node-branch-output-v1.html`

- [ ] **Step 1: 保持预览绝对定位**

预览锚在 `.source-node` 内的轴上边缘，使用 `position:absolute`、固定 `bottom` 和较高层级；展开/收起不改变 `.axis` 的 `getBoundingClientRect().top/height`。

- [ ] **Step 2: 运行真实用户任务走查**

按以下顺序验证并截图：

1. 初始只看到剪辑条，轴尾显示 00:30。
2. 点击片段，视频出现在轴上方，轴位置不变。
3. 点击加号，新增片段在右侧追加，旧片段不移动。
4. 复制末尾片段，轴继续向右增长并可横向滚动。
5. 拖动播放头、拖动片段、裁切和剪切，时码、预览、输出线保持一致。

- [ ] **Step 3: 清理样章运行时错误并复查视觉**

检查浏览器 `pageerror` 为空；检查横向滚动后连接线仍从实际片段边缘指向对应输出句柄；检查预览展开不会把轴推向下方。

### Task 5: 迁移到正式剪辑节点

- [x] 把固定视口、向右增长、统一帧/像素换算接入 `ClipNodeTimeline`，并保留原时间轴的拖动、裁切、分割语义。
- [x] 标尺播放头与剪刀模式共用同一帧坐标；预览浮层展开不改变轴的位置。
- [x] “下载成片”同时按片段导出并为每个片段创建画布视频节点，复用现有连接能力。
- [x] 为视口几何、追加增长、旧片段位置稳定和输出来源身份补纯函数测试；补 Electron 走查的初始 30 秒刻度与预览稳定断言。
