# Contextual Video Generation Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each checkbox is a small TDD step with a concrete verification command.

**Goal:** 把真实模型能力事实、用户上下文和可编辑的 P2 生成草稿连接起来，让 Nomi 根据当前输入推荐合适的模型/模式/参数，同时不把任何供应商判断写成全局硬编码，也不创建第二条生成执行路径。

**Architecture:** 能力档案只保存逐项对账后的事实（模式、参数、参考槽、供应商限制和有来源的表达通道）；不再抽象一个跨模型的 `cameraControl`。纯推荐器读取候选档案与当前上下文，输出排序、理由、限制和下一步，不调用 provider、不铸 grant、不写 Run。推荐结果只作为 P2 `PlanCandidate` 的初始建议和 preview 投影，用户可以在封存前自由编辑；确认后由现有 `ExecutionContract` 冻结精确值，P3 统一 Runtime Adapter 只执行封存合同。

**Tech Stack:** TypeScript, Vitest, existing `ModelArchetype` catalog, `PlanCandidate`/`ExecutionContractV1`, MCP semantic generation handler, existing provider-neutral runtime adapter.

---

## Scope and non-goals

本计划覆盖：

- Seedance/APIMart 当前真实档案的通用化修正；
- Seedance、Veo、Runway、Luma、Kling 官方能力对照，以及共享能力层的真实证据边界；
- 模型/供应商/模式/参数/参考素材切换的上下文推荐；
- P2 MCP planning/preview 的推荐投影；
- 零额度真实 MCP journey、provider counter 和错误/限制投影测试；
- 计划、证据和下一决策点更新。

本计划不做：

- 不新增 provider、gateway、RuntimeTask 或 ProductionRun owner；
- 不把 `Seedance`、`APIMart`、`trajectory`、`adaptive` 等判断写进 dispatcher；
- 不在未确认前调用 provider、上传资产、铸 spend grant 或写 Canvas/Timeline；
- 不自动改写用户已选择的模型/模式/参数；
- 不在本计划内完成 P4–P7 的多镜、时间轴 Adopt、音频/审片扩展或完整 Editor。

## User-visible acceptance

用户在当前 MCP 客户端看到的是一张短预览：

```text
建议：Seedance 2.5 · 首尾帧 · 720p · 8 秒
原因：你提供了首帧和尾帧，当前模型支持这两张图之间的过渡
限制：首尾帧模式的比例由输入图决定
操作：编辑方案 / 确认生成
```

用户可以换模型、供应商、模式、参数和素材。每次编辑都重新生成候选 revision/hash；封存后编辑返回 `new_draft_required`。如果当前模型不支持用户输入，预览给出事实和唯一下一步，不静默丢字段，不伪造不存在的模式。

## Decision gate

本计划执行到以下状态后暂停汇报，不自行扩大范围：

1. 研究-backed 能力注册表和通用推荐器通过全门；
2. Seedance/APIMart 低规格真实视频 smoke 的请求映射、查询和降级 UX 有可复核证据；
3. 需要选择下一批真实 provider/model（只继续 Seedance/APIMart，还是扩展到其他已对账模型）时，提供用户价值/成本/覆盖面的对比表，由产品负责人决定。

在此之前默认自主推进，所有零额度测试和低规格验证额度已获授权。

---

## Research checkpoint — 2026-08-24

当前提交中的 `CameraControlStrategy` 是先前为了让推荐器有测试 seam 而做的临时抽象，已经被官方文档对照证明过窄：Seedance/Veo/Runway/Kling 主要通过 prompt 或参考素材表达，Luma 的 `trajectory` 是限定在 `video_edit` 的结构化运动条件，不等同于统一相机枚举。

正式共享原语改为模式级 `expressionChannels`：`signal + via(prompt/reference_slot/structured_parameter) + status(documented/unsupported/unknown) + 真实 slot/parameter path + source`。完整证据和用户价值见 `docs/research/2026-08-24-video-capability-shared-layer.md`。

因此下面原先围绕 `cameraControl/nativeIntents` 的实现步骤不再执行；先完成新的 capability facts，再继续推荐器和 MCP wiring。2.5 APIMart 官方页面本轮抓取返回 404，未重新核验前保持 `unknown`，不扩大承诺。研究结论已写入 `docs/research/2026-08-24-video-capability-shared-layer.md`，并在当前分支删除了临时字段。

