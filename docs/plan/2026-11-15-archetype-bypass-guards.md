# 短版设计卡：模型档案「绕过单入口」在依赖规则层写不出来

> 2026-11-15。纯测试 / 配置改动：不改任何运行时代码、档案声明、界面。前置：档案单入口（`2026-11-15-archetype-single-entry.md`）及其独立验收的 3 处漏网。

## 短版设计卡

- ★1：上一刀的独立验收改坏 12 处，有 2 处没红（electron/ 生产文件直接 import 档案常量；入口目录里遍历 `sourceBackedVideoProfiles`）、1 处只有夹具红（真实内置目录不红）。这一刀把前两处挪到 dependency-cruiser 的依赖规则（import 写成动态、require、再导出都识别），第三处补一条在真实内置目录上会红的断言。量具：`pnpm run check:boundaries`（今天主干违反数 0）+ 本卡 ★9 的逐条改坏记录。不做：不改生产代码、不加新依赖、不新增 `check:` 脚本名、不改 CI。老用户：不涉及（装好的应用和存着的项目没有任何变化）。
- ★2：owner 是 `.dependency-cruiser.mjs`（方向禁令）+ `scripts/check-boundaries.mjs`（棘轮，已有）。私有的是 `electron/shared/modelArchetypes/` 里除 10 个公开文件之外的全部、`electron/shared/videoCapabilities/` 里除 12 个公开文件之外的各档案声明文件（新增文件默认私有）；只准读它们的：入口 `entry.ts`（`builtInCatalog` 专属）、本目录、`src/devlab/`（只限 `builtInCatalog`）；`scripts/` 和测试文件本来就不在扫描范围。证据：`node scripts/door-map.mjs resolveModelArchetype`；目录外谁 import 目录内哪个文件，本机用 dependency-cruiser 直接数过。
- ★3：以前定过：档案单入口（上一张卡）、依赖规则管方向（R21，已有 7 条）。三条路：沿原方向（给结构测试的正则再加几种写法，永远追不完 import 的写法）；换做法（选：现成的依赖规则，按文件点名谁能 import 谁，写法不管用哪种）；删（删掉结构测试里被规则接管的两条）。规则管不了「某个符号只准谁用」（depcruise 只看文件边）：`sourceBackedVideoProfiles`、目录内公开文件点名档案常量、videoCapabilities/index.ts 转出的档案常量，留给结构测试按符号名守。夹具 `modeParamsVariantFixture.ts` 原本住在被扫的 electron/parity/（只被 3 个测试 import），挪进 electron/testSupport/（扫描本就排除），规则零例外。复用：`check:boundaries` 的棘轮，新规则硬零、不进基线。
- ★4：规则红 = 打印违反的文件、import 到哪、该走哪个入口（中文说明）；今天主干为 0 所以不红；基线文件不动。
- ★9：回放：今天主干跑 `check:boundaries` 违反 0。反例（改坏→红→还原→绿）：①electron/ 生产文件直接 import `builtInCatalog`；②src/ 生产文件同上；③动态 `import()`；④`require`；⑤在入口目录新文件里改名再导出 `builtInCatalog`；⑥视频档案声明：目录外 import `./viduQ3` 红；目录内 referenceChannels 里 import 它（验收反例 10 原样）由结构测试红；⑦入口目录里新文件遍历 `sourceBackedVideoProfiles`（结构测试）；⑧验收线反例 8（某一类改坏只有夹具红）原样重做，新断言红；测试文件 / 实验室 import `builtInCatalog` 不红。回滚：还原提交，无数据影响。
