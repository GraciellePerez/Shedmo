export const EASYPOST_PROVIDER = "easypost";
export const EASYPOST_API_BASE = "https://api.easypost.com/v2";
export const EASYPOST_TRACKER_TIMEOUT_MS = 10_000;

export const EASYPOST_HMAC_PREFIX = "hmac-sha256-hex=";
export const EASYPOST_WEBHOOK_TIMESTAMP_TOLERANCE_MS = 60_000;
export const EASYPOST_WEBHOOK_FUTURE_SKEW_MS = 30_000;

export type ShedmoShipmentState =
  | "tracking_validating"
  | "pre_shipment"
  | "carrier_accepted"
  | "in_transit"
  | "delivered"
  | "exception"
  | "invalid"
  | "verification_delayed";

export type EasyPostFailureKind =
  | "invalid_tracking"
  | "auth"
  | "rate_limit"
  | "timeout"
  | "outage"
  | "billing"
  | "config"
  | "transient";

export type EasyPostTracker = {
  id: string;
  object?: string;
  mode?: string;
  tracking_code?: string;
  carrier?: string;
  status?: string;
  status_detail?: string;
  created_at?: string;
  updated_at?: string;
  tracking_details?: Array<{ datetime?: string; status?: string }>;
};

export const EASYPOST_TRACKER_STATUS_MAP = {
  unknown: "tracking_validating",
  pre_transit: "pre_shipment",
  in_transit: "in_transit",
  out_for_delivery: "in_transit",
  available_for_pickup: "in_transit",
  delivered: "delivered",
  return_to_sender: "exception",
  failure: "exception",
  cancelled: "exception",
  error: "exception",
} as const;

const INVALID_TRACKING_CODES = new Set([
  "TRACKER.CARRIER_CODE_MISMATCH",
  "TRACKER.NO_CARRIER_FOR_CODE",
]);

export const mapShedmoCarrierToEasyPost = (carrier: string): string => {
  const normalized = carrier.trim().toUpperCase();
  if (normalized === "USPS" || normalized === "UNITED STATES POSTAL SERVICE") {
    return "USPS";
  }
  if (normalized === "UPS" || normalized === "UNITED PARCEL SERVICE") {
    return "UPS";
  }
  if (normalized === "FEDEX" || normalized === "FEDERAL EXPRESS") {
    return "FedEx";
  }
  throw new Error("UNSUPPORTED_CARRIER");
};

export const mapEasyPostTrackerStatus = (
  status: string | null | undefined,
): ShedmoShipmentState => {
  const key = (status ?? "").trim().toLowerCase();
  if (key in EASYPOST_TRACKER_STATUS_MAP) {
    return EASYPOST_TRACKER_STATUS_MAP[key as keyof typeof EASYPOST_TRACKER_STATUS_MAP];
  }
  return "verification_delayed";
};

export const classifyEasyPostFailure = (input: {
  httpStatus?: number | null;
  code?: string | null;
  message?: string | null;
  timedOut?: boolean;
}): EasyPostFailureKind => {
  if (input.timedOut) return "timeout";
  const status = input.httpStatus ?? 0;
  const code = (input.code ?? "").trim().toUpperCase();
  if (INVALID_TRACKING_CODES.has(code)) return "invalid_tracking";
  if (status === 401 || status === 403 || code === "UNAUTHORIZED" || code === "USER.UNAUTHORIZED") {
    return "auth";
  }
  if (status === 429) return "rate_limit";
  if (status === 402) return "billing";
  if (code === "TRACKER.NO_CARRIER_ACCOUNT" || code === "TRACKER.UNSUPPORTED_CARRIER") {
    return "config";
  }
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500 && status <= 599) return "outage";
  return "transient";
};

export const delayedStateForFailure = (
  kind: EasyPostFailureKind,
): Extract<ShedmoShipmentState, "invalid" | "verification_delayed"> =>
  kind === "invalid_tracking" ? "invalid" : "verification_delayed";

const bytesToHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const timingSafeEqualString = (left: string, right: string): boolean => {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length === rightBytes.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
};

const EASYPOST_RFC_2822_TIMESTAMP =
  /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/;

