# 删掉的文件在 corrective 根因合同里无法表达（门岗缺陷，暂用 structural 合同绕开）

> 📎 教训 · 首次记录 2026-09-14 · 状态：现行（门岗缺陷未修，已记账）
> **触发场景**：一个 PR **删掉**了 `src/` 或 `electron/` 下的高风险生产文件（P1「加新必删旧」几乎每次都会），
> 而 `check:root-cause-contracts` 在「写进 scope_paths」和「写进 doors」之间反复报两种互相矛盾的红。

**结论**：别在 corrective 合同里试图表达「这个文件被我删了」——**表达不出来**。
把删除单独写成一份 `change_kind: "structural"` 的合同（structural 合同不跑门表校验），
corrective 那份的 `scope_paths` 不要覆盖被删文件。

**症状（两条路互堵）**：

| 你怎么写 | 门岗怎么说 |
|---|---|
| 被删文件在 `scope_paths` 里，不在 `doors` 里 | `changed production file is not in the door map: <file>`（改了门表之外的文件 = 门没数全）|
| 被删文件也写进 `doors` | `door path does not exist: <file>` |
| 被删文件从 `scope_paths` 拿掉 | `High-risk production file is not covered by a root-cause contract: <file>` |

**为什么会踩**：R21.3「数门」2026-09-11 才生效（PR #759）。
`scripts/root-cause-contracts.mjs` 的 `validateDoorMap()` 里，stray 规则是
`isDoorGovernedFile(file) && pathIsInScope(file, scopePaths) && !doorPaths.has(file)`——
**它只问「这个改过的生产文件在不在门表里」，没问「它还在不在」**。
而同一函数里每条 door 都要过 `fileExists(clean, existingFiles)`（`existingFiles` 来自
`git ls-files --cached --others`）加上 `lineMentionsSymbol()`，被删的文件永远解析不到 `path:line`。
于是「删掉一扇门」这件事——**恰恰是 `door_reduction` 想鼓励的结果**——被 stray 这条规则自己堵死了。

**正解（未做，已记账）**：给合同 schema 一个能说「这扇门被我拆了」的字段，两种等价写法：
- 最小改动：stray 过滤加一条 `&& fileExists(file, existingFiles)`——被删的文件不算漏数的门；或
- 更显式：合同加 `removed_doors: [{path, line, symbol}]`（校验时**不**要求 path 仍存在，
  但要求它出现在本次 diff 的删除清单里），并让 `door_reduction.before - after` 与它对得上。
  这一版更好：门表从「修完还剩几扇」升级成「拆了哪几扇、还剩哪几扇」，减门第一次变成可核对的事实。

**为什么当时没顺手修**：改 `scripts/root-cause-contracts.mjs` 就得为这次改动自己出一份合同，
而 `scripts` 这个「模块」在 `check:symptom-cluster` 眼里 7 天内已有 18 份合同——
新加一份会立刻要求先写一份 `scripts` 的结构评审。**在一个打捞 PR 里做不完，也不该混进去。**

**怎么用**：
- 撞到上面三条报错来回跳，就别再试第四种写法了——按本条走 structural 合同。
- 现成样本：`docs/fixes/2026-09-11-catalog-management-entry-removal.root-cause.json`
  （PR #754 删 `electron/catalog/catalogManagement.ts` 时用的那份）。
- structural 合同的必填项比 corrective 少但更硬：`structural_evidence.affected_paths` 每项都要
  **真实存在 + 本次 diff 有改动 + 被 scope_paths 覆盖**，所以 `affected_paths` 要挑那个**接管者**
  （例子里是 `electron/capabilityCore/dispatcher.ts`），不是被删的那个。
