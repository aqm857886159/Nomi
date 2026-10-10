# TapNow 剪辑交互参考帧（2026-10-11）

来源：用户提供的参考录屏 `~/Downloads/a16bf8f0-95ea-4363-a1f7-d4d41728c5a2.gif`（8.83s / 1328×770 / 12fps），
用来给「视频节点的剪辑交互」定形（见 `docs/plan/2026-10-11-canvas-ux-8-issues.md` §3）。

抽帧方式（可复现，用的是仓库自带的 ffmpeg，零新增依赖）：

```bash
FF=$(node -e "console.log(require('@ffmpeg-installer/ffmpeg').path)")
G=~/Downloads/a16bf8f0-95ea-4363-a1f7-d4d41728c5a2.gif
# 12 格联络表（每 0.74s 一帧，缩到 440 宽）
"$FF" -i "$G" -vf "fps=1.35,scale=440:-1,tile=4x3" -frames:v 1 01-contact-sheet-12f.png
# 两张关键帧（原尺寸）
"$FF" -ss 2.2 -i "$G" -frames:v 1 02-t2.2s-node-and-composer.png
"$FF" -ss 6.4 -i "$G" -frames:v 1 03-t6.4s-filmstrip-clip-bar.png
```

三张图各说明什么：

| 文件 | 时刻 | 看什么 |
|---|---|---|
| `01-contact-sheet-12f.png` | 全程 | 点剪刀 → 节点下方出现胶片条 → 拖两端手柄 → 选区变化，整段动作顺序 |
| `02-t2.2s-node-and-composer.png` | 2.2s | 节点自身底边保留播放控件（播放键 + `1.9s`…`5.1s` 两个读数 + 全屏）；节点下方是节点的生成设置卡，**没有第二块视频** |
| `03-t6.4s-filmstrip-clip-bar.png` | 6.4s | 剪辑条本体：缩略图胶片 + 蓝色高亮选区（标 `2.00s`）+ 两枚白色手柄 + 两端圆形 ✕/✓ + 胶片下 `Arrow Left / Arrow Right  Move selection` 提示 + 右侧 `✦ Smart clip` |

结论（写进 §3 的方案）：剪辑条**长在节点之外的正下方**、**不新增第二个 `<video>`**、确认/取消是**两端圆钮**、带**方向键微调**提示；`Smart clip` 这批不接线。
