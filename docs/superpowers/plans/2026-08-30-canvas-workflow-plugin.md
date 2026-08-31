# Nomi 固定流程与原生画布插件计划

状态：🚧 第一阶段生产切片已落地；Agent 集成按 #223 暂缓

## 背景与用户任务

创作者常把“参考图 → 角色/场景 → 生成镜头 → 人工检查”搭好一次，却在每个新项目重复拖节点、连线、上传素材和调整参数。用户真正要的是把一次成功的工作方法固定下来，并在下一个项目完整搬过来，而不是学习插件格式或进入市场挑包。最短闭环是：框选一套现有节点 → 保存为流程 → 在另一个项目点击“复制到画布” → 一次撤销回退。

这里的用户价值是复用已经验证过的创作决策，而不是再保存一张结果图。若用户只做一次性流程，流程库没有价值，因此第一阶段只在用户明确保存时收录，不自动收集画布内容。

## 用户旅程与交互合同

### 保存

用户在 React Flow 画布框选或点选节点，选区工具条提供“保存为流程”。宿主自动生成名称、封面、节点/素材数量和一行可选描述；用户不填写也能保存。保存的是一次完整快照：节点、内部边、分组、相对布局、提示词、模型和插件状态，以及已在本地物化的图片、视频、音频和生成结果。

### 找到

流程库是应用级、跨项目的左侧抽屉。卡片用“素材封面 + 小型流程结构”帮助快速识别；无素材时退回结构缩略图。搜索覆盖名称、描述、标签、节点名称和插件 type，不搜索或改写完整提示词。`全部 / 最近 / 收藏 / 类型` 只做确定性的索引筛选，不引入 AI 识别或市场推荐。

### 复制

用户点击唯一主操作“复制到画布”，不进入映射表单。宿主在当前视口/插入点生成新节点和目标项目素材，保留可见内容、参数、布局和边；只重新生成内部 id 并重写引用。复制完成后新节点保持选中，提示复制的节点与素材数量，整次操作可一次撤销/重做。

### 编辑与恢复

`⋯ → 编辑信息`只编辑名称、描述、标签和封面。要改变流程内容，用户在画布中编辑后明确另存为新流程或更新流程。插件缺失、不兼容或迁移失败时显示占位节点，保留原始数据、素材引用、位置和边；重新启用插件后可恢复。无法安全物化的外部 URL 只保留原始引用并标记不可用，不通过任意远程 loader 下载。

## 范围

本分支交付：

1. ADR、威胁模型、manifest/版本/占位/所有权合同和开源实现对账。
2. `VITE_NOMI_CANVAS_PLUGINS=true` 才启用的本地插件注册表。
3. 一个编译进 Nomi 的可信“工作流检查点”节点插件，验证注册、注销、React Flow 渲染和受控交互。
4. 应用级跨项目流程库：框选保存完整包、元数据编辑、左侧库内检索、受控素材物化和关闭重开恢复。
5. 从流程库复制到任意项目：id 重映射、素材引用重写、内部边保留、统一撤销/重做和持久化。
6. 有序版本迁移、非法 manifest/不兼容版本、重复 type 冲突和缺失插件占位测试。
7. 插件写入统一 `updateNode`/图事务，覆盖撤销/重做和持久化。

不做：远程/本地任意脚本、插件市场、CSP/preload 改造、全部节点迁移、#223 未定稿的 Agent 工具接入、性能路径改造。

## 实现顺序

1. 先落盘纯类型/注册/迁移/模板模块及单元测试（红 → 绿）。
2. 扩展 GenerationCanvasNode/Snapshot 的可选插件字段和模板字段，保证 normalizer 不丢未知 envelope。
3. 把 renderer 解析接到宿主注册表；缺失时使用占位；内置插件只获得窄回调。
4. 建立应用级 library index + 受控 project-asset copy bridge；不把二进制素材塞进 Zustand 或 JSON 快照，复制只提交来源项目/目标项目/相对路径。
5. 将保存/复制接入 Zustand store 的现有写入、undo、persist 机制，保证跨项目物化只产生一笔画布写入。
6. 在已有选区工具条加“保存为流程”，替换隐藏的项目内 select 入口为左侧全局流程库；加入元数据编辑和混合预览，所有文案走 i18n。
7. 跑分层测试：插件/迁移/模板/asset bundle/normalizer 单测；跨项目 React Flow 交互和真实用户旅程回归；typecheck/lint/i18n/tokens/filesize/build。无性能路径变化，不跑全量性能基准。

## 验收不变量

- 任意插件节点都能由 `pluginId + typeId + schemaVersion + state` 重建；缺失插件不丢节点/边。
- 注册表遇到重复 plugin id、重复 type id、内置 kind 冲突或不兼容版本时拒绝注册。
- 模板只复制选区内部边；应用后节点/边获得新 id，保持相对位置和插件状态。
- 元数据编辑不会改变不可变工作流快照；复制时只生成新 id、物化素材并重写目标引用。
- 库条目独立于来源项目；来源项目存在时素材按相对路径经主进程复制，来源缺失/复制失败仍保留原始引用并显示可恢复占位。内容哈希去重留作后续优化。
- 模板应用和插件状态编辑各有明确 undo barrier，redo 恢复同一结果。
- 插件组件不持有 store 或 Electron 对象，只能请求宿主回调。
- Agent/MCP/Skill 不新增旁路；#223 继续作为后续接口依赖。

## 回滚与风险

feature flag 默认关闭即可回滚 renderer 插件；模板字段为 optional，旧项目不受影响。若迁移失败，保留原 envelope 并显示占位。若 React Flow 渲染出现异常，关闭 flag 后现有内置节点路径保持不变。风险最高的是跨项目素材所有权、持久化 schema/undo 与 renderer 适配，优先用 bundle manifest、纯函数和接口测试锁住。素材无法安全复制时必须显式标记，不以静默丢失换取“成功”。

## 方案验收标准（用户价值）

- 用户从新项目打开流程库到把一套已验证流程放上画布，不需要配置映射或重新上传已纳入 bundle 的素材。
- 卡片在左侧窄栏中能同时给出用途线索（封面/描述）和结构线索（节点与素材数量），且主操作只有“复制到画布”。
- 复制后用户立即看到新节点并可继续编辑；错误复制可以一次撤销，关闭项目后重开仍能恢复。
- 任何缺失插件、版本不兼容或素材不可用都不会静默删除原始节点数据。
- Agent 后续只能调用同一复制/写入边界；在 #223 合同稳定前不新增 Agent tool 或旁路协议。

## 研究证据

- React Flow custom nodes / `nodeTypes`: https://reactflow.dev/learn/customization/custom-nodes
- React Flow `NodeToolbar`: https://reactflow.dev/api-reference/components/node-toolbar
- Rete.js plugin system: https://retejs.org/docs/concepts/plugin-system/
- Rete.js editor/area/render 分层: https://retejs.org/docs/concepts/editor/
- ComfyUI Manager custom-node lifecycle: https://github.com/comfy-org/ComfyUI-Manager
- n8n node creation docs: https://docs.n8n.io/integrations/creating-nodes/overview/
- n8n workflow templates: https://docs.n8n.io/workflows/templates/
