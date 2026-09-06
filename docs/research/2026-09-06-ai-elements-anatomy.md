# Vercel AI Elements — real source anatomy

## Provenance

| Item | Value |
|---|---|
| Repo | `github.com/vercel/ai-elements` (shallow clone, full source read) |
| Commit inspected | `6a9d5b1822ffb10bba4bd97175f01edd7d8651cd` — *"Add question component for choices and freeform responses (#479)"*, authored **2026-08-21** |
| Read on | 2026-09-06 |
| License | **Apache-2.0** (`LICENSE`: "Copyright 2023 Vercel, Inc.") |
| Source path | `packages/elements/src/<component>.tsx` — one flat file per component, no `index.ts` barrel. `package.json` exports map is `{"./*": "./src/*.tsx"}` |
| Package version | `@repo/elements` is `private: true`, `version: "0.0.0"` — it is **not** published to npm. Distribution is via the `ai-elements` CLI (`packages/cli`) which copies files into your repo, shadcn-registry style. So "the version" is the commit, not a semver. |
| Peer runtime in repo | React **19.2.3**, `ai` ^6.0.105, `@ai-sdk/react` ^3.0.41, lucide-react ^0.577, `streamdown` ^2.4, `tokenlens` ^1.3.1, `@radix-ui/react-use-controllable-state` |
| Docs site | `https://ai-sdk.dev/elements/components/*` now **308-redirects** to `https://elements.ai-sdk.dev/components/*` |

### Sources that actually responded
- ✅ `api.github.com/repos/vercel/ai-elements/contents/` and `/git/trees/main?recursive=1` — reachable, unauthenticated.
- ✅ `git clone --depth 1 https://github.com/vercel/ai-elements.git` — **full real source obtained.** Everything below is read from the actual `.tsx` files unless marked otherwise.
- ✅ In-repo canonical docs: `skills/ai-elements/references/*.md` (48 files) and runnable examples `packages/examples/src/*.tsx`.
- ✅ `https://elements.ai-sdk.dev/components/tool` and `/components/context` via WebFetch (after following the 308).
- ✅ Context7 `resolve-library-id` → `/vercel/ai-elements` exists (682 snippets). Not needed for detail since raw source was obtained; noted because its blurb still says "built on shadcn/ui".
- ❌ `https://ai-sdk.dev/elements/components/tool` — does **not** serve content directly; 308 to the new host.

---

## ⚠️ Read this first: five things that will break a naive vendoring

1. **`Response` and `Actions` no longer exist as components.** There is no `response.tsx` and no `actions.tsx` in the current tree. They were folded into `message.tsx` as **`MessageResponse`** and **`MessageActions` / `MessageAction`**. Older tutorials and most of the internet still say `<Response>` / `<Actions>` / `<Action>`.
2. **`MessageAvatar` no longer exists.** `message.tsx` exports no avatar at all. Avatar duty moved to the separate `persona.tsx` (`Persona`, a Rive-WebGL animated thing with a `PersonaState` enum) — that is *not* a drop-in avatar, it's an animated assistant face. For a plain avatar you write your own.
3. **`PromptInputToolbar` no longer exists** — split into **`PromptInputHeader`** (above the textarea, `order-first`) and **`PromptInputFooter`** (below).
4. **`PromptInputModelSelect*` no longer exists** — renamed to the generic **`PromptInputSelect*`** family. (There is also a separate richer `model-selector.tsx`.)
5. **`PromptInputAttachments` / `PromptInputAttachment` no longer exist** — attachments moved to their own `attachments.tsx` (`Attachments`, `Attachment`, `AttachmentPreview`, …), and the glue component `PromptInputAttachmentsDisplay` seen in the docs is **userland code defined inside the example file**, not an export. You must write it yourself.

Also relevant to a **React 18 + Tailwind 3 + Mantine** target:
- Source targets **React 19** (`react: 19.2.3`). Watch for `use()`, ref-as-prop, and the `useControllableState` from Radix. Nothing in the components below strictly needs React 19 except via transitive Radix versions.
- Styling is **Tailwind 4** idiom. Concretely blocking utilities: `field-sizing-content` (see PromptInputTextarea), `size-*`, `is-user:dark` variant, `group-[.is-user]:*` arbitrary-group variants, `bg-muted/50` on shadcn CSS variables, `data-[state=open]:animate-in` (tailwindcss-animate). On Tailwind 3 you need `tailwindcss-animate` plus a shadcn-style CSS-variable theme, or you re-map every token to Mantine.
- Every component leans on `@repo/shadcn-ui` primitives — `Collapsible`, `Alert`, `Badge`, `Button`, `HoverCard`, `Progress`, `InputGroup`, `Select`, `Command`, `DropdownMenu`, `ScrollArea`, `Card`, `Tooltip`, `ButtonGroup`, `Spinner`. Those are Radix-based. Vendoring into Mantine means substituting each of these; the AI-Elements files themselves are thin wrappers, so **the interesting logic is small and the primitive dependency is large**.

---

## 1. Tool — `packages/elements/src/tool.tsx` (173 lines)

### State enum — the actual answer

`ToolPart["state"]` has **seven** values, not four. `output-denied` **does exist**, and there are two approval states you didn't ask about:

```tsx
export type ToolPart = ToolUIPart | DynamicToolUIPart;

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
};

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
};
```

Confirmed three ways: source `tool.tsx`, `__tests__/tool.test.tsx` (asserts `approval-requested` and `output-denied` render), and the live docs page at `elements.ai-sdk.dev/components/tool` which lists all seven.

State→label mapping to hardcode: `input-streaming`→Pending (grey circle), `input-available`→Running (pulsing clock), `approval-requested`→Awaiting Approval (yellow clock), `approval-responded`→Responded (blue check), `output-available`→Completed (green check), `output-denied`→Denied (**orange** X), `output-error`→Error (**red** X).