共享 registry 的候选列表不再硬编码供应商模型名：Electron/stdio 从当前 catalog 构造视频候选；命中逐项对账档案才使用精确能力，未对账模型使用保守 unknown 档案。这样供应商缺少高级能力不会让基础能力被整体禁用，新增模型也不需要修改推荐器。

### Task 1: Replace provisional camera field with research-backed expression channels

**Files:**
- Modify: `src/config/modelArchetypes/types.ts`
- Modify: `src/config/modelArchetypes/seedanceApimart.ts`
- Modify: `src/config/modelArchetypes/seedance25Apimart.ts`
- Modify: `docs/research/2026-08-24-video-capability-shared-layer.md`
- Test: `src/config/modelArchetypes/modelArchetypeCapabilities.test.ts`

- [x] **Step 1: Write failing tests for expression channels and reference constraints**

Add tests that assert facts are read from the selected mode, not inferred from provider/model names:

```ts
it('declares Seedance prompt and motion-reference channels without a native camera enum', () => {
  const mode = SEEDANCE_2_APIMART_ARCHETYPE.modes.find((item) => item.id === 'omni');
  expect(mode?.expressionChannels).toEqual(expect.arrayContaining([
    expect.objectContaining({ signal: 'camera_motion', via: 'prompt', status: 'documented' }),
    expect.objectContaining({ signal: 'motion_reference', via: 'reference_slot', slotKind: 'video_ref', status: 'documented' }),
  ]));
  expect(mode).not.toHaveProperty('cameraControl');
});

it('keeps Seedance 2.0 audio dependency in the mode slot declaration', () => {
  const omni = SEEDANCE_2_APIMART_ARCHETYPE.modes.find((item) => item.id === 'omni');
  expect(omni?.slots.find((slot) => slot.kind === 'audio_ref')?.requiresAnyOf)
    .toEqual(['image_ref', 'video_ref']);
});

it('does not assume Seedance 2.5 has the Seedance 2.0 audio dependency', () => {
  const omni = SEEDANCE_2_5_APIMART_ARCHETYPE.modes.find((item) => item.id === 'omni');
  expect(omni?.slots.find((slot) => slot.kind === 'audio_ref')?.requiresAnyOf).toBeUndefined();
});
```

- [x] **Step 2: Run the focused test and verify it fails for the missing capability field**

Run:

```bash
pnpm exec vitest run src/config/modelArchetypes/modelArchetypeCapabilities.test.ts --reporter=dot
```

Expected: FAIL because `ArchetypeMode` has no `expressionChannels` field and the provisional camera field is still present.

- [x] **Step 3: Add the smallest typed capability declaration**

Add to `types.ts`:

```ts
export type ArchetypeExpressionChannel = {
  signal: string;
  via: 'prompt' | 'reference_slot' | 'structured_parameter';
  status: 'documented' | 'unsupported' | 'unknown';
  slotKind?: ArchetypeReferenceSlotKind;
  parameterKey?: string;
  parameterPath?: string;
  evidence?: ArchetypeSource;
};
```

Replace the provisional field with `expressionChannels?: ArchetypeExpressionChannel[]` on `ArchetypeMode`. Declare only evidence-backed Seedance facts in the APIMart mode profiles. Do not add provider-specific branching to the recommender, and do not normalize Luma `trajectory` into camera motion.

- [x] **Step 4: Run focused tests and typecheck**

Run:

```bash
pnpm exec vitest run src/config/modelArchetypes/modelArchetypeCapabilities.test.ts src/config/modelArchetypes/videoGenerationRecommendation.test.ts --reporter=dot
pnpm run typecheck
```

Expected: all focused tests pass and typecheck exits 0.

- [x] **Step 5: Commit the capability fact boundary**

```bash
git add src/config/modelArchetypes/types.ts src/config/modelArchetypes/seedanceApimart.ts src/config/modelArchetypes/seedance25Apimart.ts src/config/modelArchetypes/modelArchetypeCapabilities.test.ts
git commit -m "feat: declare model-specific video capability facts"
```

