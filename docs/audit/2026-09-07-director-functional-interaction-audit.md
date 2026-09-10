# 导演台完整功能与交互复核

状态：✅ 本地修复与验收完成（2026-09-07）。改动保留在用户当前工作区，未提交、未推送；此前导演台切换与五类片段配色成果保留。

最终相关单测 594 项通过、9 项既有环境跳过，构建及同构建 Electron／窗口栏／手机旅程通过，关键截图和实际 PNG／MP4 已亲眼核验。两项既有工程门禁失败（Ponytail Windows 测试、词表远端历史比较）已独立举证，不计作本轮修复成果，也不将整体门禁称为全绿。实体手机传感器及外部 AI 质量边界见文末。

依据：参考产品导演台功能清单 §0–§8 与其真实行为，以及已获批的 V2/外壳/切换门方案。不是以旧 V1 推测对齐。

续跑来源：任务「检查当前工作区」（`01a07808-dc07-7d43-b06d-63447cfc834e`）最后请求为「再完整核对一下所有的功能逻辑及交互逻辑」，2026-09-07 05:21 因 `insufficient_quota` 中断。本任务按用户「继续任务吧」恢复开发与验收；旧任务界面的 `custom` provider 配置错误不属于本报告的修复范围。

## 判断口径

每项核对入口、状态写入、撤销/取消/删除等反向操作、保存重开和实际输出。源码存在、单测通过、真实用户任务通过分别记录。统一标题栏、细菱形骨骼、固定默认快捷键与确定性逐帧 MP4 属已批准差异。真实手机传感器和外部 AI 服务不得以模拟器或桩响应冒充实测。

修改前现场：`main`，HEAD `8943494471a1f8baf6e10169e761ccbf367dc4ea`；大量既有未提交改动。本轮延续原计划指定的工作区，不切分支、不整合远端；`delivery:preflight` 因沙箱拒绝写 `.git/FETCH_HEAD` 未通过，见 `resume-preflight.log`，本报告不作为远端交付收据。`.tmp/director-full-audit-20260907/director-before/`、`tests-before/` 和 `status-before.txt` 是本轮差异归属基线。

## 总矩阵

