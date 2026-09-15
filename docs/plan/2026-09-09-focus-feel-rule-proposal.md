# #662 接入提案：焦点与 UA 外观

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：等待 #662 合并后接入其唯一 scanFeel；本分支不复制或改写 _feel.mjs。

接口已从 origin/test/ux-feel-regression-mechanism-20260909 读取：scanFeel(root,{rules,label})，finding={rule,message,target}，违规抛带 findings 的 Error。新增配置应默认关闭互动探测，走查显式启用；不能在同步 root.evaluate 中冒充真实鼠标/键盘操作。

## 先查别人

- 依赖：node_modules/@mantine/core/styles.css:60 已有 mantine-focus-auto，必须由基础层统一覆盖，而非组件逐个覆盖。
- 仓库：tailwind.config.ts:403 已有全局焦点与滚动条 owner；#662 的 tests/ux/_feel.mjs:3 是唯一 scanFeel。
- 生态：https://m3.material.io/components/text-fields/guidelines 字段容器负责焦点状态；https://design-system.service.gov.uk/components/text-input/ 提供有意采用强外环的反例。

依赖里的 Chromium 已提供 :focus-visible 与 :has；现役 Tailwind addBase（tailwind.config.ts:403）已有焦点与滚动条规则。仓库接口是 #662 的 scanFeel，不另起扫描器。官方 Apple/Material/GOV.UK 依据、取舍与实测详见 [焦点分层方案](2026-09-09-focus-indication-class.md#先查别人)。结论：复用现有 owner，提交夹具和接口提案，不新增依赖或通用扫描框架。

## 必红夹具与判据

夹具：tests/ux/fixtures/focus-indication/leaks.html；修复边界矩阵：controls.html。运行 node tests/ux/focus-indication.e2e.mjs 验证前两条负例的确暴露问题，并校验生产 Tailwind 编译产物。

| rule | 动作 | 违规判据 | 必红目标 |
|---|---|---|---|
| mouse-text-outline | Playwright 真实 click 文本输入 | outlineStyle 不为 none/hidden 且 outlineWidth>0；不能只看宽度，Chromium 在 outline:none 时也可能报告 3px | #mouse-text |
| keyboard-focus-missing | 真 Tab 到非文本控件，不调用 click 激活 | activeElement 与目标相同，缺少可见、非透明、非 UA auto 的设计系统指示（outline 或声明的等价内描边） | #keyboard-button |
| ua-default-focus-ring | 上面两种动作后读样式 | style=auto，或计算色与页面临时探针 -webkit-focus-ring-color 一致且未声明系统色无障碍模式；色相近本身不能断言来源 | #mouse-text |
| ua-default-scrollbar | 仅检查实际可滚动元素 | scrollbar-width/color 都为 auto，且 ::-webkit-scrollbar/thumb 无自定义尺寸/背景（按 Chromium 平台检查） | #scrollbar |
| ua-default-form-control | 检查 select/checkbox/radio/range | 原生 appearance:auto 且没有设计系统所有权/已验证的 accent-color 或自定义渲染；不能只凭 appearance:auto 报违规 | #select/#checkbox/#range |

非文本 focusable 不能只列 button，须包括 a[href]、select、summary、非文本 input、tabindex、语义角色；排除 disabled/inert/隐藏元素。文本包括 textarea、文本/数字 input、contenteditable 空值/true/plaintext-only，排除 hidden/button/submit/reset/checkbox/radio/range/color/file/date 等非文本类型。只读输入仍可选中与复制。

## 不破坏用户任务的扫描

互动扫描在隔离走查实例进行。每次先保存 activeElement、selection、scrollTop/Left，读完恢复；restore 不得发送/提交或永久覆盖用户内容。真实 click 只用于文本控件，按钮通过 Tab 聚焦，避免扫描触发删除/生成等操作。root 是 Locator 时只枚举其范围；探针结束必须恢复滚动与焦点。forced-colors 单列，不把系统可访问性颜色当品牌泄漏。

## 同族现状

全局 scrollbar-width:thin 与 token scrollbar-color 已在 tailwind.config.ts；这不是此次已复现故障。原生控件 appearance:auto 本身不是 bug：Mantine Checkbox 用隐藏 native input 保留可访问性并另绘图标，range 可以由 accent-color 接管。禁止为了“门岗绿”盲目 appearance:none 让 checkbox 勾选和 select 箭头消失。
