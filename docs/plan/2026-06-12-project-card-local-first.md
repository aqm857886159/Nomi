# 项目卡片本地位置入口

日期：2026-06-12

## 样张

`docs/design/mockups/2026-06-12-project-card-folder-action-v2.html`
`docs/design/mockups/2026-06-12-project-library-source-distinction.html`

## 范围

- 项目库操作区下方只出现一次位置说明：图片在 `assets`，成片在 `exports`。
- 项目卡片右侧增加文件夹图标弱按钮，打开项目根目录。
- 最近项目标题同侧增加来源筛选：全部 / 默认项目 / 外部文件夹。
- 项目卡片封面不再用角标区分来源，来源只放在卡片 metadata。
- 打通已有桌面项目 summary 的 `rootPath` 到渲染层。

## 不动项

- 不改项目存储结构。
- 不改模型接入面板。
- 不改生成、导出、素材落盘路径。

## 验收

- 卡片不显示半截路径，也不重复展示 `assets / exports` 说明。
- 来源筛选靠近“最近项目”，不放到页面最右侧。
- 封面不显示“文件夹”标识。
- hover 封面仍只突出“继续创作”和删除。
- “打开”能打开项目文件夹。
