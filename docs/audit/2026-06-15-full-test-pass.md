# 2026-06-15 全套测试穿透 — 代码健康五门 + R13 真机走查

> 触发：用户要求「全套测试，极度完整，确保用户在用的时候没有任何问题」。
> 方法：CLAUDE.md「特别完整的用户测试」标准方法（清场→全新构建→常驻驱动→逐旅程走→交互态遮挡→挖根因→落文档）。
> 环境：worktree `wonderful-galileo-4e1d06`，分支 `claude/wonderful-galileo-4e1d06`。

## 一、代码健康五门（全绿）

| 门 | 结果 |
|---|---|
| check:filesize | ✓ 上限 800 行，巨壳白名单 3 个 |
| typecheck | ✓ 双 tsconfig 无错 |
| lint:ci | ✓ 84 warnings / 0 errors（棘轮上限 98） |
| test | ✓ 163 文件 / 1384 用例（含本轮新增自愈单测） |
| build | ✓ Vite + electron tsc |

五门只证代码健康，证不了体验——故继续 R13 真机走查（P3）。

## 二、R13 穿透式走查（软渲染驱动，真机截图人眼判断）

走查覆盖（均**干净、无遮挡/溢出/裁切**）：

| 屏 | 结果 |
|---|---|
| 项目库首页 | ✓ 动作卡片 + 项目网格 + 搜索/筛选 |
| 创作区（Tiptap） | ✓ 工具栏 + 编辑器 + 文案输入正常 |
| 创作助手面板 | ✓ 灵感空态 + 三快捷 chip + 输入框 + 模式/模型选择 |
| 创作模式下拉 | ✓ **向上翻转、完全可见**（通用/故事/脚本/素材/分镜/提示词/审校） |
| 生成画布 | ✓ 左工具栏 + 镜头节点（剧本片段→关键画面起手模板）+ 三轨时间轴 |
| 镜头节点参数卡 | ✓ 生成方式(文生图/改图) + 提示词 + 模型/比例/清晰度 + 生成按钮 |
| 模型选择器下拉 | ✓ 按 archetype 过滤的 6 个文生图模型、vendor 原名、无裁切 |
| 预览面板 | ✓ 画面预览空态 + 播放控件 + 三轨时间轴 |
| 模型接入弹层 | ✓ APIMart 已连通(13 模型)/KIE.AI 待接入/其他模型/添加模型，锚定无裁切 |
| 素材库 | ✓ 空态 + 上传；**真实上传 PNG 成功**，归入「分镜」类、画布侧栏可取用 |
| 画布分类面板 | ✓ 分镜/角色/场景/道具/声音 树，上传素材正确归类 |

未执行（需用户 API 额度，属「用户独有资源」，未擅自花钱）：真实点「生成」拆镜头 / 文生图 / 视频生成 / 带真实素材的 MP4 导出。

## 三、发现并修复：导出 ffprobe 缺执行位（P0，真生产 bug）

### 现象
用户已安装的 `/Applications/Nomi.app`（0.10.0，6/14 打包）里：
- `@ffmpeg-installer/.../ffmpeg` → `-rwxr-xr-x`（可执行）✓
- `@ffprobe-installer/.../ffprobe` → `-rw-r--r--`（**无执行位**）✗

### 根因（P2 三层）
- **症状**：用户导出视频时，有音频的素材丢音频、filtergraph 取景(WYSIWYG)退回 WebM 路径，但**不报错**（代码对探测失败全程静默降级：`exportJobs.ts:155-157 / 192-193 / 219-221`）。
- **根因**：打包/安装时平台包的 `chmod u+x` postinstall 被 pnpm 跳过——`package.json` 的 `pnpm.onlyBuiltDependencies` 只白名单了 `electron`/`esbuild`。ffmpeg 的 npm tarball 恰好自带执行位侥幸没事，ffprobe 的 tarball 没带 → ffprobe 落盘无执行位。
- **入口集**：任何用 `@ffprobe-installer` / `@ffmpeg-installer` 随附二进制的 spawn；任何一次打包流水线跳过 chmod 都会复发。这解释了为何冒烟/真 ffmpeg 验证曾「通过」却没暴露——静默降级让导出仍产出 MP4，质量缩水查不出。

