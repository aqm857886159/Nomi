# Current Nomi App Real-Window Screenshots (`origin/main` @ `1730b7ea3`)

Captured via isolated Electron window (`node tests/ux/ui.mjs up --vendor fake-apimart`, `0` real network spend, `zh-CN` Light). Every PNG has been visually verified via `read_file`.

## `S-D 样片模式` (`Seedance 2.5` Video Node)
- `current-video-model-menu.zh-CN.light.png` — Video model picker (`Seedance 2.5 · 文生/图生/首尾帧/参考/编辑 · 最高 1080p · 最长 30 秒`; note no separate draft row yet in runtime).
- `current-seedance-2.5-composer.zh-CN.light.png` — `Seedance 2.5` empty video node + composer footer (`Seedance 2.5 ▾` | `A 文生视频 ▾` | `16:9 · 720p · 5s ▾` | `预设` `翻译` `Nomi` `高级设置` `↑`).
- `current-seedance-2.5-mode-menu.zh-CN.light.png` — `Seedance 2.5` mode dropdown (`文生视频` active with right `✓`, `图生视频 · 先放 1 张图` disabled until reference attached).
- `current-seedance-2.5-params-panel.zh-CN.light.png` — `Seedance 2.5` parameter popover (`比例: 自动 / 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9`, `清晰度: 480p / 720p / 1080p`, `时长(秒): 4–30` slider, `生成音频` switch).
- `current-seedance-2.5-advanced-settings.zh-CN.light.png` — `Seedance 2.5` inline advanced settings drawer (`返回尾帧`, `种子`, `添加水印`, `输出格式 mp4 / mov`).
- `current-seedance-2.5-result-card.zh-CN.light.png` — `Seedance 2.5` settled video result card at `100%` zoom + floating video toolbar (`截帧 ▾ | 剪辑 | 拆解 ▾ | 提取深度 | 复制 | 全屏 | 下载 | 记录 | 加入时间轴`).
- `current-seedance-2.5-result-card-full.zh-CN.light.png` — `Seedance 2.5` settled video result card zoomed to `80%` showing both result card + bottom composer together.

## `S-E 图层分解` (`Seedream 5.5` / `Seedream 5.0 Pro` Image Node & Inline Whiteboard)
- `current-image-model-menu.zh-CN.light.png` — Image model picker (`Seedream 5.0 Pro · 文生图/改图 · 最高 2K`, `Seedream 5.5` further down list, right `✓`).
- `current-seedream-5.5-composer.zh-CN.light.png` — `Seedream 5.5` image node + composer (`Seedream 5.5 ▾` | `1:1 · 2K ▾` + preset chips `人物三视图 / 场景三视图 / 去 AI 感 / 自然扩图`; note **no mode selector pill** on canvas image nodes — mode auto-infers from attached references).
- `current-seedream-5.5-params-panel.zh-CN.light.png` — `Seedream 5.5` parameter popover (`比例: 16:9..1:2`, `清晰度: 1K / 1.5K / 2K`, `背景: 自动 / 透明底 / 不透明`).
- `current-seedream-5.5-advanced-settings.zh-CN.light.png` — `Seedream 5.5` inline advanced settings (`格式: png / jpeg`).
- `current-seedream-5.0-pro-composer.zh-CN.light.png` — `Seedream 5.0 Pro` composer (`Seedream 5.0 Pro ▾` | `1:1 · 2K ▾`).
- `current-seedream-5.0-pro-params-panel.zh-CN.light.png` — `Seedream 5.0 Pro` parameter popover (`比例: 自动 + 10 档`, `清晰度: 1K / 1.5K / 2K`).
- `current-seedream-5.5-result-card.zh-CN.light.png` — `Seedream 5.5` generated image node + floating image toolbar (`复制 | 多机位九宫格 ▾ | 抠图 | 改图 ▾ | 宫格 ▾ | 画板 | 全屏 | 下载 | 记录 | 加入时间轴`).
- `current-whiteboard-toolbar.zh-CN.light.png` — Inline whiteboard (`画板`) toolbar on generated `Seedream 5.5` node (`选择 / 画笔 / 橡皮 / 文字 / 颜色 / 粗细 / 撤销 / 重做 / 导入 / 素材 / 图层 / 1280×1280 / 截图 / 完成`).
- `current-whiteboard-layers-panel.zh-CN.light.png` — Inline whiteboard `图层` (`whiteboard-layers`) popover (`原图` + `图层 1` + `背景` with eye visibility & trash icons).
