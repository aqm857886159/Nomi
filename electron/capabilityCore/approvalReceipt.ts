import crypto from "node:crypto";
import fs from "node:fs";

import { writeJsonFileAtomic } from "../jsonFile";
import type { ProductionRunLock } from "../productionRun/productionRunLock";
import type { MultiShotGateProjection } from "../productionRun/shotPricing";

export const HUMAN_APPROVAL_VERSION = 1 as const;
export const HUMAN_APPROVAL_ALGORITHM = "HMAC-SHA256" as const;
export const HUMAN_APPROVAL_AUDIENCE = "nomi-mcp" as const;

export type HumanApprovalDisplay = {
  projectName?: string;
  shotSummary?: string;
  model: string;
  referenceCount?: number;
  /**
   * P4 S3a — optional multi-shot projection. When present the confirmation surface renders the
   * multi-shot card (per-shot list + fixed footer); when absent the single-shot flat card is shown.
   * It rides inside the MAC-signed challenge, so the per-shot prices/rows the user sees are tamper-proof.
   */
  shots?: MultiShotGateProjection;
};

export type HumanApprovalChallengeInput = {
  challengeKey: string;
  immutableProjectUuid: string;
  projectGeneration: number;
  projectId: string;
  runId: string;
  gateId: string;
  contractHash: string;
  targetHash: string;
  projectRevision: number;
  revocationEpoch?: number;
  costScope: string;
  pricingSnapshotHash: string;
  reservationPreview: { currency: string; maximum: number };
  display?: HumanApprovalDisplay;
  ttlMs?: number;
};

export type HumanApprovalChallengeV1 = Omit<HumanApprovalChallengeInput, "ttlMs" | "challengeKey"> & {
  version: typeof HUMAN_APPROVAL_VERSION;
  keyId: string;
  algorithm: typeof HUMAN_APPROVAL_ALGORITHM;
  issuer: "nomi-main";
  challengeId: string;
  nonce: string;
  audience: typeof HUMAN_APPROVAL_AUDIENCE;
  issuedAt: string;
  expiresAt: string;
  mac: string;
};

export type MainProcessGestureAttestationV1 = {
  kind: "main_process_gesture";
  issuer: "nomi-main";
  keyId: string;
  challengeId: string;
  decision: "accept" | "reject";
  webContentsId: number;
  frameId: number;
  origin: string;
  gestureNonce: string;
  issuedAt: string;
  expiresAt: string;
  mac: string;
};

/**
 * Attestation produced by a registered MCP client that has confirmed a generation
 * gate via the MCP elicitation protocol (2025-06-18+). Recorded in the receipt's
 * gestureAttestation field in lieu of a main-process GUI gesture attestation when
 * the confirmation surface is the calling client, not a Nomi application window.
 *
 * Fields prove: which authenticated client spoke (authenticatedClient), over which
 * challenge (challengeId / gestureNonce), with what decision, and when. The HMAC
 * is computed by the main process using its own macKey — the client never sees the
 * key, so this is not a client-self-issued attestation.
 */
export type ClientElicitationAttestationV1 = {
  kind: "client_elicitation";
  issuer: "nomi-main";
  keyId: string;
  challengeId: string;
  decision: "accept";
  authenticatedClient: string;
  gestureNonce: string;
  issuedAt: string;
  expiresAt: string;
  mac: string;
};

export type GestureAttestationV1 = MainProcessGestureAttestationV1 | ClientElicitationAttestationV1;

export type HumanApprovalReceiptV1 = {
  version: typeof HUMAN_APPROVAL_VERSION;
  keyId: string;
  algorithm: typeof HUMAN_APPROVAL_ALGORITHM;
  issuer: "nomi-main";
  receiptId: string;
  challengeId: string;
  handoffId: string;
  immutableProjectUuid: string;
  projectGeneration: number;
  revocationEpoch: number;
  projectId: string;
  runId: string;
  gateId: string;
  contractHash: string;
  targetHash: string;
  projectRevision: number;
  costScope: string;
  pricingSnapshotHash: string;
  humanActor: string;
  gestureAttestation: GestureAttestationV1;
  receiptNonce: string;
  audience: typeof HUMAN_APPROVAL_AUDIENCE;
  issuedAt: string;
  expiresAt: string;
  mac: string;
};

type ReceiptRecord = {
  token: string;
  receipt: HumanApprovalReceiptV1;
  consumedAt?: string;
};

type ChallengeRecord = {
  input: HumanApprovalChallengeInput;
  token: string;
  challenge: HumanApprovalChallengeV1;
  status: "pending" | "accepted" | "rejected" | "expired";
  receiptToken?: string;
};

