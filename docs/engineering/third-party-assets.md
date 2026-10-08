# Director 3D-BOX 第三方素材登记

本文件与同名 JSON 是 A 期第三方素材登记入口。每个入库二进制文件都在 JSON `assets` 中有来源、许可证、下载日期、SHA-256、体积和是否改动；批准下载包在 JSON `downloads` 中登记。原始压缩包只保留在 `/tmp/nomi-3dbox-assets-dl/`，不入 Git。

## 本轮方向

2026-10-04 第三轮采用 **Quaternius Universal Animation Library Standard 自带 CC0 人偶**作为 3D-BOX 默认角色，45 个动作保留原生 UAL 骨架和动作，不再给 X Bot 做重定向。上一轮新增的 10 个重定向动作、恢复的 Mixamo 4 个动作和重定向工具已从本 PR 删除。2026-10-07 导演台整体换成 UAL 人偶（施工计划 `docs/plan/2026-10-07-director-ual-mannequin.md`），旧的 `x-bot.glb` 与 9 个 Mixamo FBX 已删除并移出登记。

入库文件为 `src/assets/director/ual/ual-mannequin.glb`：

- 来源：[OpenGameArt Universal Animation Library](https://opengameart.org/content/universal-animation-library)，作者 Quaternius。
- 原包：`universal_animation_librarystandard.zip`，SHA-256 `18ff1a7215f4852b320203e8aaf02a1578b5c8eef9027fbaedfcedc7b85a3ac2`。
- 原始 Godot GLB SHA-256 `1b7bf67866360665426bb99e4c71bd619f19b408453c24e30f0c3071601eee5c`。
- 入库 GLB：6,622,820 bytes，SHA-256 `409725611d68a69ee0eee421ce0b6ad696706f64e017e2ee9a1c149d6e2d9460`。
- 原包 `License.txt` 原文：`CC0 1.0 Universal (CC0 1.0) Public Domain Dedication https://creativecommons.org/publicdomain/zero/1.0/`。
- 改动：去掉预览球、贴图和源材质，换成 Nomi 灰色白模材质；将静止姿势脚底最低点归零；保留 UAL 网格、骨架和 45 个原生动作。人偶身高 `1.828717 m`，原点约定 `ground-min-z`。

## 其他许可

- **Kenney**：道路、Car、Furniture、Building 包来自 [kenney.nl](https://kenney.nl/assets)，原包 `License.txt` 为 CC0；精选模型统一转 GLB、地面最低点归零。
- **StoryAI 静态姿势**：来源 [mannequinPosePresets.ts](https://github.com/jiguang132/storyai-3d-director-desk/blob/main/src/editor/presets/mannequinPosePresets.ts)，仓库 [LICENSE](https://github.com/jiguang132/storyai-3d-director-desk/blob/main/LICENSE) 为 MIT，保留署名。

## 待裁决灰区

仓库里只剩 `ue-mannequin-retopology.glb`（Sketchfab Standard）登记为灰区：`src/` 里已没有任何引用，另开清理。`x-bot.glb` 与 9 个 Mixamo FBX 两类灰区已随 2026-10-07 换 UAL 删除。

完整文件清单、下载包 SHA-256 与原始压缩包大小见 [`third-party-assets.json`](./third-party-assets.json)。
