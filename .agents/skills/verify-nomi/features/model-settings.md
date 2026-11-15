# 模型设置页

设置弹窗的「模型」页签：接供应商、看已接模型、自定义 API / 中转站、高级与连接设置。

## Sub-features

- 首页：已接入列表 / 接入入口、「其他接入方式」折叠（自定义 API / 中转站）、高级与连接设置区。
- 设置弹窗其它页签：文件 / 模型 / AI / 自动化 / 通用（语言、主题）/ 关于。

## How to get to it (user POV)

顶栏右上齿轮 → 设置弹窗 → 「模型」页签。项目库和项目里是同一条顶栏，哪都能点。

## Driving it with ui.mjs

```bash
node tests/ux/ui.mjs goto model-settings
node tests/ux/ui.mjs shot model-settings
node tests/ux/ui.mjs press Escape
```

## Gotchas

- 设置弹窗开着会挡住别的点击；其它 `goto` 会先关掉它，自己手点前记得 `press Escape`。
- 隔离实例没有钥匙，这一页看到的是「没接」的状态；验证接入流程别真填钥匙、别点会花钱的测试。
