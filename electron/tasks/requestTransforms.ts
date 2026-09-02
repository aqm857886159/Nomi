// 命名请求变换注册表（HttpOperation.request_transform 的执行层），与 responseTransforms 对称：
// 当请求体需要「发送前按目标后端实况补全」（如 ComfyUI 内置文生图 ckpt_name 留空 → 从本机 /object_info
// derive 第一个 checkpoint），vendor 模块注册具名变换、op 上声明变换名；executeProfileOperation 在模板
// 渲染完、发 HTTP 前应用一次。runtime 只按名查表、不含 vendor 逻辑（P4）。
//
// 与 responseTransforms 的一个刻意差异：**变换抛错要冒泡**（fail fast，零成本拦下必失败的提交并给人话），
// 所以变换实现只允许抛「面向用户的确定性错误」；内部意外一律自行兜住、原样返回 body。

export type RequestTransformContext = {
  /** vendor.baseUrlHint（变换按后端实况补参时用）。缺省空串。 */
  baseUrl: string;
  /** ComfyUI 等协议可由调用层在 HTTP 前预生成任务 id；其他 transform 不使用。 */
  promptId?: string;
  /** Optional immutable request view for preflight-only semantic validation. */
  request?: unknown;
};

export type RequestTransformFn = (body: unknown, context: RequestTransformContext) => Promise<unknown> | unknown;
export type RequestTransformValidator = (body: unknown, context: RequestTransformContext) => Promise<void> | void;

const registry = new Map<string, RequestTransformFn>();
const validators = new Map<string, RequestTransformValidator>();

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value)
    && (typeof value === "object" || typeof value === "function")
    && typeof (value as { then?: unknown }).then === "function";
}

function isDeclaredAsyncFunction(value: unknown): boolean {
  return typeof value === "function" && Object.prototype.toString.call(value) === "[object AsyncFunction]";
}

function consumeAsyncResult(value: PromiseLike<unknown>): void {
  // A synchronous caller cannot await a transform.  Consume a possible
  // rejection before throwing our deterministic boundary error so an async
  // implementation does not create an unhandled-rejection side effect in
  // tests or in the approval loop.
  void Promise.resolve(value).catch(() => undefined);
}

function unknownTransformError(name: string): Error {
  return new Error(`Request transform "${name}" is not registered`);
}

function asynchronousTransformError(name: string): Error {
  return new Error(`Request transform "${name}" must be synchronous during semantic preflight`);
}

export function registerRequestTransform(name: string, fn: RequestTransformFn, validate?: RequestTransformValidator): void {
  registry.set(name, fn);
  if (validate) validators.set(name, validate);
  else validators.delete(name);
}

/**
 * Run the side-effect-free part of a request contract before spend/localization.
 * The final transform still runs immediately before HTTP as defense-in-depth.
 */
export async function validateRequestTransform(
  name: string | undefined,
  body: unknown,
  context: RequestTransformContext,
): Promise<void> {
  if (!name) return;
  const validator = validators.get(name);
  if (!validator) return;
  await validator(body, context);
}

/**
 * Synchronous counterpart used by providers whose approval contract builds the
 * wire payload twice before it can await anything.  It intentionally shares
 * the registry above instead of reimplementing a vendor transform.  A
 * declared-but-unknown transform is a catalog error and fails closed; a
 * registered transform may omit a validator, preserving the optional
 * validator semantics of the async API.
 */
export function validateRequestTransformSync(
  name: string | undefined,
  body: unknown,
  context: RequestTransformContext,
): void {
  if (!name) return;
  if (!registry.has(name)) throw unknownTransformError(name);
  const validator = validators.get(name);
  if (!validator) return;
  if (isDeclaredAsyncFunction(validator)) throw asynchronousTransformError(name);
  const result = validator(body, context);
  if (isPromiseLike(result)) {
    consumeAsyncResult(result);
    throw asynchronousTransformError(name);
  }
}

/** 应用具名变换；未声明或未注册 → 原样返回（对现有全部 vendor 零影响）。变换抛错向上冒泡（见文件头）。 */
export async function applyRequestTransform(
  name: string | undefined,
  body: unknown,
  context: RequestTransformContext,
): Promise<unknown> {
  if (!name) return body;
  const fn = registry.get(name);
  if (!fn) return body;
  return await fn(body, context);
}

/**
 * Apply a registered request transform without crossing an async boundary.
 * Semantic generation uses this during `buildRequest`, where returning a
 * Promise would otherwise be mistaken for an approved JSON body.  Async
 * transforms are rejected rather than bypassed or guessed around.
 */
export function applyRequestTransformSync(
  name: string | undefined,
  body: unknown,
  context: RequestTransformContext,
): unknown {
  if (!name) return body;
  const fn = registry.get(name);
  if (!fn) throw unknownTransformError(name);
  // Do not invoke an async function merely to discover its Promise result:
  // implementations are allowed to perform work before the first `await`.
  // Reject declared async functions before any such side effect, then still
  // inspect the result for transpiled/custom thenables below.
  if (isDeclaredAsyncFunction(fn)) throw asynchronousTransformError(name);
  const result = fn(body, context);
  if (isPromiseLike(result)) {
    consumeAsyncResult(result);
    throw asynchronousTransformError(name);
  }
  return result;
}