| 清单区域 | 覆核入口与不变量 | 实现边界 | 证据与结论 |
|---|---|---|---|
| §0 入口/退出/保存 | 画布打开、只读不开放编辑、退出保存、产物回画布 | `DirectorNode.tsx`、`DirectorEditor.tsx`、持久化桥 | 真实 Electron 持锁二击返回、PNG/MP4 回画布与整 App 冷启动重开通过；J8 通过 |
| §1 外壳 | 顶栏、关闭、双侧栏/分割、时间轴/视口分区 | `DirectorEditor.tsx`、布局组件 | 原获批外壳保留；Windows 拖拽区与双主题在 Electron 验证 |
| §2 导航/工具/创建 | 移动旋转缩放、画笔/逐点、视角复位/聚焦、WASD/方向键、角色/机位/灯/方块 | `scene/` 输入与创建 hooks、`CreationBar.tsx` | J1/J2、输入作用域/取消/坐标回归通过；J8 复核浮层/创建模式的两层 Esc 归属 |
| §2.3 底栏 | 撤销、全景、群众、骨骼、画幅/分辨率、AI、截图/产物 | `BottomBar.tsx`、store 各共享 action | 完整工程撤销；群众保留父空间与路径；画幅/分辨率独立撤销已有红→绿 |
| §2.4 叠加层 | 角色名、构图框、实体/半透/白模、POV/录制/创建提示 | scene + viewport panels | 既有截图与 J1/J3/J7；输入模式互斥新增验证 |
| §2.5 节目小窗 | 预览机位、节目优先级/黑场、POV拒绝条件、拖动缩放折叠、画幅 | `PipViewport`、`PipRenderer`、`programCamera` | J3、非默认变换与渲染状态恢复通过；冷启动黑场真实像素红→绿，显隐/折叠/清理类回归通过 |
| §2.6 AI | ≤3参考图、画布当前/历史图片、搜索、目标层、取消、完成入场/入库 | `bridge/canvasImages.ts`、`useAiSceneBuilder`、`storeAiSceneActions` | collector 红→绿；请求切层/取消/迟到结果及原子入库回归；外部服务实测边界另记 |
| §3.1 图层/大纲 | 新建/复制/命名/删除/显隐、整组跨层复制移动、父图、搜索、多选 | `directorStore.ts`、`storeEntityActions.ts`、`sceneObjectGraph.ts`、`SceneObjectsTab.tsx` | 主事务 21 个定向测试；J8 全部通过，截图亲眼核对 |
| §3.2 资产 | 导入模型/场景/全景/泼溅、文件夹增删改移/搜索、内置模型灯几何体与山谷 | 资产 actions、AssetsTab、真实加载器 | J5 真实解码/显现/落地/视差通过；500k 内置 SPZ 源轴倒置与重命名重载均红→绿，正反向机位截图亲眼核对 |
| §4.1 角色 | 基础/颜色/变换、姿态动作、体形、IK/FK、人偶/关节、复位/吸地/镜像 | `CharacterInspector`、`SkeletonTab`、角色 actions、动作/骨骼求值 | J4/J7 和骨骼数值测试；字段提交/取消规则共用 |
| §4.2–4.4 实体属性 | 相机焦段/FOV/射线、灯色温强度朝向/显隐、物体材质/辅助/变换 | Camera/Light/PrimitiveInspector、字段原语、空间写回 | 名称/开关历史、键盘/滚轮/取消数字、只读状态专项真实 DOM 验证 |
| §4.5–4.8 时序属性 | 路径裁剪、路标/批量看向、特写目标/锚点/运动/烘焙、动作/视线/骨骼帧 | 片段/关键帧 actions、对应检查器 | 关键帧按片段编辑重映射；看向目标共享计算已实现，9 组真实控件通过；三维分组特写与路径对账单独验收，不借用山谷 J5 作为时序证据 |
| §4.9 图层属性 | 环境/网格/全局变换/全景配置、离散开关与滑条撤销 | SceneLayerInspector、sceneObjectGraph、相机坐标边界 | UI字段红→绿；非默认全局变换下创建/POV/PIP/截图/搬移一致性新增测试 |
| §5 时间轴 | 播放/停止/速率/缩放/吸附/自动帧、轨道顺序/钉住/副轨、片段/路标操作、动作弹窗/快捷键 | timeline + model clip/keyframe/shared lane | 正常 J2–J4/J7；pointercancel/空行seek/框选，resize/trim/split/clipboard/特写菜单专项 |
| §6 机位/手机 | POV编辑层、运镜采样/停止/取消、固化机位、角色/机位特写、手机控制/监视/录制反馈 | 相机动作、输入/录制 hooks、手机桌面桥/页面 | J3；最终同构建 Electron+Chrome 验证通过，480×270 实际画面、录制回执与断线持续隐藏截图亲眼核对 |
| §7 产物 | 截图/MP4、取消/重复点击/卸载/失败、持久句柄、预览删除与回画布 | `useDirectorOutputs`、`persistOutputs`、输出 actions | 输出/句柄红→绿；J6 浏览器与 Electron 真落盘/回画布分别验证 |
| §8 设置/帮助 | 速度/灵敏度/阻尼/主题/恢复默认、快捷键说明 | preferences、Settings/Help dialogs | 固定默认键位属获批差异；导航参数与输入守卫专项 |

## 已复现并修复的类根因