### Sub-components and signatures

```tsx
export type ToolProps = ComponentProps<typeof Collapsible>;

export type ToolHeaderProps = {
  title?: string;
  className?: string;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
  | { type: DynamicToolUIPart["type"]; state: DynamicToolUIPart["state"]; toolName: string }
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;
export type ToolInputProps  = ComponentProps<"div"> & { input: ToolPart["input"] };
export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];   // note: required, not optional
};

export const getStatusBadge: (status: ToolPart["state"]) => JSX.Element;  // also exported
```

Note the **discriminated union** on `ToolHeaderProps`: for a static tool you pass `type="tool-<name>"` and must NOT pass `toolName`; for `type="dynamic-tool"` you MUST pass `toolName`.

### DOM / layout structure

```
<Collapsible class="group not-prose mb-4 w-full rounded-md border">          <- Tool
  <CollapsibleTrigger class="flex w-full items-center justify-between gap-4 p-3">   <- ToolHeader
    <div class="flex items-center gap-2">
      <WrenchIcon class="size-4 text-muted-foreground" />
      <span class="font-medium text-sm">{title ?? derivedName}</span>
      <Badge variant="secondary" class="gap-1.5 rounded-full text-xs">{icon}{label}</Badge>
    </div>
    <ChevronDownIcon class="size-4 text-muted-foreground transition-transform
                            group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
  <CollapsibleContent class="space-y-4 p-4 text-popover-foreground outline-none ...">  <- ToolContent
    <div class="space-y-2 overflow-hidden">                                   <- ToolInput
      <h4 class="font-medium text-muted-foreground text-xs uppercase tracking-wide">Parameters</h4>
      <div class="rounded-md bg-muted/50"><CodeBlock language="json" /></div>
    </div>
    <div class="space-y-2">                                                   <- ToolOutput
      <h4 class="... uppercase tracking-wide">{errorText ? "Error" : "Result"}</h4>
      <div class="overflow-x-auto rounded-md text-xs [&_table]:w-full
                  {errorText ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-foreground'}">
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  </CollapsibleContent>
</Collapsible>
```

Two behaviours worth copying:

- **Tool name derivation** in `ToolHeader` — strips the `tool-` prefix:
  ```tsx
  const derivedName =
    type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");
  ```
  (`.slice(1).join("-")` so `tool-fetch_weather-v2` → `fetch_weather-v2`.)

