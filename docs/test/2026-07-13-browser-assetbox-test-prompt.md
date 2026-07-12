# Nomi 浏览器 + 素材盒 超级完整功能/设计测试提示词（给 Codex）

> 直接把「===== 提示词开始 =====」到「===== 提示词结束 =====」之间的内容整段发给 Codex。
> 它对本项目历史无记忆，本文自包含。

===== 提示词开始 =====

# 任务：对 Nomi 的「应用内浏览器 + 全局素材盒」做超级完整的功能测试与设计走查

你在 Nomi 仓库工作（Electron + React 18 + Tailwind 3 + Zustand，本地优先 AI 视频创作工作台）。
近两周新增/重构了「应用内浏览器」和「全局素材盒」，我要你把这一整块**每个功能真点一遍、真编辑一遍**，
挖出 bug（挖到根因，不是修症状）与设计问题，能修的修掉并按仓库规矩验证后提交。

## 0. 铁律（先读，违反直接判不合格）

- **别凭脑补出结论/样张**：改任何 UI 前先看它真实的样子（读完整外壳组件或先跑起来截真图），
  样张=真实布局+改动，不是想象的排版。
- **修 bug 挖根因**：看到 bug 先分「症状/根因/这类 bug 的入口集」，修在根因层，答得出「这类不再从别处复发」才算完。
- **加新必删旧**：引入新实现同 commit 删旧，无并行版、无 fallback、无逃生口。
- **报完成前必真机走查**：全绿 ≠ 完成。截图必须你自己亲眼看过（产出截图 ≠ 看过截图），
  验证的构建/入口/平台分支必须和用户实际跑的一致。
- **push 前五门全过**：`pnpm run gates`（filesize→tokens→lint(max-warnings 有棘轮)→typecheck→test→build）。
  分支先 `git branch --show-current` 确认，别在被并行狂改的树上乱 commit。

## 1. ⚠️ 最关键的陷阱：素材盒是独立透明窗口，DOM 点击测不到「点穿」

**这是这块最容易踩、最容易漏测的地方，务必先理解再动手：**

- 「素材盒」浮层不是普通 DOM 弹层，而是一个**独立的透明 BrowserWindow**（`electron/browser/overlay/browserViewOverlay.ts`）。
- 它的可点性靠 OS 级机制：主进程每 80ms 轮询系统光标位置，对账「上报的可点热区 `record.popoverRect`」，
  命中才 `setIgnoreMouseEvents(false)`；吸附态还叠一层窗口 `setShape` 裁剪。
- **核心不变量**：上报的可点热区必须覆盖「可交互内容实际在哪」。热区外的控件，真机点它会**穿透到背后的网页**。
- **Playwright / `page.click()` 给渲染进程派的是合成事件，绕过整个窗口机制**——DOM 里的按钮永远显示「能点」，
  `setIgnoreMouseEvents` 造成的穿透死区它**完全看不见**。所以：
  - **不要**用 Playwright DOM 点击来判断「这个控件能不能点」——那永远是 true，测了等于没测。
  - **要么**用真 OS 点击（需 mac 授权 Accessibility+Screen Recording，一般不可得），
  - **要么**用「几何对账」：把上报热区 `window.__nomiOverlayHitRect`（屏幕坐标，代码已挂）
    与每个可交互元素的 `getBoundingClientRect()` + overlay 窗口屏幕原点比对，
    **任何中心落在热区外的可交互元素 = 真机必穿透 = bug**。
- 参考现成守卫：`tests/ux/browser-overlay-interaction.walk.mjs`（已实现几何对账，扩展它）。
- 已知同类根因坑：`BrowserPromptExtractionSettingsModal` 用 `fixed inset-0` 铺满整窗、居中大对话框，
  但热区只覆盖吸附卡片 → 对话框左侧落在死区被点穿（已修：溢出整窗的模态在场时热区扩到整窗；
  验证这条别回归）。

## 2. 环境与启动（零额度、隔离）

```bash
pnpm install            # 若 node_modules 是软链到主仓且缺依赖，rm -rf node_modules && pnpm install
pnpm build              # 全新构建，防 stale-chunk 伪 bug（改完 renderer 要 npx vite build，改 electron 要 npx tsc -p electron/tsconfig.json）
```