- 工程被当作零散字段：历史漏资产，跨层在草稿外写冻结对象，复制漏子树/引用/轨道元数据。共享边界改为完整工程事务与子树搬移。
- 空间坐标被混用：嵌套解组/克隆/群众与动画路径跳位，非默认场景变换下创建、预览与输出分叉。共享矩阵转换同时处理 rest 和路标；相机另遵守 YXZ 朝向。
- 片段与关键帧各自改时间：resize丢帧、trim/split无切点、pose初帧覆盖，组合操作多次撤销。统一片段采样与映射。
- 用户输入未明确消费归属：键盘与浮层/文本冲突、模式取消泄露、pointercancel提交。输入守卫和模式生命周期收口。
- 字段没有明确提交边界：取消/空值变0、键盘调节和离散开关漏历史。共用数字草稿与事务规则。
- 异步任务缺少归属与结束边界：AI切层串写、取消迟到写入、输出编码期间提前解锁、手机并发起停泄露监听器。请求/输出/服务生命周期各在单一边界持有并释放。
- 图片参考按节点外壳过滤、手机只传控制不传画面、资产缺内置山谷和路标看向入口：按批准清单补齐生产通路，复用现有结果语义/传输/加载/采样能力。
- 新建泼溅漏源轴转换：参考产品新增入口在 X 轴旋转 180°，Nomi 原为零，真实 SPZ 天地倒置。内置、连线和上传统一在新增入口转换，普通模型与旧工程位姿保留。
- 点云资源生命周期包含显示文案：重命名/切换语言触发销毁与重新加载。加载 effect 仅依赖资源 URL 与 store，错误反馈读取当前已提交文案；迟到与卸载回调有回归覆盖。
- 节目小窗测量早于父容器挂载：已有机位冷启动时，子组件 layout effect 读取到空 host ref，之后没有订阅测量，主视口有角色而小窗一直黑。隐藏/重显也漏同一依赖。测量改在整次 DOM 提交后执行，显示状态纳入条件和依赖；冷挂载、显隐、折叠/无机位与清理共用原测量边界，渲染器保持不变。5 项类回归从 3 红/2 绿变为全部通过。
- Spark 宿主同步销毁早于异步排序完成：卸载先停止新增更新/排序/LoD 调度，等待在途排序和 LoD 排空后仅释放一次。真实依赖的 `readPause` 红例复现 `No target`，6 项回归转绿，修后 Electron 与 500k SPZ 旅程均通过。
- 手机图片 URL 清理与可见状态脱节：断线虽清除 src，仍显示破图图标与边框。预览初始隐藏，只由当前连接的有效加载事件显示；清理统一隐藏并释放 URL，旧连接与页面退出后的迟到回调不能恢复画面。页面脚本 5 项红→绿覆盖等待、断线、坏帧、旧连接和页面释放；真实旅程增加断线前可见、断线后持续不可见的证明。
- 项目保存同步抢锁且未保留发布异常：清理时的保存只尝试一次，短暂竞争会失败；直接改成异步还会让三个保存按 2、3、1 完成、旧内容覆盖新内容。共享入口现在异步等锁、按真实工程根目录保持本进程顺序，并复用原来的 staged 校验/备份/提交。原始异常保留 cause，永久失败仍拒绝，未提高锁等待预算。
- 界面的当前工程指针不能代表尚未完成的保存：独立审阅复现新工程串写到旧 ID、返回等待时关闭提前确认、显式保存被旧自动保存覆盖，以及加载新工程清空目标后跳过旧保存。每个订阅在仍拥有工程时捕获快照，手动/自动/退出保存共用同一队列；回执登记从订阅创建持续到排空，不随界面目标清空而丢失。返回库重复点击共用一次退出 Promise，保存失败保留工程并允许重试。四条独立固定反例均已转绿。

## 验证记录