- **`ToolOutput` renders nothing when empty**, and picks a renderer by output type:
  ```tsx
  if (!(output || errorText)) return null;
  let Output = <div>{output as ReactNode}</div>;
  if (typeof output === "object" && !isValidElement(output)) {
    Output = <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />;
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }
  ```
  So: a React element passes through; an object is JSON-pretty-printed; a string is fed to CodeBlock **as json** (yes, even plain prose — that's the real code).

### Canonical composition (from `skills/ai-elements/references/tool.md`)

```tsx
<Tool defaultOpen={true}>
  <ToolHeader type="tool-fetch_weather_data" state={weatherTool.state} />
  <ToolContent>
    <ToolInput input={weatherTool.input} />
    <ToolOutput
      output={<MessageResponse>{formatWeatherResult(weatherTool.output)}</MessageResponse>}
      errorText={weatherTool.errorText}
    />
  </ToolContent>
</Tool>
```

Note it composes with `MessageResponse`, not `Response`.

---

## 2. Confirmation — `packages/elements/src/confirmation.tsx` (169 lines)

There is **no `ConfirmationRequest`-as-a-form**; the whole component is a set of *state-gated slots* over an `Alert`. Seven exports.

```tsx
type ToolUIPartApproval =
  | { id: string; approved?: never; reason?: never }
  | { id: string; approved: boolean; reason?: string }
  | { id: string; approved: true;  reason?: string }
  | { id: string; approved: false; reason?: string }
  | undefined;

export type ConfirmationProps = ComponentProps<typeof Alert> & {
  approval?: ToolUIPartApproval;
  state: ToolUIPart["state"];          // required
};
export type ConfirmationTitleProps   = ComponentProps<typeof AlertDescription>;
export interface ConfirmationRequestProps  { children?: ReactNode }
export interface ConfirmationAcceptedProps { children?: ReactNode }
export interface ConfirmationRejectedProps { children?: ReactNode }
export type ConfirmationActionsProps = ComponentProps<"div">;
export type ConfirmationActionProps  = ComponentProps<typeof Button>;
```

### The state machine — verbatim gating logic

Context carries `{ approval, state }`. Each slot self-hides:

```tsx
// <Confirmation> root: renders nothing at all in these cases
if (!approval || state === "input-streaming" || state === "input-available") return null;

// <ConfirmationRequest>  — the "please decide" body
if (state !== "approval-requested") return null;

// <ConfirmationActions>  — the button row
if (state !== "approval-requested") return null;

// <ConfirmationAccepted>
if (!approval?.approved ||
    (state !== "approval-responded" && state !== "output-denied" && state !== "output-available"))
  return null;

// <ConfirmationRejected>
if (approval?.approved !== false ||
    (state !== "approval-responded" && state !== "output-denied" && state !== "output-available"))
  return null;
```

So: **accepted/rejected are not separate states** — they're derived from `approval.approved === true/false` *crossed with* the tool being in one of the three post-decision states. `approved` being `undefined` (the first union arm) means "requested, not yet answered" and shows neither slot. Also note `approval.reason?: string` exists in the type but is never rendered by the library.

Consuming a `null` context throws: `"Confirmation components must be used within Confirmation"`.

### DOM structure

```
<Alert class="flex flex-col gap-2">              <- Confirmation (context provider)
  <AlertDescription class="inline" />            <- ConfirmationTitle
  {ConfirmationRequest children}                 <- bare children, NO wrapper element
  {ConfirmationAccepted children}                <- bare children, NO wrapper element
  {ConfirmationRejected children}                <- bare children, NO wrapper element
  <div class="flex items-center justify-end gap-2 self-end">   <- ConfirmationActions
    <Button type="button" class="h-8 px-3 text-sm" />          <- ConfirmationAction
  </div>
</Alert>
```

`ConfirmationRequest/Accepted/Rejected` return `children` **raw** — they add no DOM node. That's why the example puts an icon + span directly inside them.

### Canonical composition

```tsx
{deleteTool?.approval && (
  <Confirmation approval={deleteTool.approval} state={deleteTool.state}>
    <ConfirmationRequest>
      This tool wants to delete: <code>{deleteTool.input?.filePath}</code><br />
      Do you approve this action?
    </ConfirmationRequest>
    <ConfirmationAccepted><CheckIcon className="size-4" /><span>You approved this tool execution</span></ConfirmationAccepted>
    <ConfirmationRejected><XIcon className="size-4" /><span>You rejected this tool execution</span></ConfirmationRejected>
    <ConfirmationActions>
      <ConfirmationAction variant="outline"
        onClick={() => addToolApprovalResponse({ id: deleteTool.approval!.id, approved: false })}>
        Reject
      </ConfirmationAction>
      <ConfirmationAction variant="default"
        onClick={() => addToolApprovalResponse({ id: deleteTool.approval!.id, approved: true })}>
        Approve
      </ConfirmationAction>
    </ConfirmationActions>
  </Confirmation>
)}
```

The write-side hook is `addToolApprovalResponse({ id, approved })` from `useChat` (AI SDK v6). If you're not on AI SDK v6, that's your own state to wire.

---

## 3. Task — `packages/elements/src/task.tsx` (87 lines)

Smallest of the set; no context, no state, pure Collapsible + styling.

```tsx
export type TaskProps         = ComponentProps<typeof Collapsible>;              // defaultOpen = true
export type TaskTriggerProps  = ComponentProps<typeof CollapsibleTrigger> & { title: string };
export type TaskContentProps  = ComponentProps<typeof CollapsibleContent>;
export type TaskItemProps     = ComponentProps<"div">;
export type TaskItemFileProps = ComponentProps<"div">;
```

Note `Task` defaults **`defaultOpen = true`** (unlike ChainOfThought, which defaults closed).

### DOM structure

```
<Collapsible defaultOpen>                                          <- Task  (no classes of its own)
  <CollapsibleTrigger asChild class="group">                       <- TaskTrigger
    {children ?? (                                                 <- default trigger if no children
      <div class="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm
                  transition-colors hover:text-foreground">
        <SearchIcon class="size-4" />
        <p class="text-sm">{title}</p>
        <ChevronDownIcon class="size-4 transition-transform group-data-[state=open]:rotate-180" />
      </div>
    )}
  </CollapsibleTrigger>
  <CollapsibleContent class="... data-[state=open]:animate-in ...">  <- TaskContent
    <div class="mt-4 space-y-2 border-muted border-l-2 pl-4">        <- the timeline rail
      <div class="text-muted-foreground text-sm">…</div>             <- TaskItem
      <div class="inline-flex items-center gap-1 rounded-md border bg-secondary
                  px-1.5 py-0.5 text-foreground text-xs">…</div>     <- TaskItemFile (inline chip)
    </div>
  </CollapsibleContent>
</Collapsible>
```

`TaskTrigger` uses `asChild`, so if you pass children they replace the whole default row (and `title` is then ignored). The left rail (`border-l-2 pl-4`) lives inside `TaskContent`, not on the items. `TaskItemFile` is an inline chip meant to be nested *inside* a `TaskItem`'s text.

---

## 4. Message / Response / Actions — `packages/elements/src/message.tsx` (360 lines)

**All three of your "Message, Response, Actions" live in this one file now.** Exports:

`Message`, `MessageContent`, `MessageActions`, `MessageAction`, `MessageResponse`, `MessageToolbar`, plus a whole branch family: `MessageBranch`, `MessageBranchContent`, `MessageBranchSelector`, `MessageBranchPrevious`, `MessageBranchNext`, `MessageBranchPage`.

**No `MessageAvatar`.**

### Signatures

```tsx
export type MessageProps        = HTMLAttributes<HTMLDivElement> & { from: UIMessage["role"] };
export type MessageContentProps = HTMLAttributes<HTMLDivElement>;
export type MessageActionsProps = ComponentProps<"div">;
export type MessageActionProps  = ComponentProps<typeof Button> & { tooltip?: string; label?: string };
export type MessageResponseProps = ComponentProps<typeof Streamdown>;
export type MessageToolbarProps = ComponentProps<"div">;
export type MessageBranchProps  = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;                       // default 0
  onBranchChange?: (branchIndex: number) => void;
};
```

### The role styling trick (important if you re-theme)

`Message` puts a **marker class** on the wrapper and `MessageContent` reads it with group variants. There is no prop drilling:

```tsx
export const Message = ({ className, from, ...props }) => (
  <div className={cn(
    "group flex w-full max-w-[95%] flex-col gap-2",
    from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
    className)} {...props} />
);

export const MessageContent = ({ children, className, ...props }) => (
  <div className={cn(
    "is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
    "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
    "group-[.is-assistant]:text-foreground",
    className)} {...props}>{children}</div>
);
```

So: **user** messages get a rounded `bg-secondary` bubble, right-aligned; **assistant** messages get *no bubble at all* — just text. `is-user:dark` is a custom Tailwind 4 variant registered in the app CSS; on Tailwind 3 you must replace both `group-[.is-user]:*` (works in TW3) and `is-user:dark` (does not).

### MessageResponse (the ex-`Response`)

```tsx
const streamdownPlugins = { cjk, code, math, mermaid };

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating
);
MessageResponse.displayName = "MessageResponse";
```

It is a thin wrapper over **`streamdown`** (Vercel's streaming-safe markdown renderer) with four plugins from `@streamdown/*`: `cjk`, `code`, `math`, `mermaid`. The custom `memo` comparator re-renders only on `children` or `isAnimating` change. If you don't want the streamdown dependency chain (it pulls shiki, katex, mermaid), this is the one component you'll want to swap for your own markdown renderer — the rest of the file is layout only.

### MessageActions / MessageAction (the ex-`Actions`/`Action`)

```tsx
export const MessageActions = ({ className, children, ...props }) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>{children}</div>
);

export const MessageAction = ({ tooltip, children, label, variant = "ghost", size = "icon-sm", ...props }) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );
  if (tooltip) {
    return (
      <TooltipProvider><Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent><p>{tooltip}</p></TooltipContent>
      </Tooltip></TooltipProvider>
    );
  }
  return button;
};
```

Defaults: `variant="ghost"`, `size="icon-sm"`. Always emits an `sr-only` label. Note it mounts its **own `TooltipProvider` per action** — wasteful if you render many; consider hoisting.

### MessageBranch state machine

`MessageBranch` holds `currentBranch` (number) and `branches` (ReactElement[]). `MessageBranchContent` registers its children into context via `useEffect` when lengths differ, then renders **all** branches with `index === currentBranch ? "block" : "hidden"` (so all branches stay mounted). `goToPrevious`/`goToNext` **wrap around**:

```tsx
const goToPrevious = () => handleBranchChange(currentBranch > 0 ? currentBranch - 1 : branches.length - 1);
const goToNext     = () => handleBranchChange(currentBranch < branches.length - 1 ? currentBranch + 1 : 0);
```

`MessageBranchSelector` returns `null` when `totalBranches <= 1`. `MessageBranchPage` renders `{currentBranch + 1} of {totalBranches}` in a `ButtonGroupText`.

`MessageToolbar` is just `<div class="mt-4 flex w-full items-center justify-between gap-4">` — the row that holds Actions on one side and the branch selector on the other.

### Canonical composition (from `references/message.md`)

```tsx
<Message from={message.role}>
  <MessageContent>
    <MessageResponse>{part.text}</MessageResponse>
  </MessageContent>
</Message>
…
<MessageActions>
  <MessageAction …>…</MessageAction>
  <MessageAction …>…</MessageAction>
</MessageActions>
```

---

## 5. PromptInput — `packages/elements/src/prompt-input.tsx` (1463 lines)

The largest file by far. ~45 exports. Current names vs the names you asked about:

| You asked for | Current reality |
|---|---|
| `PromptInput` | ✅ `PromptInput` |
| `PromptInputTextarea` | ✅ `PromptInputTextarea` |
| `PromptInputToolbar` | ❌ gone → `PromptInputHeader` + `PromptInputFooter` |
| `PromptInputTools` | ✅ `PromptInputTools` |
| `PromptInputSubmit` | ✅ `PromptInputSubmit` |
| `PromptInputButton` | ✅ `PromptInputButton` |
| `PromptInputModelSelect*` | ❌ gone → `PromptInputSelect` / `SelectTrigger` / `SelectContent` / `SelectItem` / `SelectValue` |
| `PromptInputAttachments` / `PromptInputAttachment` | ❌ gone → `attachments.tsx`: `Attachments` / `Attachment` / … |

Additional current exports: `PromptInputProvider`, `PromptInputBody`, `PromptInputActionMenu{,Trigger,Content,Item}`, `PromptInputActionAddAttachments`, `PromptInputActionAddScreenshot`, `PromptInputHoverCard{,Trigger,Content}`, `PromptInputTabsList`/`Tab`/`TabLabel`/`TabBody`/`TabItem`, `PromptInputCommand{,Input,List,Empty,Group,Item,Separator}`, and hooks `usePromptInputController`, `usePromptInputAttachments`, `useProviderAttachments`, `usePromptInputReferencedSources`.

### Root props

```tsx
export interface PromptInputMessage { text: string; files: FileUIPart[] }

export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, "onSubmit" | "onError"> & {
  accept?: string;          // e.g. "image/*"; undefined = any
  multiple?: boolean;
  globalDrop?: boolean;     // accept drops anywhere on document; default false (opt-in)
  syncHiddenInput?: boolean;// mirror into a hidden input for native form posts; default false
  maxFiles?: number;
  maxFileSize?: number;     // bytes
  onError?: (err: { code: "max_files" | "max_file_size" | "accept"; message: string }) => void;
  onSubmit: (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};
```

### Two-mode state ownership

`PromptInput` is **self-managed by default**; wrapping it in `<PromptInputProvider>` lifts text + attachment state out:

```tsx
const controller = useOptionalPromptInputController();
const usingProvider = !!controller;
const files = usingProvider ? controller.attachments.files : items;
```

Context shapes:

```tsx
export interface TextInputContext  { value: string; setInput: (v: string) => void; clear: () => void }
export interface AttachmentsContext {
  files: (FileUIPart & { id: string })[];
  add: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clear: () => void;
  openFileDialog: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
}
export interface PromptInputControllerProps {
  textInput: TextInputContext;
  attachments: AttachmentsContext;
  __registerFileInput: (ref, open) => void;   // INTERNAL
}
```

Root DOM: a hidden `<input type="file" class="hidden">` **sibling**, then the form:

```tsx
<form className={cn("w-full", className)} onSubmit={handleSubmit} ref={formRef} {...props}>
  <InputGroup className="overflow-hidden">{children}</InputGroup>
</form>
```

Submit clears inputs **only on success** — on a rejected promise or a throw it deliberately keeps the text so the user can retry. It also converts `blob:` URLs to data URLs before handing files to `onSubmit`.

### ▶ How the textarea auto-grows — the actual answer

**There is no JavaScript resize.** No `scrollHeight`, no ResizeObserver, no `rows` math. It is one CSS utility:

```tsx
<InputGroupTextarea
  className={cn("field-sizing-content max-h-48 min-h-16", className)}
  name="message"
  …
/>
```

`field-sizing-content` → CSS `field-sizing: content`, which makes the `<textarea>` size itself to its content. Bounded by `min-h-16` (4rem) and `max-h-48` (12rem), after which the textarea scrolls. The underlying shadcn `InputGroupTextarea` adds `flex-1 resize-none rounded-none border-0 bg-transparent py-3 shadow-none focus-visible:ring-0`.

**Vendoring caveat:** `field-sizing` is Chromium 123+ / no Firefox or Safari as of this writing, and `field-sizing-content` is a Tailwind **4** utility. On React 18 + Tailwind 3 + Mantine (and especially in Electron, where you control the engine and this is actually fine) you either (a) add the utility yourself in `tailwind.config` / plain CSS, since it's one declaration, or (b) fall back to the classic `el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'` on input. AI Elements gives you no JS fallback to copy.

### Keyboard behaviour (worth copying verbatim)

```tsx
if (e.key === "Enter") {
  if (isComposing || e.nativeEvent.isComposing) return;   // IME-safe — matters for zh-CN
  if (e.shiftKey) return;                                  // Shift+Enter = newline
  e.preventDefault();
  const { form } = e.currentTarget;
  const submitButton = form?.querySelector('button[type="submit"]') as HTMLButtonElement | null;
  if (submitButton?.disabled) return;                      // respect disabled submit
  form?.requestSubmit();
}
// Backspace on empty textarea removes the last attachment
if (e.key === "Backspace" && e.currentTarget.value === "" && attachments.files.length > 0) {
  e.preventDefault();
  attachments.remove(attachments.files.at(-1)!.id);
}
```

It tracks composition with local `isComposing` state via `onCompositionStart`/`onCompositionEnd` **in addition to** `e.nativeEvent.isComposing` — belt and braces for IME. Paste handler pulls `item.kind === "file"` off the clipboard and calls `attachments.add(files)`.

### ▶ Submit button status values

Type is **`ChatStatus`** imported from `ai` — the four values are `"submitted" | "streaming" | "ready" | "error"` (confirmed by the local union in `packages/examples/src/prompt-input.tsx`: `useState<"submitted" | "streaming" | "ready" | "error">("ready")`). `status` is **optional**.

```tsx
export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus;
  onStop?: () => void;
};

const isGenerating = status === "submitted" || status === "streaming";

let Icon = <CornerDownLeftIcon className="size-4" />;   // default / "ready" / undefined
if (status === "submitted")      Icon = <Spinner />;
else if (status === "streaming") Icon = <SquareIcon className="size-4" />;
else if (status === "error")     Icon = <XIcon className="size-4" />;

const handleClick = useCallback((e) => {
  if (isGenerating && onStop) { e.preventDefault(); onStop(); return; }
  onClick?.(e);
}, [isGenerating, onStop, onClick]);

<InputGroupButton
  aria-label={isGenerating ? "Stop" : "Submit"}
  onClick={handleClick}
  size={size}                                    // default "icon-sm"
  type={isGenerating && onStop ? "button" : "submit"}   // flips type so it doesn't submit
  variant={variant}                              // default "default"
  {...props}
>{children ?? Icon}</InputGroupButton>
```

Key detail: the button's `type` **flips from `submit` to `button`** while generating *if and only if* `onStop` is provided. Without `onStop` it stays a submit button and the stop icon is cosmetic.

### Header / Footer / Tools / Button

```tsx
PromptInputHeader → <InputGroupAddon align="block-end" class="order-first flex-wrap gap-1" />
PromptInputFooter → <InputGroupAddon align="block-end" class="justify-between gap-1" />
PromptInputTools  → <div class="flex min-w-0 items-center gap-1" />
PromptInputBody   → <div class="contents" />      // display:contents — a pure grouping no-op
```

`PromptInputHeader` is `align="block-end"` **plus `order-first`** — that's how it appears above the textarea while remaining an InputGroup addon.

`PromptInputButton` picks its own size and supports a rich tooltip:

```tsx
export type PromptInputButtonTooltip =
  | string
  | { content: ReactNode; shortcut?: string; side?: ComponentProps<typeof TooltipContent>["side"] };

const newSize = size ?? (Children.count(props.children) > 1 ? "sm" : "icon-sm");
// defaults: variant="ghost", type="button"
```

i.e. **one child → icon button; more than one child → text+icon "sm" button.** The shortcut renders as `<span class="ml-2 text-muted-foreground">` inside the tooltip.

### Select family (ex model-select)

All five are near-transparent wrappers over shadcn `Select`. Only the trigger restyles:

```tsx
<SelectTrigger className={cn(
  "border-none bg-transparent font-medium text-muted-foreground shadow-none transition-colors",
  "hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground",
  className)} />
```

### Canonical composition (`packages/examples/src/prompt-input.tsx`)

```tsx
<PromptInputProvider>
  <PromptInput globalDrop multiple onSubmit={handleSubmit}>
    <PromptInputAttachmentsDisplay />      {/* ← YOUR code, not an export. See below. */}
    <PromptInputBody>
      <PromptInputTextarea />
    </PromptInputBody>
    <PromptInputFooter>
      <PromptInputTools>
        <PromptInputActionMenu>
          <PromptInputActionMenuTrigger />
          <PromptInputActionMenuContent>
            <PromptInputActionAddAttachments />
            <PromptInputActionAddScreenshot />
          </PromptInputActionMenuContent>
        </PromptInputActionMenu>
        <PromptInputButton …>…</PromptInputButton>
        <PromptInputSelect …>
          <PromptInputSelectTrigger><PromptInputSelectValue /></PromptInputSelectTrigger>
          <PromptInputSelectContent>
            {models.map((m) => <PromptInputSelectItem key={m.id} value={m.id}>…</PromptInputSelectItem>)}
          </PromptInputSelectContent>
        </PromptInputSelect>
      </PromptInputTools>
      <PromptInputSubmit disabled={!text && !status} status={status} />
    </PromptInputFooter>
  </PromptInput>
</PromptInputProvider>
```

The `PromptInputAttachmentsDisplay` glue you must write yourself:

```tsx
const PromptInputAttachmentsDisplay = () => {
  const attachments = usePromptInputAttachments();
  const handleRemove = useCallback((id: string) => attachments.remove(id), [attachments]);
  if (attachments.files.length === 0) return null;
  return (
    <Attachments variant="inline">
      {attachments.files.map((attachment) => (
        <AttachmentItem attachment={attachment} key={attachment.id} onRemove={handleRemove} />
      ))}
    </Attachments>
  );
};
```

### Attachments — `packages/elements/src/attachments.tsx` (426 lines)

```tsx
export type AttachmentData = (FileUIPart & { id: string }) | (SourceDocumentUIPart & { id: string });
export type AttachmentMediaCategory = "image" | "video" | "audio" | "document" | "source" | "unknown";
export type AttachmentVariant = "grid" | "inline" | "list";

export type AttachmentsProps = HTMLAttributes<HTMLDivElement> & { variant?: AttachmentVariant };  // default "grid"
export type AttachmentProps  = HTMLAttributes<HTMLDivElement> & { data: AttachmentData; onRemove?: () => void };
export type AttachmentPreviewProps = HTMLAttributes<HTMLDivElement> & { fallbackIcon?: ReactNode };
// + AttachmentInfo, AttachmentRemove, AttachmentHoverCard{,Trigger,Content}, AttachmentEmpty
// + utils: getMediaCategory(data), getAttachmentLabel(data)
```

Variant → layout (variant is passed down by context, not per-item):

```
Attachments  grid   → "flex items-start flex-wrap gap-2 ml-auto w-fit"
             inline → "flex items-start flex-wrap gap-2"
             list   → "flex items-start flex-col gap-2"

Attachment   grid   → "group relative size-24 overflow-hidden rounded-lg"
             inline → "group relative flex h-8 cursor-pointer select-none items-center gap-1.5
                       rounded-md border border-border px-1.5 font-medium text-sm transition-all
                       hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50"
             list   → "group relative flex w-full items-center gap-3 rounded-lg border p-3 hover:bg-accent/50"
```

Icons per category: image→`ImageIcon`, video→`VideoIcon`, audio→`Music2Icon`, document→`FileTextIcon`, source→`GlobeIcon`, unknown→`PaperclipIcon`.

---

## 6. Context — `packages/elements/src/context.tsx` (409 lines)

All nine names you asked for exist, **plus `ContextContentFooter`**.

### Root schema

```tsx
interface ContextSchema {
  usedTokens: number;      // required
  maxTokens: number;       // required
  usage?: LanguageModelUsage;   // from "ai"
  modelId?: string;
}
export type ContextProps = ComponentProps<typeof HoverCard> & ContextSchema;
```

`Context` provides these via React context and renders `<HoverCard closeDelay={0} openDelay={0} {...props} />` — instant open/close, no delay. All children throw if used outside: `"Context components must be used within Context"`.

### ▶ How the usage ring is drawn — verbatim

It is a **hand-rolled inline SVG donut using stroke-dasharray/dashoffset**, not a library and not `Progress`. Constants at the top of the file:

```tsx
const PERCENT_MAX = 100;
const ICON_RADIUS = 10;
const ICON_VIEWBOX = 24;
const ICON_CENTER = 12;
const ICON_STROKE_WIDTH = 2;
```

```tsx
const ContextIcon = () => {
  const { usedTokens, maxTokens } = useContextValue();
  const circumference = 2 * Math.PI * ICON_RADIUS;      // ≈ 62.83
  const usedPercent = usedTokens / maxTokens;
  const dashOffset = circumference * (1 - usedPercent);

  return (
    <svg aria-label="Model context usage" height="20" role="img"
         style={{ color: "currentcolor" }}
         viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`} width="20">
      {/* track */}
      <circle cx={ICON_CENTER} cy={ICON_CENTER} fill="none" opacity="0.25"
              r={ICON_RADIUS} stroke="currentColor" strokeWidth={ICON_STROKE_WIDTH} />
      {/* progress arc */}
      <circle cx={ICON_CENTER} cy={ICON_CENTER} fill="none" opacity="0.7"
              r={ICON_RADIUS} stroke="currentColor"
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="round" strokeWidth={ICON_STROKE_WIDTH}
              style={{ transform: "rotate(-90deg)", transformOrigin: "center" }} />
    </svg>
  );
};
```

So the whole ring is: 24×24 viewBox rendered at 20×20, r=10, stroke 2, both circles `currentColor` (track at 0.25 opacity, arc at 0.7), arc rotated −90° so it starts at 12 o'clock, `strokeLinecap="round"`. Fully theme-adaptive because it inherits `currentColor` — trivially portable to Mantine. Note there is **no transition** on the dashoffset; it snaps.

`ContextIcon` is **not exported** — it's private, rendered only inside the default `ContextTrigger`.

### Sub-components

```tsx
ContextTrigger        : ComponentProps<typeof Button>
ContextContent        : ComponentProps<typeof HoverCardContent>
ContextContentHeader  : ComponentProps<"div">
ContextContentBody    : ComponentProps<"div">
ContextContentFooter  : ComponentProps<"div">
ContextInputUsage     : ComponentProps<"div">
ContextOutputUsage    : ComponentProps<"div">
ContextReasoningUsage : ComponentProps<"div">
ContextCacheUsage     : ComponentProps<"div">
```

Every one of them uses the **"children override the default"** pattern — pass children and you replace the built-in rendering entirely.

`ContextTrigger` default: `<Button type="button" variant="ghost">` containing `<span class="font-medium text-muted-foreground">{percent}</span>` + `<ContextIcon />`, wrapped in `HoverCardTrigger asChild`.

`ContextContent`: `<HoverCardContent class="min-w-60 divide-y overflow-hidden p-0">` — `divide-y` is what draws the lines between header/body/footer, and `p-0` because each section pads itself (`p-3`).

`ContextContentHeader` default body:
```tsx
<div class="w-full space-y-2 p-3">
  <div class="flex items-center justify-between gap-3 text-xs">
    <p>{displayPct}</p>
    <p class="font-mono text-muted-foreground">{used} / {total}</p>
  </div>
  <div class="space-y-2"><Progress class="bg-muted" value={usedPercent * 100} /></div>
</div>
```
(So the header uses shadcn `Progress` — a linear bar — *separate* from the SVG ring in the trigger.)

`ContextContentBody`: `<div class="w-full p-3">`. `ContextContentFooter`: `<div class="flex w-full items-center justify-between gap-3 bg-secondary p-3 text-xs">` showing "Total cost" + formatted USD.

### The four usage rows — exact `usage` fields consumed

Each reads one field off `LanguageModelUsage`, **returns `null` when that field is 0/absent**, and computes a per-row cost via `tokenlens`'s `getUsage({ modelId, usage })?.costUSD?.totalUSD`:

| Component | usage field read | tokenlens call | label |
|---|---|---|---|
| `ContextInputUsage` | `usage?.inputTokens` | `{ input: inputTokens, output: 0 }` | "Input" |
| `ContextOutputUsage` | `usage?.outputTokens` | `{ input: 0, output: outputTokens }` | "Output" |
| `ContextReasoningUsage` | `usage?.reasoningTokens` | `{ reasoningTokens }` | "Reasoning" |
| `ContextCacheUsage` | **`usage?.cachedInputTokens`** | `{ cacheReads: cacheTokens, input: 0, output: 0 }` | "Cache" |

⚠️ The live docs page's example writes `cachedTokens` in the `usage` object — **that is wrong / stale**. The source reads `usage.cachedInputTokens` (the AI SDK v6 field name). Use `cachedInputTokens`.

Row DOM is identical for all four:
```tsx
<div class="flex items-center justify-between text-xs">
  <span class="text-muted-foreground">Input</span>
  <span>{compactTokens}<span class="ml-2 text-muted-foreground">• {costText}</span></span>
</div>
```
Number formatting: tokens via `Intl.NumberFormat("en-US", { notation: "compact" })` (→ "32K", "1.5M"); undefined renders as an em-dash `"—"`; percentages via `{ style: "percent", maximumFractionDigits: 1 }`; costs via `{ style: "currency", currency: "USD" }`.

`tokenlens` is a real runtime dependency here (model pricing tables). If you don't want it, stub `getUsage` — it's the only import.

### Composition

```tsx
<Context maxTokens={128000} usedTokens={45000} modelId="anthropic:claude-3-opus"
         usage={{ inputTokens: 30000, outputTokens: 12000, reasoningTokens: 2000, cachedInputTokens: 1000 }}>
  <ContextTrigger />
  <ContextContent>
    <ContextContentHeader />
    <ContextContentBody>
      <ContextInputUsage />
      <ContextOutputUsage />
      <ContextReasoningUsage />
      <ContextCacheUsage />
    </ContextContentBody>
    <ContextContentFooter />
  </ContextContent>
</Context>
```

---

## 7. Queue / Plan / Chain-of-Thought — all three exist

### Queue — `packages/elements/src/queue.tsx` (274 lines) ✅ exists

Data types (yours to produce; the component is presentational only):

```tsx
export interface QueueMessagePart { type: string; text?: string; url?: string; filename?: string; mediaType?: string }
export interface QueueMessage { id: string; parts: QueueMessagePart[] }
export interface QueueTodo { id: string; title: string; description?: string; status?: "pending" | "completed" }
```

**The only state enum is `QueueTodo.status: "pending" | "completed"`**, and even that isn't consumed internally — the components take a `completed?: boolean` prop instead.

Exports: `Queue`, `QueueList`, `QueueSection`, `QueueSectionTrigger`, `QueueSectionLabel`, `QueueSectionContent`, `QueueItem`, `QueueItemIndicator`, `QueueItemContent`, `QueueItemDescription`, `QueueItemActions`, `QueueItemAction`, `QueueItemAttachment`, `QueueItemImage`, `QueueItemFile`.

```tsx
QueueItemIndicatorProps   = ComponentProps<"span"> & { completed?: boolean }   // default false
QueueItemContentProps     = ComponentProps<"span"> & { completed?: boolean }
QueueItemDescriptionProps = ComponentProps<"div">  & { completed?: boolean }
QueueSectionLabelProps    = ComponentProps<"span"> & { count?: number; label: string; icon?: React.ReactNode }
QueueItemActionProps      = Omit<ComponentProps<typeof Button>, "variant" | "size">
QueueListProps            = ComponentProps<typeof ScrollArea>
QueueSectionProps         = ComponentProps<typeof Collapsible>   // defaultOpen = true
```

Structure:
```
<div class="flex flex-col gap-2 rounded-xl border border-border bg-background px-3 pt-2 pb-2 shadow-xs">  <- Queue
  <Collapsible defaultOpen>                                                        <- QueueSection
    <CollapsibleTrigger asChild>
      <button class="group flex w-full items-center justify-between rounded-md bg-muted/40 px-3 py-2
                     text-left font-medium text-muted-foreground text-sm hover:bg-muted">   <- QueueSectionTrigger
        <span class="flex items-center gap-2">                                     <- QueueSectionLabel
          <ChevronDownIcon class="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
          {icon}<span>{count} {label}</span>
        </span>
      </button>
    </CollapsibleTrigger>
    <CollapsibleContent>                                                           <- QueueSectionContent
      <ScrollArea class="mt-2 -mb-1"><div class="max-h-40 pr-4"><ul>               <- QueueList
        <li class="group flex flex-col gap-1 rounded-md px-3 py-1 text-sm hover:bg-muted">  <- QueueItem
          <span class="mt-0.5 inline-block size-2.5 rounded-full border …" />       <- QueueItemIndicator
          <span class="line-clamp-1 grow break-words …" />                          <- QueueItemContent
          <div class="ml-6 text-xs …" />                                            <- QueueItemDescription
          <div class="flex gap-1">                                                  <- QueueItemActions
            <Button variant="ghost" size="icon"
              class="size-auto rounded p-1 … opacity-0 transition-opacity group-hover:opacity-100" />  <- QueueItemAction
          </div>
        </li>
      </ul></div></ScrollArea>
    </CollapsibleContent>
  </Collapsible>
</div>
```
`completed` styling: indicator → `border-muted-foreground/20 bg-muted-foreground/10` (vs `border-muted-foreground/50`); content → `text-muted-foreground/50 line-through`; description → `text-muted-foreground/40 line-through`. Actions are **reveal-on-hover** (`opacity-0 … group-hover:opacity-100`), and the list is capped at `max-h-40` inside a ScrollArea.

### Plan — `packages/elements/src/plan.tsx` (147 lines) ✅ exists

A `Collapsible` rendered `asChild` into a shadcn `Card`.

```tsx
export type PlanProps = ComponentProps<typeof Collapsible> & { isStreaming?: boolean };  // default false
// context: { isStreaming }; throws "Plan components must be used within Plan"

<Collapsible asChild data-slot="plan" {...props}>
  <Card className={cn("shadow-none", className)}>{children}</Card>
</Collapsible>
```

Exports: `Plan`, `PlanHeader` (→`CardHeader`), `PlanTitle` (→`CardTitle`), `PlanDescription` (→`CardDescription`), `PlanAction` (→`CardAction`), `PlanContent` (→`CardContent`), `PlanFooter`, `PlanTrigger` (→`CollapsibleTrigger`, uses `ChevronsUpDownIcon`).

`PlanTitle` and `PlanDescription` have `children` re-typed (Omit of the Card props) because when `isStreaming` is true they wrap children in **`<Shimmer>`** (from `./shimmer`) — that's the whole point of the `isStreaming` context.

### Chain of Thought — `packages/elements/src/chain-of-thought.tsx` (222 lines) ✅ exists

```tsx
export type ChainOfThoughtProps = ComponentProps<"div"> & {
  open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void;   // defaultOpen = false
};
export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
  icon?: LucideIcon;                 // default DotIcon
  label: ReactNode;                  // required
  description?: ReactNode;
  status?: "complete" | "active" | "pending";   // default "complete"
};
export type ChainOfThoughtHeaderProps        = ComponentProps<typeof CollapsibleTrigger>;
export type ChainOfThoughtContentProps       = ComponentProps<typeof CollapsibleContent>;
export type ChainOfThoughtSearchResultsProps = ComponentProps<"div">;
export type ChainOfThoughtSearchResultProps  = ComponentProps<typeof Badge>;
export type ChainOfThoughtImageProps         = ComponentProps<"div"> & { caption?: string };
```

**Step status enum: `"complete" | "active" | "pending"`** →
```tsx
const stepStatusStyles = {
  active:   "text-foreground",
  complete: "text-muted-foreground",
  pending:  "text-muted-foreground/50",
};
```

Controlled/uncontrolled via Radix `useControllableState({ prop: open, defaultProp: defaultOpen, onChange: onOpenChange })`. All sub-components are `memo`'d. Root is `<div class="not-prose w-full space-y-4">` (NOT a Collapsible — the `Collapsible` is instantiated *inside* `ChainOfThoughtHeader` and again in `ChainOfThoughtContent`, both driven by the shared context, which is unusual and worth noting if you restructure).

Step DOM draws the connector rail per-step:
```tsx
<div class="flex gap-2 text-sm {statusStyle} fade-in-0 slide-in-from-top-2 animate-in">
  <div class="relative mt-0.5">
    <Icon class="size-4" />
    <div class="absolute top-7 bottom-0 left-1/2 -mx-px w-px bg-border" />   {/* vertical connector */}
  </div>
  <div class="flex-1 space-y-2 overflow-hidden">
    <div>{label}</div>
    {description && <div class="text-muted-foreground text-xs">{description}</div>}
    {children}
  </div>
</div>
```
Header default label is the string `"Chain of Thought"` with a `BrainIcon`.

---

## Appendix: full current component inventory (48 files)

`agent, artifact, attachments, audio-player, canvas, chain-of-thought, checkpoint, code-block, commit, confirmation, connection, context, controls, conversation, edge, environment-variables, file-tree, image, inline-citation, jsx-preview, message, mic-selector, model-selector, node, open-in-chat, package-info, panel, persona, plan, prompt-input, question, queue, reasoning, sandbox, schema-display, shimmer, snippet, sources, speech-input, stack-trace, suggestion, task, terminal, test-results, tool, toolbar, transcription, voice-selector, web-preview`

Each has a matching `packages/elements/__tests__/<name>.test.tsx` (vitest + @vitest/browser + playwright) and a `skills/ai-elements/references/<name>.md` doc with a props table. The tests are the fastest way to see intended prop combinations.

Notably **absent**: `response.tsx`, `actions.tsx`, `loader.tsx`, `branch.tsx`, `avatar` — all folded elsewhere (see the warnings at the top).

Related but out of scope here: `agent.tsx` (`Agent`, `AgentHeader`, `AgentContent`, `AgentInstructions`, `AgentTools`, `AgentTool`, `AgentOutput`) — likely relevant given Nomi's Agent panel work.
