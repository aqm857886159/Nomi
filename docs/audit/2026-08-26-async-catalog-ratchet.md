# D2 异步 catalog 棘轮证明

故意注入 `mc?.listModels()?.find(...)` 后，门岗字面输出：

```text
异步 catalog 返回值用法：发现 1 处，?. 链 1 处，基线 0 处
  ✗ tests/ux/.async-catalog-ratchet-fixture.mjs:1:listModels (direct .find)
❌ 异步 catalog 棘轮失败：1 处新缺陷；Promise 必须先 await 再调用数组方法。
```

撤销注入后，门岗字面输出：

```text
异步 catalog 返回值用法：发现 0 处，?. 链 0 处，基线 0 处
✅ 异步 catalog 棘轮通过：无新增 Promise 当数组用法。
```
