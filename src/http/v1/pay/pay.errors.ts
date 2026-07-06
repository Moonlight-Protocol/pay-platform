import { PlatformError } from "@/error/index.ts";
import type { APIErrorStatus } from "@/http/default-schemas.ts";

/**
 * Error codes owned by the /pay/* payment slice. These are used only when the
 * upstream provider-platform does not supply its own structured error `code`
 * (in which case that provider/soroman code is forwarded verbatim instead).
 */
export enum PAY_ERROR_CODES {
  PROVIDER_BUNDLE_REJECTED = "PAY_BUNDLE_001",
  BUNDLE_SETTLEMENT_FAILED = "PAY_BUNDLE_002",
}

const source = "@http/v1/pay";

/**
 * Statuses accepted by `errorStatusSchema` (default-schemas.ts). Any upstream
 * status outside this set must be mapped before it reaches the wire.
 */
const ALLOWED_STATUSES: readonly number[] = [400, 401, 403, 404, 409, 429];

/**
 * Maps an upstream provider-platform HTTP status onto a status allowed by
 * pay-platform's `errorStatusSchema`.
 * - An allowed 4xx passes through unchanged.
 * - Any other 4xx (a provider-side rejection) collapses to 409 Conflict.
 * - A 5xx / unreachable upstream collapses to 500.
 */
export function mapProviderStatus(providerStatus: number): APIErrorStatus {
  if (ALLOWED_STATUSES.includes(providerStatus)) {
    return providerStatus as APIErrorStatus;
  }
  if (providerStatus >= 400 && providerStatus < 500) return 409;
  return 500;
}

type ProviderErrorBody = {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  details?: unknown;
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * Parses a provider-platform error response body. Provider `PlatformError`s
 * serialize as `{ code, status, message, details }`. Returns `undefined` when
 * the body is missing or is not a JSON object.
 */
export function parseProviderError(
  raw: string,
): ProviderErrorBody | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as ProviderErrorBody;
    }
  } catch {
    // Not JSON — there is no structured identity to forward.
  }
  return undefined;
}

/**
 * A bundle submit/poll returned a non-2xx from provider-platform. Forwards the
 * provider's own error `code` and safe `message`/`details` through
 * pay-platform's structured error system. The raw upstream body is kept only on
 * `baseError` (for logs/traces) and never reaches the wire.
 */
export class PROVIDER_BUNDLE_REJECTED extends PlatformError {
  constructor(args: {
    providerStatus: number;
    providerCode?: string;
    providerMessage?: string;
    providerDetails?: string;
    baseError?: Error | unknown;
  }) {
    const status = mapProviderStatus(args.providerStatus);
    const message = args.providerMessage ??
      "The payment bundle was rejected by the provider.";
    super({
      source,
      code: args.providerCode ?? PAY_ERROR_CODES.PROVIDER_BUNDLE_REJECTED,
      message,
      details: args.providerDetails,
      baseError: args.baseError,
      api: {
        status,
        message,
        details: args.providerDetails,
      },
    });
  }
}

/**
 * Builds a {@link PROVIDER_BUNDLE_REJECTED} from a raw upstream response,
 * preserving the cause chain on `baseError`.
 */
export function providerBundleRejected(
  providerStatus: number,
  rawBody: string,
): PROVIDER_BUNDLE_REJECTED {
  const parsed = parseProviderError(rawBody);
  return new PROVIDER_BUNDLE_REJECTED({
    providerStatus,
    providerCode: asString(parsed?.code),
    providerMessage: asString(parsed?.message),
    providerDetails: asString(parsed?.details),
    baseError: new Error(
      `provider-platform responded ${providerStatus}`,
      rawBody ? { cause: new Error(rawBody) } : undefined,
    ),
  });
}

/**
 * An async bundle failed to settle on chain (poll returned FAILED/EXPIRED, or
 * the settlement wait timed out). The on-chain identity lives in the bundle
 * GET's `data.failureDetail = { code, source, message, name? }`.
 */
export class BUNDLE_SETTLEMENT_FAILED extends PlatformError {
  constructor(args: {
    bundleId: string;
    outcome: string;
    failureCode?: string;
    failureMessage?: string;
    baseError?: Error | unknown;
  }) {
    const message = args.failureMessage ??
      `The payment bundle did not settle (${args.outcome}).`;
    super({
      source,
      code: args.failureCode ?? PAY_ERROR_CODES.BUNDLE_SETTLEMENT_FAILED,
      message,
      baseError: args.baseError,
      api: {
        status: 409,
        message,
      },
    });
  }
}

type FailureDetail = {
  code?: unknown;
  source?: unknown;
  message?: unknown;
  name?: unknown;
};

/**
 * Builds a {@link BUNDLE_SETTLEMENT_FAILED} from a bundle GET's
 * `data.failureDetail`, preserving the cause chain on `baseError`.
 */
export function bundleSettlementFailed(args: {
  bundleId: string;
  outcome: string;
  failureDetail?: FailureDetail;
}): BUNDLE_SETTLEMENT_FAILED {
  const { bundleId, outcome, failureDetail } = args;
  return new BUNDLE_SETTLEMENT_FAILED({
    bundleId,
    outcome,
    failureCode: asString(failureDetail?.code),
    failureMessage: asString(failureDetail?.message),
    baseError: new Error(`bundle ${bundleId} ${outcome}`),
  });
}