const EASYPOST_MONTHS = new Map([
  ["Jan", 0], ["Feb", 1], ["Mar", 2], ["Apr", 3],
  ["May", 4], ["Jun", 5], ["Jul", 6], ["Aug", 7],
  ["Sep", 8], ["Oct", 9], ["Nov", 10], ["Dec", 11],
]);

const EASYPOST_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const parseEasyPostWebhookTimestamp = (value: string): number | null => {
  const match = EASYPOST_RFC_2822_TIMESTAMP.exec(value);
  if (!match) return null;
  const [, weekday, dayText, monthText, yearText, hourText, minuteText, secondText,
    offsetSign, offsetHourText, offsetMinuteText] = match;
  const month = EASYPOST_MONTHS.get(monthText);
  if (month === undefined) return null;
  const day = Number(dayText);
  const year = Number(yearText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);
  if (
    day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 23 || offsetMinute > 59
  ) return null;

  const localUtc = Date.UTC(year, month, day, hour, minute, second);
  const localDate = new Date(localUtc);
  if (
    localDate.getUTCFullYear() !== year || localDate.getUTCMonth() !== month ||
    localDate.getUTCDate() !== day || EASYPOST_WEEKDAYS[localDate.getUTCDay()] !== weekday
  ) return null;
  const offsetMs = (offsetHour * 60 + offsetMinute) * 60_000;
  return localUtc - (offsetSign === "+" ? offsetMs : -offsetMs);
};

export const verifyEasyPostWebhookSignatureV2 = async (input: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  timestampHeader: string | null | undefined;
  pathHeader: string | null | undefined;
  requestMethod: string;
  requestPath: string;
  webhookSecret: string;
  nowMs?: number;
}): Promise<boolean> => {
  const provided = input.signatureHeader?.trim() ?? "";
  const timestamp = input.timestampHeader?.trim() ?? "";
  const signedPath = input.pathHeader?.trim() ?? "";
  const signatureMatch = /^hmac-sha256-hex=([a-fA-F0-9]{64})$/.exec(provided);
  if (!signatureMatch || !timestamp || !signedPath || !input.webhookSecret) return false;
  if (signedPath !== input.requestPath) return false;

  const occurredAt = parseEasyPostWebhookTimestamp(timestamp);
  if (occurredAt === null) return false;
  const ageMs = (input.nowMs ?? Date.now()) - occurredAt;
  if (
    ageMs > EASYPOST_WEBHOOK_TIMESTAMP_TOLERANCE_MS ||
    ageMs < -EASYPOST_WEBHOOK_FUTURE_SKEW_MS
  ) return false;

  const normalizedSecret = input.webhookSecret.normalize("NFKD");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalizedSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `${timestamp}${input.requestMethod.toUpperCase()}${signedPath}${input.rawBody}`,
    ),
  );
  const expected = `${EASYPOST_HMAC_PREFIX}${bytesToHex(digest)}`;
  return timingSafeEqualString(expected, provided.toLowerCase());
};

export const isEasyPostTrackerId = (value: string): boolean =>
  /^trk_[A-Za-z0-9]{6,100}$/.test(value);

export const trackerOccurredAt = (
  tracker: EasyPostTracker,
  fallback?: string | null,
): string => {
  const details = Array.isArray(tracker.tracking_details)
    ? tracker.tracking_details
    : [];
  let latest: string | null = null;
  for (const detail of details) {
    if (typeof detail?.datetime === "string" && detail.datetime.trim()) {
      if (!latest || detail.datetime > latest) latest = detail.datetime;
    }
  }
  if (latest) return latest;
  if (typeof tracker.updated_at === "string" && tracker.updated_at.trim()) {
    return tracker.updated_at;
  }
  if (typeof tracker.created_at === "string" && tracker.created_at.trim()) {
    return tracker.created_at;
  }
  if (fallback && fallback.trim()) return fallback;
  return new Date().toISOString();
};

