# 卡 9：director-refine d3a-clip-zh 与 34 处像素差诊断

日期：2026-10-05（UTC）
诊断基线：PR #1007 合并报告，Darwin arm64，1440×1000 @1x，基线起点 `origin/main / aacb7f626`。
本报告只记录事实和归因；没有更新 `tests/ux/design-lab/__baselines__/`、`calibration.json` 或产品代码。

## 1. d3a-clip-zh 失败

PR #1007 的定向命令是：

```text
NOMI_DESIGN_LAB_UPDATE=1 npx playwright test -c tests/ux/design-lab/playwright.config.mjs --grep 'director-refine.*d3a-clip-zh'
```

报告记录的原始页面错误：

```text
Error: director3dbox lab: 等不到 [data-nomi-escape-layer="director-popover"] button 里的「黑衣侍卫」
```

失败截图：[director-refine-d3a-clip-zh-actual.png](../2026-10-05-darwin-baselines/director-refine-d3a-clip-zh-actual.png)

截图哈希（PNG，1280×933，RGB）：`e92bb8315f25f86668e6a4d07d12a0b6d69d90875ca30ead92b72c5c9f2e0564`。画面中「+ 添加轨道」菜单列出 `ground / wall_enclosure / wall east / gate / courtyard tree`，没有「黑衣侍卫」。

### 代码链

- `d9ec0a501`（`feat(design-lab): 导演台精修「选中才出」样张屏`）首次引入 `d3a-clip-zh` 与 `PICK_GUARD_CLIP`。步骤假设「AI 编出的工程没有轨道」，先点「添加轨道」，再找「黑衣侍卫」和 `standard_walk`。
- `7416b03fa`（`fix(director): 在不在时间轴由片段推出`）把编译器出口接到统一规则 `syncInTimeline`：只要实体有片段，就把 `inTimeline` 设为 `true`。
- 现行 UI 的候选来自 `entitiesOutsideTimeline`，条件是 `!entity.inTimeline && !isAuxiliary`。因此已带动作/轨迹片段的角色不会出现在「添加轨道」菜单。
- 通过同一份现行编译器做的可复现实验：

```text
node_modules/.bin/tsx -e "import { S1_ORACLE_PLANS } from './evals/director/s1OraclePlans.ts'; import { compileDirectorPlan } from './src/workbench/generationCanvas/nodes/director/model/compiler/directorPlanCompiler.ts'; import { entitiesOutsideTimeline } from './src/workbench/generationCanvas/nodes/director/model/timelineTracks.ts'; const r=compileDirectorPlan(S1_ORACLE_PLANS['courtyard-standoff']); if(!r.ok) throw new Error(r.errors.join(';')); const s=r.project.scenes.find(x=>x.id===r.project.activeSceneId)??r.project.scenes[0]; console.log(JSON.stringify({guard:s.objects.find(x=>x.name==='黑衣侍卫'),outside:entitiesOutsideTimeline(s).map(x=>x.name)},null,2));"
```

输出关键事实：

```text
guard.name = 黑衣侍卫
guard.trajectoryClips = [actor:guard-sidestep-4, 4s–8s]
guard.actionClips = [standing_idle, standard_walk, standing_idle]
guard.inTimeline = true
outside = [ground, wall_enclosure, wall east, gate, courtyard tree]
```

所以失败点是实验室步骤与现行工程/编辑器不变量不一致，发生在点击文本等待阶段（约 30 秒），不是字体、WebGL 或场景未落定错误。应重新定义该格的动作/夹具后再拍板；本卡没有替换步骤，也没有伪造基线。

## 2. PR #1007 的 34 个像素差

PR #1007 报告的屏级统计为：process-feedback 14、settings-sound 3、storyboard 8、canvas-frame 1、settings 4、depth-action 2、director-3dbox 2。报告链接的 `logs/check-design-lab.log` 未进入合并提交，因此当前可核对的是屏级计数、代表像素数和 Git 历史；无法从已提交材料安全地声称每一个具体 state 文件名。

判定规则：基线 PNG 的最后提交之后，若现役组件/实验室夹具的运行时 DOM、文案、几何或 3D 数据有提交，归为「代码改动，需重新拍板/重录」；若只有类型或编译期改动，且现役渲染路径无变化，归为「字体/环境噪音候选」。

| 屏 | 差异数（PR1007） | 基线 PNG 最后提交 | 后续可核对提交/事实 | 归因 |
|---|---:|---|---|---|
| process-feedback | 14 | `ce5cfb336`（2026-09-11） | `BaseGenerationNode`、等待面、任务行、浮条在基线后持续变更；代表提交：`50764219b`、`716480007`、`e2ade130d`、`6fc3e2763`。 | 代码改动；需重录/重新拍板 |
| settings-sound | 3（约 508/屏） | `ab027e3f1`（2026-09-23） | `AttentionSoundSection.tsx` 后续仅是 React 19 类型导入和 `useRef` 类型标注，未改 DOM、class、文案或布局。 | 字体/浏览器环境噪音候选；没有代码重拍依据 |
| storyboard | 8（代表 3252、3568、3978） | `ab027e3f1`（2026-09-23） | 基线后改动了行/锚区/参考槽现役路径：`ec786acb2`、`dad3db47e`、`cf7abb89b`，后续还有恢复文案提交 `c4c4e0215`、`911873697`。 | 代码改动；需重录/重新拍板 |
| canvas-frame | 1（436） | `ab027e3f1`（2026-09-23） | `d636c8ac6` 改了 GroupFrame/CollapsedGroupCard 运行时行为，并同步改动 `canvas-frame-05-collapsed` 夹具。 | 代码改动；需重录/重新拍板 |
| settings | 4（10481–11278） | `8be8c1124`（2026-09-11） | `bf9ae2555` 改五步进度投影；`e34c6ec7b` 重写接入卡/文案；`adc64d26f` 改设置夹具的 MCP 归属字段。 | 代码/夹具改动；需重录/重新拍板 |
| depth-action | 2（1659/1579） | `9490c0a99`（2026-09-09） | `a49e82305` 直接移除处理覆盖层的 `placement="top"`；`e2ade130d`、`649402b46`、`a5cf953aa` 又改浮条布局。 | 代码改动；需重录/重新拍板 |
| director-3dbox | 2（17583/18043） | `fbba3cfdc`（2026-10-04） | 基线后导演视图切换到新精修壳（`e8ca3acf4`、`656827a6e`），并继续改编译器/舞台模型/相机跟随（`7416b03fa`、`a89f7c0a7` 等）。 | 代码/3D 工程数据改动；需重录/重新拍板 |

小像素数（例如 process-feedback 约 0.01、settings-sound 约 0.01）本身不能证明是字体噪音；只有 settings-sound 在基线后没有运行时视觉改动，才可把它列为环境候选。其余屏应按代码改动处理，不能直接更新基线覆盖。

## 3. 实际验证与限制

- 已在现行源码上运行上面的 `tsx` 编译检查，输出与截图菜单完全一致。
- 已尝试用当前 Linux Chromium 重跑设计实验室；由于 Darwin 基线与 Linux 字体/渲染器不同，出现跨平台大面积差异，不能作为本次 Darwin 34 处归因证据，未写入或更新任何基线。
- PR #1007 的两份原始日志未提交 Git；因此本报告保留现有合并报告、截图、命令和 Git 提交证据，不臆测缺失的 state 文件名。
- `git status` 在报告分支仅新增本报告；`tests/ux/design-lab/__baselines__/` 与 `calibration.json` 未改。

相关来源：[PR1007 Darwin audit](../2026-10-05-darwin-baselines/README.md)。
