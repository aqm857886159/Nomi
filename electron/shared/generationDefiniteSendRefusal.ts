/**
 * 「发送前确定拒收」：在本机、发出之前就能确定这次请求不该发（上游必拒、或发出去的不是创作者要的），零请求、零花钱。
 * 错误自己带机读码和给人看的原话（含出路句）。认它的地方只问这个接口，不认具体的错误码字符串：
 *   · Run 提交门（productionProviderPreparation.prepareProviderOrLandRefusal）：升级前批准、派发时才被拒的镜头
 *     落 needs_attention + 原话，而不是一直排队。
 * 实现它的错误：ModeInputMissingError（方式要的输入请求里没有，electron/catalog/modeInputRefusal.ts）。
 * 以后别的确定拒收（如请求体指纹漂移）接上来 = 让那个错误实现这个接口。
 */
export interface DefiniteSendRefusal {
  readonly definiteSendRefusal: true;
  /** 机读码，落到 job.errorCode。 */
  readonly code: string;
  /** 给人看的原话，落到 job.errorMessage。 */
  readonly message: string;
}

/** 错误本身或它包着的原因（`cause` 链，供应商适配层会再包一层）里第一个确定拒收；没有 = undefined。 */
export function definiteSendRefusalOf(error: unknown): DefiniteSendRefusal | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
    const candidate = current as Partial<DefiniteSendRefusal> & { cause?: unknown };
    if (candidate.definiteSendRefusal === true && typeof candidate.code === "string" && typeof candidate.message === "string") return candidate as DefiniteSendRefusal;
    current = candidate.cause;
  }
  return undefined;
}
