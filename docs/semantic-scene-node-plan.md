# 语义场景节点执行方案

## 目标

在生成画布中新增独立的 `semanticScene` 节点，承接“全景图/图片 -> 建筑或开放环境语义场景图 -> 3D 场景”的链路，避免把语义解析逻辑写入现有图片、视频、全景图或 3D 编辑器模块。

Context7 中 `pascalorg/editor` 的参考重点是语义工具链：`photo_to_scene` 先把图像转换成场景语义，再通过 `create_room`、`create_wall`、`place_item` 等工具生成真实建筑元素。因此 Nomi 侧先沉淀一个中间语义契约，而不是直接把 Pascal 的实现细节耦合进画布。

## 已落地的 MVP

1. 新增 `semanticScene` 节点类型，出现在快速添加菜单中，默认不进入图片/视频执行器。
2. 节点数据存储在 `node.meta.semanticScene`，由独立 serializer 做归一化和容错。
3. 全景图节点工具条新增“语义场景”入口，可创建并连接一个语义场景节点，保留源图引用。
4. 语义场景节点支持从上游图片/全景图节点自动推断源图，也支持查看摘要、编辑/保存 JSON、复制 JSON。
5. 语义场景节点支持“AI 分析”，通过 `image_to_prompt` 任务把源图发送给支持图片理解的文本模型，并要求模型返回 `SemanticScene` JSON。
6. 语义场景节点支持一键转换为当前项目已有的 `scene3d` 节点，生成地面、墙体/边界、开口占位、对象占位、灯光和相机。

## 使用方式

推荐链路：

1. 在生成画布创建或上传一个全景图节点。
2. 选中全景图节点，在浮动工具条点击“语义场景”。
3. 选中新建的语义场景节点，确认顶部显示“源图已绑定”。
4. 点击“AI 分析”，等待模型把全景图解析成 `SemanticScene` JSON。
5. 需要人工修正时，直接编辑 JSON 并点击“保存”。
6. 点击“转 3D”，生成并连接一个 `scene3d` 节点，再进入 3D 编辑器继续调整。

如果从快速添加菜单手动创建 `semanticScene` 节点，需要先从图片或全景图节点连线到它，或者在 JSON 的 `sourceImageUrls` 中填入源图 URL；否则“AI 分析”会保持禁用。AI 分析依赖模型管理中至少有一个启用的文本/视觉理解模型。

## Agent 工具

生成画布工具层已新增三个隔离工具：

- `create_semantic_scene`: 从指定图片/全景图节点创建并连接语义场景节点。
- `analyze_semantic_scene_from_source`: 对语义场景节点绑定的源图执行 AI 视觉语义分析。
- `convert_semantic_scene_to_scene3d`: 把语义场景节点转换为当前的 `scene3d` 节点。

当前右侧生成区 Agent 仍以“规划待确认节点”为主，已经允许规划 `semanticScene`，但真实 AI 分析仍由节点按钮或工具层显式调用，避免普通对话误触发高成本视觉分析。

## 语义契约

`SemanticScene` 的核心字段：

- `sourceType`: `panorama`、`image`、`multi_view`、`manual`
- `sceneClass`: `indoor_architecture`、`outdoor_open`、`mixed`、`unknown`
- `coordinateSystem`: `relative` 或 `meters_estimated`
- `sourceImageUrls`: 源图或多视角图
- `graph.spaces`: 房间、区域、道路、广场、地形
- `graph.boundaries`: 墙、立面、围栏、边界、地形边缘
- `graph.openings`: 门、窗、拱门
- `graph.surfaces`: 地面、天花、墙面、天空、水面
- `graph.objects`: 家具、道具、植被、车辆、人物、灯光、建筑、地貌
- `graph.lighting`: 时间、氛围、主光方向、柔和度、色温
- `graph.cameras`: 建议相机
- `graph.uncertainties`: AI 无法确定的信息

开放场景不要强行套房间模型，应优先输出 `outdoor_open` 或 `mixed`，使用 `terrain`、`plaza`、`path`、`facade`、`vegetation`、`building`、`landform` 等语义。

## 后续实施阶段

### 阶段 1：AI 语义分析器

新增独立的 semantic-scene analyzer，不复用图片/视频生成 runner。输入为源图 URL、用户补充 prompt、可选比例尺提示；输出必须是 `SemanticScene` JSON。

分析器要做三层约束：

- 视觉理解：识别空间类别、可见边界、主要对象、光照和相机建议。
- 几何估计：没有尺度时使用相对坐标；有比例尺时切到 `meters_estimated`。
- 不确定性：遮挡、不可见背面、尺度不确定必须写入 `uncertainties`。

### 阶段 2：转换质量增强

增强 `semanticSceneToScene3D`：

- 支持多空间、多高度、室内外混合区域。
- 对开放场景增加天空、水面、道路、地形坡度等更合适的占位。
- 给常见对象接入资产检索或模型占位映射，而不是只用基础几何。
- 为窗口/门洞生成更真实的墙面局部结构。

### 阶段 3：Pascal 适配层

新增可选的 `pascalScene` adapter，不直接改 `semanticScene`：

- `spaces.room + floorPolygon` -> `create_room`
- `boundaries.wall/facade` -> `create_wall`
- `objects.furniture/prop` -> `search_assets` + `place_item`
- `openings.door/window` -> 对应 Pascal 建筑开口工具

如果 Pascal 工具不可用，链路仍能通过 `scene3d` 节点工作。

### 阶段 4：人工校正闭环

在语义节点中增加结构化编辑器：

- 空间/边界/物体表格编辑
- 坐标可视化预览
- “重新分析但保留人工修改”策略
- 语义 diff，避免 AI 覆盖用户校正

### 阶段 5：生成画布 Agent 工具

给画布 AI 增加工具：

- `create_semantic_scene`
- `analyze_semantic_scene_from_source`
- `convert_semantic_scene_to_scene3d`
- 未来可选 `convert_semantic_scene_to_pascal`

这些工具只操作新节点和 adapter，不进入现有图片/视频执行路径。
