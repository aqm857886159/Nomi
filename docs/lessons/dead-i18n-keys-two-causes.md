# 死 i18n 词条有两种成因，处置正好相反

> 📎 教训 · 首次记录 2026-09-01 · 状态：现行
> **触发场景**：扫出一批「零引用」的 i18n 词条准备清理；或者看到 i18n 豁免名单里写着某文件「由某某 mapping 翻译」。

**结论**：扫出「零引用」词条**不能直接删**。删之前必须做一次「译文值 × 源码硬编码」交叉比对。两种成因、处置相反：

1. **真遗留**——功能改版后旧词条没跟着删 → 删掉。
2. **译文是好的、代码没接上**——词条 zh+en 齐备且正确，但组件把中文**写死**在常量 / 字面量里，渲染的是那份硬编码。删掉 = 把正确翻译扔了 + 把「英文界面显示中文」坐实。→ **接上代码，词条保留**（2026-09-01 用户拍板选的就是这条）。

**怎么区分**（30 秒，别靠眼力）：把候选键的 zh 译文值，拿去和 `src/` 里的中文字符串字面量做交叉比对。值能在源码里找到一模一样的硬编码 = 第 2 类。2026-09-01 实测：366 条候选里 40 条 pose 键去重后 27 个中文词**全部**在 `scene3dConstants.ts` 里有逐字硬编码，一个不差——铁证。反过来，`'素材'` / `'提示词'` / `'模型'` 这种单个通用词命中属巧合，按长度和具体性排除。

**为什么正向门岗看不见这一类**：`check-i18n-key-parity` 查的是 zh↔en 对称（两边都在 = 平衡）；可见文案硬零那道**有豁免名单，而名单里的理由会过期**——`scene3dConstants.ts` 当时挂的理由是「translated by scene3dInspector mappings」，**那个映射根本不存在**。豁免条目的理由要当断言验，别当注释信。

**接线后必看英文截图**：英文串比中文长得多，会撑破按中文密度定的固定尺寸。同一次实测撞到两处：标签列固定 42px 而 "Forward lean" 要 46px；预设按钮固定 `h-8` 被 "Raise both hands" 撑破。机器断言测得出（量 `scrollWidth` / `scrollHeight`），但得先想到去量。

**接线时的三个坑**（2026-09-02 浏览器素材那批踩到）：

- **别在模块顶层常量里调 `t()`**。`const LABELS = { replicate: t('...') }` 的求值发生在 import 那一刻，语言切换后不更新 = 把首次加载的语言冻死。正解：常量只存**键**（`as const satisfies Record<K, string>` 保住字面量类型，消费方 `t(KEYS[x])` 免 `as` 断言），取文案一律在用的地方。把写死中文改成顶层 `t()` 只是把一个 bug 换成另一个。
- **同一批文案存了两份时，先用「哪棵整棵都没人引用」定 owner**，别靠命名直觉。实测：`runtime.browser` 10 个叶子全死、`browserAssets` 163 个叶子只死 15——前者才是该删的副本。
- 判「能不能翻译」看的是**有没有人拿这个值做比较**（`includes` / `===` / `startsWith` / `indexOf`），不是「它像不像标签」。那批里最可疑的 3 个 tag 追下去只进搜索 haystack、从不渲染也从不比对 → 可翻。

**死键门岗看不见的第三种（2026-09-05）**：`check:i18n-dead-keys` 对**整命名空间动态前缀**（`scripts/lib/i18nDynamicKeyPrefixes.ts` 里的 `generationCommon` 一整棵）下的键一律降为 B 档不报。所以 Agent Host cutover（d270d34ec）删掉 `CanvasAssistantPanel` / `CanvasAssistantEntry` 后，`generationCommon.assistant.*` 留下 44 条死键、零报警，直到走查按其中一条的译文值 `[aria-label="生成区 AI 助手"]` 找元素才暴露。组件退役时顺手 `git show <sha> --diff-filter=D --name-only` 列出删掉的消费者，对它们用过的整棵键做一次零引用扫描；扫描要把模板前缀（`t(\`ns.${id}.x\`)`）也算引用，否则会把 `creationAi.mode.*` 这种活键误判成死。

**出处**：2026-09-01 / 2026-09-02 i18n 清理实测；2026-09-05 `generationCommon.assistant.*` 清理。相关：[走查断言必须有真信号](walkthrough-assertions-need-a-real-signal.md)、[一个死选择器同时造假红和假绿](dead-selector-lies-both-ways.md)。
