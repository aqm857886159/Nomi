# Native multimodal input: independent review

Reviewer: `native_input_acceptance` (independent of the input, transport and configuration implementation agents).
Reviewed on Windows on 2026-11-09. Integrated production commit: `2da3ba2578154fe1362267e2dfc78fd3ad15cd28`; the root integration test and validation documentation were still uncommitted during this review.

Scope: verify that selected original audio/video bytes reach the model alongside text/images, that invalid inputs fail before dispatch, and that follow-up/history, protocol configuration and existing transport controls remain meaningful. This report does not declare the complete feature delivered.

## Reproducible validation

From the root worktree:

```powershell
Set-Location 'C:\Users\admin\Documents\ChatGPT\Nomi-native-multimodal'
pnpm exec vitest run electron/agentLane/nativeMultimodal.integration.test.ts electron/agentLane/laneNativeMediaInput.test.ts electron/agentLane/laneGoogleTransport.test.ts electron/shared/textModelInput.test.ts src/ui/onboarding/ModelCapabilityEditor.nativeInput.test.tsx electron/ai/nativeFilePayload.test.ts electron/textTaskNativeMedia.test.ts
git diff --check
```

Observed final test result at 17:25:42 local time: **7 test files passed, 41 tests passed**, duration 3.49 seconds. `git diff --check` exited 0 without output.

The checks exercise the production model-call boundary and real SDK serializers using injected local transports. The integrated mixed-input test also exercises the real AgentHarness and its payload hooks, then sends a follow-up and checks that the original image/audio/video payloads remain present. They validate request fidelity, not the semantic quality of a remote model's understanding.

Additional reviewed coverage:

- Original media preserves its exact bytes and MIME instead of becoming a transcript, extracted frames or a summary.
- Native media is represented by Nomi file types and ephemeral bound handles, rather than falsely labelling audio/video as SDK image content.
- Persisted input keeps canonical project asset claims; native bytes and bound handles are reconstructed for requests.
- Compaction retains original attachment-bearing input claims and excludes private handles/base64 media from its textual summary request; a fresh lane rehydrates those claims.
- Unsupported input, missing originals, invalid MIME/bytes, unresolved bindings and aggregate request-size violations fail explicitly.
- The existing composer already accepts audio/video files. The model capability editor saves an explicit model-local protocol override and media capability flags while preserving unrelated metadata.
- The Google adapter uses Nomi's injected fetch without changing global fetch. Gateway prefixes and query parameters, custom headers, exact model identity, AbortSignal, usage and valid thought-signature/tool replay are covered.

## Findings resolved during review

### Gateway query parameters

A real SDK request using a base such as `https://relay.invalid/prefix/v1beta?route=a` originally appended the method suffix into the query value. The implementation now supplies a query-free SDK base and reattaches the configured query in the bound transport, preserving duplicate parameters while retaining SDK-generated parameters. The regression checks the exact path and duplicate tags.

### Payload-hook exceptions were not a fail-closed boundary

The pinned AgentHarness catches `before_payload` hook exceptions, reports them and can continue with its original payload. A direct HookRegistry reproduction confirmed that an exception alone returned the unchanged native-file handle. The provider now rejects unresolved native-file handles after awaiting the harness hook, outside that swallowed-error boundary. Real AgentHarness regression cases cover all four protocols and assert zero fetch calls.

### Aggregate memory admission

A per-file bound followed only by a final aggregate JSON check could read and encode many historical files before rejecting them. The implementation now shares a NativeMediaBudget across the request projection/history, reserves encoded sizes from available metadata before bounded reads, and enforces the final request-body bound.

### Compaction and original-media retention

The ordinary compaction path serializes projected messages to text and therefore could not safely summarize native-file handles as though they contained the original media. Attachment-bearing canonical inputs are now retained; their user text can be summarized while the original claims remain available for future request reconstruction.

### Test-fixture corrections

- `signature-original` was invalid Base64 and was correctly discarded by pi's thought-signature validation. The test uses valid Base64 rather than weakening production validation.
- The first integrated follow-up test passed a content-part array to the wrong `lane.prompt` overload. It now passes a proper UserMessage and asserts successful admission for both requests. The corrected test passed.

## Remaining limits and unverified conditions

- Inline requests are bounded to **20 MiB including Base64, other request content and retained history**. This is approximately 15 MiB of original binary media before other content; the per-file bound is slightly smaller.
- Provider File API uploads, remote file lifecycle/expiry handling and upload-reference reuse are not implemented in this feature slice. Large videos must be shortened or rejected explicitly.
- Retaining original attachment claims preserves native analysis across follow-ups, but long conversations can accumulate enough media to hit the request limit. The explicit recovery is a shorter original or a new conversation; no automatic transcription/summary substitute is claimed.
- Allowed media formats still depend on the selected protocol and provider. Native video requires the Google native route in this implementation; the OpenAI-compatible audio route is limited to its supported audio shapes/formats.
- These tests do not establish successful remote Gemini/relay interpretation of a real recording. **Root's actual live-provider test is pending and must be recorded separately.**
- Packaged Electron interaction and real Chinese/English interface screenshots were not performed by this review. **Root's UI validation is pending and must be recorded separately.** Component state/save tests are not substitutes for those checks.
- The final performance JSON was inspected and reported its bounded preparation scenario under the proposed budget; the reviewer did not independently rerun that performance scenario and does not treat it as a packaged UI responsiveness measurement.

## Review disposition

No remaining confirmed blocker was found in the reviewed code and request-boundary tests after the listed corrections. This is an independent implementation/request-fidelity review, not a claim that live-provider or packaged-UI validation has completed.

The reviewer made no production-code changes, invoked no paid model requests and used no computer-use automation. Only this documentation file was written at the coordinator's request.
