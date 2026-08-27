# pi AgentSession compatibility probe (R0): historical record

The isolated R0 implementation and synthetic Electron probe are preserved in
commit [b4a3f466](https://github.com/aqm857886159/Nomi/tree/b4a3f466813b1f4defa179e5b26b4100b0f5c8f9/experiments/pi-agent-runtime).
They are no longer a second runnable implementation in the working tree.

The verified adapters now live in the private production ESM island at
[electron/harness/runtime/pi](../../electron/harness/runtime/pi/). The four
original compatibility suites and their local HTTP fixture now live in
[tests/agent-runtime](../../tests/agent-runtime/) and run from the repository
root:

```sh
pnpm run test:agent-runtime
pnpm run check:test-types
pnpm run build:electron
```

The SDK stays pinned to `0.84.3`; the suites use real SDK sessions and localhost
HTTP/SSE with synthetic credentials, not paid providers or user projects.
The root test, type and build gates include this private island. B0 only moves
and wires the verified code; it does not switch the product Agent facade.

See the [R0 verification report](../../docs/audit/2026-08-26-pi-r0-verification.md)
for the historical 48-test, development-Electron and synthetic-ASAR evidence.
Those probe results are **not** a formal Nomi application packaging check.
Formal product/ASAR verification belongs to the later R1 cutover gate.

Ignored local `node_modules`, `dist` and `release` artifacts are retained as
historical outputs. They are not the current source or a current test result.
