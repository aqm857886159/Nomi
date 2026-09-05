# Nomi 统一 Agent + 画布样张 v1

## 状态

- `featureId`: `nomi-unified-agent-canvas-v1`
- `version`: `v1`
- `status`: `awaiting-user-confirmation`
- `changedVariable`: `workspace-composition-and-information-hierarchy`
- `generator`: Codex 内置图片生成
- `generatedImage`: `./v1-exploration.png`
- `prompt`: `../02-prompt-brief-v1.md`
- `outputSize`: `1717 × 916 PNG`

这是一张视觉方向探索样张，不是生产界面、交互证明或功能完成证明。它用于先确认工作台的信息层级和空间关系；只有用户确认方向后，才进入设计契约、真实组件实现和 Electron 走查。

## 输入参考

本次生成直接使用 Nomi 的真实页面截图作为参考图：

1. `../../../../design/reviews/2026-08-30-agent-interaction/02-agent-host-desktop.png`
2. `../../../../design/reviews/2026-08-30-agent-interaction/06-generation-default.png`
3. `../../../../design/reviews/2026-06-12-start-v3-c-workbench-tour.png`

用户附带的白色画布引导图只作为“空状态要能教会用户怎么开始”的交互模式参考，不作为视觉复制对象。

## 本版要确认的内容

1. 固定左侧栏是否让“项目、素材、Skill、三类工作台、设置”有了清楚的一处归属。
2. 中央画布是否成为主工作区，且没有再出现原来那种左侧堆一大批图片的干扰。
3. 右侧 Agent 是否足够可见，但不会把生成结果永久铺在对话流中；结果通过任务卡、结果入口或收起状态保留。
4. “视频源 → 视频拆解表 → 选择镜头后生成图/视频”的关系是否一眼可理解。
5. 中央的三张 Skill 引导卡是否解决了空白画布的问题，还是应该改成更轻量的可收起入口。

## 已发现的样张问题（不是生产问题）

### P0

- 暂无方向级 P0。主层级已经表达为“画布 > Agent 协作 > Skill 引导”。

### P1

- 图片生成模型生成的中文和细小标签不保证准确；实现时必须使用真实 i18n 文案，不能照抄样张字形。
- 顶部出现的“分享 / 预览片段”等控件没有进入本次需求合同，暂时视为模型生成的探索噪声；实现前应删除或重新确认归属。
- 右侧生成结果节点与下方 Skill 卡片同时可见时仍略密，需要确认是否把 Skill 卡片改为“首次空状态 / 可收起区域”。

### P2

- 小图标、hover 动效、焦点态、键盘操作和全屏 Agent 状态无法由这张静态样张证明，需要在 HTML mockup 和真实组件中单独验证。
- 本版只展示了 Agent 停靠在右侧的状态；全屏对话面板应作为同一设计方向的第二个状态，不应引入第二套 Agent。

## 证据边界

这张图不能证明：

- 组件已经实现；
- 视频链接获取、视频拆解、表格编辑、生成链路或持久化已经可用；
- Agent 已经能在全屏和画布间共享上下文；
- 任何模型、供应商、Skill 或媒体工具已经接通。

下一步必须先得到用户对上述五项的反馈；每次迭代只改变一个明确变量，并继续保留真实页面参考图和对应 Prompt Brief。