### 修复（根因 + 结构保证，三处补齐）
1. **源头**：`package.json` 把 `@ffmpeg-installer/*`、`@ffprobe-installer/*`（4 平台各一）加进 `pnpm.onlyBuiltDependencies`，让 chmod postinstall 在 install/打包时真正跑。
2. **运行时自愈（防一整类回归）**：新增 `electron/export/ensureExecutable.ts`，在 `ffmpegRunner.ts` 与 `mediaProbe.ts` 每次 spawn 随附二进制前幂等补执行位。无论打包是否跑过 chmod，运行时都保证可执行——防「未来某次打包又丢执行位」。
3. **现装版即时修复**：`chmod u+x` 已安装 app 的 ffprobe，用户当前 0.10.0 现在导出即正常。
4. **回归断言**：`electron/export/ensureExecutable.test.ts`（4 例：补执行位 / 幂等 / 裸命令不碰 / 不存在路径不抛）。

验证：五门全绿；导出单测 14 文件 124 例全过。

## 三·补、真实生成 E2E 回路（用户授权额度后，全过）

用真机驱动跑通三条花额度链路，逐层人眼 + 数据核验：

| 链路 | 结果 | 证据 |
|---|---|---|
| 真实拆镜头（LLM） | ✓ | 咖啡机文案 → GPT-5.5 流式拆出 **6 镜** + 跨镜头一致性元素（咖啡机/厨房/男主人/风格卡，各带参考槽）+ 结构化 prompt（含「全片风格」）|
| 真实文生图 | ✓ | 孤立节点 Seedream 4.5 文生图 → 落盘 `nomi-local://asset/.../assets/gener...`，**2048×2048**（匹配 2K）|
| 真实 MP4 导出 | ✓ | 图 → 拖入图片轨 → 导出 → `Nomi Projects/.../exports/nomi-export-*.mp4`：**H.264 / 1920×1080 / 6.8s / 合法 mp4**，ffprobe 全程正常（验证三-的修复端到端生效）|

依赖感知正确：单镜点生成会拉出全图执行计划（9 节点 7 波，因镜头依赖一致性元素），符合 dependency-wave 设计。

### 走查发现 → 已修复

**F1「确认落画布」后视口不自动 fit（P2 UX 困惑）→ 已修（commit f38df91）**
- 现象：剧本拆镜后点「确认落画布」，6 镜落在当前视口外，画布看着像「没反应」，要手动点「适应视图」才看到。
- 根因：自动 fit `useAutoFitOnLoad`（`useAutoFitOnLoad.ts:56`）只在项目/分类**首次加载**触发；落画布是在画布已加载态批量加节点，不走这条路 → 不 fit。且即便重跑，旧起手节点仍可见时 `anyNodeVisibleInViewport=true` 也不 fit。
- 取舍判断：落画布是用户**主动动作**，揭示结果天经地义，不与 `useAutoFitOnLoad` 刻意避免「每次开项目都飞入」（那是 on-load 保守）冲突 → 选 A（落画布后平滑 fit 全部镜头）。
- 修复（复用现成 nonce 模式，仿 `createCategoryNonce`，不造并行版）：store 加一次性信号 `canvasFitNonce` + `requestCanvasFit()`；`onConfirm` 落画布后 bump；`GenerationCanvas` 订阅后 360ms 平滑 `fitView(true)`。回归断言 `canvasFitSignal.test.ts`。
- 验证：真机端到端，真实拆 6 镜 → 确认落画布 → 画布自动 fit，**8 镜 7 个直接落视口内**（修复前同序列 0 可见）。

> 注：E2E 中「预览区在 0:00 空」是因我用拖拽把片段放在了 ~2s 处（释放位置），非 0:00；正常「发送到时间轴（按镜序）」会贴 0:00。非产品 bug。

## 四、轻微观察（非阻断，未改）
- 素材库「+上传」按钮 input `accept="image/*"`，只收图片；视频/音频靠生成或拖拽进入。若希望按钮也支持视频/音频，可放宽 accept（与 全部/图片/视频/音频 四 tab 对齐）。优先级低。

## 五、测试基建说明
- 本轮发现：测试环境 Electron 在合成「生成画布」视图时 **GPU 进程崩溃** → 截图崩。`win.on("crash")` 未触发（非渲染进程崩），用 `--disable-gpu` 软渲染即解决——属测试环境产物，真用户 macOS Metal GPU 不受影响。已用软渲染临时驱动完成全部截图走查。
- 临时驱动（`tests/ux/_soft-driver.tmp.mjs` / `_send.tmp.mjs`）走查后清理，不入库。
