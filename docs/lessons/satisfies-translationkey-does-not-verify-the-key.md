# `satisfies TranslationKey` 不验证这个键存不存在

> 📎 教训 · 首次记录 2026-09-17 · 状态：✅ 已固化（`check-i18n-key-refs.ts` 第 ③ 条接管）
> **触发场景**：把翻译键存成常量表再 `t(TABLE[x])`；或看到界面/报文里冒出一串 `foo.barBaz` 形状的原始 key。

**结论**：`TranslationKey = ParseKeys`，它对**未知的点分键回落 `string`**。所以
`{ unsupported: 'assetLibrary.skippedUnsupported' } as const satisfies Record<string, TranslationKey>`
里那个键**根本不在词典里**时，tsc 一声不吭。存整键字面量只解决了「死键门岗看得见」那一半，
没解决「这个键真的存在」那一半——而后者才是用户看得见的那一半。

**为什么会踩**：两道防线各自以为对方管着。
- `src/i18n/translationKey.ts` 的头注释写着「整键字面量就是死键门岗认的精确引用」，让人以为门岗扫得到；
- `scripts/check-i18n-key-refs.ts`（2026-09-01 建）当时**只认 `t()` 的第一个实参**，存进常量表、隔一层才
  `t(TABLE[x])` 的键谁都不看；
- `src/workbench/assets/assetImportRejection.test.ts` 里甚至写了一行「由 `satisfies` 在编译期管住，
  所以这里不再写那条运行时循环」——把一个**不成立的保证**当成了删测试的理由。

代价：`assetLibrary.skippedUnsupported` 两边词典都没有，`i18n.t()` 原样回键。反馈卡上印给用户的是
`assetLibrary.skippedUnsupported · 16:53 · 0.21.0`，而**这串代号就是发进报文的 `context.summary`**——
收到反馈的人只知道「某人某时导入被拒」，不知道被拒的是什么。同一个场景的**内联行**文案是对的
（走的是另一个键），所以肉眼走查界面也看不出异样，非得点开反馈卡才看得见。

**怎么用**：
- 常量表里的翻译键**不算被验过**，除非门岗真的扫它。`check:i18n` 现在扫（第 ③ 条：`satisfies` 类型文本里
  出现 `TranslationKey` 的整键字面量，按属性名判断哪一格才是键）。加同类写法前先确认门岗认得它。
- 看到「界面对、报文/日志错」这种分裂，先问**这两处是不是同一个取字点**。W-02 就是两个取字点、只有一个是活键。
- 写「由类型系统管住了，所以不用测」之前，先用阳性对照验一次：故意写个坏键，看 tsc 红不红。

**出处**：走查 `docs/audit/2026-09-17-post-804-walkthrough.md` 第 3 节 W-02；
修复见 `scripts/check-i18n-key-refs.ts`（第 ③ 条 + `translationKeyProperties`）与
`src/workbench/assets/assetImportRejection.ts` 的 `unsupportedKindRejection`。