### Task 2A: Make the capability registry readable by Electron and renderer without a second truth

**Files:**
- Create: `electron/shared/videoCapabilities/*`
- Modify: `src/config/modelArchetypes/*` to consume/re-export the shared pure registry
- Modify: `electron/capabilityCore/appIntegration.ts`
- Modify: `electron/capabilityCore/mcpStdioServer.ts`
- Test: `electron/shared/videoCapabilities/*.test.ts`

- [x] **Step 1: Add a red bootstrap test**

Prove that the default GUI and stdio planning handlers receive the same source-backed Seedance candidate list and that no provider/start/spend path is called during preview. The test must fail while `videoModelCandidates` and `recommendVideoGeneration` are optional and unwired.

- [x] **Step 2: Move only pure facts and pure recommendation code behind a main-readable shared boundary**

The shared module may contain types, source-backed capability facts, pure recommendation logic and serialization-safe constants. It must not import React, i18n, Electron, filesystem code or provider clients. Renderer-facing modules re-export the shared values; Electron imports the same values directly. Do not copy APIMart profiles into Electron.

- [x] **Step 3: Wire both default planning entry points to the shared registry**

`startCapabilityCore` and `startMcpStdioServer` read the current catalog, resolve the same shared candidates and pure recommender, and pass them into `createGenerationPlanningHandler`. Existing authority injection remains an explicit test seam, but production defaults must no longer omit recommendations or assume a fixed provider model list.

- [x] **Step 4: Run focused tests, typecheck, source gate and diff check**

```bash
pnpm exec vitest run electron/shared/videoCapabilities electron/capabilityCore/mcpGenerationTools.test.ts electron/capabilityCore/nomiMcpGenerationPlanning.test.ts --reporter=dot
pnpm run typecheck
pnpm run check:archetype-sources
git diff --check
```

- [x] **Step 5: Commit the single-owner shared registry wiring**

```bash
git commit -m "feat: wire shared video capability registry into MCP planning"
```

### Task 2: Make the recommendation engine provider/model agnostic

**Files:**
- Modify: `src/config/modelArchetypes/videoGenerationRecommendation.ts`
- Modify: `src/config/modelArchetypes/videoGenerationRecommendation.test.ts`
- Test: `src/config/modelArchetypes/videoGenerationRecommendation.test.ts`

- [x] **Step 1: Add red tests for non-hardcoded camera and audio decisions**

Add tests with synthetic model profiles that expose different expression channels and one with no declared camera evidence. Add a profile whose audio slot has no dependency. The tests must prove that the recommender follows profile facts:

```ts
it('does not claim structured trajectory is available when only prompt camera expression is documented', () => {
  const promptCamera = withModeExpressionChannels(seedance20, 't2v', [{ signal: 'camera_motion', via: 'prompt', status: 'documented' }]);
  const result = recommendVideoGeneration({ prompt: '环绕镜头', cameraIntent: 'orbit' }, [promptCamera]);
  expect(result.recommendations[0]?.limitations.join(' ')).not.toContain('没有独立的轨迹控制');
});

it('derives audio-only next action from reference-slot dependencies, not APIMart name', () => {
  const audioOnly = withAudioSlotDependency(seedance20, undefined);
  const result = recommendVideoGeneration({ references: [{ kind: 'audio', role: 'audio' }] }, [audioOnly]);
  expect(result.recommendations).not.toHaveLength(0);
});

it('returns a generic unsupported-input action when all candidates reject the reference combination', () => {
  const result = recommendVideoGeneration({ references: [{ kind: 'audio', role: 'audio' }] }, [seedance20]);
  expect(result.nextAction).toContain('参考图或参考视频');
  expect(result.nextAction).not.toContain('APIMart Seedance');
});
```

- [x] **Step 2: Run the focused tests and verify the old hardcoded behavior fails**

```bash
pnpm exec vitest run src/config/modelArchetypes/videoGenerationRecommendation.test.ts --reporter=dot
```

Expected: FAIL on the native-orbit and generic audio cases.

- [x] **Step 3: Replace hardcoded decisions with profile-driven helpers**

