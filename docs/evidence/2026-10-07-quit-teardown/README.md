# L-quitsafe evidence

The lane IPC command was deliberately forced to return `agent_lane_disposed` in an isolated Electron run. The project still opened and the Agent resident panel showed the localized failure explanation with its recovery action.

- [中文失败态](agent-lane-open-failure-zh.png)
- [English failure state](agent-lane-open-failure-en.png)

The screenshots were read visually after capture. The real Electron quit receipt is produced by `tests/ux/quit-teardown-real.e2e.mjs`.
