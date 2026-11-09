# 方向检查：尺寸与位置把手按手势认领（2026-11-09）

## 0. 一句话根因

指针捕获不取消浏览器默认拖动，以字面 separator role 普查又漏掉无 role 的真实尺寸把手。

## 1. 归类表

| 提交 / 问题 | 直接原因 | 类 |
|---|---|---|
| 3f78e2e06，导演台收进生成页 | DirectorViewport 跟随页内层与生命周期，修整窗挂载 | 页内层归属 |
| e57081ef0，统一激活界面输入 | DirectorViewport 的 active surface 输入归属 | 激活界面输入 |
| 8854368e7，模态层输入归属 | ComfyuiWorkflowSettingsPage 的输入 scope 与弹层归属 | 激活界面输入 |
| c00411696，接入自检 | runTestGeneration 及相关测试的自检行为 | 接入验证 |
| 本次三入口 | PiP beginResize/beginDrag、WorkflowGraphCanvas.onPointerDown 仅捕获或拖动会话，缺 preventDefault | 尺寸/位置手势按下认领缺口 |

`fix-churn` 命中 viewport 目录近14天第三个 fix；前两个都只改 DirectorViewport.tsx。`git log` 核实 PipViewport.tsx 本身没有命中热点，不是同一文件连续修补。

workflowPage 目录同样近14天已有两次 fix：8854368e7 只改 ComfyuiWorkflowSettingsPage.tsx，c00411696 改 runTestGeneration.ts 与其测试。WorkflowGraphCanvas.tsx 本身未命中。两个目录均为目录热点，不是被修改文件连续修补。

## 2. 为什么会出现

缺的是浏览器默认动作的归属与按真实手势的普查，不是增加一个画中画内容特例。⑩说的=摆的、⑪能选到不涉及；⑫点了=以为的适用：用户拖48px应得到对应宽度，量具是隔离 Electron CDP 原始事件和 DOM 几何，结构测试守住入口。没有将逃逸账本条目转 fixed。

## 3. 可验证预测

| 预测 | 验证 |
|---|---|
| 无 separator role 的尺寸把手会漏过旧守卫 | 新结构测试在原 PipViewport 字节上红，列出右下角把手 |
| capture 本身不能证明已取消默认拖动 | 已加载画面，六步×8px拖动，记录 dragstart/pointercancel 与宽度 |
| 单纯扩大到所有 pointer capture 会误报跳转、播放头 | 反例夹具与全仓入口表区分尺寸光标和普通捕获点击 |

## 4. 靶子独立性

问题来自独立验收的原始入口表；实现者不把实现报告当复现。量具沿用真 Electron/CDP 与既有结构测试。没有发现修对反而掉分的先例。库/跨文件回调的静态边界明列，不把无法解析当成产品缺防护。

## 5. P0 与现成方案

沿用 DOM PointerEvent.preventDefault、既有捕获/尺寸 setter；EditorSplit、TimelineTextTrack 已采用。TypeScript AST 已安装，复用原守卫，不加库或产品 helper。不是领域专属的新拖动框架。

## 6. 三条路

| 选项 | 做法 | 代价 / 风险 | 推荐 |
|---|---|---|---|
| 沿原方向修 | 给 role 守卫加 PiP 特例 | 下一个无 role 把手继续漏 | 否 |
| 换一种做法 | resize/grab/move 光标+自定义 pointerdown，识别捕获或 onMove 会话 owner；三入口统一复用已合入分隔条的 pointerdown.preventDefault 写法；工作流空白起手保护先执行 | 委托/库托管、非 pointerdown、外置 CSS 需另列边界 | 是 |
| 删掉 | 删旧字面 role 判据；不删缩放入口 | 保住创作者已有缩放与老尺寸，无迁移 | 与替换同提交 |

这是「换」：同提交删旧判据，三入口按下均复用已有 preventDefault 写法，删除仅捕获但允许原生拖动的旧行为，不新增产品分支、布局、依赖或特例。前次设计卡的键盘、焦点、钳制与持久化要求仍有效。

## 7. 权衡与批准

保住看清构图时跟手缩放的结果，同时诚实限定静态扫描能证明的边界。协调第二轮按 CLAUDE.md P1 例外代批两个目录扩范围，事后报用户。理由是文件本身未命中，改法为统一替换已有按下处理，不新增特例、分支或白名单。

## 特征测试

`src/ui/input/resizeSeparatorGesture.structure.test.ts`：原六个分隔条、无 role 的 PiP、常量/工厂写法、纯视觉 separator/原生 range/普通捕获点击误报反例；缩放版修前红测列出 PiP；扩展位置版在 origin/main 对应的两份产品文件上精确点名三入口（8过1败）；字幕主体移动1、左右尺寸2逐个认领，不靠改总数。修后三入口均须绿，不加特例压绿。真实画面复现与检查收据记录在交付报告。
