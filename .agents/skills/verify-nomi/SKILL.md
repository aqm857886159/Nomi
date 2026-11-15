---
name: verify-nomi
description: "在真的 Nomi 桌面窗口里验证一处改动（界面、交互、文案、数据有没有落对）时用。起一只隔离、安静的常驻驱动（tests/ux/ui.mjs），按功能名走到那一屏，点 / 填 / 截图 / 读回，证据落仓库外。验收线、实现线自验、修 bug 前复现都先用它，别现写几百行驱动脚本。"
---

# 验证 Nomi（常驻驱动）

一只驱动 = 一个隔离的 Nomi 窗口 + 一个常驻进程，之后每条命令几十毫秒回话。命令全在 `node tests/ux/ui.mjs <命令>`，在**本工作树根目录**跑（一个工作树只能有一只）。
先构建过（`pnpm run build`，`doctor` 会告诉你构建是不是旧的）。功能地图在 [features/README.md](features/README.md)：每个功能怎么走到、怎么驱动、有什么坑。

## Launch

```bash
node tests/ux/ui.mjs up                                   # 默认：隔离临时资料、中文、浅色、1280×800、空库
node tests/ux/ui.mjs up --locale en --theme dark --size 700x720
node tests/ux/ui.mjs up --data v0.24.0-library            # 带老用户数据起（只认登记过的名字：empty / v0.24.0-library / v0.20.0-library）
node tests/ux/ui.mjs up --out /某个仓库外目录               # 证据目录（默认系统临时目录下 nomi-verify/…，必须在仓库外）
```

- 第一行打印 `PROFILE 隔离…` 或 `PROFILE 真实资料…`，看清再往下走。READY 那行带用时、语言、主题、尺寸、数据和证据目录。
- 尺寸只有三档：`1280x800` / `1100x720` / `700x720`（窄窗 = 700）。
- 窗口不抢前台，可以照常干别的；不用等窗口、不用看前台是谁。
- 真实资料只在用户明确要时用：`NOMI_WALK_FOREGROUND_OK=1 node tests/ux/ui.mjs up --real-profile`（会抢前台、碰用户真数据；不设那个环境变量直接拒跑）。验收、复现一律隔离起。
- 已经起了一只：`up` 退出码 3 并说 pid——直接接着用（先 `doctor`），或先 `down`。

## Doctor

```bash
node tests/ux/ui.mjs doctor
```

只读，回答「这只值不值得驱动」：`ok`、我们自己的驱动 / 应用 pid 活着、隔离还是真实资料、构建戳是不是当前源码、语言 / 主题 / 尺寸和起的时候要的一样、`where`（现在在哪：`library` / `project:creation · storyboard-editor` / `settings:models` / `agent:ball`…）、页面报错数、`problems`。
`ok:false` 或 `problems` 非空就先修那一条（多半是 `build` 旧了：重新 `pnpm run build`，再 `down` / `up`），别在坏实例上取证。任何一步看着不对，先跑它。

## Drive

先按名字走到功能，再在那一屏上动手：

```bash
node tests/ux/ui.mjs features                 # 列出所有功能名
node tests/ux/ui.mjs goto storyboard          # 走到分镜编辑器（没有项目就像用户一样新建一个）
node tests/ux/ui.mjs goto canvas-node video   # 带参数的功能，参数跟在后面
node tests/ux/ui.mjs snap                     # 当前屏可点的东西：标签 / 文字 / aria / 中心坐标
node tests/ux/ui.mjs click 'aria:模型'         # 定位：aria:<aria-label> / text:<文字> / role:button=<名字> / css:<选择器> / xy:<x>,<y>
node tests/ux/ui.mjs fill 'css:[data-prompt-box] .ProseMirror' '远景，雨后天台'
node tests/ux/ui.mjs press Escape
node tests/ux/ui.mjs hover 'aria:设置'
node tests/ux/ui.mjs wait 500                 # 只在等动画落定时用；等元素用 goto / click 自带的等待
node tests/ux/ui.mjs read "document.querySelector('[data-parameter-summary]')?.getAttribute('data-parameter-summary')"
```

- `goto` 只经 `tests/ux/_shell.mjs` 等现成出口走（像人一样点），走不到会说卡在哪一步并留 `goto-<名>-failed` 截图；回执里的 `at` 是走到后 `doctor` 那行「在哪」。
- 定位优先 `aria:` 和 `css:[data-…]`（换语言不断）；`text:` 只在没有锚点时用。`click` 后会自动截一张 `live.<语言>.<主题>.png`。
- `read` 是只读探针：读 DOM、读属性、读文字。**不许**用它改状态、调 store、派事件——那是绕过界面，证明不了用户能做到。
- 设计实验室：`goto design-lab <屏> [状态]` 之后的 `shot` / `snap` / `click` / `read` 落在实验室页上；再 `goto` 任何应用里的功能就切回 Nomi 窗口。

## Evidence

```bash
node tests/ux/ui.mjs shot 01-before-switch    # → <证据目录>/01-before-switch.<语言>.<主题>.png
```

- 证据目录在仓库外（`up` 时打印；`doctor` 的 `out`）。截图名自动带语言和主题，中英两轨各截各的。每条命令按行记进同目录的 `commands.jsonl`，报错进 `errors.log`。
- 证明的规矩（缺一条就不算验证过）：
  1. **走用户的真路径**：`goto` + 点 / 填，不用 `read` 改状态、不调内部接口、不灌 localStorage。
  2. **两张图**：动作那一刻一张（点之前 / 菜单开着），结果一张（落定之后）。只有最后一屏不算。
  3. **改了数据就从第二个地方读回来**：界面上改的东西，从另一处再看到它——换个面看（切到列表视图、回项目库再进、重开分镜）或 `read` 读落盘后的状态；只看刚点的那个控件变没变不算。
  4. **截图自己打开看**（Read 那张图），不凭命令返回 ok 下结论。
- 报告里写：起的参数（语言 / 主题 / 尺寸 / 数据）、跑过的命令（`commands.jsonl` 就是清单）、截图路径、读回的值。

## Cleanup

```bash
node tests/ux/ui.mjs down                     # 只关这个工作树自己那一只（驱动 + 应用 + 实验室服务器），临时资料删掉，证据目录留着
```

- 不按进程名杀东西；`down` 30 秒没关掉才对**它自己记下的那个 pid** 发 SIGTERM。
- 关完证据还在 `up` 打印的那个目录里——报告前确认一下截图还在。
- 驱动卡死时：`down` 再 `up`（隔离资料每次都是新的，没有要留的状态）。

## Helpers

- `node tests/ux/ui.mjs <命令>`：客户端，上面所有命令；`node tests/ux/ui.mjs` 不带参数打印用法。
- `tests/ux/ui-driver.mjs`：常驻进程本体（`up` 会替你起，别直接跑）。
- `tests/ux/verifyFeatures.mjs`：功能名 → 到达步骤的表；加功能在这里加一项、在 `features/` 加一份地图，到达步骤只调 `_shell.mjs` 的出口（缺出口补进 `_shell.mjs`）。`check:walkthroughs` 核对地图和表对得上。
- `tests/ux/verify-features.walk.mjs`：把所有功能名走一遍的走查（不在快检里；改了外壳或出口后跑：`node tests/ux/verify-features.walk.mjs`）。
- `node scripts/verify-line-meter.mjs <线的临时目录>`：数一条验证线现写了几个驱动脚本、几行、用了几次驱动（量这只驱动省没省事）。
- 其它通用量具也在驱动里：`probe-latency`（点击到下一帧）、`fps-start` / `fps-stop`、`density`、`contrast`。
