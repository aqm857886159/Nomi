# 2026-10-04 Director 3D-BOX 素材 A 期：第三轮方向

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 决策

第二轮的 X Bot 重定向指标会把整体躺倒/站立抵消掉：Push_Loop 中位角 0.5°、Death01 中位角 0.8°，但联系图分别显示目标举臂悬空和站立浮空。用户于 2026-10-04 拍板：3D-BOX 默认角色改用 Quaternius Universal Animation Library Standard 自带的 CC0 人偶，动作原生使用；旧导演台 X Bot + Mixamo 不动；“藏信”等细节动作交给视频模型，不再扩展 3D 重定向库。

本轮删除上一轮新增的 10 个重定向动作 GLB/FBX、恢复的 Mixamo 4 个动作、重定向脚本/检查器和对应许可证条目；现有 X Bot、UE 人偶、9 个 Mixamo FBX 的灰区登记保留。

## 入库与可复现命令

入库采用单个 `src/assets/director/ual/ual-mannequin.glb`，理由是 UAL 的网格、骨架和 45 个动作共享同一原生骨架；运行时可按 `clipName` 选择动作，避免拆分产生重复角色网格并保留懒加载入口。处理脚本为 `scripts/director-assets/prepare_ual.py`：

```bash
blender -b --python scripts/director-assets/prepare_ual.py -- \
  --source /tmp/nomi-3dbox-assets-dl/universal_animation_librarystandard.zip \
  --output src/assets/director/ual/ual-mannequin.glb \
  --manifest src/assets/director/ual/ual-mannequin.manifest.json
```

同一输入连续运行两次，产物 SHA-256 均为 `409725611d68a69ee0eee421ce0b6ad696706f64e017e2ee9a1c149d6e2d9460`。处理去掉预览球、贴图和源材质，换成灰色白模材质，静止脚底归零；人偶身高 `1.828717 m`，原点为 `ground-min-z`。

## 骨骼与目录

语义骨映射在 `src/assets/director/ual/ual-rig.json`，包含 hips、spine、chest、neck、head、左右 upperArm/lowerArm/hand、upperLeg/lowerLeg/foot 及手指/脚趾子骨。`node scripts/director-assets/check-ual-asset.mjs` 验证 GLB 中 45 个动画和全部语义骨都存在；Node 测试在 `scripts/director-assets/check-ual-asset.node-test.mjs`。

45 个动作全部进入目录；每条包括中英文名、标签、时长、循环、根运动和一条目检描述，源数据为 `src/workbench/generationCanvas/nodes/director/model/assetCatalog/ualActions.ts`。动作分组如下：

- locomotion：`Crouch_Fwd_Loop`、`Jog_Fwd_Loop`、`Jump_Land`、`Jump_Loop`、`Jump_Start`、`Roll`、`Roll_RM`、`Sprint_Loop`、`Swim_Fwd_Loop`、`Swim_Idle_Loop`、`Walk_Formal_Loop`、`Walk_Loop`
- idle / dialogue：`Crouch_Idle_Loop`、`Idle_Loop`、`Idle_Talking_Loop`、`Idle_Torch_Loop`、`Pistol_Idle_Loop`、`Sitting_Idle_Loop`、`Sitting_Talking_Loop`、`Spell_Simple_Idle_Loop`
- combat：`Hit_Chest`、`Hit_Head`、`Pistol_Aim_Down`、`Pistol_Aim_Neutral`、`Pistol_Aim_Up`、`Pistol_Reload`、`Pistol_Shoot`、`Punch_Cross`、`Punch_Enter`、`Punch_Jab`、`Spell_Simple_Enter`、`Spell_Simple_Exit`、`Spell_Simple_Shoot`、`Sword_Attack`、`Sword_Attack_RM`、`Sword_Idle`
- interact / sit / fall：`Dance_Loop`、`Death01`、`Driving_Loop`、`Fixing_Kneeling`、`Interact`、`PickUp_Table`、`Push_Loop`、`Sitting_Enter`、`Sitting_Exit`

## 题卡语义对照