跑法二选一：
- **一次性走查脚本**（推荐先看现成的）：
  ```bash
  node tests/ux/browser-overlay-interaction.walk.mjs   # 素材盒浮层交互+几何不变量
  node tests/ux/reference-capture.walk.mjs             # 网页捕捞→落库→显示名 全链路
  ```
  这两个脚本用隔离 `--user-data-dir` + `NOMI_PROJECTS_DIR` + `NOMI_E2E=1`，零额度。
  ⚠️ 脚本收尾若 `app.close()` 挂死会留僵尸 Electron；`finally` 里要「close 竞速 8s → SIGKILL app.process()」，
  迭代完 `pnpm run kill:zombies` 清场。别每轮 launch→close，探索用常驻驱动 `tests/ux/ui-driver.mjs`。
- **给人真点的沙盒**（真机复现真站 bug 用）：
  ```bash
  mkdir -p /tmp/nomi-t/projects
  NOMI_PROJECTS_DIR=/tmp/nomi-t/projects NOMI_E2E_ALLOW_MULTI_INSTANCE=1 \
    npx electron . --user-data-dir=/tmp/nomi-t/udata
  ```

启动后进入路径：项目库 → 新建/打开项目 → 生成区（顶栏「生成」）。
- 打开浏览器：顶栏「浏览器」按钮（或渲染层派 `window.dispatchEvent(new CustomEvent('nomi-open-browser'))`）。
- 打开素材盒：浏览器工具条右上「素材盒」按钮（或派 `nomi-browser-asset-popover-open` {opened:true}）。

## 3. 功能清单（逐项真测 + 编辑一遍）

### A. 浏览器外壳（`src/ui/browser/dialog/`）
1. 多标签：新建标签(+)、切换、关闭(x)、标签超过上限(TAB_LIMIT)行为
2. 地址栏：输网址回车导航、输关键词走 Bing 搜索、前进/后退/刷新
3. 标签页 favicon：真站(有 favicon)/404 favicon/http favicon —— **必须优雅回退世界图标，不能裂图**（近期修过，验证不回归）
4. 书签：收藏(★)、书签栏、右键书签菜单
5. 起始页：素材网站快捷入口（Pinterest/Behance/Dribbble/ArtStation/小红书/YouTube 等）点击建标签；站点图标应是本地首字母瓷贴（不依赖境外 favicon 服务）
6. 「素材网站」下拉、「在系统浏览器打开」

### B. 网页捕捞入库（两条产路，都要测）
7. **资源捕捞模式**：素材盒工具条点亮「资源捕捞」→ 悬停网页图片/视频高亮 → **Ctrl+C** 捕捞入当前项目素材库
8. **拖拽入库**：直接把网页图片拖进素材盒
9. **防盗链图**：走网页会话下载（带 cookie/Referer），右键另存存不下的应也能捞
10. **落库正确性**：素材落 `assets/imported/`；sidecar `originalUrl` 恒 null（隐私：浏览的网址不进 48h 信任窗、不发给生成商）
11. **显示名**：捕捞素材应显示**网页标题**（img alt / title / 文档标题），不是 URL 哈希文件名（如 `263fcbf8…`）（近期修过三处平行映射，验证不回归）
12. 捕捞飞入素材盒的动画、素材库回流刷新（写入层 `nomi:assets:updated` 广播）

### C. 划词/截图提取提示词
13. 网页划词保存提示词
14. 选区截图 → AI 提取提示词 / 复刻风格 → 进提示词库
15. 「提示词提取设置」弹框（sliders 图标）：模式切换、模板选择、保存到 `.nomi/browser-prompt-extraction.json`
    —— **这个弹框在素材盒吸附态时以前点不进去（穿透 bug），重点验证现在整框可点**

### D. 素材盒浮层本体（`src/ui/browser/overlay/` + `src/ui/browser/popover/`）
16. 源标签切换：项目素材 / 提示词库
17. 搜索素材、种类筛选、上传(本地文件)、新建文件夹、更多(⋮)菜单
18. 素材格：单击选中、多选、双击看详情/进文件夹、右键上下文菜单、**多选拖到画布**
19. 提示词卡：双击 → 提示词详情弹框（`absolute`，应正常可点）
20. 窗口：吸附右侧/恢复浮动、拖动标题栏移动、四角 resize、最小化、关闭

### E. 顶栏/左栏一致性（近期收敛过，验证）
21. 顶栏操作应统一「图标+文字」：上手 / 浏览器 / 模型接入 / 导出（**素材盒常驻入口已删**，只在浏览器里出现）
22. 左栏 rail：素材库 / 分组 / 提示词 / 技能（图标下带微字标签）；「找素材」已并入素材库的「智能分组」页签；
    「分类」已改名「分组」

