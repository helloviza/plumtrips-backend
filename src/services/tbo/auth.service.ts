// apps/backend/src/services/tbo/auth.service.ts
import { httpShared } from "../../lib/http.js";

const TTL_MIN = Number(process.env.TBO_TOKEN_TTL_MIN || 25);

/** Use the exact env var names you had earlier */
const CREDS = {
  ClientId: String(
    process.env.TBO_ClientId || process.env.TBO_CLIENT_ID || ""
  ).trim(),
  UserName: String(
    process.env.TBO_UserName || process.env.TBO_USERNAME || ""
  ).trim(),
  Password: String(
    process.env.TBO_Password || process.env.TBO_PASSWORD || ""
  ).trim(),
  EndUserIp: String(process.env.TBO_EndUserIp || "127.0.0.1").trim(),
};

let cache: { tokenId: string | null; at: number } = { tokenId: null, at: 0 };
const fresh = (): boolean =>
  !!cache.tokenId && (Date.now() - cache.at) / 60000 < TTL_MIN;

// FIX #5: In-flight promise mutex to prevent concurrent auth races.
// Without this, two simultaneous searches both call authenticate() before
// either resolves, get two separate TBO tokens, and the second overwrites
// the cache — leaving the first request holding a token TBO may invalidate.
// Now all concurrent callers share the same in-flight promise.
let _authInFlight: Promise<string> | null = null;

/** For the /tbo/_auth-debug and /tbo/_auth-raw routes */
export function _authBodyForDebug(mask = false) {
  return {
    ClientId: CREDS.ClientId,
    UserName: CREDS.UserName,
    Password: mask ? "********" : CREDS.Password,
    EndUserIp: CREDS.EndUserIp,
  };
}

async function _doAuthenticate(): Promise<string> {
  // Double-check freshness inside the mutex — another call may have
  // already fetched and cached a token while this one was waiting.
  if (fresh()) return cache.tokenId!;

  try {
    const body = _authBodyForDebug(false); // send real password to TBO
    const { data } = await httpShared.post("/Authenticate", body, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const tokenId: string | undefined =
      data?.Response?.TokenId ?? data?.TokenId;

    if (!tokenId) {
      const msg =
        data?.Response?.Error?.ErrorMessage ||
        data?.Error?.ErrorMessage ||
        "Authenticate failed";
      throw new Error(msg);
    }

    cache = { tokenId, at: Date.now() };
    return tokenId;
  } catch (err: any) {
    const status = err?.response?.status;
    const body = err?.response?.data;
    const msg =
      body?.Response?.Error?.ErrorMessage ||
      body?.Error?.ErrorMessage ||
      err?.message ||
      "Authenticate request failed";
    throw new Error(status ? `HTTP ${status} ${msg}` : msg);
  } finally {
    // Always clear the in-flight promise so the next call after a failure
    // (or expiry) can attempt a fresh auth rather than hanging forever.
    _authInFlight = null;
  }
}

export async function authenticate(): Promise<string> {
  // Fast path: already have a fresh cached token
  if (fresh()) return cache.tokenId!;

  // FIX #5: If an auth is already in progress, return the same promise.
  // This prevents N concurrent callers from each firing their own /Authenticate.
  if (_authInFlight) return _authInFlight;

  _authInFlight = _doAuthenticate();
  return _authInFlight;
}

export const getEndUserIp = (): string => CREDS.EndUserIp;