| 题卡语义 | UAL 原生动作 | 没有对应时 |
|---|---|---|
| `walk_to` | `Walk_Loop` / `Walk_Formal_Loop` | |
| `run_to` | `Jog_Fwd_Loop` / `Sprint_Loop` | |
| `stop`、`hold` | `Idle_Loop` | |
| `sit` | `Sitting_Enter` → `Sitting_Idle_Loop` → `Sitting_Exit` | |
| `push` | `Push_Loop` | |
| `punch` | `Punch_Jab` / `Punch_Cross` | |
| `pick_up` | `PickUp_Table` | |
| `fall` | `Death01` | |
| `crouch` | `Crouch_Fwd_Loop` / `Crouch_Idle_Loop` | |
| `jump` | `Jump_Start` → `Jump_Loop` → `Jump_Land` | |
| `interact` | `Interact` | |
| `dialogue` | `Idle_Talking_Loop` / `Sitting_Talking_Loop` | |
| `pistol` | `Pistol_Aim_*` / `Pistol_Shoot` / `Pistol_Reload` | |
| `sword` | `Sword_Attack` / `Sword_Idle` | |
| `spell` | `Spell_Simple_*` | |
| `swim` | `Swim_Fwd_Loop` / `Swim_Idle_Loop` | |
| `dance` | `Dance_Loop` | |
| `kneel_repair` | `Fixing_Kneeling` | |
| `roll` | `Roll` / `Roll_RM` | |
| `藏信`等细节动作 | — | 交给视频模型 |

本轮不改编译器、评分器、`actionLibrary.ts` 或现有导演台运行时。

## 目检与确定性检查

渲染脚本为 `scripts/director-assets/render_ual_contact_sheet.py`，组合脚本为 `scripts/director-assets/compose_ual_contact_sheets.py`。它们对每个动作取起/中/末三个时刻，使用灰色人偶和地面网格；输出联系图：

- `evals/runs/retarget-r3/ual-contact/ual-actions-contact-01.png`
- `evals/runs/retarget-r3/ual-contact/ual-actions-contact-02.png`
- `evals/runs/retarget-r3/ual-contact/ual-actions-contact-03.png`

我已逐张打开三张图。每个动作的“人在做什么、脚是否着地”描述保存在 `ualActions.ts` 和 `contact-manifest.json`；图中动态跑跳、游泳、翻滚、跌倒、坐姿和蹲姿的离地/豁免状态均按画面记录，没有用“正常/通过”替代描述。

站立类动作的确定性检查由 `scripts/director-assets/check_ual_standing.py` 执行：首帧双脚最低点 ≤3 cm，髋高/身高在 45%–60%。22 个站立类动作全部通过；23 个豁免动作列在 `ual-mannequin.manifest.json` 的 `requiresStanding=false`，包括蹲、跌倒、驾驶、跪地、跳跃、拾取、推、翻滚、坐、游泳和低身持剑动作。收据为 `src/assets/director/ual/ual-standing-check.json`。

## 体积与许可证

`node scripts/check-director-asset-catalog.mjs` 报告目录引用 17 个二进制文件（1 个 UAL GLB、16 个已批准 Kenney GLB），总新增二进制 `7,147,956 bytes / 6.817 MiB`，低于 30 MiB。UAL 原始压缩包仍不进 Git；许可证登记见 `docs/engineering/third-party-assets.md` 与同名 JSON。

## 接入切换 PR

后续切换 PR 需要：将默认角色加载源切到 UAL GLB；动作播放器使用 `clipName` 从同一 GLB 选择原生动作；将 `ual-rig.json` 语义映射接入运行时；保留旧导演台 X Bot/Mixamo 路径不变；规划器只消费 `DIRECTOR_PLANNER_ASSETS` 的精简字段。本轮不改现有运行时文件。

## 先查别人

- [Quaternius Universal Animation Library](https://opengameart.org/content/universal-animation-library)
- [Kenney City Kit Roads](https://kenney.nl/assets/city-kit-roads)
- [Kenney Car Kit](https://kenney.nl/assets/car-kit)
- [three.js GLTFLoader](https://github.com/mrdoob/three.js/tree/dev/examples/jsm/loaders)
- [StoryAI mannequinPosePresets.ts](https://github.com/jiguang132/storyai-3d-director-desk/blob/main/src/editor/presets/mannequinPosePresets.ts)
