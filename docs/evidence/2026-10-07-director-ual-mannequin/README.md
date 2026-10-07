# 导演台人偶换 UAL · 真渲染证据（2026-10-07，Windows 11）

施工计划：`docs/plan/2026-10-07-director-ual-mannequin.md`。截图全部来自现役 `DirectorEditor`（导演台实验室 `director-lab.html`，无头 Chromium、软件渲染，不起可见窗口），由下列走查脚本产出、我逐张看过。走查脚本：

- `tests/ux/director-ual-mannequin.walk.mjs`（中文 / `NOMI_WALK_LOCALE=en` 英文）：新建加人、姿态、FK / IK、动作弹窗 44 条逐个预览
- `tests/ux/director-ual-migration.walk.mjs`：旧工程（`model/__fixtures__/legacy-xbot-project.v2.json`）打开 → 迁移 → 只看不落盘 → 改一笔 → 重开
- `tests/ux/director-ual-crowd.walk.mjs`：10×10 群众播放
- `tests/ux/director-j4-kneel-stand-look.walk.mjs`：跪地维修 + 视线看侧前方机位

| 截图 | 看什么 | 实测 |
|---|---|---|
| `new-01-tpose-zh.png` | 新加的人是 UAL 人偶、T 字绑定姿态 | modelPath `builtin:ual`、rig `ual`；蒙皮实测身高 1.750 m、脚底 0.000 |
| `new-02-idle-zh.png` / `new-02-idle-en.png` | 姿态页「待机」，中英两轨 | 头高 1.460 m |
| `new-03-sitting-zh.png` | 姿态页「坐姿待机」 | 头比站姿低 33 cm（坐姿需要椅子，和旧版一样） |
| `new-04-fk-left-arm-zh.png` | FK 骨骼球选左大臂、「手臂抬/下」滑条 60° | 存档写 `DEF-upper_armL.x = 60`（规范轴），左手移动 0.485 m，方向与旧 Mixamo 语义一致（抬臂） |
| `new-05-ik-right-hand-zh.png` | IK 拖右手把手往上 | 写入 `DEF-upper_armR` / `DEF-forearmR`，把手上移 80 px |
| `new-06-walk-clip-zh.png` | 动作库弹窗双击「走路」入轨 | 片段 `Walk_Loop`，检查器动作姿态「走路」 |
| `action-modal-en.png` | 英文动作弹窗，「Looping action」标签 | 列表 44 条 |
| `actions-contact-sheet-zh.png` / `-en.png` | 44 个条目逐个点开的预览总览 | 每个动作姿态正常；单次 / 单帧标签对得上（受击、瞄准等不再循环抖动） |
| `migration-01-open-zh.png` | 打开 2026-10-07 前的 x-bot 工程 | 提示「4 处跪 / 坐地动作换成了相近动作，3 处手指等细节姿势没有保留……」；人在原位、坐着的人坐着 |
| `migration-02-after-edit-zh.png` | 改一笔（挪走路的人）后 | 落盘 version 3、rig `ual`、手调骨骼键是 UAL 骨名、值原样 |
| `migration-03-reopened-zh.png` | 刷新重开 | 不再提示；坐着的人头位置与迁移当场差 0.00 cm |
| `crowd-10x10-playing-zh.png` | 一键 10×10 群众（101 人）播放「走路」 | 软件渲染帧间隔 1 人 167 ms / 101 人 1100 ms，只当相对参考；CPU 基准见 PR 正文 |
| `j4-look-at-side-camera-zh.png` | 跪地维修中，视线片段指向右前方机位 | 头水平朝向与机位方向 cos 0.140 → 0.998（转 76.8°），不再转过头 |

没覆盖（unverified）：真 GPU 帧率与阴影；最小窗口；真实上传的 Mixamo 模型；出片 MP4 编码（走桌面桥，浏览器实验室跑不到）。