- 修改前：33 个导演台测试文件、167 个测试通过；J1–J7 全部通过。常规旅程的绿没有掩盖本轮边界红例。
- 主事务：最初8例全部失败，后续增加坐标/循环父图/灯开关/群众/跨层相机与设置归属；当前21例全部通过。参考图collector 1例红→绿。
- J8：真实 UI 打组→新层复制→一次撤销/重做→折叠搜索→解组→多删撤销→保存重开全部通过；`j8-project-interactions` 截图已亲眼检查。
- J1/J2/J6/J7 的修后退出码在 `journeys-final.json`；同一早期汇总中 J4/J8 的失败已保留，由 `retry-director-j4-kneel-stand-look.walk.mjs.log`、`j4-strengthened.log` 和 `resume-camera-j8-final.log` 的后续通过收据替代。J4 增强版实际检查跪到站、侧向转头与 IK。J6 是浏览器临时产物闭环，真实 MP4 由 Electron 旅程证明。
- 字段与时间轴指针专项见 `special-final.json`；路标看向的 9 组真实操作见 `resume-waypoint-walk.log`；AI 取消/物化/撤销/再导入见 `resume-ai-walk.log`。所有日志保存在 `.tmp/director-full-audit-20260907/`，不以最后一条输出代替真实退出码。

### 下午续跑收据

- Spark 修复前的桌面旅程两次复现 `readbackDepth → driveSort: No target`，红例保留在 `resume-electron-stack.log`，当时构建身份与退出码在 `resume-before-spark-build-identity.json`、`resume-before-spark-results.json`。修后 16:03 批次为 55 文件 / 326 测试通过，构建、Electron、窗口栏和手机旅程均退出 0；截图复核另发现手机断线破图，继续修复后重新固定最终构建。
- `resume-j5-final.log`：15000 点 PLY 解码完成且显现结束；人物包围盒 Y=0.00…1.90；近/远位移 331/83px。三张截图已亲眼查看，地形不再掩埋人物。合成 PLY 只作确定性几何测试，真实 500k SPZ 另由资产走查验证。
- `resume-assets-ui-red.log` → `resume-assets-ui-green.log`：真实内置山谷源轴红→绿，名称变化保持 mesh identity、不重启显现；原点 16mm 正反向机位均可取景。对照图 `resume-valley-upside-down-red.png` / `resume-valley-upright-green.png`。
- `resume-camera-j3-final.log`：平移 X=3、旋转 35° 的父组下，F30 特写转为 12 帧路径，世界位置差 4.965e-16、方向差 0，单次撤销恢复完整工程。明确选中该特写机位的 PIP 前后 PNG SHA256 相同，主代理亲眼核对构图。此证据不冒称所有动态预设均逐帧相等。
- 16:05 隔离 Electron 工程的实际 MP4 经 ffprobe 核验为 H.264、1280×720、24fps、120帧/5秒。主代理亲眼查看第 0/60/119 帧，角色由远及近、画面非空；抽帧在 `resume-video-frame-01.png` 至 `03.png`。这个文件来自真实编码，不是浏览器 mock。
- `resume-gates-findings.md`：35 项工程门禁 33 通过；Ponytail 的 4 项 Windows 失败已在隔离 HEAD 重现；词表 StepTone 债与 HEAD 一致，远端已删除但当前落后 1332 提交。未调高基线。测试中的 4 处 WaypointSeed 缺字段已补齐，缺席断言加入存在前置证据，走查门禁 60→52。
- `resume-docs-findings.md`：10 份模块说明更新；186 个生产入口的目录归属无缺漏。源码、控件测试、完整旅程分别记录，不把目录地图视为功能验收。

手机断线破图的截图红例是 `resume-phone-disconnected-red.png`，对应 16:03 构建和退出码备份为 `resume-before-phone-visual-build-identity.json`、`resume-before-phone-visual-results.json`。这次是截图人眼发现的体验问题，旧旅程只检查 src 清理与按钮禁用而未检查图像可见性。修后 `resume-mobile-page-green.log` 为 5/5；16:20 最终单测为 56 文件 / 331 测试通过。

16:31 独立复跑窗口栏与手机旅程均退出 0（`resume-phone-visual-results.json`），主代理已亲眼查看新构建的连接、断线和窗口栏截图。手机画面为 480×270、114 个采样颜色，断开后无破图图标或白边框，录制按钮禁用；真实手机传感器仍未实测。