Implement these rules in `videoGenerationRecommendation.ts`:

1. `buildLimitations` reads `mode.expressionChannels`; prompt/reference/structured channels are described accurately, and an absent or unknown channel never becomes a false “unsupported” claim. Structured trajectory is only mentioned when the selected mode declares that exact parameter path.
2. The no-recommendation action is derived from candidate slot dependencies. It may mention “再添加参考图或参考视频”，but it must not mention a provider or model name.
3. Keep `fixedParams` and `requiresAnyOf` as profile facts. The generic recommender only reads them.
4. Keep recommendation output advisory: `score`, `reasons`, and `limitations` are projections; they must not mutate the candidate or call a provider.

- [x] **Step 4: Run focused tests, full archetype tests, lint and typecheck**

```bash
pnpm exec vitest run src/config/modelArchetypes/modelArchetypeCapabilities.test.ts src/config/modelArchetypes/videoGenerationRecommendation.test.ts --reporter=dot
pnpm exec eslint src/config/modelArchetypes/types.ts src/config/modelArchetypes/seedanceApimart.ts src/config/modelArchetypes/seedance25Apimart.ts src/config/modelArchetypes/videoGenerationRecommendation.ts src/config/modelArchetypes/modelArchetypeCapabilities.test.ts src/config/modelArchetypes/videoGenerationRecommendation.test.ts
pnpm run typecheck
```

Expected: all tests pass, eslint has no new errors, typecheck exits 0.

- [x] **Step 5: Commit the generic recommendation engine**

```bash
git add src/config/modelArchetypes/videoGenerationRecommendation.ts src/config/modelArchetypes/videoGenerationRecommendation.test.ts
git commit -m "refactor: derive video recommendations from capability facts"
```

### Task 3: Preserve reference roles in the editable P2 contract

**Files:**
- Modify: `electron/capabilityCore/executionContract.ts`
- Modify: `electron/capabilityCore/mcpGenerationTools.ts`
- Modify: `electron/capabilityCore/executionContract.test.ts`
- Modify: `electron/capabilityCore/mcpGenerationTools.test.ts`

- [x] **Step 1: Add red tests for role-preserving edits and stable hashes**

Extend the P2 tests with optional reference context:

```ts
it('preserves reference kind and role in the sealed contract', () => {
  const candidate = makeCandidate({
    references: [{ assetId: 'asset-character', contentHash: 'c'.repeat(64), version: 1, kind: 'image', role: 'character' }],
  });
  const contract = compileExecutionContract(candidate, registry);
  expect(contract.references[0]).toMatchObject({ kind: 'image', role: 'character' });
});

it('changing only a reference role creates a new candidate revision and contract hash', () => {
  const original = makeCandidate({ references: [{ assetId: 'asset-a', contentHash: 'a'.repeat(64), version: 1, kind: 'image', role: 'character' }] });
  const changed = applyPlanCandidatePatch(original, { references: [{ ...original.references[0]!, role: 'first_frame' }] });
  expect(changed.revision).toBe(original.revision + 1);
  expect(compileExecutionContract(changed, registry).contractHash).not.toBe(compileExecutionContract(original, registry).contractHash);
});
```

- [x] **Step 2: Run the focused tests and verify the fields are currently dropped**

```bash
pnpm exec vitest run electron/capabilityCore/executionContract.test.ts electron/capabilityCore/mcpGenerationTools.test.ts --reporter=dot
```

Expected: FAIL because `PlanAssetReference` and `candidateFrom` discard `kind`/`role`.

- [x] **Step 3: Add optional typed context without breaking legacy drafts**

Add optional fields to `PlanAssetReference`:

```ts
kind?: 'image' | 'video' | 'audio';
role?: 'character' | 'first_frame' | 'last_frame' | 'reference' | 'audio';
```

Update `candidateFrom` to validate and retain these fields when present. Existing references without context remain valid. Contract hashing must include the optional fields when supplied, so the sealed request conserves the user’s role choice.

- [x] **Step 4: Run focused tests and all contract tests**

```bash
pnpm exec vitest run electron/capabilityCore/executionContract.test.ts electron/capabilityCore/mcpGenerationTools.test.ts electron/capabilityCore/productionGenerationOperationStore.test.ts --reporter=dot
pnpm run typecheck
```

