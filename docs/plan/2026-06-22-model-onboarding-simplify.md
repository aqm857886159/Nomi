# 模型接入页简化（方案 A + 顶部能力概览）

> 2026-06-22 ｜ 用户：「模型接入是不是太复杂？简化一下」→ 拍板「理顺信息架构」→ 三方案选「A + 顶部能力概览」。

## 诊断（复杂度根因）
不是东西多，是「该走哪条」看不出来：① 两件事混一页（接生成模型 vs 把 Nomi 接进编程助手）；② 接模型有两个同源入口（`OnboardingDrawer.tsx:146` 中转 button 与 `:165` AddModelCard 点开同一个 Wizard）；③ 两套接入心智 + Wizard 暴露 wire protocol/请求头。

## 方案（纯理顺 IA，不动 catalog/IPC/接入能力）
改两个文件：

### OnboardingDrawer.tsx
1. **顶部能力概览条**（effect-first）：「你现在已经能生成：图片✓ 视频✓ 文本✓ 配音(未接)」——由已连通供应商(hasApiKey)的模型 kind 派生(derive 不 hardcode)，覆盖=success 绿 chip，未覆盖=灰 chip。
2. **两区分清**：①【接入生成模型】= 供应商行卡(VendorOnboardCard，待接入的一眼可见可点解锁) + 其他模型卡 + 一个合并入口；②【接入编程助手 · 可选】= ConnectAssistantCard（长尾，折叠）。
3. **合并同源入口**：删「接你的中转站·new-api」accent button + AddModelCard 两张，换成**一张**「+ 添加模型 / 中转站」（副标「new-api 一次拉全图·视频·文本 · 官方厂商 · 自定义接口」），opens Wizard。消灭「点哪个」纠结。

### OnboardingWizard.tsx
4. 接口协议 + 自定义请求头（已 custom-only）再包进一个**「高级设置」折叠**（默认收起），主流程只剩 选→填地址+Key→拉模型→保存。

## 不动项
catalog store / IPC / VendorOnboardCard 解锁逻辑 / Wizard 拉取·测试·保存能力 / ConnectAssistantCard。只动 Drawer 排版 + Wizard 高级折叠。

## 验收
- 真机走查对账方案A+概览样张：能力条正确反映已连通 kind；两区清晰；合并入口一个；编程助手成区折叠；Wizard custom 高级字段默认收起、展开可用。
- 五门全过。
