# 多会话同开 MCP 会串库：报「项目不存在」别重试、别改用当前 id

> 📎 教训 · 首次记录 2026-08-18 · 状态：现行（老行为已由 advert v2 大幅缓解）
> **触发场景**：`nomi_list_projects` 突然返回**完全不同的一套项目**（尤其只剩走查 fixture）、自己刚建的项目变成「项目不存在」；或 MCP 调用报 `Nomi did not become ready within 60 seconds` / `launcher exited before MCP was ready`。

**结论**：这不是数据丢失，是**串库**——另一个并发会话把 Nomi 的项目库指到了走查 fixture 上，MCP 读的是「当前库」，不是你建项目时那个库。**报「项目不存在」时先别重试，更别改用当前列表里的项目 id 继续写**——那是往别人的走查库里写数据。

2026-08-17 实测：同一台机器上多个会话各挂 `nomi` MCP，出现多个 `mcpNodeLauncher` 助手进程（当时 3 个），**共用同一个打包版 Nomi.app（单实例）**。串库后只剩两个走查 fixture 项目，原项目在磁盘上完好（`~/Documents/Nomi Projects/<名>-<slug>/.nomi/project.json`，当时 22KB，14 节点 + 23 边 + 4 张生成图都在）。

**为什么会踩**（2026-08-18 代码审计定位）：launcher 靠 `~/.nomi/capability-core/instance.json` 发现要连的实例（`electron/capabilityCore/mcpNodeLauncher.ts` 附近，`BOOT_TIMEOUT_MS=60s`）。旧版 advert **没校验「哪个库」，谁最后写谁赢**；fixture 库来自并发会话用 `NOMI_PROJECTS_DIR` 起的走查宿主抢注了 advert。`code=0` 退出 = 输掉 Nomi 单实例竞争的兄弟进程正常退出。advert 失效后每次 MCP 调用会盲等满 60s 再报 "did not become ready"。库指针不持久化——重启 Nomi 即回真实库。

**2026-08-18 已修（T6，advert v2）**：上面「盲等满 60s 再报含糊错」「谁后写谁赢」的老行为**不再成立**——

- advert 升 v2，带 `projectsRoot` 指纹 + `heartbeatAt` 心跳（app 每 15s 刷）；派生 / 校验 / 路径收在 `electron/capabilityCore/instanceAdvert.ts` 一处纯函数（写读同吃）。
- **非默认库**（自带 `NOMI_PROJECTS_DIR`，走查 / fixture 宿主就是）的 advert 落 `instance-<hash>.json`，**结构上抢不到**生产的 `instance.json` → 串库从源头堵死。
- launcher 握手（`mcpNodeLauncher.ensureLiveInstance`）按 verdict 分诊：库不匹配 → **秒级**报「连到库 X vs 你要库 Y + 重启 Nomi / 关掉占用会话」；心跳陈旧（>45s）→「实例失联，重启 Nomi」；旧版 v1 →「旧版格式，重启 Nomi」；只有真冷启（进程死 / 无广告）才走满 60s。

**怎么用**：

1. 现在若真是串库，会**直接读到人话错误**（含两个库名 + 怎么办），不必再手动数进程。
2. 仍要落地核查时：`ls ~/Documents/Nomi\ Projects/` 找项目目录，看 `.nomi/project.json` 大小 / mtime 确认数据在。
3. `ps -eo pid,lstart,command | grep mcpNodeLauncher` 数一下有几个助手进程 = 有几个会话在抢。
4. **解法在用户侧**：关掉另一个会话的 Nomi MCP，或重启 Nomi，让桥接重新挂回真实库。执行体这一侧没法自己切库。
5. 长任务（跑一整部片子这种）开工前先 `nomi_list_projects` 确认库是对的，并**尽早把关键产物路径记下来**（生成图落在 `<项目目录>/assets/generated/<日期>/`），断连后还能凭磁盘接着干。

**出处**：2026-08-17 实测 + 2026-08-18 代码审计；修复计划 `docs/plan/2026-08-18-mcp-experience-overhaul.md`（T6 已落地）。