Expected: all tests pass; old fixture drafts remain readable.

- [x] **Step 5: Commit the P2 reference context**

```bash
git add electron/capabilityCore/executionContract.ts electron/capabilityCore/mcpGenerationTools.ts electron/capabilityCore/executionContract.test.ts electron/capabilityCore/mcpGenerationTools.test.ts
git commit -m "feat: preserve reference roles in generation contracts"
```

### Task 4: Integrate recommendations into semantic planning and preview

**Files:**
- Modify: `electron/capabilityCore/mcpGenerationTools.ts`
- Modify: `electron/capabilityCore/mcpGenerationTools.test.ts`
- Modify: `electron/capabilityCore/nomiMcpGenerationPlanning.test.ts`
- Modify: `electron/capabilityCore/mcpToolResults.ts` only if the existing structured result needs a new optional recommendation projection

- [x] **Step 1: Add a red handler test for recommendation-only create/preview**

Inject a pure recommender dependency and assert that create/preview returns a recommendation without calling `start`, `runTask`, gateway, provider or spend:

```ts
it('returns an editable contextual recommendation during preview without provider side effects', async () => {
  const recommend = vi.fn(() => ({ recommendations: [{ provider: 'apimart', modelKey: 'doubao-seedance-2.5', modeId: 'firstlast', modeLabel: '首尾帧', params: { duration: 8 }, editableParams: ['duration'], reasons: ['提供了首帧和尾帧'], limitations: [], score: 175 } ] }));
  const handler = createGenerationPlanningHandler({ registry, operations, recommendVideoGeneration: recommend, now: fixedNow });
  const preview = await handler({ capability: 'preview', lease, params: { operationId } });
  expect(preview).toMatchObject({ recommendation: { recommendations: [{ modeId: 'firstlast' }] } });
  expect(start).not.toHaveBeenCalled();
  expect(runTask).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Run the focused test and verify the handler has no recommendation seam**

```bash
pnpm exec vitest run electron/capabilityCore/mcpGenerationTools.test.ts --reporter=dot
```

Expected: FAIL because the handler does not accept or project a recommender.

- [x] **Step 3: Add the pure recommendation seam and projection**

Extend `GenerationPlanningHandlerDependencies` with an optional `recommendVideoGeneration` function. On `create` and `preview`, call it only when the candidate/module is video and the caller supplies enough typed context. Return it as an optional `recommendation` field alongside the existing `contract`, `providerReady`, and `recoveryNotice` fields. Do not replace the candidate automatically. If the caller explicitly edits provider/model/mode/parameters/references, recompute the recommendation from the new candidate/context before preview.

The handler must continue to use `compileExecutionContract` for the final contract. The recommendation is never part of the contract hash and never authorizes a start.

## Execution checkpoint — 2026-08-24

Completed and verified on the isolated branch:

- capability facts for Seedance expression channels and 2.0/2.5 reference-audio differences;
- provider/model-agnostic recommendation logic;
- P2 reference `kind`/`role` preservation and hash changes;
- Electron planning handler recommendation DTO seam and preview projection;
- single-owner Electron/renderer shared capability registry and default MCP planning wiring;
- 123 focused assertions across capability, recommendation, contract and MCP planning suites;
- `pnpm run typecheck` and `git diff --check`.

The next step is deliberately paused at one architecture decision. The pure recommender currently lives with the renderer model archetype catalog, while the semantic planning owner runs in Electron. Importing the renderer catalog directly into Electron violates the Electron `rootDir` boundary and would pull unrelated UI/i18n code into the main-process build. Duplicating Seedance profiles in Electron would create the exact second truth source this plan is meant to avoid.

Recommended decision: move the capability facts and pure recommendation implementation into one shared, main-readable capability registry. Both renderer controls and MCP planning should consume that registry; the P2 contract remains the only execution authority. The alternative is renderer-only injection, which leaves headless MCP without recommendations when Nomi is closed.

Decision resolved: the user selected the shared-registry option. The first slice moved the recommender and Seedance APIMart facts. Follow-up inspection showed that the existing GUI catalog already owns complete model/mode/parameter/reference facts for the other curated video models; therefore the continuation must reuse those facts instead of re-researching or recreating them. Official documentation is consulted only for a concrete conflict, missing fact or stale declaration.

- [x] **Step 4: Add MCP journey tests for free editing**

In `nomiMcpGenerationPlanning.test.ts`, add one zero-provider journey that:

1. creates a video candidate with a character image;
2. previews and receives a character/reference recommendation;
3. edits the provider/model/mode and replaces the reference with first+last frame;
4. previews again and receives a first/last recommendation;
5. changes duration and a model-specific parameter;
6. asserts candidate revision and contract hash change on every edit;
7. asserts `runTask`, provider submit, gateway and spend counts stay zero.

- [x] **Step 5: Run focused MCP suites and typecheck**

```bash
pnpm exec vitest run electron/capabilityCore/mcpGenerationTools.test.ts electron/capabilityCore/nomiMcpGenerationPlanning.test.ts electron/capabilityCore/mcpSemanticGenerationConfirmation.test.ts --reporter=dot
pnpm run typecheck
```

Expected: all tests pass and no pre-confirmation side effect occurs.

- [x] **Step 6: Commit the P2 recommendation integration**

```bash
git add electron/capabilityCore/mcpGenerationTools.ts electron/capabilityCore/mcpGenerationTools.test.ts electron/capabilityCore/nomiMcpGenerationPlanning.test.ts electron/capabilityCore/mcpToolResults.ts
git commit -m "feat: project contextual video recommendations in MCP planning"
```

### Task 5: Cover realistic model/provider/input variation

**Files:**
- Modify: `src/config/modelArchetypes/videoGenerationRecommendation.test.ts`
- Modify: `electron/capabilityCore/nomiMcpGenerationPlanning.test.ts`
- Create: `docs/audit/2026-08-24-video-capability-research.md`

- [x] **Step 1: Add the scenario matrix as failing contract tests**

The matrix must include at least:

| Scenario | Expected behavior |
|---|---|
| no references + short target | text-to-video candidate is recommended when supported |
| character image | character/omni/reference mode outranks text-only mode |
| first + last frame | first/last mode is selected only on profiles declaring it |
| reference video | video-reference mode is selected only when the slot exists |
| audio-only on a model with dependency | no recommendation; generic next action asks for required companion input |
| audio-only on a model that supports it | recommendation is available |
| user chooses unsupported parameter | preview explains and blocks that field; no silent drop |
| user replaces a reference | revision/hash changes; old sealed operation is unchanged |
| provider/model switch | recommendation re-evaluates against the new profile, not old model rules |
| prompt-only camera expression profile | no false claim of native trajectory control |

Run the new tests before implementation changes to verify each missing behavior is red.

- [x] **Step 2: Implement only the smallest missing behavior per failing test**

Do not add provider-name conditionals. Add or correct only capability declarations, context normalization, recommendation scoring, or preview projection required by the failing scenario.

- [x] **Step 3: Add a zero-provider MCP JSON-RPC journey against the durable Run owner**

`electron/capabilityCore/nomiMcpGenerationPlanning.test.ts` drives the actual MCP JSON-RPC protocol through `initialize → operation/create → preview → plan edits → preview` against a durable temporary Run and records:

- one screenshot or structured output for the initial recommendation;
- one after changing model/mode/reference;
- one unsupported-input explanation;
- provider request count = 0;
- spend grant count = 0;
- Canvas/Timeline write count = 0.

The journey must not require the user to learn internal names such as `ExecutionContract`, `WAL`, `fencingEpoch` or `capability enum`.

- [x] **Step 4: Run the matrix and journey**

```bash
pnpm exec vitest run src/config/modelArchetypes/videoGenerationRecommendation.test.ts electron/capabilityCore/nomiMcpGenerationPlanning.test.ts --reporter=dot
pnpm exec vitest run electron/capabilityCore/nomiMcpGenerationPlanning.test.ts --reporter=dot
```

Expected: all assertions pass, zero provider quota/network calls, and output contains a single clear next action for unsupported combinations.

- [x] **Step 5: Update the evidence document**

Record the exact test commands, counts, scenarios, zero-side-effect counters, and known limitations in `docs/audit/2026-08-23-p1-p3-evidence.md`. Explicitly state that recommendation is advisory before sealing and that the sealed contract is the only execution authority.

- [x] **Step 6: Commit the realistic variation coverage**

```bash
git add src/config/modelArchetypes/videoGenerationRecommendation.test.ts electron/capabilityCore/nomiMcpGenerationPlanning.test.ts tests/ux/mcp-generation-editable-context.e2e.mjs docs/audit/2026-08-23-p1-p3-evidence.md
git commit -m "test: cover editable model and reference generation journeys"
```

### Task 6: Review, gates, and decision package

**Files:**
- Modify: `docs/plan/2026-08-23-video-generation-parameter-research.md`
- Modify: `docs/research/2026-08-23-video-generation-parameter-selection.md`
- Modify: `docs/audit/2026-08-23-p1-p3-evidence.md`

- [x] **Step 1: Run scoped review checks**

```bash
git diff --check
pnpm exec eslint src/config/modelArchetypes electron/capabilityCore/mcpGenerationTools.ts electron/capabilityCore/executionContract.ts
pnpm run typecheck
```

- [x] **Step 2: Run the complete project gates**

```bash
pnpm run check:filesize
pnpm run check:tokens
pnpm run check:i18n
pnpm run lint:ci
pnpm run typecheck
pnpm run test
pnpm run build
```

Expected: all commands exit 0; existing warning baseline does not increase.

- [x] **Step 3: Run the user-visible MCP journey and inspect its evidence**

```bash
pnpm run test:mcp-journey
pnpm exec vitest run electron/capabilityCore/nomiMcpGenerationPlanning.test.ts --reporter=dot
```

Read the produced screenshot/structured output and verify the same build and entry point show:

- concise recommendation;
- user-editable model/mode/parameter/reference choices;
- no internal jargon;
- one primary confirmation action;
- unsupported cases explain the reason and next step;
- no second confirmation before the same sealed contract starts.

- [x] **Step 4: Update the plan status and open the only decision package**

Report:

1. P0–P3 current implementation/evidence status;
2. model/provider/mode/reference scenario counts;
3. provider/spend/Canvas/Timeline counters;
4. remaining provider capability limits;
5. comparison of the next provider scope options.

Stop only at the provider-scope decision described above; do not start P4–P7 work in this slice.

**Completed evidence (2026-08-24):** scoped review PASS; full project gates PASS (699 files / 6175 tests, one skipped); real MCP smoke PASS (45 assertions, 10 steps, six mock-vendor requests, zero provider quota); catalog-backed editable journey PASS (Seedance standard/fast/mini, Veo, Hailuo; aliases, invalid variants, variant parameter limits, same-model edits). A user-authorized GUI smoke in the isolated branch runtime exercised the visible confirmation flow end to end: 即梦 Seedance 2.0 reached the real provider and was rejected for account permission; a separate APIMart GUI run (16:9/480p/6s) recorded `provider=apimart`, `model=grok-imagine-1.5-video-apimart` and a provider task ID. Its first media view briefly showed a load timeout, but the task completed, the MP4 was materialized locally, technical review passed, and after the local media-stream/StrictMode cleanup fix the project reopened with playable controls and a real play action; no duplicate provider submission occurred. The earlier non-interactive APIMart smoke still correctly stopped before provider because it had no client confirmation surface, and the same externally supplied key returned HTTP 401 from the direct curl path; these are different transport/credential observations, not grounds to redesign the shared abstraction. This does not make Nomi the only confirmation surface: the intended path is confirmation in the active MCP client when it supports elicitation, with Nomi as fallback. The remaining decision is operational (which client/provider credential to use for a paid online acceptance run), not a reason to redesign the shared abstraction.

### Task 7: Reuse every existing curated video profile in shared planning

**User value:** changing from Seedance to Sora, Veo, Kling, Wan, Hailuo, Vidu or another already-integrated APIMart video model must preserve the same editable modes and parameters the GUI already exposes. MCP must not reduce known models to a generic text/image fallback, and values from the previous model must not leak into the newly selected model.

**Scope:** this task does not invent capabilities, change provider payloads, or re-audit every official document. It moves the existing pure video profile facts to the shared owner, keeps renderer imports as compatibility re-exports, and validates the existing catalog-to-request path.

**Context rule:** the GUI is the first place to inspect for product context. Before adding an MCP recommendation field or model abstraction, trace the GUI's archetype, variant, mode, reference-slot and mapping inputs. MCP may share that owner or add a genuinely missing fact, but must not create a parallel simplified catalog.

- [x] **Step 1: Add the all-curated-model red test**

Enumerate `APIMART_VIDEO_MODELS`. For every seeded catalog row, require `buildVideoModelCandidates` to resolve its exact `archetypeId`, use provider-specialized parameters, and expose only modes backed by an existing transport mapping. Add a model-switch case proving Sora-only fields do not survive a switch to Hailuo and vice versa.

- [x] **Step 2: Establish one shared owner for the existing video profiles**

Move the pure APIMart video archetype declarations into `electron/shared/videoCapabilities/`. Replace the renderer declarations with compatibility re-exports. Extend the catalog candidate input with the existing `meta.archetypeId` pointer so exact identity wins over fuzzy model-key matching. Keep unknown/user-added catalog models on the conservative fallback.

- [x] **Step 3: Validate the existing request contracts without provider spend**

For every APIMart seeded video model/mode, render the real HTTP request template with its current defaults and assert: required model identity is present; declared reference slots reach a compatible wire field; parameters belong to the selected profile; switching profiles does not retain unsupported keys; sensitive headers are not exposed. Reuse the existing catalog/request pipeline and tests rather than creating a second serializer.

- [x] **Step 4: Inventory paid evidence and avoid duplicate smoke**

Inventory existing successful paid evidence first. Existing Seedance, Sora, Veo, Omni, Hailuo, Vidu, Kling Turbo, HappyHorse and Wan evidence already covers the distinct APIMart wire shapes (role-object frames, ordered arrays, single first-frame string, reference image, text-to-video and async task query). No new paid smoke is required to accept this planning slice. A user-authorized shortest/lowest-resolution/audio-off Seedance smoke was attempted after the slice: the non-interactive test entry had no client confirmation surface, so Nomi correctly stopped before provider; the direct curl path separately returned HTTP 401, and no provider task or quota was created. The follow-up isolated GUI smoke validated the actual user-facing confirmation and async provider path with a 6-second APIMart Grok request, which recorded a provider task before a result-load timeout; it did not masquerade as Seedance online evidence. If a future provider exposes a genuinely new unverified shape, run only that shortest/lowest-resolution/audio-off case; do not run one paid generation per alias/variant. Stop for user approval only if the remaining necessary smoke set has material cost, requires new credentials, or the provider gives conflicting behavior.

- [x] **Step 5: Run full gates and update evidence**

Run the focused matrix, all catalog/request tests, `check:filesize`, `check:tokens`, `check:i18n`, `lint:ci`, `typecheck`, full test and build. Record exact model/mode coverage, reused paid evidence, new spend and any provider limitation. Commit only scoped files.

- [x] **Step 6: Walk the real GUI catalog through the MCP editing journey**

Use the same catalog-backed profiles that the GUI exposes and drive one zero-cost JSON-RPC journey through Seedance → Veo → Hailuo. The journey changes model, mode, reference role and parameters, then previews after each edit while asserting that `runTask`, provider submission, gateway creation and spend remain at zero. The catalog is seeded from the existing `APIMART_VIDEO_MODELS` rows and `createCatalogModuleRegistry`; the test deliberately keeps Seedance's single base row and edits its GUI-owned `standard` / `fast` / `mini` variant identity. Context exposes those variants and their specialized parameter controls to MCP; aliases normalize to canonical IDs, unknown variants fail before preview, and variant-specific unsupported values are rejected by the same execution contract. Every recommendation is checked against the selected model/variant, not only the first result. During this pass a real UX defect was found and fixed: once a user selects a model that exists in the catalog, recommendation candidates are scoped to that model (with exact model identity taking precedence over aliases), so preview cannot silently put another model first. If a configured model is not yet represented in the catalog, the existing provider/catalog fallback remains available rather than blocking the user.
