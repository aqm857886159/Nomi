// 接模型的五个动词（方案 §4.2）。**只投对外 profile**。
//
// 为什么不进内部面：内部 lane 跑在 headless 宿主里，它既没有贴 key 页可开，也没有一个人在旁边
// 把密钥粘进去——密钥永远由用户在 Nomi 自己的安全页输入。内部面上「接模型」这件事的形状是
// `start_model_setup`（把设置页打开，让用户自己接），那一条仍然在，且是它自己的动词。
// 这里这五条是**对外宿主**（Claude Code / Codex）驱动的那条路：它能读文档、能交卡，但它交的
// 一切都是**未签名的数据**——所以地址与鉴权放法一个字都不在入参里（§6.1）。
import { MODEL_SETUP_ACTION_FIELDS, modelRemoveInputSchema, modelTryInputSchema } from "../modelOnboarding";
import type { VerbDeclaration } from "../verbDeclaration";

// 五条动词的 schema **不在这里重写**：模型要填的那一部分与契约的语义输入是同一件事，
// 定义在 `../modelOnboarding.ts` 的 `MODEL_SETUP_ACTION_FIELDS`（带描述），两边都从它派生。
// 以前这里各写一遍同样的字段与约束（Ponytail 2026-09-18）——其中一份改了约束另一份不会红，
// 而模型读的是前者、运行时判的是后者。

