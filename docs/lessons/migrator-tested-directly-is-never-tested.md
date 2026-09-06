# 迁移器被直接调用测了个遍，生产上却没人这么调它

> 📎 教训 · 首次记录 2026-09-06 · 状态：现行
> **触发场景**：写/审「老数据兼容」「schema 迁移」「向后兼容投影」的测试时；或用户报「老项目的 X 不见了」而迁移代码看起来完全正确时。

**结论**：兼容迁移的测试必须挂在**生产真正的入口**上（读盘那一层），不能挂在迁移函数本身。迁移器读的是「schema 不认识的老键」——只要生产路径在它之前插了一道 `z.object` 解析，那些键早就被剥光了，而直接喂迁移器的测试永远看不到这件事，全绿到天荒地老。

**为什么会踩**：`src/workbench/project/projectNormalize.ts` 的 `normalizePayload` 负责把老项目的 `payload.storyboardPlan` 迁成 `storyboardDesignsByDocumentId`。它写得没问题，`projectNormalize.test.ts` 里 6 条用例逐个覆盖了单 plan / plans map / 优先级 / 空态，**全绿**。

但生产上没有任何调用者直接调它。读盘走的是 `normalizeRecord`：

```ts
const legacyParsed = workbenchProjectRecordSchema.safeParse(raw)
if (legacyParsed.success) {
  return { ...legacyParsed.data, payload: normalizePayload(legacyParsed.data.payload) }
  //                                                      ^^^^^^^^^^^^^^^^^^^^^^^^^
}
```

`workbenchProjectPayloadSchema` 是普通 `z.object`（**默认剥掉未声明的键**），而它当然不会声明已经退役的 `storyboardPlan`。于是迁移器拿到的 payload 里那个键根本不存在，迁移恒定 no-op。

后果不只是「看不见」：内存里的 payload 从此不带 plan，**下一次自动保存就把它从盘上永久抹掉**——本仓 `renameLocalProject` 的注释里早就写过这条 never-wipe-user-data 铁律，只是这条路径绕开了它。实测真实项目「Nomi 宣传片｜09_00 前交片」：盘上 12 镜 5 锚，过 `normalizeRecord` 后 0 个方案。

**怎么用**：
- 写兼容迁移的测试前先 `grep` 迁移函数名，**看生产上谁在调它**。测试的入参必须和那个调用者的入参同源；两者不同源时，测试断言写在调用者那一层。
- 判断「迁移有没有生效」用真实老项目文件跑一遍读侧函数，别用手搓 fixture——手搓的 fixture 会不自觉地补全成新形状（本次真实老项目的镜头连 `shotId` / `sceneId` 都没有，plan 只有 `title/anchors/shots` 三个键）。
- 改完做变异验证：把修复回退成原样重跑，新用例必须变红。本次两条老键用例回退后确实红，第三条（新形状不受影响）两边都绿——那是护栏不是信号，别拿它当证据。
- 看到 `z.object(...)` 夹在「原始数据」和「兼容读取」之间就警觉：`.passthrough()` 或直接喂原始值，二选一。

**出处**：PR「fix(creation): 分镜方案与原稿在分镜页可达 + 老项目分镜不再被读侧剥掉」；合同 `docs/fixes/2026-09-06-legacy-storyboard-stripped-before-migration.root-cause.json`；同族教训见 [`vacuous-probe-passes-forever.md`](vacuous-probe-passes-forever.md)。
