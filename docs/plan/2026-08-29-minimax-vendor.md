# MiniMax 官方供应商接入（两个接口：文本 M1 + 视频 H3）

> 范围 / 不动项 / 回滚 / 验收门。用户请求：「把 MiniMax 的两个接口注入 Nomi，保证能正常访问并有数据」。

## 背景

用户 Obsidian 仓库首页 SN 文档里有两把 MiniMax key（`#minimax` = sk-cp 标准版、`#minimax-H3` = sk-api 超集）。
「两个接口」= MiniMax 的两个旗舰能力：**文本对话（MiniMax-M1）** + **视频生成（MiniMax-H3）**。
两者均已用真 key curl 核验端点契约（见下）。

## 范围（本次做）

1. 新建 `minimax` 供应商（裸 baseUrl `https://api.minimaxi.com`，bearer / Authorization）。
2. **文本 MiniMax-M1**：OpenAI 兼容 chat，无 mapping，走 `buildLanguageModelForVendor` 直连（baseURL 自动补 `/v1`）。
3. **视频 MiniMax-H3（V2）**：t2v，异步 create→poll。

### 端点契约（已核验）

- 文本：`POST /v1/chat/completions` `{model:"MiniMax-M1", messages:[...]}` → HTTP 200。
- 视频创建：`POST /v2/video_generation`
  `{model:"MiniMax-H3", content:[{type:"text",text}], resolution:"768P"|"2K", duration:6|8|10, ratio:"16:9"|"9:16"|"1:1"|"4:3"|"3:4"}`
  → `{task_id}`。t2v ratio 必填非 adaptive。
- 视频轮询：`GET /v2/query/video_generation/{task_id}`（路径参数）→ `{task:{id,status,content:{url}}}`。

## 不动项（明确不做）

- **Hailuo-2.3 官方 V1 原生**：`buildProfileTaskResult`/`extractAssetUrl` 无 file_id→download_url 两段解析，需 runtime 改动。已通过 apimart 中转可用，本次不碰 runtime。
- **H3 i2v**：需 MiniMax 文件上传资产吞入（本地图传 URL），非「两个接口」最小闭环，暂缓。

## 回滚

- 纯新增 seed（vendor/models/mappings 均为 insert-if-absent），删掉 `minimax*` 文件 + 撤销 seedBuiltins/index/knownVendors/i18n 的 4 处接线即可；老装机不受影响（reconcile 幂等）。

## 验收门

1. 五门全过：`check:filesize` → `check:tokens` → `check:i18n` → `lint:ci` → `typecheck` → `test` → `build`。
2. 真机验证（眼见链）：注入 `#minimax-H3` key → 文本 M1 出话、H3 t2v 出 mp4。