export function onboardingVerbs(): VerbDeclaration[] {
  const connectProvider: VerbDeclaration = {
    name: "connect_model_provider",
    profiles: ["mcp"],
    profileReason: "headlessHost",
    contractId: "model.onboarding.setup",
    effect: "reversible_local",
    nextAction: "user_sees_panel",
    aliasBoundInput: { action: "connect_provider" },
    describe: {
      does: "Open Nomi's credential page for one provider so the user can paste its key, and start a setup.",
      useWhen: "The user asks to connect a provider or a model that Nomi does not have yet.",
      notWhen: "It never accepts, asks for or stores an API key, and it cannot decide where a key is sent: the address is confirmed by the user on that page. Once the key is saved, describe the provider's API with submit_model_declaration. To hide or show models that are already connected use show_provider_models; to delete one use remove_model_provider.",
      params: "name is the provider's display name. docs is the API documentation: either the text itself or one http(s) URL per line. suggestedBaseUrl is only pre-filled on the page for the user to confirm. Pass vendorKey instead of name to adjust a connection that already exists; only its name, its proxy switch and reissuing the key can change there.",
    },
    schema: MODEL_SETUP_ACTION_FIELDS.connect_provider,
    examples: [
      // 示例用中性的假供应商：真实品牌配一个错地址是这张工具面上最危险的组合——AI 照抄，
      // 错地址预填进贴 key 页，用户一按保存就把密钥绑到了错的 origin（2026-09-21 K9，
      // 当时写的两个 Higgsfield URL 一个 404、一个 405，真实 API host 根本不是那个）。
      { when: "Open the credential page for a provider the user has an account with:", arguments: { name: "Example Relay", docs: "https://docs.example-relay.com/api", suggestedBaseUrl: "https://api.example-relay.com" } },
      { when: "The user says the key stopped working:", arguments: { vendorKey: "example-relay", reissueKey: true } },
    ],
    // 通道③：进外部宿主读到的那段说明。一条 schema-valid 的调用示例写在这里，而不是另起一份
    // 文案（`check:model-schema` 的 missing-example 认的就是描述里那段 JSON）。
    promptGuidelines: [
      'A first call looks like {"action": "connect_provider", "name": "Higgsfield", "docs": "https://docs.higgsfield.ai/api-reference", "suggestedBaseUrl": "https://platform.higgsfield.ai"}, then hand the card over with {"action": "submit_declaration", "setupId": "the id it returned", "declaration": "the card as JSON text"}.',
      "Nothing on this tool spends the user's credit, and nothing here can decide where a saved key is sent: that address is confirmed by the user on Nomi's own page.",
    ],
  };

  const submitDeclaration: VerbDeclaration = {
    name: "submit_model_declaration",
    profiles: ["mcp"],
    profileReason: "headlessHost",
    contractId: "model.onboarding.setup",
    effect: "reversible_local",
    nextAction: "none",
    aliasBoundInput: { action: "submit_declaration" },
    describe: {
      does: "Hand Nomi one whole declaration card describing a provider and its models, and register everything in it that passes.",
      useWhen: "You have read the provider's API documentation. You do not need an API key or a handle first: the card is checked, and registered, without either.",
      notWhen: "It never proves a model can produce anything: the reply keeps that claim in its unverified list until one real generation has run, which is what try_model is for. It does not delete anything; use remove_model_provider for that.",
      params: "declaration is the whole card as JSON text, provider block included; ask nomi_read for the onboarding kit and it returns the exact schema plus worked examples. Submitting is a full overwrite of the models it names, never a patch. vendorKey targets a connection that already exists; otherwise the connection id is derived from the declared base URL, and name is its display name.",
    },
    schema: MODEL_SETUP_ACTION_FIELDS.submit_declaration,
    examples: [
      { when: "Register a provider and its models in one call, before any key exists:", arguments: { name: "Example Relay", declaration: '{"provider":{"baseUrl":"https://api.example-relay.com","authType":"bearer","authHeader":"Authorization"},"sources":[{"url":"https://docs.example-relay.com/api","evidence":"POST /v1/images/generations returns data[0].url"}],"assetIngestion":{"strategy":"none","sourceUrl":"https://docs.example-relay.com/api"},"models":[{"modelKey":"demo-image","labelZh":"Demo Image","kind":"image","modes":[{"taskKind":"text_to_image","delivery":"synchronous","create":{"method":"POST","path":"/v1/images/generations","body":{"prompt":"{{request.prompt}}"},"response_mapping":{"image_url":"data.0.url"}},"sourceUrls":["https://docs.example-relay.com/api"]}]}]}' } },
    ],
    promptGuidelines: [
      'Read {"target": "onboarding_kit"} with nomi_read first: it hands you this card\'s JSON Schema, the writing rules and two worked cards to copy from. Working from memory counts as not having read the provider\'s documentation.',
      "A rejection names the field, the legal values and the documentation URL you declared for it. Fix that field and send the whole card again.",
    ],
  };

  const showModels: VerbDeclaration = {
    name: "show_provider_models",
    profiles: ["mcp"],
    profileReason: "headlessHost",
    contractId: "model.onboarding.setup",
    effect: "reversible_local",
    nextAction: "none",
    aliasBoundInput: { action: "show_models" },
    describe: {
      does: "Show or hide models of a connected provider in Nomi's model pickers.",
      useWhen: "The user asks to tidy up the model list, or to bring a hidden model back.",
      notWhen: "Hiding is not deleting and frees nothing: to remove a model or a whole connection use remove_model_provider. To add new models use submit_model_declaration.",
      params: "vendorKey and modelKeys come from nomi_read target=models. visible=false hides them.",
    },
    schema: MODEL_SETUP_ACTION_FIELDS.show_models,
    examples: [
      { when: "Hide two models the user never picks:", arguments: { vendorKey: "apimart", modelKeys: ["imagen-4", "imagen-4-fast"], visible: false } },
    ],
  };

  const cancelSetup: VerbDeclaration = {
    name: "cancel_model_setup",
    profiles: ["mcp"],
    profileReason: "headlessHost",
    contractId: "model.onboarding.setup",
    effect: "reversible_local",
    nextAction: "none",
    aliasBoundInput: { action: "cancel" },
    describe: {
      does: "Abandon an in-flight model setup.",
      useWhen: "The user changes their mind before the declaration is accepted.",
      notWhen: "It leaves an already-saved key and an already-connected provider untouched; to delete those use remove_model_provider. To carry on instead, use submit_model_declaration.",
      params: "setupId comes from connect_model_provider.",
    },
    schema: MODEL_SETUP_ACTION_FIELDS.cancel,
    examples: [{ when: "Drop the setup:", arguments: { setupId: "setup-1" } }],
  };

  const setProviderKey: VerbDeclaration = {
    name: "set_provider_key",
    profiles: ["mcp"],
    profileReason: "headlessHost",
    contractId: "model.onboarding.setup",
    effect: "reversible_local",
    nextAction: "none",
    aliasBoundInput: { action: "set_key" },
    describe: {
      does: "Save an API key the user handed you onto one connection, through the same door Nomi's own credential page writes to.",
      useWhen: "The user has explicitly given you the key and asked you to put it in, instead of pasting it themselves.",
      notWhen: "Never ask the user for a key they have not offered, never read one out of a file or an environment variable, never print it back and never put it in a message. If the user would rather paste it themselves, use connect_model_provider, which opens Nomi's own page. This call cannot decide where the key is sent: the address comes from the connection, and changing it needs the user on that page.",
      params: "vendorKey is the connection id. apiKey is the key exactly as the provider issued it.",
    },
    schema: MODEL_SETUP_ACTION_FIELDS.set_key,
    examples: [
      { when: "The user pasted their key to you and asked you to save it:", arguments: { vendorKey: "example-relay", apiKey: "<the key the user gave you>" } },
    ],
    promptGuidelines: [
      "Nomi never hands a saved key back: not in a result, not in an error, not in a trace. If you need to know whether a key is saved, read nomi_read target=models, which only says yes or no.",
    ],
  };

  const tryModelVerb: VerbDeclaration = {
    name: "try_model",
    profiles: ["mcp"],
    profileReason: "headlessHost",
    contractId: "model.onboarding.try",
    effect: "spend",
    nextAction: "user_sees_spend_card",
    describe: {
      does: "Run one real generation with a model that was just connected, and hand back the provider's own response.",
      useWhen: "A card is registered and a key is saved, and you need to know whether this model actually produces something.",
      notWhen: "This spends the user's provider credit: Nomi asks the user to confirm the charge in its own window, and nothing is sent until they do. It is not a way to generate content for a project, and it is not how you register a model — that is submit_model_declaration. Do not tell the user a model is connected until this call has returned an artifact.",
      params: "vendorKey and modelKey identify the model. prompt, taskKind and params are optional; the first mode the card declared and a short neutral prompt are used when omitted.",
    },
    schema: modelTryInputSchema,
    examples: [
      { when: "Prove the model you just registered really works:", arguments: { vendorKey: "example-relay", modelKey: "demo-image", prompt: "a red apple on a white table" } },
    ],
    promptGuidelines: [
      "The reply carries the provider's own response with secrets removed. When it fails, read that response rather than guessing: it is the same text a developer would see, and it is what tells you which field of the card is wrong.",
    ],
  };

  const removeProvider: VerbDeclaration = {
    name: "remove_model_provider",
    profiles: ["mcp"],
    profileReason: "headlessHost",
    contractId: "model.onboarding.remove",
    effect: "irreversible",
    nextAction: "user_sees_confirm_card",
    describe: {
      does: "Permanently delete models, or a whole provider connection including its saved key.",
      useWhen: "The user asks to remove a provider or models they no longer want.",
      notWhen: "This cannot be undone and it is not how you tidy a crowded picker: use show_provider_models with visible=false to hide instead. It does not connect anything; that is connect_model_provider.",
      params: "vendorKey and modelKeys come from nomi_read target=models. Leave modelKeys out to delete the whole connection. ifUnchanged is the fingerprint that same read returned, so a stale plan cannot delete something else.",
    },
    schema: modelRemoveInputSchema,
    examples: [
      { when: "Delete a connection the user is done with:", arguments: { vendorKey: "old-relay", ifUnchanged: "models-7f3a" } },
    ],
    promptGuidelines: [
      'Read first, then delete: {"vendorKey": "old-relay", "ifUnchanged": "the fingerprint that read returned"}. Leaving modelKeys out deletes the whole connection, including the key the user saved, and Nomi will not seed it back.',
      "There is no undo. If the user only wants a shorter list, hide the models instead.",
    ],
  };

  return [connectProvider, submitDeclaration, setProviderKey, showModels, cancelSetup, tryModelVerb, removeProvider];
}