type ApprovalReceiptState = {
  schemaVersion: 1;
  revision: number;
  keyId: string;
  challenges: Record<string, ChallengeRecord>;
  receipts: Record<string, ReceiptRecord>;
  checksum: string;
  mac: string;
};

export type ApprovalReceiptAuthorityDeps = {
  filePath: string;
  macKey: string | NodeJS.TypedArray;
  storeMacKey?: string | NodeJS.TypedArray;
  keyId?: string;
  lock?: ProductionRunLock;
  now?: () => string;
  randomId?: () => string;
  defaultTtlMs?: number;
};

export type ReceiptReplayResult = { receipt: HumanApprovalReceiptV1; replayed: boolean };

export class HumanApprovalRequiredError extends Error {
  readonly code = "human_approval_required";

  constructor(message = "A verified Nomi gesture is required for human approval") {
    super(message);
    this.name = "HumanApprovalRequiredError";
  }
}

export class ReceiptExpiredError extends Error {
  readonly code = "receipt_expired";

  constructor(message = "Human approval challenge or receipt has expired") {
    super(message);
    this.name = "ReceiptExpiredError";
  }
}

export class ReceiptScopeError extends Error {
  readonly code = "receipt_invalid";

  constructor(message = "Human approval scope is invalid") {
    super(message);
    this.name = "ReceiptScopeError";
  }
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Approval receipt values must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("Approval receipt values must be JSON serializable");
}

