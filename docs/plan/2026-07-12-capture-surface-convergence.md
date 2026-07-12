# 捕捞面收敛（方案 A）：M0 捕捞窗退役，PR#36 应用内浏览器成为唯一捕捞面

> 拍板：2026-07-12 用户选 A（「可以，就用方案A吧，记得推进到主分支上」）。
> 背景：两面 90% 重叠——都写当前项目 `assets/imported/`（kind `browser-capture`），差异只剩壳
> （独立窗 vs 应用内弹层）与手势（右键菜单 vs 悬停浮钮/拖拽）。并存成本：双心智、双 cookie 仓、
> 双安全面（权限双拒补了两处）。详见 2026-07-12 会话讨论。

## 范围（改什么）

1. **入口改指**（一个引擎两扇门，「网页捕捞」标签保留）：
   - `src/workbench/explorer/ProjectExplorerSidebar.tsx` 瘦头「网页捕捞」按钮 → `nomi-open-browser` 事件
   - `src/workbench/assets/AssetLibraryPanel.tsx` 带头版同名按钮 → 同上
2. **删 M0 整条**（P1 加新删旧）：
   - `electron/browser/referenceCaptureWindow.ts` 删文件；`electron/main.ts` 去 `registerReferenceCaptureIpc`
   - `electron/preload.ts` 删 `browserCapture` 桥；`src/desktop/bridge.ts` 删对应类型
   - `src/ui/browser/ReferenceCaptureChrome.tsx` 删文件；`src/NomiRouterApp.tsx`/`src/utils/routes.ts` 去路由
   - partition `persist:nomi-reference-capture` 随文件消失（用户在旧捕捞窗的网站登录态失效，重登一次，可接受）
3. **走查合并**：`tests/ux/reference-capture.walk.mjs` 重写为驱动浏览器面，六项不变量原样保留：
   ① 素材库有「网页捕捞」入口（现在开的是浏览器）② 浏览器打开 ③ 导航本地测试页
   ④ 悬停捕捞浮钮真实点击 → 素材落 `assets/imported/` 且 sidecar `originalUrl` 恒 null
   ⑤ 浏览器 view session 权限 deny-by-default 探针 ⑥ 主窗素材库回流可见。
   驱动方式优先「注入桥的浮钮真实 click」（production 全链路），不加新测试钩子；不得已才加 NOMI_E2E 钩子。
4. **文案随动**：`docs/marketing/2026-07-11-v0165-promo-shooting-plan.md` Seg1「右键捕捞」措辞改为
   悬停点捕捞/拖拽（交互变了，口播稿同步）。

## 实施中追加（勘察发现）

5. **隐私不变量对齐**：浏览器路径 sidecar 写了 `originalUrl: mediaUrl`（importBrowserMedia）/
   `originalUrl: url`（importRemoteAsset 通用路径）——违反 M0 定案「捕捞素材 originalUrl 恒 null」，
   否则 48h 信任窗会把用户浏览的网页 URL 发给生成商（泄露 + 防盗链 URL 厂商侧必挂）。
   修在咽喉点：`assetPaths.ts` 收编 capture 族 kind 集合（原 workspaceFileIndex 私有副本删除，P1）
   + 纯函数 `sanitizeAssetMetaForKind`（capture 族 → originalUrl:null）+ `projectAssetStore.ts`
   writeAsset/moveAssetFile 两个唯一 sidecar 写入者入口统一过一遍 + 纯函数单测。
   注意：generated/provider 素材的 originalUrl 保持原样（信任窗设计本意）。

## 不动项

- 素材存储/信任窗/素材盒聚合视图（两面本就同一落库，收敛不动数据层）
- `useBrowserAssetCaptureImport` 的「网页捕捞/网页拖拽」来源标签
- 浏览器安全基线（权限双拒/UA/代理已就位，收敛前后不变）

## 安全对齐核对（M0 有的浏览器面必须都有）

- [x] 权限 request+check 双拒（browserViewSession.ts，2026-07-12 已补）
- [ ] 防盗链下载走网页会话 + Referer（importMedia 路径，实施时核对，缺则补——这是宣传点）
- [x] 导航/window.open http(s)-only（合并评审已核）

## 回滚

单 commit（或紧邻两 commit）落盘；回滚 = revert 该 commit，M0 文件回来、入口指回。

## 验收门

五门全过 + 重写后的 reference-capture 走查六项 PASS + console 0 错 + 截图亲眼 Read（眼见链四问）
+ push origin HEAD:main（先 `git branch --show-current` + fetch 对账，防并行漂移）。
