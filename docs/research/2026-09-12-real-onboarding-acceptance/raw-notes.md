D1  「用 AI 帮我接入」卡上选了 Codex，点「去接入」落到「自动化与权限」页，MCP 面板仍默认停在 Claude Code——宿主选择没有跟着走，用户要在第二个地方再选一次。
    证据：codex-p2-01-host-selected.png（卡上 Codex 高亮）→ codex-p3-01-mcp-connections.png（面板标题「一键接入 Claude Code」）
    src/ui/onboarding/AiAssistedOnboardingCard.tsx:159 onOpenAssistantConnections 只切 tab，不传 host
D2  一键写出的 MCP 配置永远指向 /Applications/Nomi.app（installedMacLauncher），哪怕当前跑的是另一棵树的构建。
    electron/capabilityCore/mcpConfig.ts:225-229 launcherEntry()：dev 构建只要机器上装过 Nomi.app 就写装机版路径。
D3  app 每次启动都会把客户端配置里的 nomi 块重写回「当前 launcherEntry」。手工改过的配置（指向别的构建/别的库）会被静默覆盖。
D4  改 HOME 起的实例存不了 key：「System secure storage is unavailable; the API credential was not saved.」
    截图 codex-v1-key-after-1.png。不是产品 bug，是走查隔离的约束，但它说明 key 保存失败时的提示只出现在页面底部、不阻断，agent 侧完全看不到。
D5  nomi_list_models 的描述写「Use it when: Before every other call here」，题库 tests/fixtures/tool-selection/2026-09-11-onboarding-bank.json
    的 connect-by-name-zh 期望第一跳是 nomi_model_setup:connect_provider。真实 Codex 三次全部先调 list_models —— 听说明书的，题库判它错。