function keyBuffer(value: string | NodeJS.TypedArray): Buffer {
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function digest(value: unknown): string {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function sign(value: unknown, key: string | NodeJS.TypedArray): string {
  return crypto.createHmac("sha256", keyBuffer(key)).update(stableJson(value)).digest("base64url");
}

function encode(value: unknown): string {
  return Buffer.from(stableJson(value), "utf8").toString("base64url");
}

function decode(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new ReceiptScopeError("Signed approval value is malformed");
  }
}

function timingEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function expiresAt(now: string, ttlMs: number | undefined, defaultTtlMs: number, cap?: string): string {
  const ttl = ttlMs ?? defaultTtlMs;
  if (!Number.isInteger(ttl) || ttl <= 0) throw new ReceiptScopeError("Approval TTL is invalid");
  const value = new Date(Date.parse(now) + ttl).toISOString();
  return cap && Date.parse(cap) < Date.parse(value) ? cap : value;
}

function assertNotExpired(value: { expiresAt: string }, now: string): void {
  if (!Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(now) >= Date.parse(value.expiresAt)) throw new ReceiptExpiredError();
}

function emptyState(keyId: string): ApprovalReceiptState {
  const value = { schemaVersion: 1 as const, revision: 0, keyId, challenges: {}, receipts: {} };
  return { ...value, checksum: digest(value), mac: "" };
}

export function createApprovalReceiptAuthority(deps: ApprovalReceiptAuthorityDeps) {
  const keyId = deps.keyId ?? "approval-receipt-v1";
  const storeMacKey = deps.storeMacKey ?? deps.macKey;
  const now = deps.now ?? (() => new Date().toISOString());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const defaultTtlMs = deps.defaultTtlMs ?? 5 * 60_000;

  function readState(): ApprovalReceiptState {
    if (!fs.existsSync(deps.filePath)) return emptyState(keyId);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(deps.filePath, "utf8"));
    } catch {
      throw new ReceiptScopeError("Approval receipt store is corrupt");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ReceiptScopeError("Approval receipt store is corrupt");
    const state = parsed as ApprovalReceiptState;
    const value = { schemaVersion: state.schemaVersion, revision: state.revision, keyId: state.keyId, challenges: state.challenges, receipts: state.receipts };
    if (state.schemaVersion !== 1 || state.keyId !== keyId || state.checksum !== digest(value)
      || !timingEqual(state.mac, sign({ ...value, checksum: state.checksum }, storeMacKey))) {
      throw new ReceiptScopeError("Approval receipt store integrity check failed");
    }
    return state;
  }

  function writeState(state: ApprovalReceiptState): void {
    const value = { schemaVersion: state.schemaVersion, revision: state.revision, keyId: state.keyId, challenges: state.challenges, receipts: state.receipts };
    const withChecksum = { ...value, checksum: digest(value) };
    writeJsonFileAtomic(deps.filePath, { ...withChecksum, mac: sign({ ...value, checksum: withChecksum.checksum }, storeMacKey) });
  }

  function mutate<T>(callback: (state: ApprovalReceiptState) => { result: T; changed: boolean }): T {
    const held = deps.lock?.acquire();
    try {
      const state = readState();
      const result = callback(state);
      if (result.changed) {
        state.revision += 1;
        writeState(state);
      }
      return result.result;
    } finally {
      if (held && deps.lock) deps.lock.release(held);
    }
  }

  function signed<T extends HumanApprovalChallengeV1 | HumanApprovalReceiptV1>(token: string, kind: "challenge" | "receipt"): T {
    const value = decode(token);
    if (value.version !== HUMAN_APPROVAL_VERSION || value.algorithm !== HUMAN_APPROVAL_ALGORITHM
      || value.issuer !== "nomi-main" || value.audience !== HUMAN_APPROVAL_AUDIENCE
      || value.keyId !== keyId || typeof value.mac !== "string"
      || !timingEqual(value.mac, sign({ ...value, mac: undefined }, deps.macKey))) {
      throw new ReceiptScopeError(`Signed ${kind} is invalid`);
    }
    return value as T;
  }

  function verifyChallenge(token: string): HumanApprovalChallengeV1 {
    const challenge = signed<HumanApprovalChallengeV1>(token, "challenge");
    assertNotExpired(challenge, now());
    if (!challenge.challengeId || !challenge.nonce || !challenge.projectId || !challenge.runId || !challenge.gateId
      || !challenge.contractHash || challenge.targetHash !== challenge.contractHash || !Number.isInteger(challenge.projectRevision)) {
      throw new ReceiptScopeError("Challenge binding is incomplete");
    }
    if (challenge.display !== undefined && (!challenge.display || typeof challenge.display !== "object"
      || !challenge.display.model || (challenge.display.referenceCount !== undefined
        && (!Number.isInteger(challenge.display.referenceCount) || challenge.display.referenceCount < 0)))) {
      throw new ReceiptScopeError("Challenge display is invalid");
    }
    const state = readState();
    const record = state.challenges[challenge.challengeId];
    if (!record || record.token !== token) throw new ReceiptScopeError("Challenge is not registered");
    return challenge;
  }

  /** Resolve a challenge handle for the trusted Nomi UI without exposing the
   * signed token to MCP clients or persisting it in the handoff queue. */
  function resolveChallengeToken(challengeId: string): string {
    const normalized = typeof challengeId === "string" ? challengeId.trim() : "";
    if (!normalized) throw new ReceiptScopeError("Challenge id is required");
    const record = readState().challenges[normalized];
    if (!record) throw new ReceiptScopeError("Challenge is not registered");
    verifyChallenge(record.token);
    return record.token;
  }

  function requestChallenge(input: HumanApprovalChallengeInput): { input: HumanApprovalChallengeInput; token: string; challenge: HumanApprovalChallengeV1 } {
    return mutate<{ input: HumanApprovalChallengeInput; token: string; challenge: HumanApprovalChallengeV1 }>((state) => {
      const existing = Object.values(state.challenges).find((record) => record.input.challengeKey === input.challengeKey);
      if (existing && existing.status !== "expired" && Date.parse(now()) < Date.parse(existing.challenge.expiresAt)) {
        const { ttlMs: _existingTtl, ...existingBinding } = existing.input;
        const { ttlMs: _requestedTtl, ...requestedBinding } = input;
        if (stableJson(existingBinding) !== stableJson(requestedBinding)) throw new ReceiptScopeError("Challenge key conflicts with a different binding");
        return { result: { input: { ...existing.input }, token: existing.token, challenge: { ...existing.challenge } }, changed: false };
      }
      const issuedAt = now();
      if (!input.challengeKey || !input.immutableProjectUuid || !input.projectId || !input.runId || !input.gateId
        || !input.contractHash || input.targetHash !== input.contractHash || !Number.isInteger(input.projectRevision)
        || (input.revocationEpoch !== undefined && !Number.isInteger(input.revocationEpoch))
        || !input.costScope || !input.pricingSnapshotHash || !input.reservationPreview.currency
        || !Number.isFinite(input.reservationPreview.maximum) || input.reservationPreview.maximum < 0) {
        throw new ReceiptScopeError("Challenge input is incomplete");
      }
      const withoutMac: Omit<HumanApprovalChallengeV1, "mac"> = {
        version: HUMAN_APPROVAL_VERSION,
        keyId,
        algorithm: HUMAN_APPROVAL_ALGORITHM,
        issuer: "nomi-main",
        challengeId: randomId(),
        nonce: randomId(),
        immutableProjectUuid: input.immutableProjectUuid,
        projectGeneration: input.projectGeneration,
        projectId: input.projectId,
        runId: input.runId,
        gateId: input.gateId,
        contractHash: input.contractHash,
        targetHash: input.targetHash,
        projectRevision: input.projectRevision,
        ...(input.revocationEpoch === undefined ? {} : { revocationEpoch: input.revocationEpoch }),
        costScope: input.costScope,
        pricingSnapshotHash: input.pricingSnapshotHash,
        reservationPreview: { ...input.reservationPreview },
        ...(input.display ? { display: { ...input.display } } : {}),
        audience: HUMAN_APPROVAL_AUDIENCE,
        issuedAt,
        expiresAt: expiresAt(issuedAt, input.ttlMs, defaultTtlMs),
      };
      const challenge: HumanApprovalChallengeV1 = { ...withoutMac, mac: sign(withoutMac, deps.macKey) };
      const token = encode(challenge);
      state.challenges[challenge.challengeId] = { input: { ...input }, token, challenge, status: "pending" };
      return { result: { input: { ...input }, token, challenge }, changed: true };
    });
  }

  function createMainProcessGestureAttestation(token: string, input: {
    webContentsId: number;
    frameId: number;
    origin: string;
    decision: "accept" | "reject";
    challengeId?: string;
  }): MainProcessGestureAttestationV1 {
    const challenge = verifyChallenge(token);
    const withoutMac: Omit<MainProcessGestureAttestationV1, "mac"> = {
      kind: "main_process_gesture",
      issuer: "nomi-main",
      keyId,
      challengeId: input.challengeId ?? challenge.challengeId,
      decision: input.decision,
      webContentsId: input.webContentsId,
      frameId: input.frameId,
      origin: input.origin,
      gestureNonce: challenge.nonce,
      issuedAt: now(),
      expiresAt: challenge.expiresAt,
    };
    return { ...withoutMac, mac: sign(withoutMac, deps.macKey) };
  }

  /**
   * Create a client_elicitation attestation for a registered MCP client that has
   * confirmed a generation gate via the elicitation protocol. The main process
   * issues and signs this — the client never handles the macKey — so the audit
   * chain is honest: "a registered MCP client confirmed this gate over elicitation".
   */
  function createClientElicitationAttestation(token: string, authenticatedClient: string): ClientElicitationAttestationV1 {
    const challenge = verifyChallenge(token);
    if (typeof authenticatedClient !== "string" || !authenticatedClient.trim()) {
      throw new ReceiptScopeError("Authenticated client identity is required for client elicitation attestation");
    }
    const withoutMac: Omit<ClientElicitationAttestationV1, "mac"> = {
      kind: "client_elicitation",
      issuer: "nomi-main",
      keyId,
      challengeId: challenge.challengeId,
      decision: "accept",
      authenticatedClient: authenticatedClient.trim(),
      gestureNonce: challenge.nonce,
      issuedAt: now(),
      expiresAt: challenge.expiresAt,
    };
    return { ...withoutMac, mac: sign(withoutMac, deps.macKey) };
  }

  function verifyGesture(token: string, value: unknown): GestureAttestationV1 {
    const challenge = verifyChallenge(token);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new HumanApprovalRequiredError();
    const raw = value as Record<string, unknown>;
    if (raw.kind === "client_elicitation") {
      const attestation = raw as ClientElicitationAttestationV1;
      if (attestation.issuer !== "nomi-main" || attestation.keyId !== keyId
        || attestation.challengeId !== challenge.challengeId || attestation.gestureNonce !== challenge.nonce
        || attestation.decision !== "accept" || typeof attestation.authenticatedClient !== "string" || !attestation.authenticatedClient
        || typeof attestation.mac !== "string"
        || !timingEqual(attestation.mac, sign({ ...attestation, mac: undefined }, deps.macKey))) {
        throw new HumanApprovalRequiredError();
      }
      assertNotExpired(attestation, now());
      return attestation;
    }
    const attestation = raw as MainProcessGestureAttestationV1;
    if (attestation.kind !== "main_process_gesture" || attestation.issuer !== "nomi-main" || attestation.keyId !== keyId
      || attestation.challengeId !== challenge.challengeId || attestation.gestureNonce !== challenge.nonce
      || attestation.decision !== "accept" || !Number.isInteger(attestation.webContentsId) || !Number.isInteger(attestation.frameId)
      || typeof attestation.origin !== "string" || !attestation.origin || typeof attestation.mac !== "string"
      || !timingEqual(attestation.mac, sign({ ...attestation, mac: undefined }, deps.macKey))) {
      throw new HumanApprovalRequiredError();
    }
    assertNotExpired(attestation, now());
    return attestation;
  }

  function mintReceipt(token: string, gesture: unknown): { token: string; receipt: HumanApprovalReceiptV1 } {
    const challenge = verifyChallenge(token);
    const attestation = verifyGesture(token, gesture);
    const state = readState();
    const challengeRecord = state.challenges[challenge.challengeId];
    if (!challengeRecord) throw new HumanApprovalRequiredError();
    if (challengeRecord.status === "accepted" && challengeRecord.receiptToken) {
      const existing = state.receipts[digest(challengeRecord.receiptToken)];
      if (existing) return { token: existing.token, receipt: { ...existing.receipt } };
    }
    const receiptWithoutMac: Omit<HumanApprovalReceiptV1, "mac"> = {
      version: HUMAN_APPROVAL_VERSION,
      keyId,
      algorithm: HUMAN_APPROVAL_ALGORITHM,
      issuer: "nomi-main",
      receiptId: randomId(),
      challengeId: challenge.challengeId,
      handoffId: randomId(),
      immutableProjectUuid: challenge.immutableProjectUuid,
      projectGeneration: challenge.projectGeneration,
      revocationEpoch: challenge.revocationEpoch ?? 0,
      projectId: challenge.projectId,
      runId: challenge.runId,
      gateId: challenge.gateId,
      contractHash: challenge.contractHash,
      targetHash: challenge.targetHash,
      projectRevision: challenge.projectRevision,
      costScope: challenge.costScope,
      pricingSnapshotHash: challenge.pricingSnapshotHash,
      humanActor: attestation.kind === "client_elicitation"
        ? `mcp_client:${attestation.authenticatedClient}`
        : `web_contents:${(attestation as MainProcessGestureAttestationV1).webContentsId}:${(attestation as MainProcessGestureAttestationV1).frameId}:${(attestation as MainProcessGestureAttestationV1).origin}`,
      gestureAttestation: attestation,
      receiptNonce: randomId(),
      audience: HUMAN_APPROVAL_AUDIENCE,
      issuedAt: now(),
      expiresAt: challenge.expiresAt,
    };
    const receipt: HumanApprovalReceiptV1 = { ...receiptWithoutMac, mac: sign(receiptWithoutMac, deps.macKey) };
    const receiptToken = encode(receipt);
    return mutate((next) => {
      const current = next.challenges[challenge.challengeId];
      if (current?.status === "accepted" && current.receiptToken) {
        const existing = next.receipts[digest(current.receiptToken)];
        if (existing) return { result: { token: existing.token, receipt: { ...existing.receipt } }, changed: false };
      }
      if (!current || current.token !== token) throw new HumanApprovalRequiredError();
      next.challenges[challenge.challengeId] = { ...current, status: "accepted", receiptToken };
      next.receipts[digest(receiptToken)] = { token: receiptToken, receipt };
      return { result: { token: receiptToken, receipt }, changed: true };
    });
  }

  function verifyReceipt(token: string): HumanApprovalReceiptV1 {
    const receipt = signed<HumanApprovalReceiptV1>(token, "receipt");
    assertNotExpired(receipt, now());
    const record = readState().receipts[digest(token)];
    if (!record || record.token !== token) throw new ReceiptScopeError("Receipt is not registered");
    if (record.receipt.receiptId !== receipt.receiptId || record.receipt.challengeId !== receipt.challengeId) throw new ReceiptScopeError("Receipt record conflict");
    return receipt;
  }

  /** Resolve the opaque receipt handle carried by a semantic gate call without mutating consumption state. */
  function resolveReceiptToken(receiptId: string): string {
    const normalized = typeof receiptId === "string" ? receiptId.trim() : "";
    if (!normalized) throw new ReceiptScopeError("Receipt id is required");
    const record = Object.values(readState().receipts).find((item) => item.receipt.receiptId === normalized);
    if (!record) throw new ReceiptScopeError("Receipt is not registered");
    return record.token;
  }

  function consumeReceipt(token: string): ReceiptReplayResult {
    const receipt = verifyReceipt(token);
    const tokenKey = digest(token);
    return mutate<ReceiptReplayResult>((state) => {
      const record = state.receipts[tokenKey];
      if (!record) throw new ReceiptScopeError("Receipt is not registered");
      if (record.consumedAt) return { result: { receipt, replayed: true }, changed: false };
      record.consumedAt = now();
      return { result: { receipt, replayed: false }, changed: true };
    });
  }

  return {
    filePath: deps.filePath,
    requestChallenge,
    verifyChallenge,
    resolveChallengeToken,
    createMainProcessGestureAttestation,
    createClientElicitationAttestation,
    mintReceipt,
    verifyReceipt,
    resolveReceiptToken,
    consumeReceipt,
  };
}

export type ApprovalReceiptAuthority = ReturnType<typeof createApprovalReceiptAuthority>;