16:20 冻结后的 10 项适用工程门禁全部通过，见 `resume-incremental-contracts-final.json`，生产与测试哈希未漂移；16:31 的 Electron 测试脚本补验通过，见 `resume-electron-test-contracts-final.json`。该脚本保留满足条件的同次磁盘读取结果，并在初始三个节点未落盘时立即失败；不再吞掉等待失败后用空 ID 继续操作。更严格的同构建复跑通过功能步骤后捕获 `Workspace manifest is being changed by another process`，完整红例在 `resume-electron-manifest-red.log`，因此继续修复保存边界并重新构建验收。

保存扩围的确定性证据在 `resume-manifest-lock-repro.json`：Windows 子进程持锁竞争确会让发布 rename 返回 EPERM；无 owner 的注入 EPERM 原来也被压成同一句 Busy。原始日志已丢 cause，不能追认历史那一次的具体 errno/owner。原生 durable 100 次及目录 fsync 错误对照未复现句柄泄漏；没有把目录 fsync 当根因修。`resume-save-order-red.log` 固定记录异步迁移后的乱序反例。

17:15 中间修订的 `resume-save-boundary-final-unit.log` 为 11 文件、78 通过/2 跳过，app/electron 全 noEmit 类型检查通过。独立审阅随后捕获上面的四类所有权/退出/顺序反例，原始证据保留在 `resume-save-review-ownership-content-red.log`、`resume-save-review-cross-exit-red.log`、`resume-save-review-explicit-order-red.log` 和 `resume-save-review-hydration-gap-red.log`。17:48 最终保存修订在同一独立锚上 4/4 通过（`resume-save-owner-final-review.log`），正式相关 5 文件/27 测试通过（`resume-save-owner-final-unit.log`），随后才冻结生产代码重新集成验证。

扩大到完整 workspace/project 单测时，旧跨进程身份测试在 Windows 直接执行 `node_modules/.bin/tsx`，产生 ENOENT，未能启动身份竞争子进程。测试入口改为已安装包导出的 `tsx/cli`，由当前 `process.execPath` 启动，并在启动失败时立即传播错误、于 finally 释放测试持锁；没有跳过该测试或放宽等待。`resume-identity-child-launch-red.log` → `resume-identity-child-launch-green.log`：13 通过、1 项既有符号链接能力跳过。

18:08 开始的最终相关单测：85 文件通过，594 测试通过、9 项既有环境跳过，共 603 项，退出 0；范围包含完整导演台、desktop director、workspace、renderer project 和 bundle URL 边界。8 项跳过要求本机不具备的文件/目录符号链接能力，1 项要求非 Windows 的不可读目录权限语义；未跳过本轮新增回归。日志 `resume-final-unit.log`，实际退出码与时间见 `resume-final-results.json`。

保存版桌面输出、持锁二击返回及冷启动数据对账均通过。截图人眼复核仍发现 PiP 冷启动黑屏，故没有直接登记完成：`resume-cold-pip-before-ready.png` 为截图红例，`resume-pip-visible-red.log` 的同构建真实像素检查固定得到 0，持续 10 秒仍不满足角色像素 >100；同一旅程的新建机位正例已经通过。`resume-pip-lifecycle-red.log` → `resume-pip-lifecycle-green.log` 为组件 5 项类回归；18:08 修复冻结后重新运行完整构建和桌面旅程。正式脚本现在检查小窗截图像素，而非仅检查主视口骨骼。

手机复跑曾因本机网络切换，在 HTTPS localhost 导航处出现 `ERR_NETWORK_CHANGED`（`resume-mobile-network-changed.log`）；未修改网络配置或吞掉错误。18:02 同一冻结构建的完整重跑退出 0，实测 480×270/114 个采样颜色、远程录制回执及断线清理通过，见 `resume-before-pip-fix-results.json`。该构建的全部运行文件哈希在桌面验证期间未改变；最终 PiP 修复构建另留最终身份收据。

