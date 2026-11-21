# 空节点：浏览时认类型，单选时给下一步

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

负责人：I-node-guidance；独立普查/验收：V-node-guidance。类别：用户可见界面。用户已于 2026-10-11 批准沿用 Nomi 现有设计系统的探索图，并要求「去实现吧，考虑各种节点类型等等」。批准源保存在 `docs/design/boards/2026-10-11/source/ContextualEmptyNodes.html`，它只是 exploration；合同是同目录 board 清单及下面的状态矩阵。

| 设计卡 | 结论与证据 |
|---|---|
| ★1 用户怎么用 | 创作者新建节点→自动单选→看到下一步→准备输入→点击空白浏览分组→只看类型图标→再次单选恢复引导。主指标：六空卡分组非当前节点的引导行数由 18 降到 0；质量指标：单选原入口保留率 100%；护栏：状态/内容不减少、浏览首次点击不打开文件框。任务：建混合类型分组；在空文本输入描述；为角色/音频/全景上传本地素材并重新浏览。逐步记录预期与实际，真实应用走查另交收据。|
| ★1b 连带界面 | 仅画布普通空态。保留框外名称、生成框、配方能力判据、错误/进度/恢复操作、列表、Agent 回执与插件诊断。剪辑/导演台保留自身功能头部，正文的教学说明收口。|
| ★2 谁说了算 | React Flow 宿主 primarySelection 是是否展开引导的唯一 owner；通过 React context 传至各空态。只读禁止激活上传/编辑入口。无持久化字段，不靠创建时间猜意图。证据：door-map NodeEmptyState，GenerationCanvasReactFlowNodes 的单选门。|
| ★3 一致与复用 | 复用 NodeEmptyState、节点图标注册表、已有 composer/NodeTryList/上传处理；无新色彩/字体/图标库/生成入口。道具卡保留已有语义图标。|
| ★4 全状态 | 普通空：浏览/多选只图标、单选原引导；加载/排队/运行/取消中：原 overlay；成功/部分成功：原内容；失败/过期/可恢复：原报告；等待上游/派生备好：显式业务状态永远显示；能力不可用：原禁用原因与模型选择/输入入口。zh/en 原 i18n，light/dark 原 tokens。|
| 5 中途表 | 选择/失选/多选即时投影，关窗/重启无状态迁移；断网不影响浏览/选择；连点只允许在按下时已单选的上传/launcher 执行；生成过程的关闭/取消/恢复语义不改。所有状态均不引入新的请求或花费，回执沿用原任务。|
| 6 外部数据与失败 | 本地素材仍走现有 FileReader/项目上下文导入；模型能力与供应商失败仍归原 owner。此次仅呈现层，无新的外部格式或协议。|
| 7 性能预算 | context 每节点仅投影一个单选门，浏览节点不挂配方操作 DOM。真实密集分组走查；不新增轮询/计时器。性能数字在验收报告记录，尚无新基准。|
| 8 真实条件 | macOS Electron zh/en light/dark、最小卡高/宽及混合类型走查；Windows/真实付费/干净安装 unverified，此改动不碰付费执行边界。|
| 拍板图清单 | `docs/design/boards/2026-10-11/ContextualEmptyNodes.board.json`；独立功能普查见验收报告。|
| ★9 验收与回滚 | I 线测试/截图，V 线独立审查，报告 `docs/evidence/2026-10-11-node-guidance/acceptance.md`。⑩⑪不改参数/能力表，⑫验证先选中再激活。逃逸 USER-20261011-node-guidance。回滚本 PR scoped commit，不改项目数据。|

### 功能分类

纯前端视觉/交互；不新增 AI 工具，不改变生成/导入持久化协议。状态矩阵覆盖 image/video/text/character/scene/audio/whiteboard/panorama/model3d/keyframe/shot/output/clip/director、旧 prop renderKind；asset/artifact/shot_table/缺失插件属于内容或诊断，保留原行为。

### 2026-10-12 图标尺寸修订

用户反馈浏览态 Icon 太小。浏览态从原有引导的 18px 图标 / 36px 底盘，放大为 24px / 48px，继续使用原线性图标、颜色及圆形底盘；单选引导保持原密度。短音频/剪辑条使用垂直居中，其余节点沿用 45% 视觉中心，框外名称保留。生产截图及跨类型实测见验收报告。