export const asEasyPostTracker = (value: unknown): EasyPostTracker | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !isEasyPostTrackerId(row.id)) return null;
  if (row.object !== undefined && row.object !== "Tracker") return null;
  return {
    id: row.id,
    object: typeof row.object === "string" ? row.object : undefined,
    mode: typeof row.mode === "string" ? row.mode : undefined,
    tracking_code: typeof row.tracking_code === "string"
      ? row.tracking_code
      : undefined,
    carrier: typeof row.carrier === "string" ? row.carrier : undefined,
    status: typeof row.status === "string" ? row.status : undefined,
    status_detail: typeof row.status_detail === "string"
      ? row.status_detail
      : undefined,
    created_at: typeof row.created_at === "string" ? row.created_at : undefined,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : undefined,
    tracking_details: Array.isArray(row.tracking_details)
      ? row.tracking_details as EasyPostTracker["tracking_details"]
      : undefined,
  };
};

export const parseEasyPostTrackerEvent = (payload: unknown): {
  ignored: boolean;
  eventId?: string;
  description?: string;
  tracker?: EasyPostTracker;
  createdAt?: string;
} => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("INVALID_EVENT");
  }
  const row = payload as Record<string, unknown>;
  const description = typeof row.description === "string"
    ? row.description
    : "";
  const eventId = typeof row.id === "string" ? row.id.trim() : "";
  const createdAt = typeof row.created_at === "string" ? row.created_at : undefined;
  if (row.object !== undefined && row.object !== "Event") {
    throw new Error("INVALID_EVENT");
  }
  if (!description.startsWith("tracker.")) {
    return { ignored: true, eventId: eventId || undefined, description };
  }
  if (!eventId || eventId.length > 120) throw new Error("INVALID_EVENT");
  const tracker = asEasyPostTracker(row.result);
  if (!tracker) throw new Error("INVALID_EVENT");
  return { ignored: false, eventId, description, tracker, createdAt };
};

const basicAuthHeader = (apiKey: string): string => {
  const bytes = new TextEncoder().encode(`${apiKey}:`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
};

const readEasyPostError = async (response: Response): Promise<{
  code: string | null;
  message: string | null;
}> => {
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { code: null, message: null };
  }
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return { code: null, message: null };
  }
  const row = error as { code?: unknown; message?: unknown };
  return {
    code: typeof row.code === "string" ? row.code : null,
    message: typeof row.message === "string" ? row.message : null,
  };
};

export type EasyPostTrackerResult =
  | { ok: true; tracker: EasyPostTracker }
  | {
    ok: false;
    kind: EasyPostFailureKind;
    httpStatus: number | null;
    code: string | null;
  };

const easypostRequest = async (
  apiKey: string,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<EasyPostTrackerResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EASYPOST_TRACKER_TIMEOUT_MS);
  try {
    const response = await fetch(`${EASYPOST_API_BASE}${path}`, {
      method,
      headers: {
        authorization: basicAuthHeader(apiKey),
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!response.ok) {
      const parsed = await readEasyPostError(response);
      return {
        ok: false,
        kind: classifyEasyPostFailure({
          httpStatus: response.status,
          code: parsed.code,
          message: parsed.message,
        }),
        httpStatus: response.status,
        code: parsed.code,
      };
    }
    const payload = await response.json().catch(() => null);
    const tracker = asEasyPostTracker(payload);
    if (!tracker) {
      return { ok: false, kind: "transient", httpStatus: response.status, code: null };
    }
    return { ok: true, tracker };
  } catch (error) {
    const timedOut = error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError");
    return {
      ok: false,
      kind: classifyEasyPostFailure({ timedOut, httpStatus: timedOut ? 408 : 0 }),
      httpStatus: timedOut ? 408 : null,
      code: timedOut ? "timeout" : null,
    };
  } finally {
    clearTimeout(timer);
  }
};

export const createEasyPostTracker = (
  apiKey: string,
  trackingCode: string,
  shedmoCarrier: string,
): Promise<EasyPostTrackerResult> =>
  easypostRequest(apiKey, "POST", "/trackers", {
    tracker: {
      tracking_code: trackingCode,
      carrier: mapShedmoCarrierToEasyPost(shedmoCarrier),
    },
  });

export const retrieveEasyPostTracker = (
  apiKey: string,
  trackerId: string,
): Promise<EasyPostTrackerResult> =>
  easypostRequest(apiKey, "GET", `/trackers/${encodeURIComponent(trackerId)}`);
