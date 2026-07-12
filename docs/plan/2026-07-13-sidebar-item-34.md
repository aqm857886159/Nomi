# 左栏收敛 ③④：找素材并入素材库 + 「分类」改名「分组」

> 拍板：2026-07-13 用户「先做3和4，1和2之后再做设计调整」。①工具条文字规则、②竖条去留
> 留待下一轮（方向B 的 rail 退役也一并顺延——本轮「分组」只改名不搬家）。

## 范围

③ **找素材 → 素材库「智能分组」页签**
- AssetLibraryPanel 来源段控 [全部素材|项目素材] 加第三项「智能分组」，选中时主体渲染
  AssetFinderPanel（搜索/筛选/上传行为保持在素材页签，智能分组页签整体换身）
- ProjectExplorerSidebar 删 'find' rail 项与分支；AssetFinderPanel 引用移入 AssetLibraryPanel

④ **分类 → 分组（仅改名，不搬家）**
- rail 标签/aria、面板标题、瘦头「新建分类→新建分组」、CategoryTree 面向用户字符串
 （新分类/删除分类文案）、CanvasEmptyState「跨分类复制→跨分组复制」
- 图标暂沿用 IconTags（icon 语义调整归 ①② 那轮）
- 不改：素材库筛选的「分类：全部素材」（那是媒体种类筛选，另一含义）；代码标识符
  （categories/CategoryTree 等）不动——纯 UI 文案层改名，避免波及存档结构

## 验收

typecheck/build → 定向走查截图（rail 四项无找素材、素材库三页签可切智能分组、
分组面板开合+新建分组）→ 亲眼 Read → 五门 → push → 换沙盒。
