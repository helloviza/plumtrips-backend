// apps/backend/src/services/tbo/auth.service.ts
// src/services/tbo/auth.service.ts
//
// Shared TBO authentication — used by BOTH flights and hotels booking API.
//
// Flow:
//   POST /Authenticate → { TokenId, TokenAgencyId, TokenMemberId, ... }
//   Cache for TTL_MIN minutes, inject into every downstream request body.
//   On expiry or 401/token-error → re-authenticate transparently.

import { httpShared } from "../../lib/http.js";

const TTL_MIN = Number(process.env.TBO_TOKEN_TTL_MIN || 25);

export const getEndUserIp = (): string => {
  const ip = String(process.env.TBO_EndUserIp || "127.0.0.1").trim();
  return ip || "127.0.0.1";
};

/**
 * TBO /Book rejects blank or placeholder client IPs. Use the request-derived IP when
 * it looks real; otherwise fall back to `TBO_EndUserIp` (same as Authenticate).
 */
export function resolveBookingEndUserIp(detected?: string | null): string {
  let ip = String(detected ?? "").trim();
  if (ip.toLowerCase().startsWith("::ffff:")) ip = ip.slice(7).trim();
  if (!ip || /^(unknown|null|undefined)$/i.test(ip)) return getEndUserIp();
  return ip;
}

// Read credentials lazily at call time — dotenv is always populated before first call.
function getCreds() {
  return {
    ClientId:  String(process.env.TBO_ClientId  || process.env.TBO_CLIENT_ID  || "").trim(),
    UserName:  String(process.env.TBO_UserName  || process.env.TBO_USERNAME   || "").trim(),
    Password:  String(process.env.TBO_Password  || process.env.TBO_PASSWORD   || "").trim(),
    EndUserIp: getEndUserIp(),
  };
}

// Full token state — we need AgencyId + MemberId for Logout / GetAgencyBalance
interface TokenCache {
  tokenId:       string | null;
  agencyId:      string | null;
  memberId:      string | null;
  at:            number;
}

let cache: TokenCache = { tokenId: null, agencyId: null, memberId: null, at: 0 };

const isFresh = (): boolean =>
  !!cache.tokenId && (Date.now() - cache.at) / 60_000 < TTL_MIN;

// ── Public helpers ────────────────────────────────────────────────────────────

/** Auth body for debug routes — mask=true hides the password */
export function _authBodyForDebug(mask = false) {
  const c = getCreds();
  return {
    ClientId:  c.ClientId,
    UserName:  c.UserName,
    Password:  mask ? "********" : c.Password,
    EndUserIp: c.EndUserIp,
  };
}

/**
 * Returns a valid TBO TokenId.
 * Calls POST /Authenticate only when the cached token is missing or expired.
 * Shared by flights, hotel booking, logout, and agency balance.
 */
export async function authenticate(): Promise<string> {
  if (isFresh()) return cache.tokenId!;

  const body = _authBodyForDebug(false);
  console.log(`[auth] Authenticating → ClientId="${body.ClientId}" UserName="${body.UserName}" EndUserIp="${body.EndUserIp}"`);

  try {
    const { data } = await httpShared.post("/Authenticate", body, {
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });

    // TBO wraps the response: data.Response.TokenId  OR  data.TokenId
    const resp      = data?.Response ?? data;
    const tokenId   = resp?.TokenId   as string | undefined;
    const agencyId  = resp?.TokenAgencyId  as string | undefined;
    const memberId  = resp?.TokenMemberId  as string | undefined;

    if (!tokenId) {
      const msg =
        resp?.Error?.ErrorMessage ||
        data?.Error?.ErrorMessage ||
        "Authenticate returned no TokenId";
      throw new Error(msg);
    }

    cache = { tokenId, agencyId: agencyId ?? null, memberId: memberId ?? null, at: Date.now() };
    console.log(`[auth] Token acquired (AgencyId=${agencyId ?? "?"} MemberId=${memberId ?? "?"}) — valid for ${TTL_MIN} min`);
    return tokenId;
  } catch (err: any) {
    cache = { tokenId: null, agencyId: null, memberId: null, at: 0 };

    const status  = err?.response?.status;
    const resBody = err?.response?.data;
    const msg =
      resBody?.Response?.Error?.ErrorMessage ||
      resBody?.Error?.ErrorMessage ||
      err?.message ||
      "Authenticate request failed";
    throw new Error(status ? `HTTP ${status}: ${msg}` : msg);
  }
}

/** Force-invalidate the cached token (called after a downstream 401 / token-error) */
export function invalidateToken(): void {
  cache = { tokenId: null, agencyId: null, memberId: null, at: 0 };
  console.log("[auth] Token cache invalidated — will re-authenticate on next request");
}

/** Returns the full token state — needed for Logout and GetAgencyBalance */
export function getTokenState(): Readonly<TokenCache> {
  return { ...cache };
}

// ── Logout ────────────────────────────────────────────────────────────────────

/**
 * POST /Logout — invalidates the token on TBO's side.
 * Requires ClientId, TokenAgencyId, TokenMemberId, EndUserIp, TokenId.
 */
export async function logout(): Promise<any> {
  const tokenId  = cache.tokenId;
  const agencyId = cache.agencyId;
  const memberId = cache.memberId;

  if (!tokenId) {
    return { message: "No active token to logout" };
  }

  const c = getCreds();
  const body = {
    ClientId:       c.ClientId,
    TokenAgencyId:  agencyId  ?? "",
    TokenMemberId:  memberId  ?? "",
    EndUserIp:      c.EndUserIp,
    TokenId:        tokenId,
  };

  try {
    const { data } = await httpShared.post("/Logout", body, {
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
    return data;
  } finally {
    // Always clear local cache regardless of TBO response
    invalidateToken();
  }
}

// ── GetAgencyBalance ──────────────────────────────────────────────────────────

/**
 * POST /GetAgencyBalance — fetches wallet/account balance.
 * Requires ClientId, TokenAgencyId, TokenMemberId, EndUserIp, TokenId.
 */
export async function getAgencyBalance(): Promise<any> {
  // Ensure we have a valid token first
  const tokenId = await authenticate();
  const state   = getTokenState();
  const c       = getCreds();

  const body = {
    ClientId:      c.ClientId,
    TokenAgencyId: state.agencyId ?? "",
    TokenMemberId: state.memberId ?? "",
    EndUserIp:     c.EndUserIp,
    TokenId:       tokenId,
  };

  const { data } = await httpShared.post("/GetAgencyBalance", body, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });

  return data;
}
