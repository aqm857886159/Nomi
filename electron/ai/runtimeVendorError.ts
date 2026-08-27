import type { RuntimeErrorFacts } from '../harness/runtime/runtimePort';
import { VendorRequestError, categorizeVendorFailure, encodeVendorErrorMessage } from '../vendor/vendorHttp';
import { upstreamMessageFromBody } from './aiSdkVendorError';

/** Map recorded pi transport facts directly; never impersonate an AI4 error. */
export function describeRuntimeError(error: RuntimeErrorFacts, vendorKey: string): string {
  if (error.kind !== 'http' && error.kind !== 'timeout' && error.kind !== 'network') return error.message;
  const upstreamMsg = (error.body ? upstreamMessageFromBody(error.body) : '') || error.message;
  const statusLabel = error.status === undefined ? '请求失败' : `HTTP ${error.status}`;
  return encodeVendorErrorMessage(new VendorRequestError(`（${statusLabel}）${upstreamMsg}`, {
    vendorKey, method: 'POST', url: error.url ?? '',
    ...(error.status !== undefined ? { httpStatus: error.status } : {}),
    upstreamMsg: upstreamMsg.slice(0, 256), ...categorizeVendorFailure(error.status),
  }));
}