### 最终收口

- `resume-final-results.json`：最终 unit、build、Electron、windowbar、mobile 均退出 0。18:11 完成的构建先通过全旅程，随后仅补充冷重开画布图片已解码的截图前置条件，再以 `-DesktopOnly` 同构建复跑三条桌面旅程，仍全部通过。
- `resume-runtime-identity.json`：919 个运行文件在整组桌面验证前后保持一致，完整清单为 `resume-runtime-manifest.json`，SHA-256 为 `9735BF7BB1DFB87CB0404F53131508E2450A92491D65B24DA42ECFE5564DDC2D`。没有用更早构建替代最后生产版本。
- Electron 真实隔离项目经持锁二击返回后，关闭整个 App 并从项目库重新打开；完整导演工程、机位、PNG/MP4 引用与连边逐项相等。新建和冷重开 PiP 均通过角色像素 >100 的实际窗口截图检查；画布 PNG 等待 `complete && naturalWidth > 0` 后取证。主代理亲眼查看最终 `13-saved-reopened.png` 与 `14-director-reopened.png`，图片与 PiP 角色均已显示；PiP 图另经资产代理交叉核验。
- 同构建实际 MP4 为 H.264、1280×720、24fps、120 帧/5 秒，99,034 字节；`resume-final-video-probe.json` 与 `resume-final-video-01.png` 至 `03.png` 保存 ffprobe 和第 0/60/119 帧证据。三帧已亲眼核验，人物随推进运镜由远到近。实际导演 PNG 也已直接打开核验。
- 最终手机连接/断线、窗口栏截图已亲眼核验；有画面时角色清晰，断线后黑底干净且录制禁用，无破图。手机为真实 Electron 服务连接 Chrome 模拟页面，未冒充实体陀螺仪测试。
- 保存修订独立工程收据为 `resume-save-final-contracts.json`；最后 PiP 差量为 `resume-pip-review-final.json`（9/9）。应用 noEmit 类型、测试类型和适用结构/根因门禁均通过，Lint 为 0 错误/63 条既有警告。两项原有门禁失败沿用上面的隔离 HEAD 证据，未提高基线。
- 最后仅测试文件增加图片解码前置条件，独立 ESLint/走查门禁 2/2 通过，收据 `resume-walk-decoded-final.json`。文档状态标记和索引遗漏补齐后，重新生成账本，`resume-close-docs.json` 的状态/账本/索引 3 项均通过。HEAD 仍为 `8943494471a1f8baf6e10169e761ccbf367dc4ea`，本轮隔离桌面测试进程已退出。

本轮无外部模型额度消耗。测试使用隔离项目，不更改用户真实工程或设置；所有修复和完整红绿证据留在当前工作区。

## 已知表达边界

非均匀父级缩放叠加旋转可产生剪切，既有 TRS 工程结构与 Three `Object3D.attach` 都不能无损表达此类重新挂载；本轮保证平移/旋转/均匀缩放及可分解变换，不新增工程剪切格式。不把这一格式限制表述为任意几何都严格等价。

物理手机传感器/真实局域网质量、外部 AI 服务当前输出质量、以及上游未提供的 Marble 多档资源，是独立验证边界；最终结果只按实际证据登记。

桌面视频 IPC 没有硬取消接口：取消会阻止迟到结果登记，已发出的编码仍可能完成并留下无引用缓存。旧工程既有坏坐标不自动猜测迁移。没有声称所有预设、每个分辨率与全部设备组合均已逐一实测。

> 2026-09-08 追记：本文提到的「内置山谷」（builtin:marble-valley）已因资产许可移除——资产库「泼溅场景」目录只列用户上传的泼溅，示例场景需自备 .spz/.ply（V2 方案 §8）；机位机身同日改为程序化几何。其余条目仍为 09-07 当日记录。
