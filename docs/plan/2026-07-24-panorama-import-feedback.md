# 3D 场景全景图导入「没反应」根治（2026-07-24）

## 症状（微信群用户录屏，55s）
用户在 3D 场景全屏编辑器 → 属性 → 全景图 → 「导入全景图」，两次选择 `image.jpg`（车内全景，JPEG 315KB，目测 ≈2.2:1），画面零反应：无提示、无报错、面板停在按钮态、场景背景仍是纯色。用户判定「功能有问题」。

## 根因（两层，都实锤）

**根因 A（机制层，整类问题的入口）：反馈层被浮层压死。**
- 全局 toast 容器 `<Notifications zIndex={2000}>`（NomiAppProviders.tsx:20）。
- 3D 全屏编辑器 portal 到 body 且 `FULLSCREEN_Z_INDEX = 2147483647`（scene3dConstants.ts:90）→ 编辑器打开期间**一切 toast 都渲染在编辑器底下，肉眼不可见**。
- 同类入口：提示词库/技能库/素材库 4000、灯箱 4200、付费确认 3500、全景查看器 9999——toast(2000) 在**所有**这些浮层之下；MCP 付费确认卡(3500)在 3D 编辑器(maxint)下同样不可见。
- 全 App z 层实测：1000–3399 区间除 toast 外为空；模态层 3400–4200；基础 UI ≤600。

**根因 B（产品层）：2:1±3% 比例硬闸直接拒收。**
- `isStandardPanoramaDimensions` 要求宽高比 ∈ [1.97, 2.03]，不合格 → 仅弹一个（被根因 A 吞掉的）toast 后 return，面板无任何变化。
- 用户的图 ≈2.2:1（AI 生成的全景大多不是精确 2:1）→ 被静默拒收。
- 渲染层核实：equirect 映射对任意比例纹理只是拉伸采样，不会崩，且已有 EnvironmentResourceBoundary 兜底 → 硬拒没有技术必要。
- 口径自相矛盾：画布「全景图」节点（PanoramaViewer）接受任意比例，3D 场景导入却硬拒——同一「全景图」概念两套标准。

## 修法

1. **反馈层永远最顶**：`FEEDBACK_LAYER_Z_INDEX = 2147483647` 抽到 `src/ui/feedbackLayer.ts`，Notifications 引用它。这是「反馈可见性」的结构不变量。
2. **3D 全屏编辑器降到 3000**：盖过基础 UI（≤2000 区间），让出模态层（3400+，付费确认必须可见）与反馈层。
3. **比例硬闸 → 软警告**：非 2:1 照常导入 + warning toast「已导入，非 2:1 可能拉伸」；面板预览图 onLoad 读 naturalWidth/Height（derive 不存状态），非标准时常驻一行提示。尺寸读不出/超 80MB/非图片仍硬拒（toast 现在可见了）。
4. **结构保证**：纯逻辑抽 `scene3d/panoramaImport.ts`（面板内删旧，无并行版）；新增不变量测试：反馈层 > 全屏编辑器、全屏编辑器 < 模态层(3400)；比例判定单测。
5. i18n：新增 `nonStandardImported` / `nonStandardHint`（zh+en），删除不再使用的 `invalidRatio`。

## 不动项
- 画布侧 panorama 节点、PanoramaViewer、scene3dEnvironment 渲染层：不动。
- 其余浮层的 z 值（3400–4200/9999）：不动（它们互相不叠加触发）。

## 验收门
- 五门全过。
- R13 真机：全屏编辑器内导入非 2:1 图 → toast 可见（截图）+ 场景背景变全景（截图）+ 面板出现非标准提示；导入 2:1 图 → success toast 可见。

## 遗留（另行拍板，不捎带）
- 画布图片节点 → 3D 场景全景的直连桥（用户现在要导出到 Downloads 再 Finder 导入，摩擦真实存在）→ 需样张+拍板。