## 4. 几何不变量测试（穿透类 bug 的唯一程序化验证）

对**素材盒每一个可交互元素**（工具条按钮、tab、搜索框、格子、菜单项、以及每个弹框内的控件），
在浮层打开态（含吸附态、含各弹框打开态）下：
- 读上报热区：overlay 页 `window.__nomiOverlayHitRect`（屏幕坐标）
- 读元素屏幕坐标：overlay 窗口 `getContentBounds()` 原点 + 元素 `getBoundingClientRect()`
- **断言**：元素中心落在热区内。任何落在热区外的可交互元素，写进报告（=真机点穿）。
- 特别覆盖：吸附态 + 各弹框（设置/提示词详情/右键菜单/⋮菜单）打开时，弹框内控件是否都在热区内。

## 5. 已知待根治 bug（复现 + 根因 + 修）

**★ Dribbble 图捕捞/拖拽「下载失败」（最高优先，未根治）**：
- 复现：浏览器打开 https://dribbble.com/ → 拖/捕捞任意 shot 缩略图进素材盒 → 卡片显示「下载失败」。
  真实失败素材名例：`27549099-Satara-...`、`27548809-WPStar-...`。
- 已知：`importMedia`（会话下载）对 picsum.photos 等普通 https 图**成功**，所以下载路径本身没坏，
  是 Dribbble CDN 特定（疑似防盗链头不足 / 内容类型 / 图是 srcset 懒加载占位或 blob）。
- 已加：会话下载失败→直连拉取兜底 + 错误按 超时/403防盗链/blob 分诊到卡片副标题。
  但用户最新截图仍显示纯「下载失败」——说明分诊没命中或走了别的路，**需要你抓到真实的 Electron 主进程错误**
  （在 `electron/browser/media/browserViewMedia.ts` 的 `downloadBrowserMediaFromPageView` 打点，
   看 `will-download` 是否触发、`downloadItemMatchesUrl` 是否因重定向不匹配、下载项 state/mimeType）。
  根因定位后修死（例如：重定向后 URL 不匹配导致 120s 超时；或懒加载 src 是 data 占位需取真实 src；
   或 Dribbble 缩略图需要特定 Referer/Accept）。相关文件：
  - `electron/browser/media/browserViewMedia.ts`（importBrowserMedia / downloadBrowserMediaFromPageView）
  - `src/ui/browser/popover/browserAssetPopoverUtils.ts::readBrowserImageDragPayload`（拖拽提取的 URL）
  - `src/ui/browser/overlay/BrowserAssetOverlayApp.tsx::importBrowserAssetToLibrary`（选 importMedia vs importRemoteUrl）
  - `src/ui/browser/popover/useBrowserAssetCaptureImport.ts`（错误分诊文案）

**其它需复核不回归的近期修复**：
- 素材盒工具条「素材盒」按钮点开弹层（曾只翻 React 状态不调 native open → 打不开）
- 「提示词提取设置」弹框吸附态可点（穿透修复）
- favicon 裂图回退
- 捕捞素材显示网页标题而非哈希名（三处平行映射 `browserAssetFromDesktopAsset`，⚠️P1 债待收敛成一处）

## 6. 设计走查（截图人眼判断）

对每个打开态截图并人眼看：
- 素材盒/浏览器视觉与主工作台设计系统一致（token-only，见 `docs/design/nomi-design-system.md` 与 `src/design/`）
- 图标规格统一（描边/尺寸），无孤图标/有的有字有的没字
- 空态、加载态、错误态文案有行动价值（错误说人话，别甩无信息的「下载失败」）
- 弹框不被裁剪/不溢出/不重叠（吸附态、窗口边缘极端位置都看）
- 捕捞素材卡片名可读（网页标题）、缩略图正确

## 7. 交付要求

1. 每个 bug：根因（file:line）+ 症状 + 「这类不再复发」的结构保证（测试/不变量）。
2. 能修的修掉；UI 改动先看真实样子再改，改完真机走查（截图自己 Read 过）+ 和现状对账。
3. 几何不变量、显示名、favicon 回退、弹框可点等，尽量落成**永久断言**加进
   `tests/ux/browser-overlay-interaction.walk.mjs` / `tests/ux/reference-capture.walk.mjs`。
4. push 前 `pnpm run gates` 全过；输出一份走查报告（每项 PASS/FAIL + 截图路径 + 根因）。
5. 迭代完 `pnpm run kill:zombies` 清僵尸 Electron。

===== 提示词结束 =====
