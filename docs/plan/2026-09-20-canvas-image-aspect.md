# 生成画布图片按真实画幅显示

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已合入 main（PR #825，b5cf48bc0）；对应 TODO T-CV-06。逐项审计与验证边界见 [总报告](../audit/2026-09-20-change-by-change-review.md)。

## 问题与范围

9/8 的 63cf9cf6c 为生成反馈稳定性冻结宽高：nodeRunOutcome 保留占位 footprint，computeMediaMetaPatch preserveSize 保留 previewHeight。与 object-contain 组合后返回不同画幅即留边。本次明确替代该合同的**图片**部分：位置保持，宽度尽量保持，图片完整等比显示。视频、专属角色/场景卡的既有布局不改；不裁剪原图、不改资产文件。

共享 resolveNodeVisualSize 同时决定 DOM、React Flow、连线、选区与 fitView。图片真实尺寸在这里优先于旧 previewHeight；极端画幅整体缩放以守最大边界，允许短边低于通用下限。split 瓦片布局仍以格位宽度为准，probe 与最终 asset 节点一致。使用 React Flow 原生 keepAspectRatio，尺寸限制复用相同比例规则。轻量预览完整显示图片并复用 computeMediaMetaPatch 测量入口，视频 poster 不回填图片尺寸。

## 先查别人

- React Flow 官方 NodeResizer：<https://reactflow.dev/api-reference/components/node-resizer>（2026-09-20 实读）。keepAspectRatio 默认 false；直接启用原生等比缩放，不自己接管指针。
- tldraw ImageShapeUtil：<https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/shapes/image/ImageShapeUtil.tsx>，实际下载源码 81–83 行 isAspectRatioLocked 返回 true，171–182 行复用 resizeBox 并将 crop 作为显式操作。图片缩放与裁切分离。
- MDN object-fit：<https://developer.mozilla.org/en-US/docs/Web/CSS/object-fit>（2026-09-20 实读）。contain 在框与图比例不一致时 letterbox/pillarbox；修正几何而非改 cover 掩盖留边。

## 六角色与独立反方

CTO：几何所有消费者从共享 owner 推导。设计：完整图像，无新增控件。PM：仅纠正图片显示，旧视频冻结不变。前端：RF 原生等比与可达 min/max；LOD 与完整态一致。后端：资产字节不变，测量不触发持久化。真实用户：重开旧项目、切历史版本、拖拉与缩放均保全图像。

独立 aspect_review 审核指出 RF resizer、LOD、split asset 与旧 meta 四条遗漏，均纳入实现/回归。旧 meta 在新 src 解码前可能短暂属于旧图；当前 src onLoad 必須刷新，未知尺寸不伪造测量。没有新外部依赖，不需要 Context7 不可用时猜 API；已查当前官方参数及已安装源码。

## 验收与回滚

先红：生成占位340×340显示16:9/9:16真实图片；旧 metadata、userResized、极端比例、split asset、卡片/视频边界。真机用登记的真实拍摄帧建立历史生成结果项目，经项目卡打开、选择、RF 上下拖拉、重开、zh/en截图；不声称本轮调用供应商。检查完整图像与边界/手柄一致。

再跑 required contracts、相关单测、build、Ponytail，对 PR 和真实 merge SHA 的 CI 验证。原子 revert 本分支可回滚；无磁盘迁移或原始图像修改。

## 连带面核查后的范围修正

用户明确追问视频与角色是否也有问题。实查：视频相同冻结+contain机制；角色/道具图像区使用 flex-1 填剩余固定高，图片无 onLoad 回填，也会留边；场景卡同样固定整框 contain。因此扩展同一不变量至图片和视频结果、角色/场景/道具图像区。卡片固定宽度及名称/使用次数等内容保留，footer 用 ResizeObserver 实测，其高度加到媒体高度；不把整卡强行改成图片比例。所有测量非持久化、非历史，使用共享回填并校验 result 身份，过期 load 不覆盖新图。此节取代前述“不改视频/卡片布局”的范围假设。

## 已取得证据

- 修复前真实 3840×2160 拍摄帧落在340×340框，空白合计148.75 px；修复后340×191.25，空白0。2160×3840竖图292.5×520，空白0，原生下边缩放后误差不足0.01 px。
- 真实视频960×540在340×191.25中完整显示；角色/道具200×170.5（含动态信息区），图片区误差0.5 px（布局整数取整）；场景320×180。
- 首轮红测：2文件7失败；扩展同类面红测后修复，相关124文件1067测试通过。新增回调与可达缩放限制测试通过。完整 gates/最终验收记录随后追加。
- 原始截图/几何：`tests/ux/shots/canvas-image-aspect/`，before-portrait-zh.png可同时看横图上下留边和竖图左右留边；after-related.json记录视频与卡片。素材来自登记的真实拍摄视频，零供应商调用，不冒充新生成验收。
- 独立实施复核发现固定卡片resize把手、LOD实体border、clip等专用节点误用媒体比例，均修复；这些节点继续复用既有专用布局，媒体节点使用共享几何与RF原生锁比。

- 追加真机：旧项目重开与英文截图通过；83节点画布的未选中 LOD 与选中完整态尺寸一致，横竖媒体像素比误差低于0.001px。走查先取消上一节点选择再选择相邻节点，避免测试动作被已有 composer 覆盖。
- Ponytail 首轮只建议测试静态导入替代动态导入，已采纳。

- contracts首轮发现两张process-feedback旧基线把圆形拉成椭圆，已亲眼核对actual/diff，更新仅这两张符合完整比例修复的基线（小UI bug修复沿用既有设计，按mockup-approval-gates-only-big-ui规则无需另等大UI拍板）。补齐测试title类型及回填owner搬家reanchor。
