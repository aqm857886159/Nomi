# 自动检查更新（设计卡）

改动名：打包正式版启动后自动检查更新 + 检查失败原因上报　线：L-autoupdate　类别：其他（不碰花钱 / 长跑 / 可打断 / 新界面；提示走现有角标）

## 背景

0.22、0.23 都不自动检查：主进程唯一的 `checkForUpdates` 只由「关于」里的按钮和更新框的「重试」触发。停在旧版的人永远不知道有新版。检查失败的上报只有 `action=check, result=failure`，分不出是开发版、非正式版还是真网络错误。

## 设计卡（★5 格）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我开着 Nomi 用，新版发布后，我希望右上角出现已有的「有新版本」小角标（不弹框、不抢焦点），点它才看详情。启动后 30 秒首查，之后每 6 小时一查。不做什么：不弹模态、不自动下载、不自动安装；开发版 / 非正式版（RC、预览）不查；有下载在进行或已下载完不再查。已知坑：mac 未签名包不能就地装，角标点开后按钮是「前往下载页」，由主进程 `canAutoInstall` 判定。真实任务：旧版（0.22.x 打包）启动 → 30 秒后角标出现；点「稍后」后同一版本本次运行内不再出现；断网时不出现任何错误提示。 | `electron/update/autoCheck.test.ts`；人工（不起真 App，见交货报告） |
| ★2 谁说了算 | 「更新状态」归主进程 `electron/update/autoUpdater.ts`；渲染层 `useUpdater` 只订阅事件。调度器是纯函数模块 `autoCheck.ts`（定时、门条件、版本去重、失败分类），`autoUpdater.ts` 只负责接线。只碰一个概念（更新检查）。 | `node scripts/door-map.mjs checkForUpdates`：入口只有 `nomi:update:check` IPC，新增调度器入口，二者共用同一个 `runCheck` |
| ★3 一致与复用 | 复用现有 `autoUpdater.checkForUpdates`、现有事件广播、现有 `UpdaterDialog` 角标（`badgeVisible` 路径，本来就是「后台事件不抢焦点，只有点击才开详情」）。不写第二套提示。定时器是通用能力但只有几行，用 `setTimeout` 自链，不引依赖。 | `git grep updater-badge` |
| ★4 全状态 | 自动检查「静默」：不广播 checking（不闪「检查中」），出错不广播 error（角标不会因后台失败变红），无新版不广播。只有发现新版才广播 available → 角标。手动检查行为完全不变。用户点角标 → 现有更新框；「稍后」→ 回到角标。文案全是已有 i18n，无新增文案。 | 测试 |
| ★9 验收与回滚 | 验收：`vitest run electron/update electron/telemetry`；无头走查不涉及（无新界面）。回滚：revert 本分支提交；调度只由 `autoUpdater.ts` 里一处 `startAutoCheck()` 启动，删掉即回到旧行为。 | 提交 SHA |

## 数值与理由

- 首查延迟 30 秒：启动期要加载项目、渲染、模型表，不和它们抢网络与 CPU；又足够短，让「开了就用」的人当次会话就能看到。
- 间隔 6 小时：桌面软件通常一天开着几小时到十几小时；6 小时一天最多 4 次请求，只拉一个 latest.yml，对 GitHub 无压力，又能保证发版当天开着的人大概率当天看到。
- 失败了不加快重试，等下一个 6 小时（避免断网时反复刷）。

## 失败原因上报

`update.action` 失败时多一个 `reason`，白名单枚举 `network | parse | other`，只在 `result=failure` 时允许出现，成功事件不许带；旧队列里没有 reason 的失败事件仍然合法。`not-packaged`（开发版）与 `non-stable`（非正式版）本来就不是「用户的检查失败了」：不再上报任何事件，因此枚举里不留这两个永不出现的值。不带自由文本、不带网址。
