// ApexIQ v4.9.9.10 Source Re-Extract + Edge Fix
/**
 * ApexIQ API Proxy v4.4.4
 * Browser Render Fix
 *
 * This restores the method we actually need:
 * - ALS /bridge for stable selected legend/basic stats
 * - Cloudflare Browser Run /json for rendered ALS profile legend cards + badges
 * - Cloudflare Browser Run /json for rendered ALS leaderboard rows
 * - Safe prestige/true-level calculation
 *
 * Cloudflare required for rendered data:
 * - Browser Run / Browser Rendering binding named BROWSER
 * - compatibility_date: 2026-03-24 or later
 *
 * Fallback REST option:
 * - CF_ACCOUNT_ID
 * - CF_BROWSER_API_TOKEN with Browser Rendering - Edit permission
 *
 * Normal:
 * - ALS_API_KEY
 * - TRN_API_KEY optional; Tracker integration is next
 * - APEXIQ_LEVEL_OVERRIDES optional:
 *   {"imissanyway":{"prestigeCompleted":2,"prestigeLabel":"Prestige 2"}}
 */

const VERSION = "4.9.9.130-worker-founder-persistence-request-lfg-delete";

const LEGEND_NAMES = [
  "Alter","Ash","Axle","Ballistic","Bangalore","Bloodhound","Catalyst","Caustic","Conduit","Crypto",
  "Fuse","Gibraltar","Horizon","Lifeline","Loba","Mad Maggie","Mirage","Newcastle","Octane","Pathfinder",
  "Rampart","Revenant","Seer","Sparrow","Valkyrie","Vantage","Wattson","Wraith"
];

const PLATFORMS = [
  { key: "PC", label: "PC", als: "PC", trackerSlug: "origin" },
  { key: "PS4", label: "PlayStation", als: "PS4", trackerSlug: "psn" },
  { key: "X1", label: "Xbox", als: "X1", board: "XBOX", trackerSlug: "xbl" },
  { key: "SWITCH", label: "Switch", als: "SWITCH", trackerSlug: null }
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = pickCorsOrigin(request, env);

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });

    try {
      const betaAccessRoute = await routeBetaAccess(request, env, origin, url);
      if (betaAccessRoute) return betaAccessRoute;

      if (url.pathname === "/api/health") {
        return json({
          ok: true,
          service: "ApexIQ API Proxy",
          version: VERSION,
          alsSecretSet: !!env.ALS_API_KEY,
          trackerSecretSet: !!(env.TRN_API_KEY || env.TRACKER_API_KEY),
          browserBindingSet: !!(env.BROWSER && typeof env.BROWSER.quickAction === "function"),
          browserRestSet: !!(env.CF_ACCOUNT_ID && env.CF_BROWSER_API_TOKEN),
          renderedRecovery: browserReady(env),
          rollbackSafe: true,
          stableBase: "v4.6.8",
          endpoints: ["/api/player","/api/ranked-fast","/api/ranked","/api/meta","/api/beta/verify","/api/beta/session","/api/beta/admin/login","/api/beta/founder-status","/api/beta/admin/users","/api/beta/admin/set-founder","/api/beta/admin/requests","/api/beta/admin/request-delete","/api/beta/admin/logout","/api/rendered-profile","/api/badge-scan","/api/rendered-ranked","/api/doctor","/api/als-test","/api/switch-ranked","/api/health"]
        }, origin);
      }

      if (url.pathname === "/api/doctor") {
        return json({
          ok: true,
          version: VERSION,
          renderedRecovery: browserReady(env),
          checks: {
            ALS_API_KEY: !!env.ALS_API_KEY,
            BROWSER_binding: !!(env.BROWSER && typeof env.BROWSER.quickAction === "function"),
            CF_BROWSER_REST: !!(env.CF_ACCOUNT_ID && env.CF_BROWSER_API_TOKEN),
            TRN_API_KEY: !!(env.TRN_API_KEY || env.TRACKER_API_KEY),
            APEXIQ_LEVEL_OVERRIDES: !!env.APEXIQ_LEVEL_OVERRIDES
          },
          browserRunRequiredFor: ["full rendered ALS legend cards", "official-looking rendered badge ownership", "automatic rendered leaderboard rows"],
          ifFalse: "If renderedRecovery is false, add a Browser Run binding named BROWSER and set compatibility_date to 2026-03-24 or later."
        }, origin);
      }

      if (url.pathname === "/api/als-test") return json(await testALS(env), origin);

      if (url.pathname === "/api/tracker-test") {
        const player = String(url.searchParams.get("player") || "imissanyway").trim();
        const platform = cleanPlatform(url.searchParams.get("platform") || "PC");
        return json(await safeTracker(player, platform, env), origin);
      }

      if (url.pathname === "/api/rendered-profile") {
        const player = String(url.searchParams.get("player") || "imissanyway").trim();
        const platform = cleanPlatform(url.searchParams.get("platform") || "PC");
        let data;
        try {
          data = await getRenderedProfile(player, platform, "", env);
        } catch (e) {
          data = { ok: false, source: "Browser Run rendered ALS page", error: e.message, legendCards: [], accountBadges: [] };
        }
        // Always return 200 JSON so the frontend never crashes/turns red from a recover-only endpoint.
        return json({ ok: !!data.ok, version: VERSION, profilePage: data }, origin, 200);
      }

      if (url.pathname === "/api/badge-scan") {
        const data = await handleBadgeScan(url, env, ctx, request);
        return json(data, origin, 200);
      }

      if (url.pathname === "/api/badge-scan-lite") {
        const data = await handleBadgeScanLite(url, env, ctx, request);
        return json(data, origin, 200);
      }

      if (url.pathname === "/api/badge-self-test") {
        return respond(url, runBadgeSelfTest(), origin, 200);
      }

      if (url.pathname === "/api/legend-extract-self-test") {
        return respond(url, runLegendExtractSelfTest(), origin, 200);
      }

      if (url.pathname === "/api/rendered-ranked") {
        const platform = cleanPlatform(url.searchParams.get("platform") || "PC");
        const data = await getRenderedLeaderboard(platform, env);
        return json({ ok: !!data.ok, version: VERSION, ranked: data }, origin, data.ok ? 200 : 500);
      }

      if (url.pathname === "/api/meta") {
        const data = await handleMeta(url, env, ctx, request);
        return json(data, origin, data.ok ? 200 : 500);
      }

      if (url.pathname === "/api/resolve-player") {
        const forceResolve = url.searchParams.get("refresh") === "1" || url.searchParams.get("nocache") === "1";
        const cleanResolveUrl = new URL(url.toString());
        cleanResolveUrl.searchParams.delete("refresh");
        cleanResolveUrl.searchParams.delete("nocache");
        cleanResolveUrl.searchParams.delete("_");
        cleanResolveUrl.searchParams.delete("callback");
        cleanResolveUrl.searchParams.delete("client");
        const resolveCacheKey = new Request(cleanResolveUrl.toString(), request);
        if (!forceResolve) {
          const cachedResolve = await caches.default.match(resolveCacheKey);
          if (cachedResolve) {
            const cachedData = await cachedResolve.json();
            return respond(url, { ...cachedData, cached: true, cacheSource: "resolve-player" }, origin, 200);
          }
        }
        const data = await handleResolvePlayer(url, env, ctx, request);
        if (data && data.ok) {
          ctx.waitUntil(caches.default.put(resolveCacheKey, new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } })));
        }
        return respond(url, data, origin, 200);
      }

      if (url.pathname === "/api/resolver-self-test") {
        return respond(url, runResolverSelfTest(), origin, 200);
      }


      if (url.pathname === "/api/player-lite") {
        const data = await handlePlayerLite(url, env, ctx, request);
        return respond(url, data, origin, 200, 120);
      }

      if (url.pathname === "/api/player") {
        const data = await handlePlayer(url, env, ctx, request);
        return respond(url, data, origin, 200, 600);
      }

      if (url.pathname === "/api/ranked-fast") {
        const data = await handleRankedFast(url, env, ctx, request);
        return respond(url, data, origin, 200);
      }

      if (url.pathname === "/api/ranked") {
        const data = await handleRanked(url, env, ctx, request);
        return json(data, origin, data.ok ? 200 : 500);
      }

      if (url.pathname === "/api/switch-ranked") {
        const data = await handleSwitchRanked(url, env, ctx, request);
        return json(data, origin, data.ok ? 200 : 200);
      }

      return json({ ok: false, error: "Not found", version: VERSION }, origin, 404);
    } catch (err) {
      return respond(url, { ok: false, error: String(err && err.message ? err.message : err), version: VERSION }, origin, 200);
    }
  }
};


// === ApexIQ v4.9.9.89 Worker-backed beta access + admin panel endpoints ===
const APEXIQ_ADMIN_EMAIL = "coyemicthell@gmail.com";
const BETA_CODE_PREFIX = "beta_code:";
const BETA_ADMIN_SESSION_PREFIX = "beta_admin_session:";
const BETA_TESTER_SESSION_PREFIX = "beta_tester_session:";
const BETA_REQUEST_PREFIX = "beta_access_request:";
const BETA_FOUNDER_PREFIX = "beta_founder:";

async function routeBetaAccess(request, env, origin, url) {
  if (!url.pathname.startsWith("/api/beta")) return null;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin, 0) });
  try {
    const kv = betaKV(env);
    const body = request.method === "POST" ? await readBodyJSON(request) : {};

    if (url.pathname === "/api/beta/founder-status" && request.method === "GET") {
      const data = await betaFounderStatus(kv, url);
      return jsonPrivate(data, origin, 200);
    }

    if (url.pathname === "/api/beta/verify" && request.method === "POST") {
      const data = await betaVerify(kv, body);
      return json(data, origin, data.ok ? 200 : 400);
    }

    if (url.pathname === "/api/beta/session" && request.method === "POST") {
      const data = await betaSession(kv, body);
      return json(data, origin, data.ok ? 200 : 401);
    }

    if (url.pathname === "/api/beta/request-access" && request.method === "POST") {
      const data = await betaRequestAccess(kv, body, request);
      return jsonPrivate(data, origin, data.ok ? 200 : 400);
    }

    if (url.pathname === "/api/beta/admin/login" && request.method === "POST") {
      const data = await betaAdminLogin(kv, env, body);
      return jsonPrivate(data, origin, data.ok ? 200 : 401);
    }

    if (url.pathname.startsWith("/api/beta/admin/")) {
      const admin = await requireBetaAdmin(kv, request, body);
      if (!admin.ok) return jsonPrivate(admin, origin, 401);

      if (url.pathname === "/api/beta/admin/logout" && request.method === "POST") {
        await kv.delete(BETA_ADMIN_SESSION_PREFIX + admin.token);
        return jsonPrivate({ ok: true, loggedOut: true }, origin, 200);
      }
      if (url.pathname === "/api/beta/admin/users" && request.method === "GET") {
        return jsonPrivate(await betaAdminUsers(kv), origin, 200);
      }
      if (url.pathname === "/api/beta/admin/requests" && request.method === "GET") {
        return jsonPrivate(await betaAdminRequests(kv), origin, 200);
      }
      if (url.pathname === "/api/beta/admin/request-update" && request.method === "POST") {
        return jsonPrivate(await betaAdminRequestUpdate(kv, body, admin), origin, 200);
      }
      if (url.pathname === "/api/beta/admin/request-delete" && request.method === "POST") {
        return jsonPrivate(await betaAdminRequestDelete(kv, body, admin), origin, 200);
      }
      if (url.pathname === "/api/beta/admin/create" && request.method === "POST") {
        return jsonPrivate(await betaAdminCreate(kv, body, admin), origin, 200);
      }
      if (url.pathname === "/api/beta/admin/set-founder" && request.method === "POST") {
        return jsonPrivate(await betaAdminSetFounder(kv, body, admin), origin, 200);
      }
      if (url.pathname === "/api/beta/admin/update" && request.method === "POST") {
        return jsonPrivate(await betaAdminUpdate(kv, body, admin), origin, 200);
      }
      if (url.pathname === "/api/beta/admin/reset-devices" && request.method === "POST") {
        return jsonPrivate(await betaAdminResetDevices(kv, body, admin), origin, 200);
      }
      if (url.pathname === "/api/beta/admin/disable" && request.method === "POST") {
        return jsonPrivate(await betaAdminUpdate(kv, { ...body, status: "disabled" }, admin), origin, 200);
      }
      if (url.pathname === "/api/beta/admin/enable" && request.method === "POST") {
        return jsonPrivate(await betaAdminUpdate(kv, { ...body, status: "active" }, admin), origin, 200);
      }
      if (url.pathname === "/api/beta/admin/delete" && request.method === "POST") {
        return jsonPrivate(await betaAdminDelete(kv, body, admin), origin, 200);
      }
    }

    return json({ ok: false, error: "Unknown beta endpoint.", version: VERSION }, origin, 404);
  } catch (error) {
    const message = error && error.message ? error.message : String(error || "Beta access error");
    const status = /not configured/i.test(message) ? 503 : 500;
    return json({ ok: false, error: message, version: VERSION }, origin, status);
  }
}

function betaKV(env) {
  const kv = env.APEXIQ_BETA_KV || env.BETA_KV || env.AIQ_BETA_KV;
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    throw new Error("ApexIQ beta KV is not configured. Bind a KV namespace as APEXIQ_BETA_KV.");
  }
  return kv;
}

async function readBodyJSON(request) {
  const text = await request.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch (_) { throw new Error("Invalid JSON body."); }
}

function cleanBetaCode(input) {
  return String(input || "").normalize("NFKC").trim().toUpperCase()
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/\s+/g, "");
}
function cleanUsername(input) { return String(input || "").normalize("NFKC").trim(); }
function normUsername(input) { return cleanUsername(input).toLowerCase().replace(/[^a-z0-9]/g, ""); }
function betaBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (["1","true","yes","on","enabled"].includes(text)) return true;
  if (["0","false","no","off","disabled"].includes(text)) return false;
  return fallback;
}
function founderBadgeEnabled(record) {
  if (!record || record.status === "disabled") return false;
  if (Object.prototype.hasOwnProperty.call(record, "founderBadge")) {
    return betaBool(record.founderBadge, false);
  }
  // Migration for existing records created before the explicit toggle existed.
  return String(record.role || "").toLowerCase() === "founder" ||
    /(?:^|\b)(?:founder|founding)(?:\b|$)/i.test(String(record.badge || ""));
}
function founderPlatformNorm(input) {
  const p = String(input || "auto").trim().toLowerCase();
  if (!p || p === "auto" || p === "any" || p === "all" || p === "not sure") return "auto";
  if (["ps4","ps5","psn","playstation"].includes(p)) return "playstation";
  if (["x1","xbox","xbl","seriesx","series s","series x"].includes(p)) return "xbox";
  if (["switch","nintendo"].includes(p)) return "switch";
  if (["pc","origin","steam","ea"].includes(p)) return "pc";
  return p.replace(/[^a-z0-9]+/g, "");
}
function founderIndexKey(usernameNorm, platform) {
  return BETA_FOUNDER_PREFIX + normUsername(usernameNorm) + ":" + founderPlatformNorm(platform);
}
function founderIndexKeys(record) {
  if (!record || !record.assignedUsernameNorm) return [];
  return [founderIndexKey(record.assignedUsernameNorm, record.platform || "Auto")];
}
async function syncFounderIndex(kv, previous, current) {
  const keys = new Set([...founderIndexKeys(previous), ...founderIndexKeys(current)]);
  for (const key of keys) await kv.delete(key);
  if (!current || !current.assignedUsernameNorm || !founderBadgeEnabled(current) || current.status !== "active") return;
  const payload = {
    username: current.assignedUsername || "",
    usernameNorm: current.assignedUsernameNorm,
    platform: founderPlatformNorm(current.platform || "Auto"),
    founder: true,
    updatedAt: current.updatedAt || isoNow()
  };
  await kvPutJSON(kv, founderIndexKey(current.assignedUsernameNorm, current.platform || "Auto"), payload);
}
async function betaFounderStatus(kv, url) {
  const username = cleanUsername(url.searchParams.get("username") || url.searchParams.get("player"));
  const usernameNorm = normUsername(username);
  const platform = founderPlatformNorm(url.searchParams.get("platform") || "Auto");
  if (!usernameNorm) return { ok: true, founder: false, username: "", platform };

  const candidateKeys = [
    founderIndexKey(usernameNorm, platform),
    founderIndexKey(usernameNorm, "auto")
  ];
  for (const key of [...new Set(candidateKeys)]) {
    const hit = await kvGetJSON(kv, key);
    if (hit && hit.founder === true) {
      return { ok: true, founder: true, username: hit.username || username, platform: hit.platform || platform };
    }
  }

  // One-time compatibility scan for records created before the founder index.
  let cursor;
  do {
    const listed = await kv.list({ prefix: BETA_CODE_PREFIX, cursor, limit: 250 });
    cursor = listed.cursor;
    for (const item of listed.keys || []) {
      const record = await kvGetJSON(kv, item.name);
      if (!record || record.assignedUsernameNorm !== usernameNorm || !founderBadgeEnabled(record) || record.status !== "active") continue;
      const recordPlatform = founderPlatformNorm(record.platform || "Auto");
      if (platform !== "auto" && recordPlatform !== "auto" && recordPlatform !== platform) continue;
      await syncFounderIndex(kv, null, record);
      return { ok: true, founder: true, username: record.assignedUsername || username, platform: recordPlatform };
    }
  } while (cursor);

  return { ok: true, founder: false, username, platform };
}
function isoNow() { return new Date().toISOString(); }
function clampInt(value, min, max, fb) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fb; }
function publicBetaRecord(record, revealCode = true) {
  return {
    code: revealCode ? record.code : undefined,
    assignedUsername: record.assignedUsername || "",
    assignedUsernameNorm: record.assignedUsernameNorm || "",
    platform: record.platform || "Auto",
    status: record.status || "active",
    role: record.role || "tester",
    badge: record.badge || "Original Beta Tester",
    founderBadge: founderBadgeEnabled(record),
    maxDevices: record.maxDevices || 2,
    devices: Array.isArray(record.devices) ? record.devices : [],
    createdAt: record.createdAt || "",
    createdBy: record.createdBy || "",
    updatedAt: record.updatedAt || "",
    updatedBy: record.updatedBy || "",
    lastLoginAt: record.lastLoginAt || null,
    notes: record.notes || ""
  };
}
async function kvGetJSON(kv, key) { const v = await kv.get(key, "json"); return v || null; }
async function kvPutJSON(kv, key, value, options) { return kv.put(key, JSON.stringify(value, null, 2), options || {}); }

function randomPart(len = 4) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
async function generateBetaCode(kv) {
  for (let i = 0; i < 40; i++) {
    const code = `AIX-${randomPart(4)}-${randomPart(4)}`;
    const existing = await kvGetJSON(kv, BETA_CODE_PREFIX + code);
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique beta code.");
}
function token(prefix = "") {
  if (crypto.randomUUID) return prefix + crypto.randomUUID().replace(/-/g, "");
  return prefix + randomPart(8) + randomPart(8) + Date.now().toString(36);
}

async function betaVerify(kv, body) {
  const code = cleanBetaCode(body.code);
  const username = cleanUsername(body.username || body.assignedUsername);
  const usernameNorm = normUsername(username);
  const deviceId = String(body.deviceId || "").trim();
  const deviceSignatureHash = String(body.deviceSignatureHash || "").trim();
  const label = String(body.label || "Web device").slice(0, 120);

  if (!username) return { ok: false, error: "Enter your Apex username." };
  if (!code) return { ok: false, error: "Access key not found or inactive." };
  if (!deviceId) return { ok: false, error: "Could not verify this device. Refresh and try again." };

  const key = BETA_CODE_PREFIX + code;
  const record = await kvGetJSON(kv, key);
  if (!record || record.status !== "active") return { ok: false, error: "Access key not found or inactive." };
  if (!record.assignedUsernameNorm) return { ok: false, error: "Access key is not assigned yet. Message Coye for setup." };
  if (record.assignedUsernameNorm !== usernameNorm) return { ok: false, error: "Access key does not match that Apex username." };

  const devices = Array.isArray(record.devices) ? record.devices : [];
  const now = isoNow();
  const maxDevices = clampInt(record.maxDevices, 1, 10, 2);
  let found = devices.find(d => d && d.deviceId === deviceId);
  if (!found && deviceSignatureHash) found = devices.find(d => d && d.deviceSignatureHash && d.deviceSignatureHash === deviceSignatureHash);

  if (found) {
    found.deviceId = found.deviceId || deviceId;
    found.deviceSignatureHash = found.deviceSignatureHash || deviceSignatureHash;
    found.lastSeenAt = now;
    found.label = label || found.label || "Web device";
  } else {
    if (devices.length >= maxDevices) {
      return { ok: false, error: "This beta key is already active on 2 devices. Message Coye if you need a reset." };
    }
    devices.push({ deviceId, firstSeenAt: now, lastSeenAt: now, label, deviceSignatureHash });
  }

  record.devices = devices;
  record.lastLoginAt = now;
  record.updatedAt = now;
  await kvPutJSON(kv, key, record);

  const sessionToken = token("bt_");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  await kvPutJSON(kv, BETA_TESTER_SESSION_PREFIX + sessionToken, { code, username: record.assignedUsername, usernameNorm, deviceId, deviceSignatureHash, createdAt: now, expiresAt }, { expirationTtl: 60 * 60 * 24 * 31 });

  return { ok: true, sessionToken, expiresAt, code, assignedUsername: record.assignedUsername, platform: record.platform || "Auto", role: record.role || "tester", badge: record.badge || "Original Beta Tester", founderBadge: founderBadgeEnabled(record), maxDevices, devicesUsed: devices.length, admin: record.role === "admin" || record.role === "founder" };
}

async function betaSession(kv, body) {
  const sessionToken = String(body.sessionToken || "").trim();
  if (!sessionToken) return { ok: false, error: "Missing beta session." };
  const sess = await kvGetJSON(kv, BETA_TESTER_SESSION_PREFIX + sessionToken);
  if (!sess) return { ok: false, error: "Beta session expired. Sign in again." };
  if (Date.parse(sess.expiresAt || "") < Date.now()) return { ok: false, error: "Beta session expired. Sign in again." };
  const record = await kvGetJSON(kv, BETA_CODE_PREFIX + sess.code);
  if (!record || record.status !== "active") return { ok: false, error: "Access key not found or inactive." };
  const devices = Array.isArray(record.devices) ? record.devices : [];
  const deviceId = String(body.deviceId || sess.deviceId || "").trim();
  const known = devices.some(d => d && (d.deviceId === deviceId || (body.deviceSignatureHash && d.deviceSignatureHash === body.deviceSignatureHash)));
  if (!known) return { ok: false, error: "This device is not linked to that beta key." };
  return { ok: true, sessionToken, expiresAt: sess.expiresAt, code: record.code, assignedUsername: record.assignedUsername, platform: record.platform || "Auto", role: record.role || "tester", badge: record.badge || "Original Beta Tester", founderBadge: founderBadgeEnabled(record), maxDevices: record.maxDevices || 2, devicesUsed: devices.length, admin: record.role === "admin" || record.role === "founder" };
}

async function betaRequestAccess(kv, body, request) {
  const apexUsername = cleanUsername(body.apexUsername || body.username);
  if (!apexUsername) return { ok: false, error: "Enter your exact Apex username." };
  if (!body.agreedNoShare) return { ok: false, error: "Confirm that you will not share the access key." };
  const now = isoNow();
  const id = `${Date.now().toString(36)}_${randomPart(6)}`;
  const record = {
    id, apexUsername, apexUsernameNorm: normUsername(apexUsername),
    name: String(body.name || "").trim().slice(0, 100),
    platform: String(body.platform || "Auto").trim().slice(0, 40),
    mainLegend: String(body.mainLegend || "").trim().slice(0, 60),
    device: String(body.device || "").trim().slice(0, 120),
    notes: String(body.notes || "").trim().slice(0, 700),
    status: "new", createdAt: now, updatedAt: now,
    userAgent: String(request.headers.get("User-Agent") || "").slice(0, 220)
  };
  await kvPutJSON(kv, BETA_REQUEST_PREFIX + id, record);
  return { ok: true, id, message: "Request sent to the ApexIQ Admin console." };
}

async function betaAdminRequests(kv) {
  const requests = []; let cursor;
  do {
    const listed = await kv.list({ prefix: BETA_REQUEST_PREFIX, cursor, limit: 1000 });
    cursor = listed.cursor;
    for (const item of listed.keys || []) { const rec = await kvGetJSON(kv, item.name); if (rec) requests.push(rec); }
  } while (cursor);
  requests.sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return { ok: true, requests, count: requests.length };
}

async function betaAdminRequestUpdate(kv, body, admin) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, error: "Missing request id." };
  const key = BETA_REQUEST_PREFIX + id; const rec = await kvGetJSON(kv, key);
  if (!rec) return { ok: false, error: "Access request not found." };
  rec.status = ["new","reviewed","approved","denied"].includes(String(body.status)) ? String(body.status) : rec.status;
  rec.updatedAt = isoNow(); rec.updatedBy = admin.email;
  await kvPutJSON(kv, key, rec); return { ok: true, request: rec };
}

async function betaAdminRequestDelete(kv, body, admin) {
  const id = String(body.id || "").trim();
  if (!id) return { ok: false, error: "Missing request id." };
  const key = BETA_REQUEST_PREFIX + id;
  const rec = await kvGetJSON(kv, key);
  if (!rec) return { ok: false, error: "Access request not found." };
  await kv.delete(key);
  return { ok: true, deleted: id, updatedBy: admin.email };
}

async function betaAdminLogin(kv, env, body) {
  const email = String(body.email || "").trim().toLowerCase();
  const secret = String(body.secret || "");
  if (!env.APEXIQ_ADMIN_SECRET) return { ok: false, error: "APEXIQ_ADMIN_SECRET is not configured in the Worker." };
  if (email !== APEXIQ_ADMIN_EMAIL || secret !== String(env.APEXIQ_ADMIN_SECRET)) return { ok: false, error: "Admin login failed." };
  const adminToken = token("adm_");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 6).toISOString();
  await kvPutJSON(kv, BETA_ADMIN_SESSION_PREFIX + adminToken, { email, createdAt: isoNow(), expiresAt }, { expirationTtl: 60 * 60 * 6 });
  return { ok: true, adminToken, expiresAt, email };
}

async function requireBetaAdmin(kv, request, body = {}) {
  const auth = request.headers.get("Authorization") || "";
  const adminToken = String(body.adminToken || auth.replace(/^Bearer\s+/i, "")).trim();
  if (!adminToken) return { ok: false, error: "Admin session required." };
  const sess = await kvGetJSON(kv, BETA_ADMIN_SESSION_PREFIX + adminToken);
  if (!sess || Date.parse(sess.expiresAt || "") < Date.now()) return { ok: false, error: "Admin session expired." };
  if (String(sess.email || "").toLowerCase() !== APEXIQ_ADMIN_EMAIL) return { ok: false, error: "Admin session invalid." };
  return { ok: true, email: sess.email, token: adminToken };
}

async function betaAdminUsers(kv) {
  const users = [];
  let cursor;
  do {
    const listed = await kv.list({ prefix: BETA_CODE_PREFIX, cursor, limit: 1000 });
    cursor = listed.cursor;
    for (const item of listed.keys || []) {
      const rec = await kvGetJSON(kv, item.name);
      if (rec) users.push(publicBetaRecord(rec, true));
    }
    if (users.length >= 1000) break;
  } while (cursor);
  users.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return { ok: true, users, count: users.length };
}

async function betaAdminCreate(kv, body, admin) {
  const code = cleanBetaCode(body.code) || await generateBetaCode(kv);
  const assignedUsername = cleanUsername(body.assignedUsername || body.username || "");
  const now = isoNow();
  if (await kvGetJSON(kv, BETA_CODE_PREFIX + code)) return { ok: false, error: "That access code already exists." };
  const record = {
    code,
    assignedUsername,
    assignedUsernameNorm: assignedUsername ? normUsername(assignedUsername) : "",
    platform: String(body.platform || "Auto").trim() || "Auto",
    status: assignedUsername ? String(body.status || "active") : "disabled",
    role: String(body.role || "tester").trim() || "tester",
    badge: String(body.badge || "Original Beta Tester").trim() || "Original Beta Tester",
    founderBadge: betaBool(body.founderBadge, String(body.role || "").toLowerCase() === "founder"),
    maxDevices: clampInt(body.maxDevices, 1, 10, 2),
    devices: [],
    createdAt: now,
    createdBy: admin.email,
    updatedAt: now,
    updatedBy: admin.email,
    lastLoginAt: null,
    notes: String(body.notes || "").slice(0, 500)
  };
  await kvPutJSON(kv, BETA_CODE_PREFIX + code, record);
  await syncFounderIndex(kv, null, record);
  return { ok: true, code, record: publicBetaRecord(record, true) };
}

async function betaAdminUpdate(kv, body, admin) {
  const code = cleanBetaCode(body.code);
  if (!code) return { ok: false, error: "Missing code." };
  const key = BETA_CODE_PREFIX + code;
  const record = await kvGetJSON(kv, key);
  if (!record) return { ok: false, error: "Access key not found." };
  const previous = { ...record };
  if (body.assignedUsername !== undefined || body.username !== undefined) {
    const name = cleanUsername(body.assignedUsername !== undefined ? body.assignedUsername : body.username);
    record.assignedUsername = name;
    record.assignedUsernameNorm = name ? normUsername(name) : "";
    if (!name) record.status = "disabled";
  }
  if (body.platform !== undefined) record.platform = String(body.platform || "Auto").trim() || "Auto";
  if (body.status !== undefined) record.status = ["active", "disabled"].includes(String(body.status)) ? String(body.status) : record.status;
  if (body.role !== undefined) record.role = String(body.role || "tester").trim() || "tester";
  if (body.badge !== undefined) record.badge = String(body.badge || "Original Beta Tester").trim() || "Original Beta Tester";
  if (body.founderBadge !== undefined) record.founderBadge = betaBool(body.founderBadge, false);
  if (body.maxDevices !== undefined) record.maxDevices = clampInt(body.maxDevices, 1, 10, record.maxDevices || 2);
  if (body.notes !== undefined) record.notes = String(body.notes || "").slice(0, 500);
  record.updatedAt = isoNow();
  record.updatedBy = admin.email;
  await kvPutJSON(kv, key, record);
  await syncFounderIndex(kv, previous, record);
  return { ok: true, record: publicBetaRecord(record, true) };
}

async function betaAdminSetFounder(kv, body, admin) {
  const code = cleanBetaCode(body.code);
  if (!code) return { ok: false, error: "Missing code." };
  const key = BETA_CODE_PREFIX + code;
  const record = await kvGetJSON(kv, key);
  if (!record) return { ok: false, error: "Access key not found." };

  const previous = { ...record };
  const enabled = betaBool(
    body.enabled !== undefined ? body.enabled : body.founderBadge,
    false
  );
  record.founderBadge = enabled;
  record.updatedAt = isoNow();
  record.updatedBy = admin.email;

  await kvPutJSON(kv, key, record);
  await syncFounderIndex(kv, previous, record);

  const publicRecord = publicBetaRecord(record, true);
  return {
    ok: true,
    founderBadge: publicRecord.founderBadge === true,
    record: publicRecord,
    version: VERSION
  };
}

async function betaAdminResetDevices(kv, body, admin) {
  const code = cleanBetaCode(body.code);
  if (!code) return { ok: false, error: "Missing code." };
  const key = BETA_CODE_PREFIX + code;
  const record = await kvGetJSON(kv, key);
  if (!record) return { ok: false, error: "Access key not found." };
  record.devices = [];
  record.updatedAt = isoNow();
  record.updatedBy = admin.email;
  await kvPutJSON(kv, key, record);
  return { ok: true, record: publicBetaRecord(record, true) };
}

async function betaAdminDelete(kv, body, admin) {
  const code = cleanBetaCode(body.code);
  if (!code) return { ok: false, error: "Missing code." };
  const key = BETA_CODE_PREFIX + code;
  const previous = await kvGetJSON(kv, key);
  await kv.delete(key);
  await syncFounderIndex(kv, previous, null);
  return { ok: true, deleted: code, updatedBy: admin.email };
}

function browserReady(env) {
  return !!(env.BROWSER && typeof env.BROWSER.quickAction === "function") || !!(env.CF_ACCOUNT_ID && env.CF_BROWSER_API_TOKEN);
}

function pickCorsOrigin(request, env) {
  const setting = String(env.ALLOWED_ORIGIN || "*").trim();
  const reqOrigin = request.headers.get("Origin") || "";
  if (!setting || setting === "*") return "*";
  const allowed = setting.split(",").map(s => s.trim()).filter(Boolean);
  if (reqOrigin && allowed.includes(reqOrigin)) return reqOrigin;
  return allowed[0] || "*";
}

function corsHeaders(origin = "*", cacheSeconds = 15) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `public, max-age=${cacheSeconds}`,
    "X-ApexIQ-Version": VERSION
  };
}

function json(data, origin = "*", status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: corsHeaders(origin) });
}

function jsonPrivate(data, origin = "*", status = 200) {
  const headers = corsHeaders(origin, 0);
  headers["Cache-Control"] = "private, no-store, max-age=0";
  headers["Pragma"] = "no-cache";
  headers["Expires"] = "0";
  headers["Vary"] = "Origin, Authorization";
  headers["X-Content-Type-Options"] = "nosniff";
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

function respond(url, data, origin = "*", status = 200, cacheSeconds = 15) {
  const cb = url && (url.searchParams.get("callback") || url.searchParams.get("jsonp"));
  if (cb) {
    const callback = String(cb).trim();
    if (!/^[A-Za-z_$][0-9A-Za-z_$.]{0,80}$/.test(callback)) {
      return json({ ok: false, error: "Invalid JSONP callback.", version: VERSION }, origin, 400);
    }
    const body = `${callback}(${JSON.stringify(data)});`;
    const headers = corsHeaders(origin, 0);
    headers["Content-Type"] = "application/javascript; charset=utf-8";
    headers["Cache-Control"] = "no-store";
    return new Response(body, { status: 200, headers });
  }
  const headers = corsHeaders(origin, cacheSeconds);
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

function cleanPlatform(input) {
  const p = String(input || "auto").toUpperCase();
  if (p === "AUTO" || p === "ANY" || p === "ALL") return "auto";
  if (p === "PLAYSTATION" || p === "PSN" || p === "PS5") return "PS4";
  if (p === "XBOX" || p === "XB1" || p === "SERIESX" || p === "XBL") return "X1";
  if (p === "NINTENDO") return "SWITCH";
  return PLATFORMS.some(x => x.key === p) ? p : "auto";
}

function platformInfo(platform) {
  return PLATFORMS.find(p => p.key === platform) || PLATFORMS[0];
}

function boardPlatform(platform) {
  const p = platformInfo(platform);
  return p.board || p.als || p.key;
}

function profileUrl(platform, player) {
  return `https://apexlegendsstatus.com/profile/${platformInfo(platform).als}/${encodeURIComponent(player || "")}`;
}

function profileUidUrl(platform, uid) {
  return `https://apexlegendsstatus.com/profile/uid/${platformInfo(platform).als}/${encodeURIComponent(uid || "")}`;
}

function boardUrl(platform) {
  return `https://apexlegendsstatus.com/live-ranked-leaderboards/Battle_Royale/${boardPlatform(platform)}`;
}

async function fetchWithTimeout(url, options = {}, defaultMs = 8500) {
  const timeoutMs = Number(options.timeoutMs || defaultMs || 8500);
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort("timeout"); } catch (_) {} }, Math.max(1500, timeoutMs));
  const { timeoutMs: _dropTimeout, signal: _dropSignal, ...rest } = options || {};
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } catch (e) {
    if (String(e && e.name || "").toLowerCase().includes("abort")) throw new Error(`Timeout after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}) {
  const res = await fetchWithTimeout(url, {
    ...options,
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "User-Agent": "ApexIQ/4.9.9.41 (+Cloudflare Worker)",
      ...(options.headers || {})
    }
  }, options.timeoutMs || 8500);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = { raw: text.slice(0, 1800) }; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.error || data.Error || data.message || text.slice(0, 220)}`);
  return data;
}


async function fetchText(url, options = {}) {
  const res = await fetchWithTimeout(url, {
    ...options,
    headers: {
      "Accept": "text/html,text/plain,*/*",
      "User-Agent": "Mozilla/5.0 ApexIQ/4.9.9.41 speed resolver",
      ...(options.headers || {})
    }
  }, options.timeoutMs || 7500);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
  return text;
}


async function testALS(env) {
  if (!env.ALS_API_KEY) return { ok: false, version: VERSION, error: "ALS_API_KEY is not set." };
  const tests = [];
  for (const [name, url] of [
    ["predator", `https://api.apexlegendsstatus.com/predator?auth=${encodeURIComponent(env.ALS_API_KEY)}`],
    ["bridge", `https://api.apexlegendsstatus.com/bridge?auth=${encodeURIComponent(env.ALS_API_KEY)}&player=imissanyway&platform=PC&merge=1`],
    ["leaderboard", `https://api.apexlegendsstatus.com/leaderboard?auth=${encodeURIComponent(env.ALS_API_KEY)}&legend=Global&key=rankScore&platform=PC`]
  ]) {
    try {
      const data = await fetchJson(url);
      tests.push({ name, ok: true, keys: Object.keys(data || {}).slice(0, 25), rows: countRows(data) });
    } catch (e) {
      tests.push({ name, ok: false, error: e.message });
    }
  }
  return { ok: tests.some(t => t.ok), leaderboardAccess: !!(tests.find(t => t.name === "leaderboard") || {}).rows, renderedRecovery: browserReady(env), version: VERSION, tests };
}


function profileUsableForWorker(profile) {
  if (!profile || typeof profile !== "object") return false;
  const fields = profile.fields || {};
  const keys = ["trueLevel","visibleLevel","level","rank","rp","rankScore","kills","damage","wins","games","kdr","uid","legend","rankedPosition"];
  if (keys.some(k => fields[k] && fields[k].value !== undefined && fields[k].value !== null && String(fields[k].value).trim() !== "" && String(fields[k].value).trim() !== "—")) return true;
  if ((profile.legendStats || profile.allLegendStats || []).length) return true;
  if (profile.uid) return true;
  return false;
}

async function safeRankedProfileLookup(player, platformReq) {
  const wanted = norm(player);
  if (!wanted) return { ok: false, error: "No player to match." };
  const order = platformReq === "auto" ? ["PC", "PS4", "X1"] : [platformReq].filter(p => p !== "SWITCH");
  const candidates = [];
  const errors = [];
  for (const platform of order) {
    try {
      const info = await fetchApexRankedAllPagesFast(platform, 3);
      for (const row of (info.players || [])) {
        if (!row || !row.name) continue;
        const rn = norm(row.name);
        const exact = rn === wanted;
        const loose = !exact && (rn.includes(wanted) || wanted.includes(rn)) && Math.min(rn.length, wanted.length) >= 5;
        if (exact || loose) candidates.push({ ...row, platform, platformKey: platform, match: exact ? "exact" : "loose", source: "ApexRanked public ranked board" });
      }
    } catch (e) {
      errors.push(`${platform}: ${e.message || e}`);
    }
  }
  if (!candidates.length) return { ok: false, error: errors.join(" | ") || "No ranked row matched.", candidates: [] };
  candidates.sort((a,b) => (a.match === "exact" ? -1 : 1) - (b.match === "exact" ? -1 : 1) || toNum(a.rank) - toNum(b.rank) || toNum(b.rp) - toNum(a.rp));
  return { ok: true, row: candidates[0], candidates: candidates.slice(0, 8), platform: candidates[0].platformKey || candidates[0].platform };
}

function applyRankedFallbackProfile(profile, rankedLookup, player, platformReq) {
  if (!rankedLookup || !rankedLookup.ok || !rankedLookup.row) return profile;
  const row = rankedLookup.row;
  const platform = row.platformKey || row.platform || rankedLookup.platform || (platformReq === "auto" ? "PC" : platformReq);
  const out = profile && typeof profile === "object" ? profile : {};
  out.name = first(out.name, row.name, player);
  out.platform = first(out.platform, platform);
  out.platformUsed = first(out.platformUsed, platform);
  out.platformRequested = platformReq;
  out.platformLabel = platformInfo(platform).label;
  out.fields = out.fields || {};
  if (!out.fields.rank || !out.fields.rank.value) putField(out.fields, "rank", "Apex Predator", "ApexRanked public ranked board");
  if (!out.fields.rp || !out.fields.rp.value) putField(out.fields, "rp", row.rp || row.score, "ApexRanked public ranked board");
  if (!out.fields.rankScore || !out.fields.rankScore.value) putField(out.fields, "rankScore", row.rp || row.score, "ApexRanked public ranked board");
  if (row.rank && (!out.fields.rankedPosition || !out.fields.rankedPosition.value)) putField(out.fields, "rankedPosition", `#${row.rank}`, "ApexRanked public ranked board");
  if (row.legend && (!out.fields.legend || !out.fields.legend.value)) putField(out.fields, "legend", row.legend, "ApexRanked public ranked board");
  const rankedStats = normalizeStats([
    row.rank ? { label: "Pred rank", value: row.rank, source: "ApexRanked public ranked board" } : null,
    row.rp ? { label: "Ranked RP", value: row.rp, source: "ApexRanked public ranked board" } : null
  ].filter(Boolean));
  if (row.legend && rankedStats.length) {
    const rankedRow = { legend: row.legend, stats: rankedStats, trackers: rankedStats.map(s => ({ name: s.label, value: s.value, source: s.source })), source: "ApexRanked public ranked board" };
    out.legendStats = mergeLegendRows(out.legendStats || out.allLegendStats || [], [rankedRow]);
    out.allLegendStats = out.legendStats;
  }
  out.rankedLookup = rankedLookup;
  out.rankedOnly = !profileUsableForWorker(profile);
  out.ok = true;
  out.sources = [...(out.sources || []), { name: "ApexRanked public ranked board", ok: true, match: rankedLookup.row.match, platform }];
  out.missing = [...(out.missing || []), "Level/20B/4K require ALS profile or proof; ranked board row is not enough."];
  return out;
}

async function safePublicBadgeHtmlScan(player, platform, uid) {
  const targets = [];
  if (uid) targets.push(profileUidUrl(platform, uid));
  targets.push(profileUrl(platform, player));
  for (const target of targets) {
    try {
      const html = await fetchText(target, { headers: { "Accept": "text/html,*/*" } });
      const raw = html.slice(0, 900000);
      const badges = htmlBadgeObjectsFromAttributes(raw, "ALS public profile HTML");
      if (badges.length) return { ok: true, source: "ALS public profile HTML", url: target, accountBadges: badges, legendCards: [] };
    } catch (_) {}
  }
  return { ok: false, source: "ALS public profile HTML", accountBadges: [], legendCards: [], error: "No static badge HTML detected." };
}




function parseSearchLookup(input, platformReq) {
  const raw = String(input || "").trim();
  const out = { raw, player: raw, uid: "", platform: platformReq || "auto", mode: "name" };
  let m = raw.match(/apexlegendsstatus\.com\/profile\/uid\/(PC|PS4|X1|XBOX|PS5|PS4|SWITCH)\/([0-9]{8,32})/i);
  if (m) {
    out.mode = "als_uid_url";
    out.platform = cleanPlatform(m[1]);
    out.uid = m[2];
    out.player = "";
    return out;
  }
  m = raw.match(/apexlegendsstatus\.com\/profile\/(PC|PS4|X1|XBOX|PS5|PS4|SWITCH)\/([^?#/\s]+)/i);
  if (m) {
    out.mode = "als_name_url";
    out.platform = cleanPlatform(m[1]);
    out.player = decodeURIComponent(m[2]);
    return out;
  }
  m = raw.match(/^uid[:\s/-]*(PC|PS4|X1|XBOX|PS5|SWITCH)?[:\s/-]*([0-9]{8,32})$/i) || raw.match(/^([0-9]{10,32})$/);
  if (m) {
    out.mode = "uid";
    out.platform = m[2] ? cleanPlatform(m[1] || platformReq || "auto") : platformReq;
    out.uid = m[2] || m[1];
    out.player = "";
    return out;
  }
  return out;
}


function aliasVariantsForMatch(player) {
  return playerNameVariants(player).map(norm).filter(Boolean);
}

function uidProfileUrl(platform, uid) {
  return `https://apexlegendsstatus.com/profile/uid/${cleanPlatform(platform)}/${encodeURIComponent(uid)}`;
}

function profileExistsFromHtml(html) {
  const t = String(textFromHtml(html || "") || "").toLowerCase();
  if (!t.trim()) return false;
  if (/no profile found|couldn.t find any matching player|please double check the name|has been active on apex at least once/.test(t)) return false;
  if (/level|username aliases|show account wide badges|kills|damage|rank|profile claim|match history|stats/.test(t)) return true;
  return false;
}

function profileMatchScoreFromHtml(html, player, platform, uid) {
  const raw = String(html || "");
  const text = textFromHtml(raw);
  const hay = norm(text + " " + raw);
  const wanted = norm(player);
  const aliases = aliasVariantsForMatch(player);
  let score = 0;
  const reasons = [];
  if (profileExistsFromHtml(raw)) { score += 25; reasons.push("profile-exists"); }
  if (uid && raw.includes(String(uid))) { score += 35; reasons.push("uid-in-page"); }
  if (platform && new RegExp(`/profile/(?:uid/)?${cleanPlatform(platform)}/`, "i").test(raw)) { score += 10; reasons.push("platform-url"); }
  if (wanted && hay.includes(wanted)) { score += 35; reasons.push("display-name-exact"); }
  for (const a of aliases) {
    if (a && a !== wanted && hay.includes(a)) { score += 18; reasons.push("alias-match"); break; }
  }
  if (/usernamealiases|usernamealias/.test(hay)) { score += 8; reasons.push("alias-section"); }
  if (/showaccountwidebadges|profileclaim|matchhistory|winpickrates/.test(hay)) { score += 8; reasons.push("als-profile-markers"); }
  return { score, reasons };
}

async function verifyAlsUidProfile(uid, platform, player) {
  const p = cleanPlatform(platform || "PC");
  const target = uidProfileUrl(p, uid);
  try {
    const html = await fetchText(target, { headers: { "Accept": "text/html,*/*" } });
    const exists = profileExistsFromHtml(html);
    const match = profileMatchScoreFromHtml(html, player, p, uid);
    return { ok: exists && match.score >= 35, exists, confidence: match.score, reasons: match.reasons, uid, platform: p, url: target, source: "ALS UID profile verification" };
  } catch (e) {
    return { ok: false, exists: false, confidence: 0, reasons: ["fetch-error"], uid, platform: p, url: target, error: e.message, source: "ALS UID profile verification" };
  }
}

function scoreUidCandidate(candidate, player) {
  const name = norm(candidate.name || candidate.player || "");
  const wanted = norm(player || "");
  const aliases = aliasVariantsForMatch(player || "");
  let score = 0;
  const reasons = [];
  if (candidate.uid) { score += 40; reasons.push("has-uid"); }
  if (wanted && name === wanted) { score += 45; reasons.push("exact-name"); }
  else if (wanted && (name.includes(wanted) || wanted.includes(name)) && Math.min(name.length, wanted.length) >= 5) { score += 18; reasons.push("loose-name"); }
  else {
    for (const a of aliases) {
      if (a && name === a) { score += 35; reasons.push("exact-alias"); break; }
      if (a && (name.includes(a) || a.includes(name)) && Math.min(name.length, a.length) >= 5) { score += 14; reasons.push("loose-alias"); break; }
    }
  }
  if (candidate.rank) score += Math.max(0, 12 - Math.min(12, Number(candidate.rank) / 25));
  if (candidate.rp) score += Math.min(12, Number(candidate.rp) / 50000);
  if (/ALS/i.test(candidate.source || "")) score += 8;
  return { score: Math.round(score), reasons };
}

function parseUidLinksAroundName(html, wantedName, platformFallback, source) {
  const raw = String(html || "");
  const wanted = norm(wantedName);
  const aliases = aliasVariantsForMatch(wantedName);
  const rows = [];
  const linkRx = /href=["']([^"']*\/profile\/uid\/(PC|PS4|X1|SWITCH)\/([0-9]{8,32})[^"']*)["']/gi;
  let m;
  while ((m = linkRx.exec(raw)) && rows.length < 80) {
    const start = Math.max(0, m.index - 900);
    const end = Math.min(raw.length, m.index + 1400);
    const chunk = raw.slice(start, end);
    const text = textFromHtml(chunk);
    const n = norm(text + " " + chunk);
    const nameMatch = wanted && (n.includes(wanted) || aliases.some(a => a && n.includes(a)));
    if (!nameMatch) continue;
    const rp = (text.match(/([0-9]{2,3}(?:,[0-9]{3})+)\s*RP?/i) || [])[1] || "";
    const rank = (text.match(/#\s*([0-9]{1,4})\b/) || text.match(/\b([0-9]{1,4})\s+(?:[A-Za-z0-9_ .-]{3,32})\s+[0-9,]+\s*RP/i) || [])[1] || "";
    const row = { platform: cleanPlatform(m[2] || platformFallback), uid: m[3], name: wantedName, href: m[1], rank: toNum(rank), rp: toNum(rp), source };
    const s = scoreUidCandidate(row, wantedName);
    rows.push({ ...row, confidence: s.score, reasons: s.reasons });
  }
  const seen = new Set();
  return rows.filter(r => {
    const k = `${r.platform}:${r.uid}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a,b)=>(b.confidence||0)-(a.confidence||0));
}

function alsSearchPageUrls(player, platformReq) {
  const q = encodeURIComponent(String(player || "").trim());
  const platforms = platformReq === "auto" ? ["PC","PS4","X1","SWITCH"] : [cleanPlatform(platformReq)];
  const urls = [];
  for (const p of platforms) {
    urls.push({ platform: p, url: `https://apexlegendsstatus.com/profile/${p}/${q}`, type: "profile-name" });
  }
  urls.push({ platform: platformReq === "auto" ? "PC" : cleanPlatform(platformReq), url: `https://apexlegendsstatus.com/search?query=${q}`, type: "search" });
  urls.push({ platform: platformReq === "auto" ? "PC" : cleanPlatform(platformReq), url: `https://apexlegendsstatus.com/?q=${q}`, type: "home-search" });
  return urls;
}

async function safeALSProfileUidSearch(player, platformReq, env) {
  const attempts = [];
  const candidates = [];
  const pages = alsSearchPageUrls(player, platformReq);
  for (const page of pages) {
    try {
      const html = await fetchText(page.url, { headers: { "Accept": "text/html,*/*" } });
      const profileMatch = profileMatchScoreFromHtml(html, player, page.platform, "");
      const links = parseUidLinksAroundName(html, player, page.platform, `ALS ${page.type} static HTML`);
      attempts.push({ step: page.type, url: page.url, platform: page.platform, ok: links.length > 0 || profileMatch.score >= 60, confidence: profileMatch.score, links: links.length });
      candidates.push(...links);
      // If /profile/platform/name exists and contains a canonical UID link, this is usually enough.
      const canonical = String(html).match(/\/profile\/uid\/(PC|PS4|X1|SWITCH)\/([0-9]{8,32})/i);
      if (canonical && profileMatch.score >= 45) {
        const row = { platform: cleanPlatform(canonical[1]), uid: canonical[2], name: player, href: uidProfileUrl(canonical[1], canonical[2]), source: `ALS ${page.type} canonical UID`, confidence: profileMatch.score + 45, reasons: profileMatch.reasons };
        candidates.push(row);
      }
    } catch (e) {
      attempts.push({ step: page.type, url: page.url, platform: page.platform, ok: false, error: e.message });
    }
  }

  // Browser Run fallback for search/profile pages if static HTML is hidden.
  if (!candidates.length && browserReady(env)) {
    for (const page of pages.slice(0, 4)) {
      try {
        const script = alsLeaderboardUidScript(player);
        const snap = await browserSnapshotExtract(env, page.url, script);
        const rows = (snap.rows || []).map(r => {
          const s = scoreUidCandidate(r, player);
          return { ...r, platform: cleanPlatform(r.platform || page.platform), confidence: s.score, reasons: s.reasons, source: `Browser Run ${page.type} UID extractor` };
        });
        attempts.push({ step: `${page.type}-browser`, url: page.url, ok: rows.length > 0, rows: rows.length });
        candidates.push(...rows);
        if (candidates.length) break;
      } catch (e) {
        attempts.push({ step: `${page.type}-browser`, url: page.url, ok: false, error: e.message });
      }
    }
  }

  if (!candidates.length) return { ok: false, attempts, candidates: [], error: "No UID candidates found on ALS profile/search pages." };

  // Verify candidates before returning. This prevents passing wrong-user data.
  const verified = [];
  for (const c of candidates.sort((a,b)=>(b.confidence||0)-(a.confidence||0)).slice(0, 8)) {
    const v = await verifyAlsUidProfile(c.uid, c.platform, player);
    verified.push({ ...c, verification: v, confidence: (c.confidence || 0) + (v.ok ? v.confidence : Math.floor((v.confidence || 0) / 2)), verified: !!v.ok });
  }
  verified.sort((a,b)=>(b.verified?1:0)-(a.verified?1:0) || (b.confidence||0)-(a.confidence||0));
  const best = verified[0];
  const ok = !!best && best.verified && best.confidence >= 75;
  return { ok, ...(best || {}), attempts, candidates: verified.slice(0, 8), error: ok ? "" : "UID candidates found but none passed confidence verification." };
}


function playerNameVariants(player) {
  const raw = String(player || "").trim();
  const variants = new Set();
  const add = s => {
    s = String(s || "").trim().replace(/\s+/g, " ");
    if (s && s.length <= 64) variants.add(s);
  };
  add(raw);
  add(raw.normalize ? raw.normalize("NFKC") : raw);
  add(raw.replace(/^@+/, ""));
  add(raw.replace(/^(ttv|twitch\.tv\/|yt_|yt-|youtube\.com\/|kick\.com\/)/i, ""));
  add(raw.replace(/\[[^\]]+\]|\([^)]*\)|\{[^}]*\}/g, "").trim());
  add(raw.replace(/[·•|]+/g, " ").trim());
  add(raw.replace(/\s+/g, ""));
  add(raw.replace(/_/g, " "));
  add(raw.replace(/-/g, " "));
  const leet = raw
    .replace(/3/g, "e").replace(/4/g, "a").replace(/0/g, "o")
    .replace(/5/g, "s").replace(/1/g, "i").replace(/7/g, "t");
  add(leet);
  add(leet.replace(/\s+/g, ""));
  // Deadkenn3dys type Steam-display workaround: common EA alias may use real letters.
  add(raw.replace(/3/gi, "e"));
  // Try lower/title variants because some endpoints are weird with special case/spacing.
  add(raw.toLowerCase());
  add(raw.toUpperCase());
  return [...variants].slice(0, 14);
}

function bridgeHasUsefulData(bridge) {
  if (!bridge || !bridge.ok || !bridge.raw) return false;
  const raw = bridge.raw || {};
  const global = raw.global || {};
  const realtime = raw.realtime || {};
  const rank = global.rank || raw.rank || {};
  const selected = raw.legends && raw.legends.selected ? raw.legends.selected : {};
  const trackers = extractALSTrackers(selected, raw);
  return !!(
    raw.uid || global.uid || realtime.uid ||
    global.level || raw.level || realtime.level ||
    first(rank.rankScore, rank.RP, rank.score) ||
    trackers.length ||
    extractLegendStats(raw).length
  );
}

async function fetchBestBridgeSmart(player, platformReq, key) {
  if (!key) return { ok: false, error: "ALS_API_KEY not set", platformUsed: platformReq === "auto" ? "PC" : platformReq, raw: {}, tried: [] };
  const attempts = [];
  let best = null;
  for (const candidate of playerNameVariants(player)) {
    const b = await fetchBestBridge(candidate, platformReq, key);
    attempts.push({ candidate, ok: !!b.ok, platformUsed: b.platformUsed, score: b.score || 0, error: b.error || "", tried: b.tried || [] });
    if (b.ok && (!best || (b.score || 0) > (best.score || 0))) best = { ...b, resolvedPlayer: candidate, resolver: "ALS bridge name variant" };
    if (b.ok && bridgeHasUsefulData(b) && (b.score || 0) >= 12) break;
  }
  if (best) return { ...best, resolverAttempts: attempts };
  return { ok: false, platformUsed: platformReq === "auto" ? "PC" : platformReq, raw: {}, error: attempts.map(a => `${a.candidate}: ${a.error || "no profile"}`).join(" | "), resolverAttempts: attempts };
}

async function fetchBridgeExactThenSmart(player, platformReq, key) {
  if (!key) return { ok: false, error: "ALS_API_KEY not set", platformUsed: platformReq === "auto" ? "PC" : platformReq, raw: {}, tried: [] };
  const exact = await fetchBestBridge(player, platformReq, key);
  if (bridgeHasUsefulData(exact)) {
    return { ...exact, resolvedPlayer: player, resolver: "ALS exact-name bridge", resolverAttempts: [{ candidate: player, ok: true, platformUsed: exact.platformUsed, score: exact.score || 0 }] };
  }
  const smart = await fetchBestBridgeSmart(player, platformReq, key);
  return { ...smart, exactAttempt: { ok: !!exact.ok, platformUsed: exact.platformUsed, score: exact.score || 0, error: exact.error || "" } };
}

async function fetchBridgeByUid(uid, platformReq, key) {
  if (!key || !uid) return { ok: false, error: "Missing key or UID", raw: {}, platformUsed: platformReq === "auto" ? "PC" : platformReq };
  const order = platformReq === "auto" ? ["PC", "PS4", "X1", "SWITCH"] : [platformReq];
  const jobs = [];
  for (const platform of order) {
    for (const mode of ["uid", "player"]) jobs.push({ platform, mode });
  }
  const settled = await Promise.all(jobs.map(async job => {
    const api = new URL("https://api.apexlegendsstatus.com/bridge");
    api.searchParams.set("auth", key);
    api.searchParams.set("platform", job.platform);
    api.searchParams.set("merge", "1");
    api.searchParams.set(job.mode, uid);
    try {
      const data = await fetchJson(api.toString(), { timeoutMs: platformReq === "auto" ? 6500 : 8500 });
      const ok = data && (data.global || data.legends || data.realtime || data.uid) && !data.Error && !data.error;
      const score = ok ? scoreBridge(data) : 0;
      if (!ok) return { ...job, ok: false, score, error: data.Error || data.error || "No payload" };
      return { ...job, ok: true, score, value: { ok: true, source: "Apex Legends Status /bridge UID", platformUsed: job.platform, raw: data, score, resolver: "ALS UID bridge" } };
    } catch (e) {
      return { ...job, ok: false, error: e.message };
    }
  }));
  const tried = settled.map(r => r.ok ? { platform: r.platform, mode: r.mode, ok: true, score: r.score } : { platform: r.platform, mode: r.mode, ok: false, error: r.error });
  const valid = settled.filter(r => r.ok).map(r => r.value);
  if (valid.length) {
    valid.sort((a,b)=>(b.score||0)-(a.score||0));
    return { ...valid[0], tried };
  }
  return { ok: false, raw: {}, platformUsed: order[0], tried, error: tried.map(t => `${t.platform}/${t.mode}: ${t.error}`).join(" | ") };
}


function alsLeaderboardUidScript(wantedName) {
  const safeWanted = JSON.stringify(String(wantedName || ""));
  return String.raw`
(function(){
  const WANTED=${safeWanted};
  function clean(s){return String(s||"").replace(/\s+/g," ").trim();}
  function norm(s){return String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");}
  function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
  function num(v){const n=Number(String(v||"").replace(/,/g,""));return Number.isFinite(n)?n:0;}
  const wanted=norm(WANTED), rows=[];
  const anchors=Array.from(document.querySelectorAll("a[href*='/profile/uid/'],a[href*='/profile/']"));
  for(const a of anchors){
    const href=a.href||a.getAttribute("href")||"";
    const box=a.closest("tr,[role='row'],li,.row,div")||a;
    const text=clean((box.innerText||box.textContent||"")+" "+(a.innerText||a.textContent||""));
    const n=norm(text);
    if(!wanted||(!n.includes(wanted)&&!wanted.includes(n)))continue;
    const m=href.match(/\/profile\/uid\/(PC|PS4|X1|SWITCH)\/([0-9]+)/i);
    const m2=href.match(/\/profile\/(PC|PS4|X1|SWITCH)\/([^/?#]+)/i);
    const rp=(text.match(/([0-9]{2,3}(?:,[0-9]{3})+)\s*RP?/i)||[])[1]||"";
    const rank=(text.match(/#?\s*([0-9]{1,3})\b/)||[])[1]||"";
    if(m)rows.push({platform:m[1].toUpperCase(),uid:m[2],name:WANTED,href,rank:num(rank),rp:num(rp),source:"ALS rendered leaderboard UID anchor"});
    else if(m2)rows.push({platform:m2[1].toUpperCase(),player:decodeURIComponent(m2[2]),name:WANTED,href,rank:num(rank),rp:num(rp),source:"ALS rendered leaderboard profile anchor"});
  }
  const data={ok:rows.length>0,rows:rows.slice(0,10),source:"ALS leaderboard UID resolver",wanted:WANTED};
  document.documentElement.innerHTML="<html><body><pre id='apexiq-data'>"+esc(JSON.stringify(data))+"</pre></body></html>";
})();`;
}

function parseAlsUidLinksFromHtml(html, wantedName, platformFallback, source) {
  const raw = String(html || "");
  const text = textFromHtml(raw);
  const wanted = norm(wantedName);
  const rows = [];
  const rx = /href=["']([^"']*\/profile\/uid\/(PC|PS4|X1|SWITCH)\/([0-9]+)[^"']*)["'][\s\S]{0,800}?/gi;
  let m;
  while ((m = rx.exec(raw)) && rows.length < 20) {
    const near = textFromHtml(raw.slice(Math.max(0, m.index - 400), Math.min(raw.length, m.index + 900)));
    const n = norm(near);
    if (wanted && !(n.includes(wanted) || wanted.includes(n))) continue;
    rows.push({ platform: cleanPlatform(m[2] || platformFallback), uid: m[3], name: wantedName, href: m[1], source });
  }
  return rows;
}

async function safeALSLeaderboardUidLookup(player, platformReq, env) {
  const order = platformReq === "auto" ? ["PC", "PS4", "X1"] : [platformReq].filter(p => p !== "SWITCH");
  const attempts = [];
  const found = [];
  for (const platform of order) {
    const target = boardUrl(platform);
    try {
      const html = await fetchText(target, { headers: { "Accept": "text/html,*/*" } });
      const rows = parseUidLinksAroundName(html, player, platform, "ALS leaderboard static HTML");
      attempts.push({ platform, mode: "static", ok: rows.length > 0, rows: rows.length });
      found.push(...rows);
    } catch (e) {
      attempts.push({ platform, mode: "static", ok: false, error: e.message });
    }
    if (!found.length && browserReady(env)) {
      try {
        const snap = await browserSnapshotExtract(env, target, alsLeaderboardUidScript(player));
        const rows = (snap.rows || []).map(r => {
          const row = { ...r, platform: cleanPlatform(r.platform || platform), source: "ALS rendered leaderboard UID anchor" };
          const s = scoreUidCandidate(row, player);
          return { ...row, confidence: s.score, reasons: s.reasons };
        });
        attempts.push({ platform, mode: "browser", ok: rows.length > 0, rows: rows.length });
        found.push(...rows);
      } catch (e) {
        attempts.push({ platform, mode: "browser", ok: false, error: e.message });
      }
    }
    if (found.length) break;
  }
  if (!found.length) return { ok: false, attempts, candidates: [], error: "No ALS leaderboard UID link found." };

  const verified = [];
  for (const c of found.sort((a,b)=>(b.confidence||0)-(a.confidence||0)).slice(0, 8)) {
    const v = await verifyAlsUidProfile(c.uid, c.platform, player);
    verified.push({ ...c, verification: v, verified: !!v.ok, confidence: (c.confidence || 0) + (v.ok ? v.confidence : Math.floor((v.confidence || 0) / 2)) });
  }
  verified.sort((a,b)=>(b.verified?1:0)-(a.verified?1:0) || (b.confidence||0)-(a.confidence||0));
  const best = verified[0];
  const ok = !!best && best.verified && best.confidence >= 75;
  return { ok, ...(best || {}), candidates: verified.slice(0, 8), attempts, error: ok ? "" : "Leaderboard UID candidates found but none passed confidence verification." };
}

function htmlBadgeObjectsFromAttributes(html, source) {
  const raw = String(html || "");
  const badges = [];
  const seen = new Set();
  function add(name, src, extra = {}) {
    const id = badgeIdFromName(name || src || "");
    if (!id || id === "badge" || seen.has(id + "|" + (src || ""))) return;
    seen.add(id + "|" + (src || ""));
    badges.push({ id, type: id, name: id === "twenty_kill" ? "20 Kill Badge" : id === "four_k" ? "4K Damage Badge" : (name || id), label: id === "twenty_kill" ? "20 Kill Badge" : id === "four_k" ? "4K Damage Badge" : (name || id), src: src || "", source, ...extra });
  }
  const attrRx = /<(?:img|div|span|button|i|a)[^>]*(?:badge|Badge|20|4k|4000|hammer|wake|kill)[^>]*>/gi;
  let m;
  while ((m = attrRx.exec(raw)) && badges.length < 80) {
    const tag = m[0];
    const src = (tag.match(/\s(?:src|data-src|href)=["']([^"']+)["']/i) || [])[1] || "";
    const alt = (tag.match(/\s(?:alt|title|aria-label|data-original-title|data-bs-title)=["']([^"']+)["']/i) || [])[1] || "";
    const cls = (tag.match(/\sclass=["']([^"']+)["']/i) || [])[1] || "";
    add([alt, cls, src].filter(Boolean).join(" "), src);
  }
  const hay = textFromHtml(raw) + " " + raw;
  if (/20\s*kill|20[-_\s]*bomb|twenty[-_\s]*kill|wake/i.test(hay)) add("20 Kill Badge", "");
  if (/4k|4\s*000|4000|four[-_\s]*k|hammer/i.test(hay)) add("4K Damage Badge", "");
  return badges;
}




async function handleResolvePlayer(url, env, ctx, request) {
  const input = String(url.searchParams.get("player") || "").trim();
  const platformReq = cleanPlatform(url.searchParams.get("platform") || "auto");
  const lookup = parseSearchLookup(input, platformReq);
  const player = lookup.player || input;
  const out = { ok: false, version: VERSION, input, platform: platformReq, lookup, stages: [] };
  if (!input) return { ...out, error: "Missing player." };

  if (lookup.uid) {
    const v = await verifyAlsUidProfile(lookup.uid, lookup.platform === "auto" ? "PC" : lookup.platform, player || input);
    out.stages.push({ stage: "input_uid_verify", ...v });
    return { ...out, ok: !!v.exists, uid: lookup.uid, platform: v.platform, verified: v.ok, confidence: v.confidence, url: v.url, source: "input UID/profile URL" };
  }

  const bridge = env.ALS_API_KEY ? await fetchBestBridgeSmart(player, platformReq, env.ALS_API_KEY) : { ok: false, error: "ALS_API_KEY missing" };
  out.stages.push({ stage: "bridge_name_variants", ok: !!bridge.ok, platformUsed: bridge.platformUsed, resolvedPlayer: bridge.resolvedPlayer || "", score: bridge.score || 0, useful: bridgeHasUsefulData(bridge), error: bridge.error || "" });
  if (bridgeHasUsefulData(bridge)) {
    const raw = bridge.raw || {};
    const uid = first(raw.uid, raw.global && raw.global.uid, raw.realtime && raw.realtime.uid);
    return { ...out, ok: true, uid, player: bridge.resolvedPlayer || player, platform: bridge.platformUsed, source: "ALS bridge name variant", confidence: 100 };
  }

  const profileSearch = await safeALSProfileUidSearch(player, platformReq, env);
  out.stages.push({ stage: "als_profile_search_uid", ok: !!profileSearch.ok, uid: profileSearch.uid || "", platform: profileSearch.platform || "", confidence: profileSearch.confidence || 0, error: profileSearch.error || "", attempts: profileSearch.attempts || [], candidates: profileSearch.candidates || [] });
  if (profileSearch.ok) return { ...out, ok: true, uid: profileSearch.uid, player, platform: profileSearch.platform, source: profileSearch.source || "ALS profile/search UID resolver", confidence: profileSearch.confidence, url: profileSearch.verification && profileSearch.verification.url || uidProfileUrl(profileSearch.platform, profileSearch.uid), candidates: profileSearch.candidates };

  const boardSearch = await safeALSLeaderboardUidLookup(player, platformReq, env);
  out.stages.push({ stage: "als_leaderboard_uid", ok: !!boardSearch.ok, uid: boardSearch.uid || "", platform: boardSearch.platform || "", confidence: boardSearch.confidence || 0, error: boardSearch.error || "", attempts: boardSearch.attempts || [], candidates: boardSearch.candidates || [] });
  if (boardSearch.ok) return { ...out, ok: true, uid: boardSearch.uid, player, platform: boardSearch.platform, source: boardSearch.source || "ALS leaderboard UID resolver", confidence: boardSearch.confidence, url: boardSearch.verification && boardSearch.verification.url || uidProfileUrl(boardSearch.platform, boardSearch.uid), candidates: boardSearch.candidates };

  return { ...out, error: "No verified ALS UID/profile match found. ApexIQ refused to pass possibly wrong user data." };
}

function runResolverSelfTest() {
  const cases = [
    parseSearchLookup("https://apexlegendsstatus.com/profile/uid/PC/1007058010095", "auto"),
    parseSearchLookup("uid:PC:1007058010095", "auto"),
    parseSearchLookup("Deadkenn3dys", "auto")
  ];
  const ok = cases[0].uid === "1007058010095" && cases[0].platform === "PC" && cases[1].uid === "1007058010095" && playerNameVariants("Deadkenn3dys").some(x => /Deadkennedys/i.test(x));
  return { ok, version: VERSION, cases, variants: playerNameVariants("Deadkenn3dys") };
}



async function handlePlayerLite(url, env, ctx, request) {
  const input = String(url.searchParams.get("player") || "").trim();
  const platformReq = cleanPlatform(url.searchParams.get("platform") || "auto");
  const lookup = parseSearchLookup(input, platformReq);
  const player = lookup.player || input;
  const force = url.searchParams.get("refresh") === "1" || url.searchParams.get("nocache") === "1";
  if (!input && !lookup.uid) return { ok: false, error: "Missing player.", version: VERSION, mode: "player-lite" };

  const cacheUrl = new URL(url.toString());
  for (const k of ["refresh","nocache","_","callback","client"]) cacheUrl.searchParams.delete(k);
  const cacheKey = new Request(cacheUrl.toString(), request);
  if (!force) {
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached.json();
  }

  const resolver = { lookup, attempts: [] };
  let bridge = { ok: false, error: "not attempted", platformUsed: lookup.platform === "auto" ? "PC" : lookup.platform, raw: {} };

  if (lookup.uid) {
    bridge = env.ALS_API_KEY ? await fetchBridgeByUid(lookup.uid, lookup.platform, env.ALS_API_KEY) : bridge;
    resolver.attempts.push({ step: "lite_bridge_uid", ok: !!bridge.ok, platformUsed: bridge.platformUsed, error: bridge.error || "" });
  } else {
    bridge = env.ALS_API_KEY ? await fetchBridgeExactThenSmart(player, lookup.platform, env.ALS_API_KEY) : { ok: false, error: "ALS_API_KEY not set", platformUsed: lookup.platform === "auto" ? "PC" : lookup.platform, raw: {} };
    resolver.attempts.push({ step: "lite_bridge_exact_then_smart", ok: !!bridge.ok, platformUsed: bridge.platformUsed, resolvedPlayer: bridge.resolvedPlayer || player, error: bridge.error || "" });
  }

  const raw = bridge.raw || {};
  const global = raw.global || {};
  const realtime = raw.realtime || {};
  const platform = bridge.platformUsed || (lookup.platform === "auto" ? "PC" : lookup.platform);
  const uid = lookup.uid || first(raw.uid, global.uid, realtime.uid);
  const resolvedPlayer = bridge.resolvedPlayer || first(global.name, raw.name, player, uid);

  // Lite mode intentionally skips Browser Rendering, Tracker, and ranked-board fallback.
  // This gives the frontend a fast first paint; /api/player can hydrate deeper rows after.
  const levelSource = { ok: !!bridge.ok, source: "ApexIQ fast /bridge", raw };
  const tracker = { ok: false, flat: [], legendStats: [], error: "skipped in player-lite" };
  const rendered = { ok: false, legendCards: [], accountBadges: [], error: "skipped in player-lite" };
  const profile = buildProfile(resolvedPlayer || player || uid, lookup.platform, bridge, levelSource, tracker, rendered);
  if (profile) {
    profile.fastMode = true;
    profile.resolver = resolver;
    profile.lookup = lookup;
    if (uid) {
      profile.uid = profile.uid || uid;
      profile.fields = profile.fields || {};
      putField(profile.fields, "uid", uid, "ApexIQ fast resolver");
    }
  }

  const out = {
    ok: !!profile && profileUsableForWorker(profile),
    mode: "player-lite",
    profile,
    resolver,
    version: VERSION,
    diagnostics: {
      bridge: !!bridge.ok,
      uidResolved: !!uid,
      legendRows: profile && profile.legendStats ? profile.legendStats.length : 0
    }
  };

  const response = new Response(JSON.stringify(out, null, 2), { headers: corsHeaders("*", 120) });
  if (!force && out.ok) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return out;
}


async function handlePlayer(url, env, ctx, request) {
  const startedAt = Date.now();
  const input = String(url.searchParams.get("player") || "").trim();
  const platformReq = cleanPlatform(url.searchParams.get("platform") || "auto");
  const lookup = parseSearchLookup(input, platformReq);
  const player = lookup.player || input;
  const force = url.searchParams.get("refresh") === "1" || url.searchParams.get("nocache") === "1";
  if (!input && !lookup.uid) return { ok: false, error: "Missing player.", version: VERSION };

  const cacheUrl = new URL(url.toString());
  for (const k of ["refresh","nocache","_","callback","client"]) cacheUrl.searchParams.delete(k);
  const cacheKey = new Request(cacheUrl.toString(), request);
  if (!force) {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const data = await cached.json();
      return { ...data, cached: true, cacheSource: "player-v41" };
    }
  }

  const resolver = { lookup, attempts: [] };
  let bridge = { ok: false, error: "not attempted", platformUsed: lookup.platform === "auto" ? "PC" : lookup.platform, raw: {} };

  if (lookup.uid) {
    bridge = env.ALS_API_KEY ? await fetchBridgeByUid(lookup.uid, lookup.platform, env.ALS_API_KEY) : bridge;
    resolver.attempts.push({ step: "bridge_uid_parallel", ok: !!bridge.ok, platformUsed: bridge.platformUsed, error: bridge.error || "" });
  } else {
    bridge = env.ALS_API_KEY ? await fetchBridgeExactThenSmart(player, lookup.platform, env.ALS_API_KEY) : { ok: false, error: "ALS_API_KEY not set", platformUsed: lookup.platform === "auto" ? "PC" : lookup.platform, raw: {} };
    resolver.attempts.push({ step: "bridge_exact_then_smart_parallel", ok: !!bridge.ok, platformUsed: bridge.platformUsed, resolvedPlayer: bridge.resolvedPlayer || player, error: bridge.error || "" });
  }

  let platform = bridge.platformUsed || (lookup.platform === "auto" ? "PC" : lookup.platform);
  let raw = bridge.raw || {};
  let uid = lookup.uid || first(raw.uid, raw.global && raw.global.uid, raw.realtime && raw.realtime.uid);
  let resolvedPlayer = bridge.resolvedPlayer || player;

  let uidLookup = { ok: false };
  if (!bridgeHasUsefulData(bridge) && !uid && player) {
    const profileUid = await safeALSProfileUidSearch(player, lookup.platform, env);
    resolver.attempts.push({ step: "als_profile_search_uid", ok: !!profileUid.ok, uid: profileUid.uid || "", platform: profileUid.platform || "", confidence: profileUid.confidence || 0, error: profileUid.error || "" });
    uidLookup = profileUid.ok ? profileUid : await safeALSLeaderboardUidLookup(player, lookup.platform, env);
    if (!profileUid.ok) resolver.attempts.push({ step: "als_leaderboard_uid", ok: !!uidLookup.ok, uid: uidLookup.uid || "", platform: uidLookup.platform || "", confidence: uidLookup.confidence || 0, error: uidLookup.error || "" });
    if (uidLookup.ok && uidLookup.uid) {
      uid = uidLookup.uid;
      platform = uidLookup.platform || platform;
      const verified = uidLookup.verification && uidLookup.verification.ok ? uidLookup.verification : await verifyAlsUidProfile(uid, platform, player);
      resolver.attempts.push({ step: "verify_uid_profile", ok: !!verified.ok, confidence: verified.confidence || 0, url: verified.url || "" });
      if (verified.exists) {
        const uidBridge = env.ALS_API_KEY ? await fetchBridgeByUid(uid, platform, env.ALS_API_KEY) : { ok: false, raw: {}, platformUsed: platform };
        resolver.attempts.push({ step: "bridge_from_verified_uid_parallel", ok: !!uidBridge.ok, platformUsed: uidBridge.platformUsed, error: uidBridge.error || "" });
        if (bridgeHasUsefulData(uidBridge)) {
          bridge = uidBridge;
          raw = bridge.raw || {};
          resolvedPlayer = first(raw.global && raw.global.name, raw.name, uidLookup.name, player);
        }
      }
    }
  }

  const renderedPromise = browserReady(env)
    ? getRenderedProfile(lookup.uid ? "" : resolvedPlayer, platform, uid, env).catch(e => ({ ok: false, error: e.message, legendCards: [], accountBadges: [] }))
    : Promise.resolve({ ok: false, error: "Browser Run not enabled.", legendCards: [], accountBadges: [] });
  const trackerPromise = safeTracker(resolvedPlayer || player || uid, platform, env).catch(e => ({ ok: false, flat: [], legendStats: [], error: e.message }));

  const [rendered, tracker] = await Promise.all([renderedPromise, trackerPromise]);
  const prestigeProbe = rendered && rendered.ok ? rendered : await safePrestigeProbe(lookup.uid ? "" : resolvedPlayer, platform, uid, env);
  let profile = buildProfile(resolvedPlayer || player || uid, lookup.platform, bridge, prestigeProbe, tracker, rendered);

  if (!profileUsableForWorker(profile) && rendered && rendered.ok) {
    profile = buildProfile(resolvedPlayer || player || uid, lookup.platform, { ok: false, platformUsed: platform, raw: { uid } }, rendered, tracker, rendered);
  }

  let rankedLookup = { ok: false };
  if (!profileUsableForWorker(profile) || url.searchParams.get("rankedFallback") === "1") {
    rankedLookup = await safeRankedProfileLookup(player || resolvedPlayer || input, lookup.platform);
    resolver.attempts.push({ step: "apexranked_fallback", ok: !!rankedLookup.ok, platform: rankedLookup.platform || "", error: rankedLookup.error || "" });
    if (rankedLookup.ok && (!profileUsableForWorker(profile) || url.searchParams.get("rankedFallback") === "1")) {
      profile = applyRankedFallbackProfile(profile, rankedLookup, player || resolvedPlayer || input, lookup.platform);
    }
  }

  if (profile) {
    profile.resolver = resolver;
    profile.lookup = lookup;
    profile.speedMode = "parallel-v41";
    if (uid) {
      profile.uid = profile.uid || uid;
      profile.fields = profile.fields || {};
      putField(profile.fields, "uid", uid, lookup.uid ? "ApexIQ UID/profile URL resolver" : "ApexIQ resolver");
    }
    if (uidLookup && uidLookup.ok) profile.resolvedByLeaderboardUid = uidLookup;
  }

  const out = {
    ok: !!profile && profileUsableForWorker(profile),
    profile,
    rankedLookup,
    resolver,
    version: VERSION,
    timingMs: Date.now() - startedAt,
    diagnostics: {
      renderedRows: (rendered && rendered.legendCards || []).length,
      renderedStats: countStats(rendered && rendered.legendCards || []),
      renderedBadges: countBadges(rendered && rendered.legendCards || []) + ((rendered && rendered.accountBadges || []).length),
      levelTrusted: !!(profile && profile.fields && (profile.fields.trueLevel || profile.fields.level || profile.fields.visibleLevel)),
      rankedFallback: !!(rankedLookup && rankedLookup.ok),
      uidResolved: !!uid,
      parallelBridge: true,
      trackerParallel: true
    }
  };

  const response = new Response(JSON.stringify(out, null, 2), { headers: corsHeaders("*", 600) });
  if (!force && out.ok) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return out;
}


async function fetchBestBridge(player, platformReq, key) {
  const order = platformReq === "auto" ? ["PC", "PS4", "X1", "SWITCH"] : [platformReq];
  const tasks = order.map(async platform => {
    const api = new URL("https://api.apexlegendsstatus.com/bridge");
    api.searchParams.set("auth", key);
    api.searchParams.set("player", player);
    api.searchParams.set("platform", platform);
    api.searchParams.set("merge", "1");
    try {
      const data = await fetchJson(api.toString(), { timeoutMs: platformReq === "auto" ? 6500 : 8500 });
      const ok = data && (data.global || data.legends || data.realtime || data.uid) && !data.Error && !data.error;
      if (!ok) return { platform, ok: false, error: data.Error || data.error || "No player payload returned." };
      const score = scoreBridge(data);
      return { platform, ok: true, score, value: { ok: true, source: "Apex Legends Status /bridge", platformUsed: platform, raw: data, score } };
    } catch (e) {
      return { platform, ok: false, error: e.message };
    }
  });
  const settled = await Promise.all(tasks);
  const tried = settled.map(r => r.ok ? { platform: r.platform, ok: true, score: r.score } : { platform: r.platform, ok: false, error: r.error });
  const valid = settled.filter(r => r.ok).map(r => r.value);
  if (valid.length) {
    valid.sort((a, b) => b.score - a.score);
    return { ...valid[0], tried, candidates: valid.map(v => ({ platform: v.platformUsed, score: v.score })) };
  }
  return { ok: false, platformUsed: order[0], raw: {}, tried, error: tried.map(t => `${t.platform}: ${t.error}`).join(" | ") };
}



function profileDomExtractorScript() {
  return String.raw`
(function(){
  const LEGENDS = ["Alter","Ash","Axle","Ballistic","Bangalore","Bloodhound","Catalyst","Caustic","Conduit","Crypto","Fuse","Gibraltar","Horizon","Lifeline","Loba","Mad Maggie","Mirage","Newcastle","Octane","Pathfinder","Rampart","Revenant","Seer","Sparrow","Valkyrie","Vantage","Wattson","Wraith"];
  const STAT_LABELS = ["BR Kills as kill leader","BR Games played","BR Damage","BR Kills","BR Wins","Arenas Games played","Arenas Damage","Arenas Kills","Arenas Wins","Alternator SMG Damage","Alternator SMG Kills","L-STAR EMG Kills","M600 Spitfire Kills","R-301 Carbine Kills","R-99 SMG Kills","SMG Damage","SMG Kills"];
  const BADGES = [
    ["twenty_kill","20 Kill Badge",["20 kill badge","20 kill","20_kill","20kill"]],
    ["four_k","4K Damage Badge",["4k damage badge","4k damage","4000 damage","4,000 damage","hammer"]],
    ["triple_triple","Triple Triple",["triple triple"]],
    ["team_work","Team Work",["team work","teamwork"]],
    ["no_witnesses","No Witnesses",["no witnesses"]],
    ["rapid_elimination","Rapid Elimination",["rapid elimination"]],
    ["pred_badge","Apex Predator",["apex predator","predator badge"]],
    ["master_badge","Master Badge",["master badge"]],
    ["diamond_badge","Diamond Badge",["diamond badge"]],
    ["platinum_badge","Platinum Badge",["platinum badge"]],
    ["gold_badge","Gold Badge",["gold badge"]],
    ["silver_badge","Silver Badge",["silver badge"]],
    ["bronze_badge","Bronze Badge",["bronze badge"]],
    ["assassin","Assassin",["assassin"]]
  ];
  function clean(s){return String(s||"").replace(/\s+/g," ").trim();}
  function text(el){return clean((el&&el.innerText)||el?.textContent||"");}
  function lines(el){return String((el&&el.innerText)||el?.textContent||"").split(/\n+/).map(x=>clean(x)).filter(Boolean);}
  function num(v){const n=Number(String(v||"").replace(/,/g,"")); return Number.isFinite(n)?n:0;}
  function norm(s){return String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");}
  function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
  function reEsc(s){return String(s).replace(/[.*+?^\${}()|[\]\\]/g,"\\$&");}
  function visible(el){
    if(!el||!el.getBoundingClientRect)return false;
    const r=el.getBoundingClientRect();
    const cs=getComputedStyle(el);
    return r.width>0&&r.height>0&&cs.display!=="none"&&cs.visibility!=="hidden"&&Number(cs.opacity||1)>0;
  }
  function rect(el){return el.getBoundingClientRect();}
  function legendFromHeaderText(t){
    const c=clean(t).replace(/• selected/i,"").trim();
    return LEGENDS.find(l=>c===l||c.startsWith(l+" "));
  }
  function findLegendHeaders(){
    const headers=[];
    const all=Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,b,strong,span,div"));
    for(const el of all){
      if(!visible(el))continue;
      const t=text(el);
      if(!t||t.length>70)continue;
      const legend=legendFromHeaderText(t);
      if(!legend)continue;
      const r=rect(el);
      if(r.top<0||r.top>document.body.scrollHeight)continue;
      headers.push({legend,el,top:r.top,left:r.left,width:r.width,height:r.height});
    }
    headers.sort((a,b)=>a.top-b.top||a.left-b.left);
    // Deduplicate stacked duplicate text nodes.
    const out=[];
    for(const h of headers){
      if(out.some(x=>x.legend===h.legend&&Math.abs(x.top-h.top)<8&&Math.abs(x.left-h.left)<80))continue;
      out.push(h);
    }
    return out;
  }
  function elementsInBand(top,bottom,leftLimit){
    return Array.from(document.querySelectorAll("div,span,p,b,strong,td,th,li,img,[title],[alt],[aria-label],[data-original-title],[data-bs-title]")).filter(el=>{
      if(!visible(el))return false;
      const r=rect(el);
      const cy=r.top+r.height/2;
      if(cy<top||cy>bottom)return false;
      if(leftLimit!==undefined && r.left<leftLimit-120)return false;
      return true;
    });
  }
  function addStat(out,label,value,source,seen){
    const v=num(value); if(!v)return;
    const key=label.toLowerCase()+"|"+v;
    if(seen.has(key))return;
    seen.add(key);
    out.push({label,value:v,source});
  }
  function parseStatsInBand(top,bottom,left){
    const out=[], seen=new Set();
    const els=elementsInBand(top,bottom,left);
    for(const el of els){
      const t=text(el);
      if(!/\d/.test(t)||t.length>180)continue;
      for(const label of STAT_LABELS){
        const lab=reEsc(label);
        let m=t.match(new RegExp(lab+"\\s*[:\\-]?\\s*([0-9][0-9,]{0,12})","i"));
        if(m)addStat(out,label,m[1],"ALS visual region",seen);
        m=t.match(new RegExp("([0-9][0-9,]{0,12})\\s+"+lab,"i"));
        if(m)addStat(out,label,m[1],"ALS visual region",seen);
      }
      const ln=lines(el);
      for(let i=0;i<ln.length;i++){
        for(const label of STAT_LABELS){
          if(ln[i].toLowerCase()===label.toLowerCase() && ln[i+1] && /^[0-9][0-9,]*$/.test(ln[i+1])){
            addStat(out,label,ln[i+1],"ALS visual region",seen);
          }
        }
      }
    }
    const byLabel=new Map();
    const order=STAT_LABELS;
    for(const s of out){
      if(!byLabel.has(s.label))byLabel.set(s.label,s);
    }
    return [...byLabel.values()].sort((a,b)=>order.indexOf(a.label)-order.indexOf(b.label)).slice(0,8);
  }
  function badgeNameFrom(raw){
    const s=String(raw||"").replace(/[-_]/g," ").toLowerCase();
    const compact=s.replace(/[^a-z0-9]/g,"");
    if(/(?:^|\D)20(?:\D|$)|20kill|20bomb|twentykill|wake/.test(s)||/20kill|20bomb|twentykill|wake/.test(compact)) return {id:"twenty_kill",name:"20 Kill Badge",label:"20 Kill Badge",src:"",source:"ALS visual region"};
    if(/4k|4000|4 000|fourk|hammer/.test(s)||/4k|4000damage|fourk|hammer/.test(compact)) return {id:"four_k",name:"4K Damage Badge",label:"4K Damage Badge",src:"",source:"ALS visual region"};
    for(const [id,name,keys] of BADGES){
      if(keys.some(k=>s.includes(k)||compact.includes(k.replace(/[^a-z0-9]/g,""))))return {id,name,label:name,src:"",source:"ALS visual region"};
    }
    return null;
  }
  function parseBadgesInBand(top,bottom,left){
    const badges=[], seen=new Set();
    function add(b,src){
      if(!b)return;
      const key=(b.name+"|"+(src||"")).toLowerCase();
      if(seen.has(key))return;
      seen.add(key);
      badges.push({...b,src:src||b.src||""});
    }
    for(const el of elementsInBand(top,bottom,left)){
      const r=rect(el);
      const attrs=["alt","title","aria-label","data-original-title","data-bs-title","src","href","data-src","style","class"].map(a=>el.getAttribute&&el.getAttribute(a)||"").join(" ");
      const bg=(getComputedStyle(el).backgroundImage||"").replace(/^url\(["']?|["']?\)$/g,"");
      const t=text(el);
      const b=badgeNameFrom(attrs+" "+bg+" "+(t.length<140?t:""));
      const src=(el.getAttribute&&el.getAttribute("src"))||bg||"";
      if(b)add(b,src);
      else if(el.tagName==="IMG" && src && r.width>=16 && r.width<=92 && r.height>=16 && r.height<=92 && !/legend|characters|portrait|favicon|logo/i.test(src)){
        const name=(src.split("/").pop()||"ALS Badge").replace(/\.[a-z0-9]+$/i,"").replace(/[-_]+/g," ").trim();
        if(name)add({id:norm(name)||"als_badge",name,label:name,src,source:"ALS visual region image"},src);
      }
    }
    return badges.slice(0,10);
  }
  function accountBadges(){
    const heads=Array.from(document.querySelectorAll("*")).filter(el=>visible(el)&&/account\s+wide\s+badges/i.test(text(el))&&text(el).length<90);
    for(const h of heads){
      const r=rect(h);
      const b=parseBadgesInBand(r.top,r.top+260,r.left-40);
      if(b.length)return b;
    }
    return [];
  }
  function visibleLevel(){
    const s=text(document.body);
    const m=s.match(/\bLEVEL\s+([0-9]{1,5})\b/i)||s.match(/\bVisible\s+level\s+([0-9]{1,5})\b/i);
    return m?num(m[1]):0;
  }
  function prestige(){
    const s=text(document.body);
    const m=s.match(/\bPRESTIGE\s+([0-4])\b/i)||s.match(/\bPrestige\s+([0-4])\b/i);
    return m?num(m[1]):undefined;
  }
  const headers=findLegendHeaders();
  const cardsByLegend=new Map();
  for(let i=0;i<headers.length;i++){
    const h=headers[i];
    const next=headers.find((x,idx)=>idx>i && x.top>h.top+25);
    const top=Math.max(0,h.top-8);
    const bottom=Math.min(next?next.top-8:h.top+560,h.top+560);
    if(bottom-top<55)continue;
    const stats=parseStatsInBand(top,bottom,h.left);
    const badges=parseBadgesInBand(top,bottom,h.left);
    const score=stats.length*20+badges.length*12-(bottom-top>480?10:0);
    if(!stats.length&&!badges.length)continue;
    const old=cardsByLegend.get(h.legend);
    if(!old||score>old.score)cardsByLegend.set(h.legend,{legend:h.legend,stats,trackers:stats.map(s=>({name:s.label,key:s.label,value:s.value,source:s.source})),badges,officialBadges:badges,source:"ALS visual-region DOM extractor",score});
  }
  const cards=[...cardsByLegend.values()].map(({score,...x})=>x);
  const v=visibleLevel(), p=prestige();
  const data={ok:true,source:"Browser Run visual-region DOM extractor",mode:"visual-region-dom",visibleLevel:v||undefined,prestigeCompleted:p,prestigeLabel:p!==undefined?"Prestige "+p:"",trueLevel:(v&&p!==undefined)?v+p*500:undefined,accountBadges:accountBadges(),legendCards:cards};
  document.documentElement.innerHTML="<html><body><pre id='apexiq-data'>"+esc(JSON.stringify(data))+"</pre></body></html>";
})();`;
}

function leaderboardDomExtractorScript() {
  return String.raw`
(function(){
  function clean(s){return String(s||"").replace(/\s+/g," ").trim();}
  function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
  function num(v){const n=Number(String(v||"").replace(/,/g,"")); return Number.isFinite(n)?n:0;}
  function visible(el){const r=el.getBoundingClientRect();const cs=getComputedStyle(el);return r.width>0&&r.height>0&&cs.display!=="none"&&cs.visibility!=="hidden";}
  try{window.scrollTo(0,0);}catch(e){}
  const rows=[], seen=new Set();
  function add(rank,name,rp,extra){
    const r=num(rank), score=num(rp);
    let n=clean(name).replace(/\b(Offline|Online|In match|In lobby|Level|Lvl|RP|Predator|Master|Masters)\b/gi," ").replace(/[#•|]+/g," ").replace(/\s+/g," ").trim();
    if(!r||r<1||r>750||!n||n.length>48||!score||score<10000||score>1000000)return;
    if(/apexlegendsstatus|leaderboard|battle royale|loading|captcha|blocked|ranked|pred cutoff/i.test(n))return;
    const key=(r+"|"+n+"|"+score).toLowerCase(); if(seen.has(key))return; seen.add(key);
    rows.push({rank:r,name:n,rp:score,level:extra&&extra.level||"",legend:extra&&extra.legend||"",status:extra&&extra.status||"",source:"ALS leaderboard visual DOM"});
  }
  const candidates=Array.from(document.querySelectorAll("tr,[role='row'],li,div")).filter(el=>{
    if(!visible(el))return false;
    const t=clean(el.innerText||el.textContent||"");
    if(t.length<12||t.length>520)return false;
    return /[0-9]{2,3},[0-9]{3}/.test(t)&&/(^|\s)#?\d{1,3}(\s|$)/.test(t);
  });
  for(const el of candidates){
    const parts=String(el.innerText||el.textContent||"").split(/\n+/).map(clean).filter(Boolean);
    const full=parts.join(" ");
    let rank=parts.find(x=>/^#?\d{1,3}$/.test(x));
    let rp=parts.find(x=>/^[0-9]{2,3},[0-9]{3}\s*(RP)?$/i.test(x));
    let name=parts.find(x=>/[A-Za-z_\-\[\].]{2,}/.test(x)&&!/rp|level|offline|online|predator|master|rank|battle|royale|platform/i.test(x)&&!/[0-9]{2,3},[0-9]{3}/.test(x));
    if(rank&&rp&&name)add(rank,name,rp,{});
    let m=full.match(/#?\s*(\d{1,3})\s+([A-Za-z0-9_\-\[\]. ]{2,48}?)\s+(?:Level\s*\d+\s+|Lvl\s*\d+\s+)?([0-9]{2,3},[0-9]{3})\s*(?:RP)?/i);
    if(m)add(m[1],m[2],m[3],{});
  }
  rows.sort((a,b)=>a.rank-b.rank);
  const pageText=clean(document.body.innerText||document.body.textContent||"");
  const data={ok:rows.length>0,players:rows.slice(0,25),source:"Browser Run visual leaderboard extractor",pageHint:pageText.slice(0,240),rowCandidates:candidates.length};
  document.documentElement.innerHTML="<html><body><pre id='apexiq-data'>"+esc(JSON.stringify(data))+"</pre></body></html>";
})();`;
}

async function getRenderedProfile(player, platform, uid, env) {
  const urls = [];
  if (player) urls.push(profileUrl(platform, player));
  if (uid) urls.push(profileUidUrl(platform, uid));

  const attempts = [];
  let best = null;

  for (const target of [...new Set(urls)]) {
    // Best path: inject a DOM extractor into the real rendered ALS page, then snapshot the JSON.
    try {
      const snap = await browserSnapshotExtract(env, target, profileDomExtractorScript());
      const normalized = normalizeRenderedProfile(snap, target);
      normalized.source = "Browser Run snapshot injected DOM extractor";
      normalized.mode = "snapshot-dom";
      attempts.push({
        method: "Browser Run /snapshot injected DOM extractor",
        url: target,
        ok: normalized.ok,
        legendCards: normalized.legendCards.length,
        stats: countStats(normalized.legendCards),
        badges: countBadges(normalized.legendCards) + (normalized.accountBadges || []).length
      });
      if (!best || scoreRenderedProfile(normalized) > scoreRenderedProfile(best)) best = normalized;
      if (normalized.legendCards.length >= 8 && countStats(normalized.legendCards) >= 20) break;
    } catch (e) {
      attempts.push({ method: "Browser Run /snapshot injected DOM extractor", url: target, ok: false, error: e.message });
    }

    // Fallback: rendered HTML content parser.
    try {
      const renderedHtml = await browserContent(env, target);
      const parsed = parseRenderedALSProfileContent(renderedHtml, target);
      attempts.push({
        method: "Browser Run /content parser fallback",
        url: target,
        ok: parsed.ok,
        legendCards: parsed.legendCards.length,
        stats: countStats(parsed.legendCards),
        badges: countBadges(parsed.legendCards)
      });
      if (!best || scoreRenderedProfile(parsed) > scoreRenderedProfile(best)) best = parsed;
    } catch (e) {
      attempts.push({ method: "Browser Run /content parser fallback", url: target, ok: false, error: e.message });
    }

    // Last fallback: AI JSON extractor. Rate-limited sometimes, so this is last.
    const prompt = [
      "Extract ONLY data visibly rendered on this Apex Legends Status profile page.",
      "Do not guess. Do not copy stats from one legend to another.",
      "For each legend card/block, include only the stats and badges visible inside that exact legend card/block.",
      "Badge rule: only include badges that are visible as badge icons, badge labels, tooltip names, alt text, title text, or image filenames. Do not infer badges from kills/damage stats.",
      "Return account-wide badges and every visible legend card with exact stat label/value pairs and exact badge names."
    ].join("\n");

    try {
      const result = await browserJson(env, target, prompt, profileSchema(), { waitUntil: "networkidle2", timeout: 45000 });
      const normalized = normalizeRenderedProfile(result, target);
      attempts.push({ method: "Browser Run /json fallback", url: target, ok: normalized.ok, legendCards: normalized.legendCards.length, stats: countStats(normalized.legendCards), badges: countBadges(normalized.legendCards) });
      if (!best || scoreRenderedProfile(normalized) > scoreRenderedProfile(best)) best = normalized;
    } catch (e) {
      attempts.push({ method: "Browser Run /json fallback", url: target, ok: false, error: e.message });
    }
  }

  if (best) {
    best.attempts = attempts;
    return best;
  }

  return { ok: false, source: "Browser Run", error: "Browser Run returned no rendered profile data.", attempts, legendCards: [], accountBadges: [] };
}

async function getRenderedLeaderboard(platform, env) {
  const target = boardUrl(platform);
  try {
    const snap = await browserSnapshotExtract(env, target, leaderboardDomExtractorScript());
    const players = (snap.players || [])
      .map(p => ({ ...p, platform, url: profileUrl(platform, p.name), source: p.source || "ALS rendered DOM snapshot" }))
      .filter(p => p.name && p.rp >= 10000)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 25);
    if (players.length) {
      return { ok: true, platform, url: target, source: "Browser Run snapshot DOM extractor", players, predCutoff: 0, mastersPreds: 0, splitEnds: "" };
    }
    return {
      ok: false,
      platform,
      url: target,
      source: "Browser Run snapshot DOM extractor",
      players: [],
      error: snap && snap.pageHint ? `No visible rows found. Page hint: ${String(snap.pageHint).slice(0,220)}` : "No visible leaderboard rows found in rendered snapshot."
    };
  } catch (e) {
    return {
      ok: false,
      platform,
      url: target,
      source: "Browser Run snapshot DOM extractor",
      players: [],
      error: e.message
    };
  }
}

async function browserQuick(env, action, payload) {
  if (env.BROWSER && typeof env.BROWSER.quickAction === "function") {
    const resp = await env.BROWSER.quickAction(action, payload);
    if (resp && typeof resp.text === "function") {
      const txt = await resp.text();
      if (action === "content" || action === "markdown") return txt;
      try { return JSON.parse(txt); } catch (_) { return txt; }
    }
    if (resp && typeof resp.json === "function") {
      const data = await resp.json();
      if (data && data.success === false) throw new Error(JSON.stringify(data.errors || data));
      return data.result || data;
    }
    return resp && resp.result ? resp.result : resp;
  }

  if (env.CF_ACCOUNT_ID && env.CF_BROWSER_API_TOKEN) {
    const endpoint = action === "content" ? "content" : action === "markdown" ? "markdown" : "json";
    const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/${endpoint}`, {
      method: "POST",
      headers: { "authorization": `Bearer ${env.CF_BROWSER_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`Browser Rendering REST ${endpoint} failed: ${text.slice(0, 500)}`);
    if (endpoint === "content" || endpoint === "markdown") return text;
    const data = JSON.parse(text || "{}");
    if (data.success === false) throw new Error(`Browser Rendering REST failed: ${JSON.stringify(data.errors || data)}`);
    return data.result || data;
  }

  throw new Error("Browser Run is not configured. Add BROWSER binding or CF_ACCOUNT_ID + CF_BROWSER_API_TOKEN.");
}


async function browserSnapshotExtract(env, targetUrl, scriptContent) {
  const result = await browserQuick(env, "snapshot", {
    url: targetUrl,
    formats: ["content", "markdown"],
    gotoOptions: { waitUntil: "networkidle0", timeout: 60000 },
    viewport: { width: 1365, height: 2600, deviceScaleFactor: 1 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36 ApexIQ",
    addScriptTag: [{ content: scriptContent }]
  });

  const content = typeof result === "string"
    ? result
    : (result && (result.content || (result.result && result.result.content) || result.markdown || JSON.stringify(result)));

  const raw = extractApexIQJson(content || "");
  if (!raw) throw new Error("Snapshot extractor did not return ApexIQ JSON.");
  return JSON.parse(raw);
}

function extractApexIQJson(content) {
  const s = String(content || "");
  let m = s.match(/<pre[^>]+id=["']apexiq-data["'][^>]*>([\s\S]*?)<\/pre>/i);
  if (m) return decodeHtmlText(m[1]).trim();
  m = s.match(/APEXIQ_JSON_START([\s\S]*?)APEXIQ_JSON_END/);
  if (m) return decodeHtmlText(m[1]).trim();
  return "";
}

function decodeHtmlText(s) {
  return String(s || "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function browserContent(env, targetUrl) {
  return await browserQuick(env, "content", {
    url: targetUrl,
    gotoOptions: { waitUntil: "networkidle0", timeout: 45000 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36 ApexIQ"
  });
}

async function browserJson(env, targetUrl, prompt, schema, gotoOptions = {}) {
  const payload = {
    url: targetUrl,
    prompt,
    response_format: { type: "json_schema", schema },
    gotoOptions,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36 ApexIQ"
  };

  if (env.BROWSER && typeof env.BROWSER.quickAction === "function") {
    const resp = await env.BROWSER.quickAction("json", payload);
    if (resp && typeof resp.json === "function") {
      const data = await resp.json();
      if (data && data.success === false) throw new Error(JSON.stringify(data.errors || data));
      return data.result || data;
    }
    return resp && resp.result ? resp.result : resp;
  }

  if (env.CF_ACCOUNT_ID && env.CF_BROWSER_API_TOKEN) {
    const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/json`, {
      method: "POST",
      headers: { "authorization": `Bearer ${env.CF_BROWSER_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) throw new Error(`Browser Rendering REST failed: ${JSON.stringify(data.errors || data)}`);
    return data.result || data;
  }

  throw new Error("Browser Run is not configured. Add BROWSER binding or CF_ACCOUNT_ID + CF_BROWSER_API_TOKEN.");
}


function parseRenderedALSProfileContent(html, url) {
  const text = htmlToText(html);
  const visibleLevel = parseVisibleLevelFromText(text);
  const prestigeCompleted = parsePrestigeFromText(text);
  const trueLevel = (visibleLevel && visibleLevel <= 500 && prestigeCompleted !== undefined)
    ? visibleLevel + prestigeCompleted * 500
    : undefined;

  const accountBadges = parseAccountBadgesFromHtml(html, text);
  const legendCards = parseLegendCardsFromRenderedHtml(html, text);

  return {
    ok: !!(visibleLevel || prestigeCompleted !== undefined || legendCards.length || accountBadges.length),
    source: "Browser Run rendered ALS DOM+text parser",
    mode: "browser-content-dom-text",
    url,
    visibleLevel: visibleLevel || undefined,
    prestigeCompleted,
    prestigeLabel: prestigeCompleted !== undefined ? `Prestige ${prestigeCompleted}` : "",
    trueLevel,
    accountBadges,
    legendCards,
    selectedLegend: parseSelectedLegendFromText(text)
  };
}

function parseVisibleLevelFromText(text) {
  const s = String(text || "");
  let m = s.match(/\bLEVEL\s+([0-9]{1,5})\b/i) || s.match(/\bVisible\s+level\s+([0-9]{1,5})\b/i);
  if (m) return toNum(m[1]);
  return undefined;
}

function parsePrestigeFromText(text) {
  const s = String(text || "");
  const m = s.match(/\bPRESTIGE\s+([0-4])\b/i) || s.match(/\bPrestige\s+([0-4])\b/i);
  return m ? toNum(m[1]) : undefined;
}

function parseSelectedLegendFromText(text) {
  const s = String(text || "");
  for (const legend of LEGEND_NAMES) {
    const re = new RegExp(`\\b${escapeRegExp(legend)}\\b\\s*(?:BR Kills|BR Damage|Arenas|Kills)`, "i");
    if (re.test(s)) return legend;
  }
  return "";
}

const APEXIQ_RENDERED_STAT_LABELS = [
  "BR Kills as kill leader",
  "BR Games played",
  "BR Damage",
  "BR Kills",
  "BR Wins",
  "Arenas Games played",
  "Arenas Damage",
  "Arenas Kills",
  "Arenas Wins",
  "Alternator SMG Damage",
  "Alternator SMG Kills",
  "L-STAR EMG Kills",
  "M600 Spitfire Kills",
  "R-301 Carbine Kills",
  "R-99 SMG Kills",
  "SMG Damage",
  "SMG Kills",
  "Kills",
  "Damage",
  "Wins",
  "Games played"
];

const APEXIQ_RENDERED_BADGE_LABELS = [
  "20 Kill Badge","4K Damage Badge","Triple Triple","Team Work","No Witnesses","Rapid Elimination",
  "Apex Predator","Master Badge","Diamond Badge","Platinum Badge","Gold Badge","Silver Badge","Bronze Badge",
  "Assassin","Wake","Wrath"
];

function parseLegendCardsFromRenderedHtml(html, text) {
  const textRows = parseLegendCardsFromRenderedText(text || htmlToText(html));
  const htmlRows = parseLegendCardsFromRenderedRawHtml(html || "");
  return mergeLegendRows(textRows, htmlRows);
}

function parseLegendCardsFromRenderedText(text) {
  const s = String(text || "").replace(/\s+/g, " ");
  const lower = s.toLowerCase();
  const rows = [];

  for (const legend of LEGEND_NAMES) {
    const candidates = findAllLegendIndexes(lower, legend.toLowerCase()).map(idx => {
      const next = nextLegendIndex(lower, idx + legend.length);
      const end = next > idx ? Math.min(next, idx + 3600) : Math.min(s.length, idx + 3600);
      const seg = s.slice(idx, end);
      const stats = parseStatsFromSegment(seg);
      const badges = parseBadgesFromSegment(seg);
      return { idx, seg, stats, badges, score: stats.length * 10 + badges.length * 6 + seg.length / 20000 };
    }).sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (best && (best.stats.length || best.badges.length)) {
      rows.push({
        legend,
        stats: best.stats,
        trackers: best.stats.map(st => ({ name: st.label, key: st.label, value: st.value, source: st.source })),
        badges: best.badges,
        officialBadges: best.badges,
        source: "Browser Run rendered ALS text parser"
      });
    }
  }

  return sanitizeLegendCards(rows);
}

function parseLegendCardsFromRenderedRawHtml(html) {
  const s = String(html || "");
  const lower = s.toLowerCase();
  const rows = [];

  for (const legend of LEGEND_NAMES) {
    const idxes = findAllLegendIndexes(lower, legend.toLowerCase());
    let best = null;
    for (const idx of idxes) {
      const end = Math.min(s.length, idx + 18000);
      const seg = s.slice(idx, end);
      const text = htmlToText(seg);
      const stats = parseStatsFromSegment(text);
      const badges = parseBadgesFromHtmlSegment(seg, text);
      const score = stats.length * 10 + badges.length * 9;
      if (!best || score > best.score) best = { stats, badges, score };
    }
    if (best && (best.stats.length || best.badges.length)) {
      rows.push({
        legend,
        stats: best.stats,
        trackers: best.stats.map(st => ({ name: st.label, key: st.label, value: st.value, source: st.source })),
        badges: best.badges,
        officialBadges: best.badges,
        source: "Browser Run rendered ALS HTML parser"
      });
    }
  }
  return sanitizeLegendCards(rows);
}

function findAllLegendIndexes(lowerText, legendLower) {
  const out = [];
  let i = lowerText.indexOf(legendLower);
  while (i >= 0) {
    const before = i === 0 ? " " : lowerText[i - 1];
    const after = lowerText[i + legendLower.length] || " ";
    if (!/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after)) out.push(i);
    i = lowerText.indexOf(legendLower, i + legendLower.length);
  }
  return out;
}

function findBestLegendIndex(lowerText, legendLower) {
  const all = findAllLegendIndexes(lowerText, legendLower);
  return all.length ? all[0] : -1;
}

function nextLegendIndex(lowerText, from) {
  let best = -1;
  for (const l of LEGEND_NAMES) {
    const idxes = findAllLegendIndexes(lowerText.slice(from), l.toLowerCase()).map(i => i + from);
    for (const i of idxes) if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

function parseStatsFromSegment(seg) {
  const out = [];
  const seen = new Set();

  function add(label, value) {
    const cleanLabel = String(label || "").replace(/\s+/g, " ").trim();
    const num = toNum(value);
    if (!cleanLabel || !num) return;
    if (/top|rank|level|prestige|views|reputation|profile|badge|skin|frame|pose|intro/i.test(cleanLabel)) return;
    const key = `${cleanLabel.toLowerCase()}|${num}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label: cleanLabel, value: num, source: "Browser Run rendered ALS parser" });
  }

  const clean = String(seg || "").replace(/\s+/g, " ");

  for (const label of APEXIQ_RENDERED_STAT_LABELS) {
    const lab = escapeRegExp(label);
    // label before value: "BR Damage 289,797"
    let re = new RegExp(`${lab}\\s+([0-9][0-9,]{0,12})`, "ig");
    let m;
    while ((m = re.exec(clean))) add(label, m[1]);

    // value before label: "289,797 BR Damage"
    re = new RegExp(`([0-9][0-9,]{0,12})\\s+${lab}`, "ig");
    while ((m = re.exec(clean))) add(label, m[1]);
  }

  return dedupeSpecificStats(out).slice(0, 12);
}

function dedupeSpecificStats(stats) {
  const out = [];
  for (const s of stats) {
    const label = String(s.label).toLowerCase();
    const value = String(s.value);
    // If BR/Arenas-specific stat exists, do not also show generic Kills/Damage/Wins with same value.
    if (/^(kills|damage|wins|games played)$/.test(label)) {
      const specific = stats.some(x => String(x.value) === value && String(x.label).toLowerCase() !== label && String(x.label).toLowerCase().includes(label.split(" ")[0]));
      if (specific) continue;
    }
    out.push(s);
  }
  return out;
}

function parseBadgesFromSegment(seg) {
  const badges = [];
  for (const name of APEXIQ_RENDERED_BADGE_LABELS) {
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
    if (re.test(seg)) badges.push({ id: badgeIdFromName(name), name, label: name, src: "", source: "Browser Run rendered ALS parser" });
  }
  return normalizeBadges(badges);
}

function parseBadgesFromHtmlSegment(htmlSeg, textSeg) {
  const badges = parseBadgesFromSegment(textSeg);
  const attrText = [];
  const imgRe = /<img\b[^>]*>/ig;
  let m;
  while ((m = imgRe.exec(String(htmlSeg || "")))) {
    const tag = m[0];
    const attrs = [];
    for (const attr of ["alt","title","aria-label","data-original-title","data-bs-title","src"]) {
      const r = new RegExp(`${attr}=["']([^"']+)["']`, "i").exec(tag);
      if (r) attrs.push(r[1]);
    }
    attrText.push(attrs.join(" "));
  }
  const combined = decodeHtml(attrText.join(" "));
  for (const name of APEXIQ_RENDERED_BADGE_LABELS) {
    if (new RegExp(escapeRegExp(name), "i").test(combined) || badgeIdFromName(combined).includes(badgeIdFromName(name))) {
      badges.push({ id: badgeIdFromName(name), name, label: name, src: "", source: "Browser Run rendered ALS image attributes" });
    }
  }
  return normalizeBadges(badges);
}

function parseAccountBadgesFromHtml(html, text) {
  const s = String(html || "");
  const lower = s.toLowerCase();
  const i = lower.indexOf("account wide badges");
  const seg = i >= 0 ? s.slice(i, i + 8000) : s.slice(0, 8000);
  const badges = parseBadgesFromHtmlSegment(seg, htmlToText(seg));
  if (badges.length) return badges.slice(0, 24);
  return parseBadgesFromSegment((text || "").slice(0, 1800)).slice(0, 24);
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[-_]/g, " ");
}

function countStats(cards) {
  return (cards || []).reduce((n, c) => n + ((c.stats || c.trackers || []).length), 0);
}

function parseRenderedLeaderboardContent(html, platform, url) {
  const text = htmlToText(html);
  const blocked = /ERR_BLOCKED_BY_RESPONSE|refused to connect|captcha|rate limit|slow down/i.test(text);
  const players = parseLeaderboardRowsFromText(text, platform);
  return {
    ok: players.length > 0,
    platform,
    url,
    source: "Browser Run rendered ALS content parser",
    predCutoff: 0,
    mastersPreds: 0,
    splitEnds: "",
    players,
    blocked,
    error: players.length ? "" : (blocked ? "Rendered page was blocked/rate-limited by source." : "Browser Run returned no visible leaderboard rows.")
  };
}

function parseLeaderboardRowsFromText(text, platform) {
  const clean = String(text || "").replace(/\s+/g, " ");
  const rows = [];
  const seen = new Set();

  function add(rank, name, rp) {
    const r = toNum(rank);
    const score = toNum(rp);
    let n = String(name || "")
      .replace(/\b(Offline|Online|In match|In lobby|Level|Lvl|RP|Predator|Master|Masters)\b/gi, " ")
      .replace(/[#•|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!r || r < 1 || r > 750 || !n || n.length > 48 || !score || score < 10000 || score > 1000000) return;
    if (/apexlegendsstatus|leaderboard|battle royale|loading|captcha|blocked/i.test(n)) return;
    const key = `${r}:${n}:${score}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ rank: r, name: n, rp: score, platform, source: "Browser Run rendered ALS content parser", url: profileUrl(platform, n) });
  }

  const patterns = [
    /(?:^|\s)#\s*(\d{1,3})\s+([A-Za-z0-9_\-[\]. ]{2,48}?)\s+([0-9]{2,3},[0-9]{3}|[0-9]{5,6})\s*(?:RP)?/ig,
    /(?:^|\s)(\d{1,3})\s+([A-Za-z0-9_\-[\]. ]{2,48}?)\s+(?:Lvl|Level)?\s*\d{0,4}\s+([0-9]{2,3},[0-9]{3}|[0-9]{5,6})\s*(?:RP)?/ig,
    /(?:Rank\s*)?(\d{1,3})\s+Player\s+([A-Za-z0-9_\-[\]. ]{2,48}?)\s+RP\s+([0-9]{2,3},[0-9]{3}|[0-9]{5,6})/ig
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(clean))) add(m[1], m[2], m[3]);
  }
  return rows.sort((a, b) => a.rank - b.rank).slice(0, 25);
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function profileSchema() {
  return {
    type: "object",
    properties: {
      name: { type: ["string","null"] },
      visibleLevel: { type: ["number","string","null"] },
      prestige: { type: ["number","string","null"] },
      trueLevel: { type: ["number","string","null"] },
      selectedLegend: { type: ["string","null"] },
      accountBadges: { type: "array", items: { type: "string" } },
      legendCards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            legend: { type: "string" },
            stats: {
              type: "array",
              items: {
                type: "object",
                properties: { label: { type: "string" }, value: { type: ["number","string"] } },
                required: ["label","value"]
              }
            },
            badges: { type: "array", items: { type: "string" } }
          },
          required: ["legend"]
        }
      }
    },
    required: ["legendCards"]
  };
}

function leaderboardSchema() {
  return {
    type: "object",
    properties: {
      platform: { type: ["string","null"] },
      predCutoff: { type: ["number","string","null"] },
      mastersPreds: { type: ["number","string","null"] },
      splitEnds: { type: ["string","null"] },
      players: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rank: { type: ["number","string"] },
            name: { type: "string" },
            rp: { type: ["number","string"] },
            level: { type: ["number","string","null"] },
            legend: { type: ["string","null"] },
            status: { type: ["string","null"] }
          },
          required: ["rank","name","rp"]
        }
      }
    },
    required: ["players"]
  };
}

function normalizeRenderedProfile(result, url) {
  const r = unwrap(result);
  const cards = sanitizeLegendCards((r.legendCards || r.legends || r.legendStats || []).map(c => ({
    legend: first(c.legend, c.name, c.legendName, ""),
    stats: normalizeStats(c.stats || c.trackers || []),
    badges: normalizeBadges(c.badges || c.officialBadges || []),
    source: "Browser Run rendered ALS profile"
  })));

  const visibleLevel = toNum(first(r.visibleLevel, r.level));
  const prestigeCompleted = parsePrestige(first(r.prestige, r.prestigeCompleted, r.prestigeNumber));
  const trueLevel = toNum(first(r.trueLevel, r.totalLevel));
  return {
    ok: !!(visibleLevel || cards.length),
    source: "Browser Run rendered ALS profile",
    mode: "browser-json",
    url,
    name: first(r.name, ""),
    visibleLevel: visibleLevel || undefined,
    prestigeCompleted,
    prestigeLabel: prestigeCompleted !== undefined ? `Prestige ${prestigeCompleted}` : "",
    trueLevel: trueLevel || (visibleLevel && visibleLevel <= 500 && prestigeCompleted !== undefined ? visibleLevel + prestigeCompleted * 500 : undefined),
    selectedLegend: first(r.selectedLegend, ""),
    accountBadges: normalizeBadges(r.accountBadges || []),
    legendCards: cards
  };
}

function normalizeRenderedLeaderboard(result, platform, url) {
  const r = unwrap(result);
  const players = (r.players || r.rows || r.leaderboard || []).map((p, i) => ({
    rank: toNum(first(p.rank, p.position, i + 1)),
    name: String(first(p.name, p.player, p.username, "")).trim(),
    rp: toNum(first(p.rp, p.RP, p.score, p.rankScore, p.value)),
    level: first(p.level, p.visibleLevel, ""),
    legend: first(p.legend, ""),
    status: first(p.status, ""),
    platform,
    source: "Browser Run rendered ALS leaderboard",
    url: p.name ? profileUrl(platform, p.name) : ""
  })).filter(p => p.rank && p.name && p.rp >= 10000 && p.rp < 1000000)
    .sort((a,b) => a.rank - b.rank)
    .slice(0,25);

  return {
    ok: players.length > 0,
    platform,
    url,
    source: "Browser Run rendered ALS leaderboard",
    predCutoff: toNum(first(r.predCutoff, r.predRP)),
    mastersPreds: toNum(first(r.mastersPreds, r.mastersAndPreds)),
    splitEnds: first(r.splitEnds, ""),
    players,
    error: players.length ? "" : "Browser Run returned no visible leaderboard rows."
  };
}

function sanitizeLegendCards(cards) {
  const rows = [];
  const seenLegend = new Set();
  for (const c of cards || []) {
    const legend = normalizeLegendName(c.legend);
    if (!legend || seenLegend.has(norm(legend))) continue;
    seenLegend.add(norm(legend));
    const stats = normalizeStats(c.stats || []).filter(isSafeStat);
    // Important: ALS sometimes exposes badge icons visually without useful alt/title text.
    // Do not drop those visual slots; keep them as unknown candidates so ApexIQ can display/map them.
    const badges = normalizeBadges(c.badges || []).filter(b => isSafeBadgeName(b.name || b.label || b.id) || b.src || b.source === "ALS visual region image");
    rows.push({
      legend,
      stats,
      trackers: stats.map(s => ({ name: s.label, key: s.label, value: s.value, source: s.source })),
      badges,
      officialBadges: badges,
      source: c.source || "Browser Run rendered ALS profile"
    });
  }
  return rows;
}

function isSafeStat(s) {
  const label = String(s.label || "").toLowerCase();
  if (!label) return false;
  if (/badge|profile|rank|prestige|level|source|skin|frame|pose|intro/.test(label)) return false;
  return /(kills?|damage|wins?|games? played|matches|arenas?|br |smg|l-star|r-301|r-99|spitfire|alternator|leader)/.test(label);
}

function isSafeBadgeName(name) {
  const s = String(name || "").toLowerCase();
  return /badge|als badge slot|unknown als|20 kill|20 bomb|20kill|20bomb|4k|4,000|4000|triple triple|team work|teamwork|no witnesses|rapid elimination|predator|master|diamond|platinum|gold|silver|bronze|assassin|wake|wrath|hammer/.test(s);
}

async function safePrestigeProbe(player, platform, uid, env) {
  const attempts = [];
  const urls = [];
  if (player) urls.push(profileUrl(platform, player));
  if (uid) urls.push(profileUidUrl(platform, uid));

  const override = findLevelOverride(player, platform, env);
  let bestParsed = null;

  for (const target of [...new Set(urls)]) {
    try {
      const html = await fetchText(target);
      const parsed = parsePrestigeText(htmlToText(html));
      attempts.push({ url: target, ok: !!(parsed.visibleLevel || parsed.prestigeCompleted !== undefined), mode: "direct" });
      if (parsed.visibleLevel || parsed.prestigeCompleted !== undefined) {
        bestParsed = { ...parsed, ok: true, source: "Apex Legends Status profile page", url: target, attempts };
        break;
      }
    } catch (e) {
      attempts.push({ url: target, ok: false, mode: "direct", error: e.message });
    }
  }

  if (bestParsed && override) {
    const visible = bestParsed.visibleLevel;
    const prestigeCompleted = override.prestigeCompleted !== undefined ? Number(override.prestigeCompleted) : bestParsed.prestigeCompleted;
    const trueLevel = override.trueLevel !== undefined
      ? Number(override.trueLevel)
      : (visible && visible <= 500 && prestigeCompleted !== undefined ? visible + prestigeCompleted * 500 : bestParsed.trueLevel);
    return {
      ...bestParsed,
      source: "Apex Legends Status profile page + ApexIQ level override",
      prestigeCompleted,
      prestigeLabel: override.prestigeLabel || (prestigeCompleted !== undefined ? `Prestige ${prestigeCompleted}` : bestParsed.prestigeLabel),
      trueLevel
    };
  }

  if (bestParsed) return bestParsed;

  if (override) {
    return {
      ok: true,
      source: "ApexIQ level override",
      visibleLevel: undefined,
      prestigeCompleted: override.prestigeCompleted !== undefined ? Number(override.prestigeCompleted) : undefined,
      prestigeLabel: override.prestigeLabel || (override.prestigeCompleted !== undefined ? `Prestige ${override.prestigeCompleted}` : ""),
      trueLevel: override.trueLevel !== undefined ? Number(override.trueLevel) : undefined,
      attempts
    };
  }

  return { ok: false, source: "", attempts };
}


function parsePrestigeText(text) {
  const s = String(text || "").replace(/\s+/g, " ");
  const pm = s.match(/\bPRESTIGE\s*([0-4])\b/i) || s.match(/\bPrestige\s*([0-4])\b/i);
  const lm = s.match(/\bLEVEL\s*([0-9]{1,5})\b/i) || s.match(/\bLevel\s*([0-9]{1,5})\b/);
  const visibleLevel = lm ? toNum(lm[1]) : undefined;
  const prestigeCompleted = pm ? toNum(pm[1]) : undefined;
  return {
    visibleLevel,
    prestigeCompleted,
    prestigeLabel: prestigeCompleted !== undefined ? `Prestige ${prestigeCompleted}` : "",
    trueLevel: visibleLevel && visibleLevel <= 500 && prestigeCompleted !== undefined ? visibleLevel + prestigeCompleted * 500 : undefined
  };
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function defaultLevelOverride(player, platform) {
  const key = String(player || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (key === "imissanyway") return { prestigeCompleted: 2, prestigeLabel: "Prestige 2" };
  return null;
}

function findLevelOverride(player, platform, env) {
  if (env.APEXIQ_LEVEL_OVERRIDES) {
    try {
      const map = JSON.parse(env.APEXIQ_LEVEL_OVERRIDES);
      const keys = [`${String(player).toLowerCase()}|${platform}`, String(player).toLowerCase(), String(player), "default"];
      for (const k of keys) if (map[k]) return map[k];
    } catch (_) {}
  }
  return defaultLevelOverride(player, platform);
}

async function safeTracker(player, platform, env) {
  const key = env.TRN_API_KEY || env.TRACKER_API_KEY;
  if (!key) return { ok: false, error: "TRN_API_KEY / TRACKER_API_KEY not set", flat: [], legendStats: [] };
  const slug = platformInfo(platform).trackerSlug;
  if (!slug) return { ok: false, error: "Tracker unsupported platform", flat: [], legendStats: [] };
  try {
    const data = await fetchJson(`https://public-api.tracker.gg/v2/apex/standard/profile/${slug}/${encodeURIComponent(player)}`, {
      headers: { "TRN-Api-Key": key }
    });
    return { ok: true, source: "Tracker Network API", raw: data, flat: flattenTracker(data), legendStats: flattenTrackerLegendRows(data) };
  } catch (e) {
    return { ok: false, error: e.message, flat: [], legendStats: [] };
  }
}

function flattenTrackerLegendRows(root) {
  const rows = [];
  const segments = root && root.data && Array.isArray(root.data.segments) ? root.data.segments : [];
  for (const seg of segments) {
    const meta = seg.metadata || {};
    const type = String(seg.type || meta.type || "").toLowerCase();
    const name = first(meta.name, meta.legendName, seg.name, seg.displayName);
    const legend = normalizeLegendName(name);
    if (!legend || (type && !/legend/.test(type))) continue;
    const stats = [];
    for (const [key, st] of Object.entries(seg.stats || {})) {
      if (!st || typeof st !== "object") continue;
      const label = first(st.displayName, st.metadata && st.metadata.name, key);
      const value = first(st.value, st.displayValue);
      if (label !== undefined && value !== undefined) stats.push({ label: String(label), value, source: "Tracker Network" });
    }
    const normalized = normalizeStats(stats);
    if (normalized.length) {
      rows.push({
        legend,
        stats: normalized,
        trackers: normalized.map(s => ({ name: s.label, key: s.label, value: s.value, source: s.source })),
        badges: [],
        officialBadges: [],
        source: "Tracker Network"
      });
    }
  }
  return rows;
}

function selectedLegendRowFromBridge(legendName, selectedStats) {
  const legend = normalizeLegendName(legendName);
  if (!legend) return null;
  const stats = normalizeStats(selectedStats || []);
  return {
    legend,
    stats,
    trackers: stats.map(s => ({ name: s.label, key: s.label, value: s.value, source: s.source || "Apex Legends Status /bridge" })),
    badges: [],
    officialBadges: [],
    source: "Apex Legends Status /bridge selected legend"
  };
}

function trustedRenderedRows(rows) {
  return (rows || []).filter(r => {
    const statCount = (r.stats || []).length + (r.trackers || []).length;
    const badgeCount = (r.badges || []).length + (r.officialBadges || []).length;
    // Avoid cross-card Browser Run bleed. Use rendered rows only if they have badges or a reasonable set of stats.
    return badgeCount > 0 || statCount >= 1;
  });
}


function buildProfile(player, platformReq, bridge, levelSource, tracker, rendered) {
  const raw = bridge.raw || {};
  const global = raw.global || {};
  const realtime = raw.realtime || {};
  const rank = global.rank || raw.rank || {};
  const selected = raw.legends && raw.legends.selected ? raw.legends.selected : {};
  const bridgeTrackers = extractALSTrackers(selected, raw);

  const platform = bridge.platformUsed || (platformReq === "auto" ? "PC" : platformReq);
  const selectedStats = normalizeStats([
    ...bridgeTrackers.map(t => ({ label: t.name || t.key, value: t.value, source: "Apex Legends Status" })),
    ...(tracker.flat || [])
  ]);

  const apiLevel = first(global.level, raw.level, realtime.level);
  const levelInfo = computeLevel(apiLevel, { ...(levelSource || {}), raw });

  const fields = {};
  const visibleLevelValue = levelInfo.visibleLevel || (toNum(apiLevel) && toNum(apiLevel) <= 500 ? toNum(apiLevel) : undefined);
  const plainLevelValue = visibleLevelValue || levelInfo.trueLevel || apiLevel;
  const playerKey = norm(player);
  const sourceText = String(levelInfo.source || levelSource && levelSource.source || "");
  const isOwnerOverride = playerKey === "imissanyway" && /override|prestige/i.test(sourceText);
  // Important distinction:
  // - Bridge 1-500 level is valid visible account level and should display as "Level".
  // - Only >500/prestige/override should display as "True Level".
  if (plainLevelValue) putField(fields, "level", plainLevelValue, levelInfo.source || "Apex Legends Status /bridge");
  if (visibleLevelValue) putField(fields, "visibleLevel", visibleLevelValue, levelInfo.source || "Apex Legends Status /bridge");
  if ((levelInfo.trueLevel && levelInfo.trueLevel > 500) || isOwnerOverride) {
    putField(fields, "trueLevel", levelInfo.trueLevel || plainLevelValue, levelInfo.source || "ApexIQ level override");
  }
  if (levelInfo.prestigeCompleted !== undefined) {
    putField(fields, "prestige", levelInfo.prestigeLabel || `Prestige ${levelInfo.prestigeCompleted}`, levelInfo.source);
  }

  const rankScore = first(rank.rankScore, rank.RP, rank.score, global.rankScore);
  putField(fields, "rank", formatRank(rank), "Apex Legends Status");
  putField(fields, "rankScore", rankScore, "Apex Legends Status");
  putField(fields, "rp", rankScore, "Apex Legends Status");
  const selectedLegendName = first(rendered.selectedLegend, selected.LegendName, selected.legendName, selected.name, realtime.selectedLegend);
  putField(fields, "legend", selectedLegendName, "Apex Legends Status");
  putField(fields, "uid", first(raw.uid, global.uid, realtime.uid), "Apex Legends Status");
  putField(fields, "kills", findMetric(selectedStats, ["kills", "kill"]), "ALS/Tracker");
  putField(fields, "damage", findMetric(selectedStats, ["damage", "dmg"]), "ALS/Tracker");
  putField(fields, "wins", findMetric(selectedStats, ["wins", "win"]), "ALS/Tracker");
  putField(fields, "games", findMetric(selectedStats, ["games played", "matches", "games"]), "ALS/Tracker");
  putField(fields, "kdr", findMetric(selectedStats, ["k/d", "kd", "kdr", "kill death"]), "Tracker");

  const bridgeLegendRows = extractLegendStats(raw);
  const selectedBridgeRow = selectedLegendRowFromBridge(selectedLegendName, selectedStats);
  const trackerLegendRows = tracker && tracker.ok ? sanitizeLegendCards(tracker.legendStats || []) : [];
  const renderedRows = rendered && rendered.ok ? sanitizeLegendCards(rendered.legendCards || []) : [];
  const allLegendStats = sanitizeLegendRowsStrict(mergeLegendRows([selectedBridgeRow, ...bridgeLegendRows, ...trackerLegendRows].filter(Boolean), trustedRenderedRows(renderedRows)));

  return {
    ok: bridge.ok || (rendered && rendered.ok),
    mock: false,
    rawAvailable: { als: !!bridge.ok, tracker: !!tracker.ok, trackerLegendRows: !!(tracker && tracker.legendStats && tracker.legendStats.length), rendered: !!(rendered && rendered.ok) },
    name: first(rendered.name, global.name, raw.name, player),
    platform,
    platformUsed: platform,
    platformRequested: platformReq,
    platformLabel: platformInfo(platform).label,
    uid: first(raw.uid, global.uid, realtime.uid),
    fields,
    levelInfo,
    trackers: bridgeTrackers,
    accountBadges: rendered && rendered.ok ? rendered.accountBadges || [] : [],
    officialAccountBadges: rendered && rendered.ok ? rendered.accountBadges || [] : [],
    legendBadges: badgeRowsFromLegendRows(allLegendStats),
    officialLegendBadges: badgeRowsFromLegendRows(allLegendStats),
    allLegendStats,
    legendStats: allLegendStats,
    profilePage: rendered && rendered.ok ? {
      ok: true,
      mode: rendered.mode,
      source: rendered.source,
      url: rendered.url,
      visibleLevel: levelInfo.visibleLevel,
      prestigeCompleted: levelInfo.prestigeCompleted,
      prestigeLabel: levelInfo.prestigeLabel,
      trueLevel: levelInfo.trueLevel,
      accountBadges: rendered.accountBadges || [],
      legendStats: allLegendStats,
      legendBadges: badgeRowsFromLegendRows(allLegendStats),
      badgeRowsFound: allLegendStats.reduce((n, r) => n + (r.badges || []).length, 0)
    } : { ok: false, error: rendered && rendered.error },
    sources: [
      { name: "Apex Legends Status /bridge", ok: !!bridge.ok, error: bridge.error || "", tried: bridge.tried || [] },
      { name: "Browser Run rendered ALS page", ok: !!(rendered && rendered.ok), error: rendered && rendered.error || "", attempts: rendered && rendered.attempts || [] },
      { name: "Prestige/level source", ok: !!(levelSource && levelSource.ok), source: levelSource && levelSource.source || "" },
      { name: "Tracker Network", ok: !!tracker.ok, error: tracker.error || "" }
    ],
    missing: ["wins", "games", "kdr"].filter(k => !fields[k]).map(k => `${k}: not returned by ALS/Tracker`),
    fetchedAt: new Date().toISOString(),
    liveRefresh: true
  };
}


function findPrestigeInObject(obj, depth = 0, seen = new Set()) {
  if (!obj || typeof obj !== "object" || depth > 8 || seen.has(obj)) return undefined;
  seen.add(obj);
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k || "").toLowerCase();
    if (/prestige/.test(key)) {
      if (typeof v === "number" && v >= 0 && v <= 10) return v;
      const n = toNum(v);
      if (n !== undefined && n >= 0 && n <= 10) return n;
      const m = String(v || "").match(/prestige\s*([0-9]+)/i);
      if (m) return toNum(m[1]);
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = findPrestigeInObject(v, depth + 1, seen);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function findTrueLevelInObject(obj, depth = 0, seen = new Set()) {
  if (!obj || typeof obj !== "object" || depth > 8 || seen.has(obj)) return undefined;
  seen.add(obj);
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k || "").toLowerCase();
    if (/true.*level|account.*level|total.*level|overall.*level/.test(key)) {
      const n = toNum(v);
      if (n && n > 500 && n < 10000) return n;
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = findTrueLevelInObject(v, depth + 1, seen);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}


function computeLevel(apiLevelRaw, src) {
  const apiLevel = toNum(apiLevelRaw);
  const visibleFromSrc = toNum(src && src.visibleLevel);
  const rawPrestige = findPrestigeInObject(src && src.raw);
  const prestige = src && src.prestigeCompleted !== undefined ? toNum(src.prestigeCompleted) : rawPrestige;
  const trueFromSrc = toNum(src && src.trueLevel) || findTrueLevelInObject(src && src.raw);

  // If the rendered/profile source gives visible level + prestige, this is the most reliable true-level formula.
  const visible = visibleFromSrc && visibleFromSrc <= 500 ? visibleFromSrc : (apiLevel && apiLevel <= 500 ? apiLevel : undefined);
  if (visible && visible <= 500 && prestige !== undefined) {
    return {
      visibleLevel: visible,
      trueLevel: visible + prestige * 500,
      prestigeCompleted: prestige,
      prestigeLabel: src && src.prestigeLabel || `Prestige ${prestige}`,
      source: src && src.source || "Apex Legends Status profile"
    };
  }

  if (trueFromSrc && trueFromSrc > 500) {
    return { visibleLevel: visible, trueLevel: trueFromSrc, prestigeCompleted: prestige, prestigeLabel: prestige !== undefined ? (src.prestigeLabel || `Prestige ${prestige}`) : "", source: src && src.source || "live" };
  }

  if (apiLevel > 500) {
    return {
      visibleLevel: visibleFromSrc && visibleFromSrc <= 500 ? visibleFromSrc : undefined,
      trueLevel: apiLevel,
      prestigeCompleted: prestige,
      prestigeLabel: prestige !== undefined ? src.prestigeLabel || `Prestige ${prestige}` : "",
      source: "Apex Legends Status"
    };
  }

  return { visibleLevel: apiLevel && apiLevel <= 500 ? apiLevel : undefined, trueLevel: apiLevel > 500 ? apiLevel : undefined, source: "Apex Legends Status /bridge visible level" };
}



function trackerPlatformSlug(platform) {
  if (platform === "PC") return ["all", "origin"];
  if (platform === "PS4") return ["psn", "all"];
  if (platform === "X1") return ["xbl", "all"];
  return ["all"];
}

function trackerGGUrl(slug) {
  return `https://apex.tracker.gg/apex/leaderboards/stats/${slug}/RankScore?legend=all&page=1`;
}

async function fetchTrackerGGLeaderboard(platform) {
  const slugs = trackerPlatformSlug(platform);
  let lastError = "";
  for (const slug of slugs) {
    const url = trackerGGUrl(slug);
    try {
      const html = await fetchText(url, { headers: { "Accept": "text/html,*/*", "User-Agent": "Mozilla/5.0 ApexIQ/4.9.9.6" } });
      const embedded = parseEmbeddedTrackerJson(html, platform, url);
      const text = textFromHtml(html);
      const players = embedded.length ? embedded : parseTrackerGGText(text, platform, url);
      if (players.length) {
        return { ok: true, source: `Tracker.gg public RankScore leaderboard (${slug})`, url, players, rawHint: text.slice(0, 600) };
      }
      lastError = "No Tracker.gg rows parsed from " + slug;
    } catch (e) {
      lastError = e.message;
    }
  }
  return { ok: false, source: "Tracker.gg public RankScore leaderboard", url: trackerGGUrl(slugs[0]), players: [], error: lastError };
}


function parseEmbeddedTrackerJson(html, platform, sourceUrl) {
  const out = [];
  const text = String(html || "");
  const patterns = [
    /"rank"\s*:\s*(\d+)[\s\S]{0,500}?"name"\s*:\s*"([^"]+)"[\s\S]{0,500}?"value"\s*:\s*(\d+)/g,
    /"displayValue"\s*:\s*"([\d,]+)"[\s\S]{0,500}?"rank"\s*:\s*(\d+)[\s\S]{0,500}?"name"\s*:\s*"([^"]+)"/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) && out.length < 50) {
      let rank, name, rp;
      if (m.length === 4 && /^\d+$/.test(m[1])) { rank = toNum(m[1]); name = m[2]; rp = toNum(m[3]); }
      else { rp = toNum(m[1]); rank = toNum(m[2]); name = m[3]; }
      if (rank && name && rp >= 10000 && !out.some(r => r.rank === rank || r.name === name)) out.push({ rank, name, rp, score: rp, platform, source: "Tracker.gg embedded data", url: sourceUrl });
    }
  }
  return out.sort((a,b)=>a.rank-b.rank);
}

function trackerCleanLine(line) {
  const s = String(line || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (/^(Fortnite|Valorant|Search|Leaderboards|My Profile|Insights|Premium|Rank Player Rank Score Level|Apex Legends Rank Distribution|Last updated|The number of Master|The graph below|Image:|Get Premium|Sign In|More Games|Rank|Player|Rank Score|Level)$/i.test(s)) return "";
  return s;
}

function parseTrackerGGText(text, platform, sourceUrl) {
  const lines = String(text || "").split(/\n+/).map(trackerCleanLine).filter(Boolean);
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    if (!/^\d{1,3}$/.test(lines[i])) continue;
    const rank = toNum(lines[i]);
    if (!rank || rank > 750) continue;

    let name = "";
    let rp = 0;
    let level = 0;

    for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
      const line = lines[j];
      if (!name && !/^\d[\d,]*$/.test(line) && !/^Image:/i.test(line)) {
        name = line;
        continue;
      }
      if (name && !rp && /^\d{2,3}(,\d{3})+$/.test(line)) {
        rp = toNum(line);
        continue;
      }
      if (name && rp && /^\d{1,5}$/.test(line)) {
        level = toNum(line);
        break;
      }
    }

    if (rank && name && rp >= 10000 && !rows.some(r => r.rank === rank || r.name === name)) {
      rows.push({ rank, name, rp, score: rp, level, platform, source: "Tracker.gg public RankScore leaderboard", url: sourceUrl });
    }
  }

  return rows.sort((a,b) => a.rank - b.rank).slice(0, 50);
}





function apexRankedLegendPattern() {
  const aliases = [...LEGEND_NAMES, "Axel"];
  return aliases.slice().sort((a,b)=>b.length-a.length).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

function normalizeApexRankedLegendName(name) {
  return String(name || "").trim().toLowerCase() === "axel" ? "Axle" : String(name || "").trim();
}

function cleanApexRankedLine(line) {
  return String(line || "")
    .replace(/&middot;|&amp;middot;|middot;/gi, "·")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLegendPlatformLine(line) {
  const cleaned = cleanApexRankedLine(line);
  const m = cleaned.match(/^(.+?)\s*(?:·|\u00b7)\s*(PC|PS4|PS|PlayStation|X1|Xbox|XBOX)$/i);
  if (!m) return null;
  const legend = normalizeApexRankedLegendName(m[1]);
  const valid = new Set([...LEGEND_NAMES.map(x => x.toLowerCase()), "axle"]);
  if (!valid.has(legend.toLowerCase())) return null;
  return { legend, platformText: m[2] };
}

function parseApexRankedRowsLineMode(raw, platform, url) {
  const lines = String(raw || "").split(/\n+/).map(cleanApexRankedLine).filter(Boolean);
  const rows = [];
  for (let i = 0; i < lines.length && rows.length < 60; i++) {
    if (!/^\d{1,3}$/.test(lines[i])) continue;
    const rank = toNum(lines[i]);
    if (!rank || rank > 750) continue;

    let j = i + 1;
    if (/^[A-Z?]$/.test(lines[j] || "")) j++;
    const nameParts = [];
    let legendInfo = null;
    for (; j < Math.min(lines.length, i + 8); j++) {
      legendInfo = parseLegendPlatformLine(lines[j]);
      if (legendInfo) break;
      if (/^\d{2,3}(?:,\d{3})+$/.test(lines[j])) break;
      if (!/^(Rank|Player|RP|24h RP|Status|Live|Searching live ranked data|Top 1-50)$/i.test(lines[j])) nameParts.push(lines[j]);
    }
    if (!legendInfo || !nameParts.length) continue;
    let rp = 0;
    for (let k = j + 1; k < Math.min(lines.length, j + 5); k++) {
      if (/^\d{2,3}(?:,\d{3})+$/.test(lines[k])) {
        rp = toNum(lines[k]);
        break;
      }
    }
    const name = nameParts.join(" ").trim();
    if (rank && name && rp >= 10000 && !rows.some(r => r.rank === rank || r.name === name)) {
      rows.push({ rank, name, legend: legendInfo.legend, rp, score: rp, platform, source: "ApexRanked direct public leaderboard", url });
    }
  }
  return rows.sort((a,b) => a.rank - b.rank);
}

function parseApexRankedRowsRegexMode(raw, platform, url) {
  const text = String(raw || "").replace(/&middot;|&amp;middot;|middot;/gi, "·").replace(/\s+/g, " ").trim();
  const rows = [];
  const legendPat = apexRankedLegendPattern();
  const rowRe = new RegExp(String.raw`(?:^|\s)(\d{1,3})\s+[A-Z?]\s+(.{1,80}?)\s+(${legendPat})\s*(?:·|\u00b7)\s+(PC|PS4|PS|PlayStation|X1|Xbox|XBOX)\s+(?:(?:Apex Predator|Master|Diamond|Platinum|Gold|Silver|Bronze|Rookie)\s+)?(\d{2,3}(?:,\d{3})+)\s+(?:[▲▼–-]\s*\+?[\d,]+|Live|Idle|0)?`, "gi");
  let m;
  while ((m = rowRe.exec(text)) && rows.length < 60) {
    const rank = toNum(m[1]);
    const name = String(m[2] || "").trim();
    const legend = normalizeApexRankedLegendName(m[3]);
    const rp = toNum(m[5]);
    if (rank && name && rp >= 10000 && !/Rank Player|Searching live/i.test(name) && !rows.some(r => r.rank === rank || r.name === name)) {
      rows.push({ rank, name, legend, rp, score: rp, platform, source: "ApexRanked direct public leaderboard", url });
    }
  }
  return rows.sort((a,b) => a.rank - b.rank);
}

function parseApexRankedRowsFromRaw(raw, platform, url) {
  const lineRows = parseApexRankedRowsLineMode(raw, platform, url);
  if (lineRows.length > 1) return lineRows;
  const regexRows = parseApexRankedRowsRegexMode(raw, platform, url);
  if (regexRows.length > lineRows.length) return regexRows;
  if (lineRows.length) return lineRows;

  const text = String(raw || "").replace(/\s+/g, " ");
  const topMatch = text.match(/Top RP\s+(\d{2,3}(?:,\d{3})+)\s+(.+?)\s+Top 24h mover/i);
  if (topMatch) {
    const rp = toNum(topMatch[1]);
    const name = String(topMatch[2] || "").trim();
    if (name && rp) return [{ rank: 1, name, rp, score: rp, platform, source: "ApexRanked public top signal", url }];
  }
  return [];
}

function parseApexRankedTopRows(pageInfo, platform) {
  const raw = String(pageInfo?.rawHint || "");
  const rows = parseApexRankedRowsFromRaw(raw, platform, pageInfo.url || "https://apexranked.com/");
  if (rows.length) return rows.slice(0, 50);
  return [];
}





function apexRankedPlatformParam(platform) {
  if (platform === "PC") return "PC";
  if (platform === "PS4") return "PS4";
  if (platform === "X1") return "X1";
  return "";
}

function apexRankedPlatformUrl(platform, page = 1) {
  const p = apexRankedPlatformParam(platform);
  if (!p) return "";
  const u = new URL("https://apexranked.com/");
  u.searchParams.set("page", String(page));
  u.searchParams.set("platform", p);
  u.searchParams.set("scope", "predator");
  u.searchParams.set("search", "");
  u.searchParams.set("search_mode", "strict");
  return u.toString();
}

function parseApexRankedPageInfo(text, page, platform, url) {
  const pageCount = toNum(firstMatch(text, /Page\s+\d+\s*\/\s*(\d+)/i)) || 15;
  return {
    page,
    platform,
    url,
    pageCount,
    predCutoff: numberFromText(firstMatch(text, /Pred cutoff\s*([\d,]+)/i)) || numberFromText(firstMatch(text, /Current cutoff\s*([\d,]+)/i)),
    mastersPreds: numberFromText(firstMatch(text, /Estimated masters players\s*([\d,]+)/i)) || numberFromText(firstMatch(text, /([\d,]+)\s*Masters est/i)),
    lastUpdated: firstMatch(text, /Last refresh\s*([^\n]+)/i) || firstMatch(text, /Updated\s*([A-Z][a-z]{2}\s+\d+,[^\n]+)/i),
    trackedTop750: numberFromText(firstMatch(text, /Tracked top 750\s*([\d,]+)/i)) || numberFromText(firstMatch(text, /([\d,]+)\s*tracked/i)),
    top750Online: numberFromText(firstMatch(text, /Top 750 online now\s*([\d,]+)/i)) || numberFromText(firstMatch(text, /Online now\s*([\d,]+)/i))
  };
}

async function fetchApexRankedPage(platform, page) {
  const url = apexRankedPlatformUrl(platform, page);
  if (!url) return { ok: false, players: [], error: "ApexRanked has no URL for " + platform };
  const attempts = [
    { url, source: "ApexRanked direct public pages" },
    { url: jinaReaderUrl(url), source: "ApexRanked via Jina Reader fallback" }
  ];
  let lastError = "";
  for (const attempt of attempts) {
    try {
      const html = await fetchText(attempt.url, { headers: { "Accept": "text/html,text/plain,*/*", "User-Agent": "Mozilla/5.0 ApexIQ/4.9.9.6" } });
      const text = textFromHtml(html);
      const players = parseApexRankedRowsFromRaw(text, platform, url);
      const info = parseApexRankedPageInfo(text, page, platform, url);
      if (players.length || info.predCutoff || info.mastersPreds) return { ok: players.length > 0, source: attempt.source, url, page, players, ...info, rawHint: text.slice(0, 2500) };
      lastError = "No readable rows from " + attempt.source;
    } catch (e) {
      lastError = e.message || String(e);
    }
  }
  return { ok: false, source: "ApexRanked fallback exhausted", url, page, players: [], error: lastError || "No ranked data returned" };
}

async function fetchApexRankedAllPages(platform, requestedPages = 15) {
  const p = apexRankedPlatformParam(platform);
  if (!p) return { ok: false, players: [], source: "ApexRanked direct public pages", error: "ApexRanked currently exposes PC, PS4, and X1 tabs only." };
  const first = await fetchApexRankedPage(platform, 1);
  const pageCount = Math.max(1, Math.min(15, requestedPages || first.pageCount || 15));
  const jobs = [];
  for (let page = 2; page <= pageCount; page++) jobs.push(fetchApexRankedPage(platform, page).catch(e => ({ ok:false, page, players:[], error:e.message })));
  const rest = await Promise.all(jobs);
  const pages = [first, ...rest].filter(Boolean);
  const byRank = new Map();
  for (const pg of pages) {
    for (const row of pg.players || []) {
      if (!byRank.has(row.rank)) byRank.set(row.rank, row);
    }
  }
  const players = [...byRank.values()].sort((a,b)=>a.rank-b.rank);
  const bestInfo = pages.find(pg => pg.predCutoff || pg.mastersPreds || pg.lastUpdated) || first || {};
  return {
    ok: players.length > 0,
    source: "ApexRanked direct public pages",
    url: apexRankedPlatformUrl(platform, 1),
    players,
    pagesFetched: pages.length,
    pageCount,
    pageResults: pages.map(pg => ({ page: pg.page, ok: !!pg.ok, rows: (pg.players || []).length, error: pg.error || "" })),
    predCutoff: bestInfo.predCutoff,
    mastersPreds: bestInfo.mastersPreds,
    lastUpdated: bestInfo.lastUpdated,
    trackedTop750: bestInfo.trackedTop750,
    top750Online: bestInfo.top750Online,
    rawHint: (first && first.rawHint) || ""
  };
}


async function fetchTextLimited(url, options = {}, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchText(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
function alsSwitchLeaderboardUrl() {
  return "https://apexlegendsstatus.com/live-ranked-leaderboards/Battle_Royale/SWITCH";
}
function jinaReaderUrl(targetUrl) {
  return "https://r.jina.ai/" + targetUrl;
}
function parseAlsSwitchRows(raw, url, source) {
  const lines = String(raw || "").split(/\n+/).map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  const rows = [];
  const isRankLine = s => /^(\d{1,4})#\d{1,4}$/.test(s || "");
  const legendRx = /^Image:\s*(Alter|Ash|Axle|Ballistic|Bangalore|Bloodhound|Catalyst|Caustic|Conduit|Crypto|Fuse|Gibraltar|Horizon|Lifeline|Loba|Mad Maggie|Mirage|Newcastle|Octane|Pathfinder|Rampart|Revenant|Seer|Sparrow|Valkyrie|Vantage|Wattson|Wraith)$/i;

  const firstRankIndex = lines.findIndex(isRankLine);
  const pageMode = firstRankIndex > 0 && /^\d{2,3}(?:,\d{3})+$/.test(lines[firstRankIndex - 1]) ? "backward" : "forward";

  function collectAround(i, dir) {
    let name = "", rp = 0, status = "", level = "", legend = "";
    const start = dir < 0 ? i - 1 : i + 1;
    const end = dir < 0 ? Math.max(-1, i - 14) : Math.min(lines.length, i + 14);
    for (let j = start; dir < 0 ? j > end : j < end; j += dir) {
      const line = lines[j];
      if (isRankLine(line)) break;
      if (!legend && legendRx.test(line)) {
        legend = line.replace(/^Image:\s*/i, "").trim();
        continue;
      }
      if (!name && /^Image:\s*Rank\s+/i.test(line)) {
        name = line.replace(/^Image:\s*Rank\s*/i, "").trim();
        continue;
      }
      if (!name && /^Image:\s*/i.test(line) && !/^Image:\s*Rank$/i.test(line)) {
        const candidate = line.replace(/^Image:\s*/i, "").trim();
        if (candidate && !LEGEND_NAMES.some(l => l.toLowerCase() === candidate.toLowerCase())) name = candidate;
        continue;
      }
      if (!status && /\bLvl\s*\d+/i.test(line)) {
        status = line.replace(/\|/g, " · ");
        const lm = line.match(/Lvl\s*(\d+)/i);
        if (lm) level = lm[1];
        continue;
      }
      if (!rp && /^\d{2,3}(?:,\d{3})+$/.test(line)) {
        rp = toNum(line);
        continue;
      }
    }
    return { name, rp, status, level, legend };
  }

  for (let i = 0; i < lines.length; i++) {
    const rankMatch = lines[i].match(/^(\d{1,4})#\d{1,4}$/);
    if (!rankMatch) continue;
    const rank = toNum(rankMatch[1]);
    if (!rank || rank > 900) continue;

    const primary = collectAround(i, pageMode === "backward" ? -1 : 1);
    const fallback = collectAround(i, pageMode === "backward" ? 1 : -1);
    const picked = {
      name: primary.name || fallback.name,
      rp: primary.rp || fallback.rp,
      status: primary.status || fallback.status,
      level: primary.level || fallback.level,
      legend: primary.legend || fallback.legend
    };

    if (rank && picked.name && picked.rp && !rows.some(r => r.rank === rank)) {
      rows.push({ rank, name: picked.name, rp: picked.rp, score: picked.rp, platform: "SWITCH", source, url, status: picked.status, level: picked.level, legend: picked.legend });
    }
  }

  // Backup compact regex for reader text that collapses each row.
  if (!rows.length) {
    const text = lines.join("\n");
    const rx = /(\d{1,4})#\d{1,4}[\s\S]{0,180}?Image:\s*Rank\s*([^\n]+)[\s\S]{0,180}?Lvl\s*(\d+)[\s\S]{0,180}?(\d{2,3}(?:,\d{3})+)/gi;
    let m;
    while ((m = rx.exec(text))) {
      const rank = toNum(m[1]), name = String(m[2] || "").trim(), level = String(m[3] || ""), rp = toNum(m[4]);
      if (rank && name && rp && !rows.some(r => r.rank === rank)) rows.push({ rank, name, rp, score: rp, platform: "SWITCH", source, url, status: level ? "Lvl " + level : "", level, legend: "" });
    }
  }

  return rows.sort((a,b) => a.rank - b.rank).slice(0, 850);
}
async function handleSwitchRanked(url, env, ctx, request) {
  const target = alsSwitchLeaderboardUrl();
  const attempts = [
    { url: target, source: "ALS public Switch leaderboard", timeout: 8500 },
    { url: jinaReaderUrl(target), source: "ALS Switch via Jina Reader", timeout: 12000 }
  ];
  let lastError = "";
  for (const attempt of attempts) {
    try {
      const html = await fetchTextLimited(attempt.url, { headers: { "Accept": "text/html,text/plain,*/*", "User-Agent": "Mozilla/5.0 ApexIQ/4.9.9.6" } }, attempt.timeout);
      const text = textFromHtml(html);
      const rows = parseAlsSwitchRows(text, target, attempt.source);
      const predCutoff = numberFromText(firstMatch(text, /RP for predator\s*([\d,]+)/i)) || numberFromText(firstMatch(text, /Predator\s*([\d,]+)\s*RP/i));
      const mastersPreds = numberFromText(firstMatch(text, /Masters\s*&\s*Preds\s*([\d,]+)/i)) || numberFromText(firstMatch(text, /Masters.*?Preds\s*([\d,]+)/i));
      const splitEnds = firstMatch(text, /Split ends in\s*([^\n]+)/i);
      if (rows.length || predCutoff || mastersPreds) {
        return {
          ok: rows.length > 0,
          version: VERSION,
          platform: {
            platform: "SWITCH",
            platformKey: "SWITCH",
            platformLabel: "Switch",
            label: "Switch",
            url: target,
            predCutoff,
            mastersPreds,
            splitEnds,
            pagesFetched: rows.length ? 1 : 0,
            pageCount: 1,
            players: rows,
            leaderboardSource: attempt.source,
            source: attempt.source,
            error: rows.length ? "" : "Switch cutoff returned, but rows were not readable."
          },
          rawHint: text.slice(0, 2200)
        };
      }
      lastError = attempt.source + ": no readable Switch rows";
    } catch (e) {
      lastError = attempt.source + ": " + (e.name === "AbortError" ? "timeout" : e.message);
    }
  }
  return {
    ok: false,
    version: VERSION,
    platform: {
      platform: "SWITCH",
      platformKey: "SWITCH",
      platformLabel: "Switch",
      label: "Switch",
      url: target,
      players: [],
      pagesFetched: 0,
      pageCount: 1,
      leaderboardSource: "Switch fallback failed",
      error: lastError || "Switch rows unavailable"
    },
    error: lastError || "Switch rows unavailable"
  };
}


async function fetchApexRankedPageFast(platform, page, timeoutMs = 9000) {
  const url = apexRankedPlatformUrl(platform, page);
  if (!url) return { ok: false, players: [], error: "ApexRanked has no URL for " + platform };
  const attempts = [
    { url, source: "ApexRanked direct public pages", timeout: timeoutMs },
    { url: jinaReaderUrl(url), source: "ApexRanked via Jina Reader fallback", timeout: Math.max(timeoutMs, 12000) }
  ];
  let lastError = "";
  for (const attempt of attempts) {
    try {
      const html = await fetchTextLimited(attempt.url, { headers: { "Accept": "text/html,text/plain,*/*", "User-Agent": "Mozilla/5.0 ApexIQ/4.9.9.6" } }, attempt.timeout);
      const text = textFromHtml(html);
      const players = parseApexRankedRowsFromRaw(text, platform, url);
      const info = parseApexRankedPageInfo(text, page, platform, url);
      if (players.length || info.predCutoff || info.mastersPreds) {
        return { ok: players.length > 0, source: attempt.source, url, page, players, ...info, rawHint: text.slice(0, 1800) };
      }
      lastError = "No readable rows from " + attempt.source;
    } catch (e) {
      lastError = e.message || String(e);
    }
  }
  return { ok: false, source: "ApexRanked fallback exhausted", url, page, players: [], error: lastError || "No ranked data returned" };
}

async function fetchApexRankedAllPagesFast(platform, requestedPages = 1) {
  const p = apexRankedPlatformParam(platform);
  if (!p) return { ok: false, players: [], source: "ApexRanked fast direct public pages", error: "ApexRanked does not expose this platform tab." };
  const pageLimit = Math.max(1, Math.min(15, Number(requestedPages || 1)));
  const first = await fetchApexRankedPageFast(platform, 1, 9000);
  const jobs = [];
  for (let page = 2; page <= pageLimit; page++) jobs.push(fetchApexRankedPageFast(platform, page, 9000).catch(e => ({ ok:false, page, players:[], error:e.message })));
  const rest = jobs.length ? await Promise.all(jobs) : [];
  const pages = [first, ...rest].filter(Boolean);
  const byRank = new Map();
  for (const pg of pages) {
    for (const row of pg.players || []) {
      if (!byRank.has(row.rank)) byRank.set(row.rank, row);
    }
  }
  const players = [...byRank.values()].sort((a,b)=>a.rank-b.rank);
  const bestInfo = pages.find(pg => pg.predCutoff || pg.mastersPreds || pg.lastUpdated) || first || {};
  return {
    ok: players.length > 0,
    source: "ApexRanked fast direct public pages",
    url: apexRankedPlatformUrl(platform, 1),
    players,
    pagesFetched: pages.length,
    pageCount: pageLimit,
    pageResults: pages.map(pg => ({ page: pg.page, ok: !!pg.ok, rows: (pg.players || []).length, error: pg.error || "" })),
    predCutoff: bestInfo.predCutoff,
    mastersPreds: bestInfo.mastersPreds,
    lastUpdated: bestInfo.lastUpdated,
    trackedTop750: bestInfo.trackedTop750,
    top750Online: bestInfo.top750Online,
    rawHint: (first && first.rawHint) || ""
  };
}

async function handleRankedFast(url, env, ctx, request) {
  const force = url.searchParams.get("refresh") === "1" || url.searchParams.get("nocache") === "1";
  const pages = Math.max(1, Math.min(15, Number(url.searchParams.get("pages") || "1")));
  const requested = new Set(String(url.searchParams.get("platforms") || "PC,PS4,X1").split(",").map(s => cleanPlatform(s.trim())).filter(Boolean));
  const cacheKey = new Request(url.toString().replace(/([?&])(refresh|nocache|_)=([^&]*)/g, "$1"), request);
  if (!force) {
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached.json();
  }

  const targets = PLATFORMS.filter(p => p.key !== "SWITCH" && requested.has(p.key));
  const platforms = await Promise.all(targets.map(async p => {
    let rows = [];
    let pageInfo = {};
    let err = "";
    let predCutoff = "";
    let mastersPreds = "";
    let lastUpdated = "";
    try {
      const info = await fetchApexRankedAllPagesFast(p.key, pages);
      pageInfo = info;
      rows = info.players || [];
      predCutoff = info.predCutoff || "";
      mastersPreds = info.mastersPreds || "";
      lastUpdated = info.lastUpdated || "";
      err = info.error || "";
    } catch (e) {
      err = e.message || String(e);
    }
    return withRowAliases({
      platform: p.key,
      platformKey: p.key,
      platformLabel: p.label,
      label: p.label,
      url: apexRankedPlatformUrl(p.key, 1) || boardUrl(p.key),
      altUrls: {
        apexRanked: apexRankedPlatformUrl(p.key, 1),
        alsLive: boardUrl(p.key),
        trackerGG: trackerGGUrl(trackerPlatformSlug(p.key)[0])
      },
      predCutoff,
      mastersPreds,
      splitEnds: "",
      lastUpdated,
      pageInfo,
      playerCount: rows.length,
      pagesFetched: pageInfo.pagesFetched || 0,
      pageCount: pageInfo.pageCount || pages,
      players: rows,
      leaderboardAccess: rows.length > 0,
      needsLeaderboardAccess: rows.length === 0,
      leaderboardSource: rows.length ? "ApexRanked fast direct public pages" : "ApexRanked fast failed",
      error: err,
      note: rows.length ? "Rows returned by ApexRanked fast endpoint." : ("Fast endpoint returned no rows. " + err)
    });
  }));

  // Add a Switch placeholder. Real Switch still loads through /api/switch-ranked so it cannot block this endpoint.
  if (requested.has("SWITCH") || String(url.searchParams.get("includeSwitch") || "1") === "1") {
    platforms.push(withRowAliases({
      platform: "SWITCH",
      platformKey: "SWITCH",
      platformLabel: "Switch",
      label: "Switch",
      url: alsSwitchLeaderboardUrl(),
      altUrls: { alsLive: alsSwitchLeaderboardUrl() },
      predCutoff: "",
      mastersPreds: "",
      splitEnds: "",
      lastUpdated: "",
      pageInfo: { pagesFetched: 0, pageCount: 1 },
      playerCount: 0,
      pagesFetched: 0,
      pageCount: 1,
      players: [],
      leaderboardAccess: false,
      needsLeaderboardAccess: true,
      leaderboardSource: "separate /api/switch-ranked",
      error: "Switch loads separately so it cannot break ranked.",
      note: "Switch loads separately through /api/switch-ranked."
    }));
  }

  const out = {
    ok: true,
    version: VERSION,
    fast: true,
    endpoint: "/api/ranked-fast",
    fetchedAt: new Date().toISOString(),
    pagesRequested: pages,
    leaderboardStrategy: ["ApexRanked direct public pages only", "Switch separated to /api/switch-ranked"],
    platforms,
    leaderboards: platforms,
    ranked: platforms,
    sources: [{ name: "ApexRanked fast direct public pages", ok: platforms.some(p => (p.players || []).length > 0) }]
  };
  ctx.waitUntil(caches.default.put(cacheKey, json(out, "*", 200, { "Cache-Control": "public, max-age=45" })));
  return out;
}

async function handleRanked(url, env, ctx, request) {
  const force = url.searchParams.get("refresh") === "1" || url.searchParams.get("nocache") === "1";
  const renderWanted = url.searchParams.get("render") === "1";
  const cacheKey = new Request(url.toString().replace(/([?&])(refresh|nocache|_)=([^&]*)/g, "$1"), request);
  if (!force) {
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached.json();
  }

  let predator = null;
  let predError = "";
  if (env.ALS_API_KEY) {
    try { predator = await fetchJson(`https://api.apexlegendsstatus.com/predator?auth=${encodeURIComponent(env.ALS_API_KEY)}`); }
    catch (e) { predError = e.message; }
  }

  const platforms = [];
  const sourceSummary = [
    { name: "Apex Legends Status Predator API", ok: !!predator, error: predError || "" },
    { name: "ALS official /leaderboard API", ok: false },
    { name: "ALS public live-ranked HTML", ok: false },
    { name: "ALS legacy rankScore HTML", ok: false },
    { name: "ApexRanked PC public page", ok: false },
    { name: "Tracker.gg public RankScore leaderboard", ok: false },
    { name: "Cloudflare Browser Rendering fallback", ok: false }
  ];

  for (const p of PLATFORMS) {
    const pred = extractPredatorForPlatform(predator, p.key);
    let rows = [];
    let source = "";
    let err = "";
    let pageInfo = {};
    let lastUpdated = "";
    let splitEnds = "";
    let mastersPreds = pred.mastersPreds;
    let predCutoff = pred.predCutoff;

    // 1) Keyed ALS leaderboard if available.
    if (env.ALS_API_KEY) {
      try {
        const lb = await fetchOfficialLeaderboard(env.ALS_API_KEY, p.key);
        rows = parseOfficialLeaderboard(lb, p.key).slice(0, 25);
        if (rows.length) {
          source = "ALS official /leaderboard API";
          sourceSummary[1].ok = true;
        }
      } catch (e) { err = e.message; }
    }

    // 2) ApexRanked direct all pages. This pulls up to 15 pages / 750 rows for PC, PS4, and X1.
    if (!rows.length && p.key !== "SWITCH") {
      try {
        const pageLimit = Math.max(1, Math.min(15, Number(url.searchParams.get("pages") || "15")));
        const apexPages = await fetchApexRankedAllPages(p.key, pageLimit);
        if (apexPages.players.length) {
          rows = apexPages.players;
          source = apexPages.source;
          pageInfo = apexPages;
          predCutoff = apexPages.predCutoff || predCutoff;
          mastersPreds = apexPages.mastersPreds || mastersPreds;
          lastUpdated = apexPages.lastUpdated || lastUpdated;
          err = "";
          const src = sourceSummary.find(s => /ApexRanked/.test(s.name));
          if (src) src.ok = true;
        } else if (apexPages.error) {
          err = err ? `${err} | ApexRanked all pages: ${apexPages.error}` : `ApexRanked all pages: ${apexPages.error}`;
        }
      } catch (e) {
        err = err ? `${err} | ApexRanked all pages: ${e.message}` : `ApexRanked all pages: ${e.message}`;
      }
    }

    // 3) Public live ranked page HTML. This is the big alternative to Browser Rendering.
    if (!rows.length) {
      try {
        const live = await fetchAlsPublicLiveLeaderboard(p.key);
        if (live.players.length) {
          rows = live.players.slice(0, 25);
          source = live.source;
          pageInfo = live;
          predCutoff = live.predCutoff || predCutoff;
          mastersPreds = live.mastersPreds || mastersPreds;
          splitEnds = live.splitEnds || splitEnds;
          lastUpdated = live.lastUpdated || lastUpdated;
          err = "";
          sourceSummary[2].ok = true;
        }
      } catch (e) {
        err = err ? `${err} | ALS public live: ${e.message}` : `ALS public live: ${e.message}`;
      }
    }

    // 4) Legacy rankScore public page. Slower, but simple HTML often works.
    if (!rows.length) {
      try {
        const legacy = await fetchAlsLegacyRankScore(p.key);
        if (legacy.players.length) {
          rows = legacy.players.slice(0, 25);
          source = legacy.source;
          pageInfo = legacy;
          lastUpdated = legacy.lastUpdated || lastUpdated;
          err = "";
          sourceSummary[3].ok = true;
        }
      } catch (e) {
        err = err ? `${err} | ALS legacy: ${e.message}` : `ALS legacy: ${e.message}`;
      }
    }

    // 5) Tracker.gg public RankScore page. This is the best row fallback when ALS blocks Worker fetches.
    if (!rows.length) {
      try {
        const tracker = await fetchTrackerGGLeaderboard(p.key);
        if (tracker.players.length) {
          rows = tracker.players.slice(0, 25);
          source = tracker.source;
          pageInfo = tracker;
          err = "";
          const trackerSource = sourceSummary.find(s => s.name === "Tracker.gg public RankScore leaderboard");
          if (trackerSource) trackerSource.ok = true;
        } else if (tracker.error) {
          err = err ? `${err} | Tracker.gg: ${tracker.error}` : `Tracker.gg: ${tracker.error}`;
        }
      } catch (e) {
        err = err ? `${err} | Tracker.gg: ${e.message}` : `Tracker.gg: ${e.message}`;
      }
    }

    // 6) ApexRanked public PC page. PC only and more limited, but useful as backup pressure data.
    if (!rows.length && p.key === "PC") {
      try {
        const apexRanked = await fetchApexRankedPublic();
        if (apexRanked.players.length) {
          rows = apexRanked.players.slice(0, 25);
          source = apexRanked.source;
          pageInfo = apexRanked;
          predCutoff = apexRanked.predCutoff || predCutoff;
          mastersPreds = apexRanked.mastersPreds || mastersPreds;
          lastUpdated = apexRanked.lastUpdated || lastUpdated;
          err = "";
          sourceSummary[4].ok = true;
        } else if (apexRanked.topScore || apexRanked.mastersPreds) {
          const topRows = parseApexRankedTopRows(apexRanked, p.key);
          if (topRows.length) {
            rows = topRows;
            source = "ApexRanked public top signal";
            err = "";
          }
          pageInfo = apexRanked;
          mastersPreds = apexRanked.mastersPreds || mastersPreds;
          lastUpdated = apexRanked.lastUpdated || lastUpdated;
        }
      } catch (e) {
        err = err ? `${err} | ApexRanked: ${e.message}` : `ApexRanked: ${e.message}`;
      }
    }

    // 7) Old Browser Rendering fallback, last only.
    if (!rows.length && browserReady(env) && renderWanted) {
      const rendered = await getRenderedLeaderboard(p.key, env);
      if (rendered.ok && rendered.players.length) {
        rows = rendered.players;
        source = rendered.source;
        err = "";
        sourceSummary[5].ok = true;
      } else {
        err = err ? `${err} | Browser: ${rendered.error}` : rendered.error;
      }
    }

    platforms.push(withRowAliases({
      platform: p.key,
      platformKey: p.key,
      platformLabel: p.label,
      label: p.label,
      url: boardUrl(p.key),
      altUrls: {
        alsLive: boardUrl(p.key),
        alsLegacyRankScore: legacyRankScoreUrl(p.key),
        apexRanked: p.key !== "SWITCH" ? apexRankedPlatformUrl(p.key, 1) : "",
        trackerGG: trackerGGUrl(trackerPlatformSlug(p.key)[0])
      },
      predCutoff,
      mastersPreds,
      splitEnds,
      lastUpdated,
      pageInfo,
      playerCount: rows.length,
      pagesFetched: pageInfo.pagesFetched || 0,
      pageCount: pageInfo.pageCount || 0,
      players: rows,
      leaderboardAccess: rows.length > 0,
      needsLeaderboardAccess: rows.length === 0,
      leaderboardSource: source,
      error: err,
      note: rows.length
        ? `Rows returned by ${source}.`
        : (renderWanted ? "No row source returned usable rows. Use external links or retry later." : "Pred cutoff may still be live. Use render=1 to attempt row extraction.")
    }));
  }

  const out = {
    ok: true,
    version: VERSION,
    renderTried: renderWanted,
    fetchedAt: new Date().toISOString(),
    leaderboardStrategy: [
      "ALS official /leaderboard API when ALS_API_KEY allows it",
      "Public ALS live-ranked HTML parse (no Browser Rendering)",
      "Public ALS legacy rankScore HTML parse",
      "ApexRanked direct public page",
      "Tracker.gg public RankScore page fallback",
      "Cloudflare Browser Rendering fallback"
    ],
    sources: sourceSummary,
    platforms,
    leaderboards: platforms,
    ranked: platforms
  };

  const response = new Response(JSON.stringify(out, null, 2), { headers: corsHeaders("*", renderWanted ? 20 : 60) });
  if (!force) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return out;
}



function textFromHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|td|th|h1|h2|h3|h4|section|article|a)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function numberFromText(s) {
  const m = String(s || "").match(/(\d[\d,]{2,})/);
  return m ? toNum(m[1]) : 0;
}

function firstMatch(text, re) {
  const m = String(text || "").match(re);
  return m ? String(m[1] || "").trim() : "";
}

function legacyRankScoreUrl(platform) {
  const legacy = platform === "X1" ? "X1" : platform;
  return `https://apexlegendsstatus.com/leaderboard/Global/rankScore/${legacy}/1`;
}

async function fetchAlsPublicLiveLeaderboard(platform) {
  const url = boardUrl(platform);
  const html = await fetchText(url, { headers: { "Accept": "text/html,*/*" } });
  const text = textFromHtml(html);
  const players = parseAlsLiveText(text, platform).slice(0, 50);
  const predCutoff = numberFromText(firstMatch(text, /RP for predator\s*([\d,]+)\s*RP/i));
  const mastersPreds = numberFromText(firstMatch(text, /Masters\s*&\s*Preds\s*([\d,]+)/i));
  const splitEnds = firstMatch(text, /Split ends in\s*([^\n]+)/i);
  const lastUpdated = firstMatch(text, /Last updated\s*([^\n]+)/i) || firstMatch(text, /Updated every\s*([^\n]+)/i);
  return {
    ok: players.length > 0 || !!predCutoff || !!mastersPreds,
    source: "ALS public live-ranked HTML",
    url,
    players,
    predCutoff,
    mastersPreds,
    splitEnds,
    lastUpdated,
    rawHint: text.slice(0, 600)
  };
}


function cleanAlsNameCandidate(line) {
  let s = String(line || "").trim();
  s = s.replace(/Image:\s*(Apex Predator|Predator|Rank|Rookie|Bronze|Silver|Gold|Platinum|Diamond|Master|Alter|Ash|Axle|Ballistic|Bangalore|Bloodhound|Catalyst|Caustic|Conduit|Crypto|Fuse|Gibraltar|Horizon|Lifeline|Loba|Mad Maggie|Mirage|Newcastle|Octane|Pathfinder|Rampart|Revenant|Seer|Sparrow|Valkyrie|Vantage|Wattson|Wraith)\s*/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (/^(image:|rank$|offline$|online$|leaderboard$|platform$|search$|go$|live twitch|no streams|how do i|last updated|rp for predator|masters|split ends|predator country|top countries|@pos@|# player|hourly|battle royale)/i.test(s)) return "";
  if (/^(Offline|Online|In match|In lobby|In match loading)/i.test(s)) return "";
  if (/^\d[\d,]*(\s+\d[\d,]*)?$/.test(s)) return "";
  if (/^\d+\s*#\s*\d+/.test(s)) return "";
  if (s.length > 64) return "";
  return s;
}

function parseAlsLiveText(text, platform) {
  const lines = String(text || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const rankLine = lines[i];
    const rankMatch = rankLine.match(/^(\d+)\s*#\s*(\d+)/) || rankLine.match(/^#\s*(\d+)/) || rankLine.match(/^(\d+)#?$/);
    if (!rankMatch) continue;
    const rank = toNum(rankMatch[2] || rankMatch[1]);
    if (!rank || rank > 1000) continue;

    let name = "";
    let rp = 0;

    for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
      const line = lines[j].trim();
      const candidate = cleanAlsNameCandidate(line);
      if (!name && candidate) {
        name = candidate;
        continue;
      }
      if (name && /\b\d{2,3}(,\d{3})+\b/.test(line)) {
        const m = line.match(/\b\d{2,3}(,\d{3})+\b/);
        rp = toNum(m[0]);
        break;
      }
    }

    if (name && rp >= 10000 && !rows.some(r => r.rank === rank || r.name === name)) {
      rows.push({ rank, name, rp, platform, source: "ALS public live-ranked HTML", url: profileUrl(platform, name) });
    }
  }

  return rows.sort((a,b) => a.rank - b.rank);
}


async function fetchAlsLegacyRankScore(platform) {
  const url = legacyRankScoreUrl(platform);
  const html = await fetchText(url, { headers: { "Accept": "text/html,*/*" } });
  const text = textFromHtml(html);
  const players = parseLegacyRankScoreText(text, platform).slice(0, 50);
  const lastUpdated = firstMatch(text, /Last updated on\s*([^\n]+)/i);
  return { ok: players.length > 0, source: "ALS legacy rankScore HTML", url, players, lastUpdated, rawHint: text.slice(0, 600) };
}

function parseLegacyRankScoreText(text, platform) {
  const out = [];
  const compact = String(text || "").replace(/\s+/g, " ");
  const re = /#\s*(\d+)\s*([A-Za-z0-9_\-\[\]\(\)\.\|ぁ-んァ-ン一-龥가-힣 ]{2,40}?)\s+(?:Image\s*)?(\d{2,3}(?:,\d{3})+)/g;
  let m;
  while ((m = re.exec(compact)) && out.length < 80) {
    const rank = toNum(m[1]);
    const name = String(m[2] || "").replace(/\s*Image\s*$/i, "").trim();
    const rp = toNum(m[3]);
    if (rank && name && rp >= 10000 && !/Player name|Battle royale/i.test(name) && !out.some(r => r.rank === rank || r.name === name)) {
      out.push({ rank, name, rp, platform, source: "ALS legacy rankScore HTML", url: profileUrl(platform, name) });
    }
  }
  return out.sort((a,b) => a.rank - b.rank);
}


async function fetchApexRankedPublic() {
  const url = "https://apexranked.com/";
  const html = await fetchText(url, { headers: { "Accept": "text/html,*/*", "User-Agent": "Mozilla/5.0 ApexIQ/4.9.9.6" } });
  const text = textFromHtml(html);
  const players = parseApexRankedRowsFromRaw(text, "PC", url);
  const topScore = numberFromText(firstMatch(text, /Top score\s*([\d,]+)\s*RP/i)) || (players[0] && players[0].rp) || numberFromText(firstMatch(text, /Top RP\s*([\d,]+)/i));
  return {
    ok: players.length > 0 || !!topScore,
    source: "ApexRanked direct public page",
    url,
    players,
    mastersPreds: numberFromText(firstMatch(text, /Estimated masters players\s*([\d,]+)/i)) || numberFromText(firstMatch(text, /([\d,]+)\s*Masters est/i)),
    topScore,
    trackedTop750: numberFromText(firstMatch(text, /Tracked top 750\s*([\d,]+)/i)) || numberFromText(firstMatch(text, /([\d,]+)\s*tracked/i)),
    top750Online: numberFromText(firstMatch(text, /Top 750 online now\s*([\d,]+)/i)) || numberFromText(firstMatch(text, /Online now\s*([\d,]+)/i)),
    lastUpdated: firstMatch(text, /Last refresh\s*([^\n]+)/i) || firstMatch(text, /Updated\s*([A-Z][a-z]{2}\s+\d+,[^\n]+)/i),
    rawHint: text.slice(0, 5000)
  };
}



async function fetchOfficialLeaderboard(key, platform) {
  const api = new URL("https://api.apexlegendsstatus.com/leaderboard");
  api.searchParams.set("auth", key);
  api.searchParams.set("legend", "Global");
  api.searchParams.set("key", "rankScore");
  api.searchParams.set("platform", platform);
  return fetchJson(api.toString());
}

function parseOfficialLeaderboard(data, platform) {
  const rows = findLeaderboardRows(data);
  return rows.map((row, idx) => ({
    rank: toNum(first(row.rank, row.position, idx + 1)),
    name: String(first(row.name, row.player, row.username, row.playerName, row.user, row.platformUserHandle, "")).trim(),
    uid: first(row.uid, row.id, row.userId, ""),
    platform,
    rp: toNum(first(row.value, row.rankScore, row.score, row.RP, row.rp)),
    source: "ALS official /leaderboard",
    url: `https://apexlegendsstatus.com/profile/${platform}/${encodeURIComponent(String(first(row.name, row.player, row.username, row.playerName, "")))}`
  })).filter(r => r.name && r.rp >= 10000);
}

function findLeaderboardRows(data) {
  const out = [];
  const seen = new WeakSet();
  function looks(row) {
    if (!row || typeof row !== "object") return false;
    const keys = Object.keys(row).map(k => k.toLowerCase());
    return keys.some(k => ["name","player","username","playername","user","platformuserhandle"].includes(k)) &&
      keys.some(k => ["value","rankscore","score","rp"].includes(k));
  }
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const x of node) {
        if (looks(x)) out.push(x);
        walk(x);
      }
    } else {
      for (const x of Object.values(node)) walk(x);
    }
  }
  walk(data);
  return out;
}

function withRowAliases(p) {
  const rows = p.players || [];
  return { ...p, rows, playerRows: rows, leaderboardRows: rows, topPlayers: rows, leaderboard: rows };
}

function extractPredatorForPlatform(predator, platform) {
  if (!predator || typeof predator !== "object") return {};
  const names = platform === "PS4" ? ["PS4","Playstation","PlayStation"] :
    platform === "X1" ? ["X1","Xbox","XBOX"] :
    platform === "SWITCH" ? ["SWITCH","Switch"] : ["PC"];
  const candidates = [];
  for (const k of names) {
    if (predator[k]) candidates.push(predator[k]);
    if (predator.BR && predator.BR[k]) candidates.push(predator.BR[k]);
    if (predator.RP && predator.RP[k]) candidates.push(predator.RP[k]);
    if (predator.ApexPredator && predator.ApexPredator[k]) candidates.push(predator.ApexPredator[k]);
  }
  return {
    predCutoff: toNum(deepFindFirst(candidates, ["val","value","rp","RP","rankScore","score","predator"])),
    mastersPreds: toNum(deepFindFirst(candidates, ["totalMastersAndPreds","masters","Masters","mastersAndPreds","total"]))
  };
}

function deepFindFirst(objects, keys) {
  const set = new Set(keys.map(k => k.toLowerCase()));
  const seen = new WeakSet();
  function walk(node) {
    if (!node || typeof node !== "object") return undefined;
    if (seen.has(node)) return undefined;
    seen.add(node);
    for (const [k, v] of Object.entries(node)) {
      if (set.has(k.toLowerCase()) && v !== null && v !== undefined && String(v).trim() !== "") return v;
    }
    for (const v of Object.values(node)) {
      const found = walk(v);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const obj of objects || []) {
    const found = walk(obj);
    if (found !== undefined) return found;
  }
  return undefined;
}

function extractALSTrackers(selected, raw) {
  const out = [];
  const seen = new Set();

  function add(t) {
    if (!t || typeof t !== "object") return;
    const name = first(t.name, t.key, t.label, t.type, t.displayName);
    const value = first(t.value, t.total, t.val, t.amount, t.rankScore, t.score);
    if (name === undefined || value === undefined) return;
    const id = `${String(name).toLowerCase()}|${String(value).toLowerCase()}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ name: String(name), key: String(first(t.key, name)), value });
  }

  function walk(node, depth = 0) {
    if (!node || depth > 5) return;
    if (Array.isArray(node)) {
      node.forEach(x => walk(x, depth + 1));
      return;
    }
    if (typeof node !== "object") return;

    if (first(node.name, node.key, node.label, node.type, node.displayName) !== undefined &&
        first(node.value, node.total, node.val, node.amount, node.rankScore, node.score) !== undefined) {
      add(node);
    }

    for (const key of ["data", "trackers", "stats", "children", "items"]) walk(node[key], depth + 1);
  }

  walk(selected);
  walk(raw && raw.trackers);
  walk(raw && raw.total && raw.total.data);
  walk(raw && raw.global && raw.global.data);
  return out;
}

function extractLegendStats(raw) {
  const legends = raw && raw.legends || {};
  const out = [];

  function addRow(legendName, node, sourceHint) {
    const legend = normalizeLegendName(legendName);
    if (!legend || !node || typeof node !== "object") return;
    const trackers = extractALSTrackers(node, {});
    if (!trackers.length) return;
    const stats = normalizeStats(trackers.map(t => ({
      label: t.name || t.key,
      value: t.value,
      source: sourceHint || "Apex Legends Status /bridge"
    })));
    if (!stats.length) return;
    const key = norm(legend);
    const current = out.find(r => norm(r.legend) === key);
    if (current) {
      current.stats = normalizeStats([...(current.stats || []), ...stats]);
      current.trackers = current.stats.map(s => ({ name: s.label, key: s.label, value: s.value, source: s.source }));
      return;
    }
    out.push({
      legend,
      stats,
      trackers: stats.map(s => ({ name: s.label, key: s.label, value: s.value, source: s.source })),
      badges: [],
      officialBadges: [],
      source: sourceHint || "Apex Legends Status /bridge"
    });
  }

  function walk(node, nameHint, depth) {
    if (!node || depth > 7) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, nameHint, depth + 1);
      return;
    }
    if (typeof node !== "object") return;

    const possibleName = normalizeLegendName(first(
      node.LegendName,
      node.legendName,
      node.legend,
      node.name,
      node.displayName,
      node.metadata && node.metadata.name,
      nameHint
    ));

    if (possibleName) addRow(possibleName, node, "Apex Legends Status /bridge");

    for (const [key, child] of Object.entries(node)) {
      if (!child || typeof child !== "object") continue;
      const keyLegend = normalizeLegendName(key);
      walk(child, keyLegend || possibleName || nameHint, depth + 1);
    }
  }

  walk(legends, "", 0);
  return mergeLegendRows(out, []);
}

function mergeLegendRows(a, b) {
  const by = new Map();
  for (const row of [...(a || []), ...(b || [])]) {
    if (!row || !row.legend) continue;
    const key = norm(row.legend);
    const existing = by.get(key) || { legend: row.legend, stats: [], trackers: [], badges: [], officialBadges: [] };
    const stats = normalizeStats([...(existing.stats || []), ...(row.stats || []), ...(row.trackers || []).map(t => ({ label: t.name || t.key, value: t.value, source: t.source }))]);
    const badges = normalizeBadges([...(existing.badges || []), ...(existing.officialBadges || []), ...(row.badges || []), ...(row.officialBadges || [])]);
    by.set(key, { ...existing, ...row, stats, trackers: stats.map(s => ({ name: s.label, key: s.label, value: s.value, source: s.source })), badges, officialBadges: badges });
  }
  return Array.from(by.values());
}


function rosterLegendOnly(name) {
  return LEGEND_NAMES.find(l => norm(l) === norm(name)) || "";
}

function parseLegendBadgeSignal(text, value, source) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (isUntrustedVisualBadgeSource(source)) return null;

  // ALS exposes these as badge-like tracker names:
  // "Valkyrie's Wake" = 20 kill game badge
  // "Valkyrie's Wrath" = damage badge tier; high/max tiers represent 4K/hammer.
  let m = raw.match(/^(.+?)(?:'s|’s|s)?\s+(Wake|Wrath)$/i);
  if (!m) return null;

  const legend = rosterLegendOnly(m[1]);
  if (!legend) return null;

  const badgeWord = m[2].toLowerCase();
  const n = toNum(value);
  if (badgeWord === "wake") {
    // ALS can return the Wake tracker with value 0 even when the badge is not owned.
    // Only a positive numeric tracker value is trusted as ownership evidence.
    if (n <= 0) return null;
    return {
      legend,
      badge: {
        id: "twenty_kill",
        type: "twenty_kill",
        name: "20 Kill Badge",
        label: "20B / Wake",
        rawName: raw,
        value: n,
        verified: true,
        trust: "legend_verified",
        source: source || "Apex Legends Status badge tracker"
      }
    };
  }

  if (badgeWord === "wrath") {
    // Wrath values below tier 4 are lower damage badges, not the 4K hammer.
    // Missing/non-numeric values are not accepted as ownership proof.
    if (n < 4) return null;
    return {
      legend,
      badge: {
        id: "four_k",
        type: "four_k",
        name: "4K Damage Badge",
        label: "4K / Wrath",
        rawName: raw,
        value: n,
        verified: true,
        trust: "legend_verified",
        source: source || "Apex Legends Status badge tracker",
        note: `ALS Wrath tier/value ${n}`
      }
    };
  }
  return null;
}

function isBadgeOnlyStatLabel(label) {
  const s = String(label || "").toLowerCase();
  if (/\b(wake|wrath)\b/.test(s)) return true;
  if (/^apex\s+[a-z]/i.test(label || "")) return true;
  if (/rapid elimination|shot caller|flawless victory|squad wipe|deadeye|assassin|heart seeker|you're tiering me apart/i.test(label || "")) return true;
  return false;
}

function uniqueBadgesStrict(list) {
  const out = [];
  const seen = new Set();
  for (const b of list || []) {
    if (!b) continue;
    const type = b.type || b.id || badgeTypeFromName(b.name || b.label || b.rawName || "");
    const legend = rosterLegendOnly(b.legend || "") || "";
    const knownType = type && type !== "unknown_als_badge" && type !== "badge";
    const key = knownType
      ? `${legend}|${type}`
      : `${legend}|${type}|${norm(b.rawName || b.name || b.label || "")}|${b.src || ""}|${b.slotIndex ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...b, id: b.id || type, type, legend: b.legend || legend, verified: b.verified !== false });
  }
  return out;
}

function sanitizeLegendRowsStrict(rows) {
  const by = new Map();

  function ensure(legend, source) {
    const key = norm(legend);
    if (!key) return null;
    if (!by.has(key)) by.set(key, { legend, stats: [], trackers: [], badges: [], officialBadges: [], source: source || "Apex Legends Status" });
    return by.get(key);
  }

  for (const row of rows || []) {
    if (!row || typeof row !== "object") continue;

    const directLegend = rosterLegendOnly(row.legend);
    const rowStats = normalizeStats([...(row.stats || []), ...(row.trackers || []).map(t => ({ label: t.name || t.key, value: t.value, source: t.source || row.source }))]);
    const rowBadgeSignal = parseLegendBadgeSignal(row.legend, rowStats[0] && rowStats[0].value, row.source);

    const legend = directLegend || (rowBadgeSignal && rowBadgeSignal.legend) || "";
    if (!legend) continue;

    const entry = ensure(legend, row.source);
    if (!entry) continue;

    if (rowBadgeSignal) entry.badges.push({ ...rowBadgeSignal.badge, legend });

    for (const b of [...(row.badges || []), ...(row.officialBadges || [])]) {
      const signal = parseLegendBadgeSignal(b.rawName || b.name || b.label || b.id || "", b.value, b.source || row.source);
      if (signal && signal.legend === legend) entry.badges.push({ ...signal.badge, legend });
      else if (b.type || b.id || b.name || b.label || b.src) entry.badges.push({ ...b, legend: b.legend || legend, verified: b.verified !== false, trust: b.trust || "legend_verified" });
    }

    for (const stat of rowStats) {
      const label = stat.label || stat.name || stat.key || "";
      const signal = parseLegendBadgeSignal(label, stat.value, stat.source || row.source);
      if (signal && signal.legend === legend) {
        entry.badges.push({ ...signal.badge, legend });
        continue;
      }
      if (!directLegend) continue;
      if (isBadgeOnlyStatLabel(label)) continue;
      entry.stats.push(stat);
    }

    entry.stats = normalizeStats(entry.stats);
    entry.trackers = entry.stats.map(s => ({ name: s.label, key: s.label, value: s.value, source: s.source }));
    entry.badges = uniqueBadgesStrict(entry.badges);
    entry.officialBadges = entry.badges;
  }

  return [...by.values()].filter(r => r.stats.length || r.badges.length);
}

function badgeRowsFromLegendRows(rows) {
  return sanitizeLegendRowsStrict(rows || [])
    .filter(r => r.badges && r.badges.length)
    .map(r => ({ legend: r.legend, badges: r.badges, source: r.source || "Apex Legends Status badge tracker" }));
}


function normalizeStats(stats) {
  const out = [];
  const seen = new Set();
  for (const s of stats || []) {
    const label = String(first(s.label, s.name, s.key, s.type, "")).trim();
    const value = first(s.value, s.total, s.val, s.amount);
    if (!label || value === undefined || value === null || value === "") continue;
    const key = `${label.toLowerCase()}|${String(value).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, value: isNumeric(value) ? toNum(value) : value, source: s.source || "live" });
  }
  return out;
}

function normalizeBadges(badges) {
  const out = [];
  const seen = new Set();
  let slot = 0;
  for (const b of badges || []) {
    const rawName = typeof b === "string" ? b : first(b.rawName, b.name, b.label, b.title, "");
    const src = typeof b === "string" ? "" : first(b.src, b.url, b.icon, b.image, "");
    const source = typeof b === "object" ? first(b.source, b.reason, b.imageDescription, "") : "";
    const collectionLike = isCollectionLikeBadgeText(rawName) || isCollectionLikeBadgeText(src);
    const strictCollection = isUntrustedVisualBadgeSource(source) ? "" : badgeIdFromStrongCollectionName(rawName);
    const type = strictCollection || (collectionLike ? "unknown_als_badge" : badgeIdFromName(rawName || (src ? "unknown ALS badge slot" : "")));
    let name = rawName ? String(rawName) : "";
    if (!name && src) name = "Unknown ALS badge slot";
    if (!name) continue;
    const id = type || "unknown_als_badge";
    const key = `${String(id).toLowerCase()}|${String(name).toLowerCase()}|${String(src).toLowerCase()}|${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id,
      type: id,
      name,
      label: name,
      rawName: name,
      src: src || "",
      slotIndex: slot++,
      confidence: typeof b === "object" ? first(b.confidence, "") : "",
      reason: typeof b === "object" ? first(b.reason, b.imageDescription, "") : "",
      source: typeof b === "object" ? first(b.source, "Browser Run rendered ALS profile") : "Browser Run rendered ALS profile"
    });
  }
  return out;
}

function flattenTracker(root) {
  const out = [];
  const seen = new WeakSet();
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    const label = first(node.displayName, node.name, node.label, node.key, node.metadata && node.metadata.name);
    const value = first(node.value, node.displayValue);
    if (label !== undefined && value !== undefined) out.push({ label: String(label), value, source: "Tracker Network" });
    if (Array.isArray(node)) node.forEach(walk);
    else Object.values(node).forEach(walk);
  }
  walk(root);
  return out;
}

function findMetric(stats, terms) {
  const lowered = terms.map(t => t.toLowerCase());
  for (const item of stats || []) {
    const name = String(item.label || item.name || item.key || "").toLowerCase();
    if (lowered.some(term => name === term || name.includes(term))) return item.value;
  }
  return undefined;
}

function formatRank(rank) {
  if (!rank || typeof rank !== "object") return "";
  const name = first(rank.rankName, rank.name, rank.tier, rank.rankDivName);
  const div = first(rank.rankDiv, rank.division);
  const score = first(rank.rankScore, rank.RP, rank.score);
  const parts = [];
  if (name) parts.push(String(name));
  if (div && !String(name || "").includes(String(div))) parts.push(String(div));
  if (score) parts.push(`${toNum(score).toLocaleString()} RP`);
  return parts.join(" • ");
}

function normalizeLegendName(name) {
  const found = LEGEND_NAMES.find(l => norm(l) === norm(name));
  return found || String(name || "").trim();
}

function parsePrestige(x) {
  if (x === undefined || x === null || x === "") return undefined;
  const m = String(x).match(/prestige\s*([0-4])/i) || String(x).match(/\b([0-4])\b/);
  return m ? toNum(m[1]) : undefined;
}

function scoreBridge(data) {
  const global = data.global || {};
  const rank = global.rank || data.rank || {};
  const selected = data.legends && data.legends.selected ? data.legends.selected : {};
  const trackers = extractALSTrackers(selected, data);
  return (toNum(first(global.level, data.level)) * 12) +
    (toNum(first(rank.rankScore, rank.RP, rank.score)) / 50) +
    (toNum(findMetric(trackers.map(t => ({ label: t.name, value: t.value })), ["kills"])) / 3) +
    (toNum(findMetric(trackers.map(t => ({ label: t.name, value: t.value })), ["damage"])) / 1500);
}

function scoreRenderedProfile(p) {
  return ((p.legendCards || []).length * 50) + countStats(p.legendCards || []) * 8 + countBadges(p.legendCards || []) * 14 + ((p.accountBadges || []).length * 10) + (p.visibleLevel ? 10 : 0);
}

function countBadges(cards) {
  return (cards || []).reduce((n, c) => n + ((c.badges || c.officialBadges || []).length), 0);
}

function countRows(data) {
  try { return findLeaderboardRows(data).length; } catch (_) { return 0; }
}



function isUntrustedVisualBadgeSource(source) {
  const s = String(source || "").toLowerCase();
  return /browser run|rendered|visual|json fallback|snapshot|content parser|ai json|quickaction/.test(s);
}

function isCollectionLikeBadgeText(name) {
  const s = String(name || "").toLowerCase().replace(/[_-]+/g, " ");
  return /\bwake\b|\bwrath\b|20\s*(kill|bomb)|twenty\s*kill|\b20b\b|\b4k\b|4\s*k|4000|4,000|four\s*thousand|hammer/.test(s);
}

function badgeIdFromStrongCollectionName(name) {
  const s = String(name || "").trim().replace(/[_-]+/g, " ");
  if (/^[A-Za-z ]+(?:'s|’s)?\s+Wake$/i.test(s)) return "twenty_kill";
  if (/^[A-Za-z ]+(?:'s|’s)?\s+Wrath$/i.test(s)) return "four_k";
  return "";
}

function badgeIdFromName(name) {
  const s = String(name || "").toLowerCase();
  const compact = s.replace(/[^a-z0-9]/g, "");
  if (/20\s*kill|20\s*bomb|twenty|wake/.test(s) || /20kill|20bomb|twentykill|badge20/.test(compact)) return "twenty_kill";
  if (/4k|4\s*000|4000|4,000|hammer/.test(s) || /fourk|4000damage|damage4000/.test(compact)) return "four_k";
  if (/unknown\s+als\s+badge\s+slot|visual\s+badge\s+slot/.test(s)) return "unknown_als_badge";
  if (/triple/.test(s)) return "triple_triple";
  if (/team\s*work|teamwork/.test(s)) return "team_work";
  if (/no witnesses/.test(s)) return "no_witnesses";
  if (/rapid/.test(s)) return "rapid_elimination";
  if (/pred/.test(s)) return "pred_badge";
  if (/master/.test(s)) return "master_badge";
  return String(name || "badge").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "badge";
}

function unwrap(x) {
  if (!x) return {};
  if (x.result) return x.result;
  if (x.data) return x.data;
  return x;
}

function putField(fields, key, value, source) {
  if (value === undefined || value === null || value === "" || value === "—") return;
  fields[key] = { value, source: source || "live" };
}

function first(...values) {
  return values.find(v => v !== undefined && v !== null && String(v).trim() !== "");
}






function runLegendExtractSelfTest() {
  const sample = {
    legends: {
      selected: { LegendName: "Valkyrie", data: [{ name: "BR Kills", value: 2939 }] },
      all: {
        Caustic: { data: [{ name: "NOX: Gassed enemies killed", value: 1 }] },
        Valkyrie: { data: [{ name: "BR Kills", value: 2939 }, { name: "BR Damage", value: 888261 }] },
        Rampart: { trackers: [{ name: "Kills", value: 2000 }] }
      },
      Bangalore: { data: [{ name: "Kills", value: 10 }] }
    }
  };
  const rows = extractLegendStats(sample);
  const names = rows.map(r => r.legend).sort();
  const ok = rows.length >= 4 && names.includes("Caustic") && names.includes("Valkyrie") && names.includes("Rampart") && names.includes("Bangalore");
  return { ok, version: VERSION, rows: rows.map(r => ({ legend: r.legend, stats: (r.stats || []).length, labels: (r.stats || []).map(s => s.label) })) };
}



function runBadgeSelfTest() {
  const cases = [
    { input: "20 Kill Badge", expected: "twenty_kill" },
    { input: "20 bomb badge", expected: "twenty_kill" },
    { input: "wake badge", expected: "twenty_kill" },
    { input: "badge20kill.png", expected: "twenty_kill" },
    { input: "4K Damage Badge", expected: "four_k" },
    { input: "4000 damage hammer", expected: "four_k" },
    { input: "damage4000.png", expected: "four_k" },
    { input: "Unknown ALS badge slot", expected: "unknown_als_badge" }
  ];
  const results = cases.map(c => {
    const got = badgeTypeFromName(c.input) || badgeIdFromName(c.input);
    return { ...c, got, pass: got === c.expected };
  });
  return {
    ok: results.every(r => r.pass),
    version: VERSION,
    engine: "ApexIQ 20B / 4K badge classifier self-test",
    note: "This verifies classification logic only. Live ownership still depends on ALS rendered badge slots or approved proof.",
    results
  };
}


async function getVisualBadgeProfile(player, platform, uid, env) {
  const urls = [];
  if (player) urls.push(profileUrl(platform, player));
  if (uid) urls.push(profileUidUrl(platform, uid));

  const schema = {
    type: "object",
    properties: {
      player: { type: ["string","null"] },
      accountBadges: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: ["string","null"] },
            confidence: { type: ["string","number","null"] },
            reason: { type: ["string","null"] }
          },
          required: ["name"]
        }
      },
      legendCards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            legend: { type: "string" },
            badges: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: ["string","null"] },
                  confidence: { type: ["string","number","null"] },
                  reason: { type: ["string","null"] },
                  imageDescription: { type: ["string","null"] }
                },
                required: ["name"]
              }
            }
          },
          required: ["legend","badges"]
        }
      }
    },
    required: ["legendCards"]
  };

  const prompt = [
    "You are verifying Apex Legends badges from a rendered Apex Legends Status profile page.",
    "Use VISUAL badge icons, visible labels, tooltip text, alt text, and nearby legend card context.",
    "Do NOT infer badges from normal stats like kills or damage.",
    "If a 20 Kill Badge icon is visibly shown on a legend, return name='20 Kill Badge' and type='twenty_kill'.",
    "If a 4K / 4000 Damage hammer badge icon is visibly shown on a legend, return name='4K Damage Badge' and type='four_k'.",
    "If the page shows a badge icon but you cannot identify it, return name='Unknown ALS badge slot' and type='unknown_als_badge' with an imageDescription.",
    "Return each badge under the legend card or legend section it visibly belongs to.",
    "Separate account-wide badges from legend-specific badges.",
    "This is verification, not guessing: if a badge is not visible, do not include it."
  ].join("\\n");

  const attempts = [];
  let best = null;
  for (const target of [...new Set(urls)]) {
    try {
      const result = await browserJson(env, target, prompt, schema, { waitUntil: "networkidle2", timeout: 60000 });
      const normalized = normalizeRenderedProfile(result, target);
      normalized.source = "Browser Run visual badge AI extractor";
      normalized.mode = "visual-badge-json";
      attempts.push({ method: "Browser Run /visual badge json", url: target, ok: normalized.ok, legendCards: normalized.legendCards.length, badges: countBadges(normalized.legendCards) + (normalized.accountBadges || []).length });
      if (!best || scoreRenderedProfile(normalized) > scoreRenderedProfile(best)) best = normalized;
    } catch (e) {
      attempts.push({ method: "Browser Run /visual badge json", url: target, ok: false, error: e.message });
    }
  }
  if (best) {
    best.attempts = attempts;
    return best;
  }
  return { ok: false, source: "Browser Run visual badge AI extractor", mode: "visual-badge-json", attempts, legendCards: [], accountBadges: [] };
}

function mergeRenderedBadgeSources(base, visual) {
  const out = { ...(base || {}) };
  const by = new Map();
  function addCard(card, sourceTag) {
    const legend = normalizeLegendName(card && card.legend);
    if (!legend) return;
    const k = norm(legend);
    const old = by.get(k) || { legend, stats: [], trackers: [], badges: [], officialBadges: [], source: "" };
    const stats = normalizeStats([...(old.stats || []), ...(card.stats || [])]).filter(isSafeStat);
    const badges = normalizeBadges([...(old.badges || []), ...(old.officialBadges || []), ...(card.badges || []), ...(card.officialBadges || [])])
      .filter(b => isSafeBadgeName(b.name || b.label || b.id) || b.src || b.type === "unknown_als_badge");
    by.set(k, {
      ...old,
      ...card,
      legend,
      stats,
      trackers: stats.map(s => ({ name: s.label, key: s.label, value: s.value, source: s.source })),
      badges,
      officialBadges: badges,
      source: [old.source, card.source, sourceTag].filter(Boolean).join(" + ")
    });
  }
  for (const c of (base && base.legendCards || [])) addCard(c, "DOM");
  for (const c of (visual && visual.legendCards || [])) addCard(c, "Visual AI");
  out.legendCards = [...by.values()];
  out.accountBadges = normalizeBadges([...(base && base.accountBadges || []), ...(visual && visual.accountBadges || [])]);
  out.badgeVisualAttempts = visual && visual.attempts || [];
  out.source = [base && base.source, visual && visual.ok ? visual.source : ""].filter(Boolean).join(" + ");
  out.ok = !!(out.ok || (visual && visual.ok) || out.legendCards.length || out.accountBadges.length);
  return out;
}



async function handleBadgeScanLite(url, env, ctx, request) {
  const player = String(url.searchParams.get("player") || "imissanyway").trim();
  const platformReq = cleanPlatform(url.searchParams.get("platform") || "PC");
  const force = url.searchParams.get("refresh") === "1" || url.searchParams.get("nocache") === "1";
  if (!player) return { ok: false, error: "Missing player.", version: VERSION };

  // Longer cache because Browser Run is rate-limited and badge ownership is not second-by-second data.
  const stableKeyUrl = new URL(url.toString());
  stableKeyUrl.searchParams.delete("refresh");
  stableKeyUrl.searchParams.delete("nocache");
  stableKeyUrl.searchParams.delete("_");
  stableKeyUrl.pathname = "/api/badge-scan-lite";
  const cacheKey = new Request(stableKeyUrl.toString(), request);

  if (!force) {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const data = await cached.json();
      data.cache = { hit: true, note: "Badge scan cache hit. Use refresh=1 only when needed." };
      return data;
    }
  }

  let platform = platformReq === "auto" ? "PC" : platformReq;
  let uid = "";
  let bridgeOk = false;
  let bridgeError = "";
  let bridgeRawForBadges = {};

  if (env.ALS_API_KEY) {
    try {
      const bridge = await fetchBestBridge(player, platformReq, env.ALS_API_KEY);
      bridgeOk = !!bridge.ok;
      bridgeError = bridge.error || "";
      platform = bridge.platformUsed || platform;
      const raw = bridge.raw || {};
      bridgeRawForBadges = raw;
      uid = first(raw.uid, raw.global && raw.global.uid, raw.realtime && raw.realtime.uid, "");
    } catch (e) {
      bridgeError = e.message;
    }
  } else {
    bridgeError = "ALS_API_KEY not set";
  }

  let rendered = { ok: false, source: "Browser Run", error: "Browser Run not enabled.", legendCards: [], accountBadges: [], attempts: [] };

  if (browserReady(env)) {
    // Use ONE URL and ONE visual attempt. UID URL is usually more stable when bridge gives UID.
    const target = uid ? profileUidUrl(platform, uid) : profileUrl(platform, player);
    try {
      const visual = await getVisualBadgeProfileLite(target, env);
      rendered = normalizeRenderedProfile(visual.raw || visual, target);
      rendered.ok = !!(rendered.ok || countBadges(rendered.legendCards) || (rendered.accountBadges || []).length);
      rendered.source = "Browser Run rate-limit-safe visual badge scan";
      rendered.mode = "visual-badge-lite";
      rendered.url = target;
      rendered.attempts = [{
        method: "Browser Run /badge-scan-lite visual JSON",
        url: target,
        ok: rendered.ok,
        legendCards: rendered.legendCards.length,
        badges: countBadges(rendered.legendCards) + (rendered.accountBadges || []).length
      }];
    } catch (e) {
      const msg = e.message || String(e);
      const rateLimited = /rate limit|2001/i.test(msg);
      rendered = {
        ok: false,
        source: "Browser Run rate-limit-safe visual badge scan",
        mode: "visual-badge-lite",
        url: target,
        error: rateLimited ? "Browser Run rate-limited. Wait before refreshing badge scan." : msg,
        rateLimited,
        legendCards: [],
        accountBadges: [],
        attempts: [{ method: "Browser Run /badge-scan-lite visual JSON", url: target, ok: false, error: msg, rateLimited }]
      };
    }
  }

  // If Browser Run is rate-limited or returns no visual badge slots, try static ALS profile HTML as a cheap fallback.
  let publicBadgeFallback = { ok: false };
  if (!countBadges(rendered.legendCards || []) && !(rendered.accountBadges || []).length) {
    publicBadgeFallback = await safePublicBadgeHtmlScan(player, platform, uid);
    if (publicBadgeFallback.ok) {
      rendered = publicBadgeFallback;
    }
  }

  const bridgeBadgeRows = sanitizeLegendRowsStrict(extractLegendStats(bridgeRawForBadges)).filter(r => r.badges && r.badges.length);
  if (bridgeBadgeRows.length) {
    rendered = {
      ...rendered,
      ok: true,
      source: rendered.source ? `${rendered.source} + ALS bridge badge tracker` : "ALS bridge badge tracker",
      legendCards: mergeLegendRows(rendered.legendCards || [], bridgeBadgeRows)
    };
  }

  const out = buildBadgeScanResult(player, platform, rendered, {
    bridgeOk,
    bridgeError,
    uid,
    renderedRecovery: browserReady(env),
    browserBindingSet: !!(env.BROWSER && typeof env.BROWSER.quickAction === "function"),
    browserRestSet: !!(env.CF_ACCOUNT_ID && env.CF_BROWSER_API_TOKEN),
    publicBadgeFallback
  });

  out.lite = true;
  out.rateLimitSafe = true;
  out.cache = { hit: false, ttlSeconds: 21600, note: "Badge scans are cached longer to avoid Browser Run rate limits." };
  if (rendered.rateLimited) {
    out.ok = false;
    out.warning = "Browser Run is enabled but rate-limited right now. Do not keep refreshing; wait and retry.";
  } else if (!browserReady(env)) {
    out.warning = "Browser Run is not enabled.";
  } else if (!out.summary.legendVerified && !out.summary.accountVerified) {
    out.warning = "Browser Run completed, but no ALS badge slots were returned by the visual scan.";
  }

  // Cache successful scans, and also short-cache rate-limit responses to stop spam-refreshing.
  const ttlOk = !!(out.summary.legendVerified || out.summary.accountVerified || rendered.rateLimited);
  if (ttlOk) ctx.waitUntil(caches.default.put(cacheKey, json(out, "*", rendered.rateLimited ? 429 : 200)));
  return out;
}

async function getVisualBadgeProfileLite(target, env) {
  const schema = {
    type: "object",
    properties: {
      player: { type: ["string","null"] },
      accountBadges: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: ["string","null"] },
            confidence: { type: ["string","number","null"] },
            reason: { type: ["string","null"] }
          },
          required: ["name"]
        }
      },
      legendCards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            legend: { type: "string" },
            badges: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: ["string","null"] },
                  confidence: { type: ["string","number","null"] },
                  reason: { type: ["string","null"] },
                  imageDescription: { type: ["string","null"] }
                },
                required: ["name"]
              }
            }
          },
          required: ["legend","badges"]
        }
      }
    },
    required: ["legendCards"]
  };

  const prompt = [
    "Verify Apex Legends badges from this rendered Apex Legends Status profile page.",
    "Use visible badge icons, visible labels, tooltip text, alt text, and nearby legend card context.",
    "Do not infer badges from normal stats.",
    "If a 20 Kill Badge / 20 bomb / Wake style badge is visibly shown on a legend, return type='twenty_kill' and name='20 Kill Badge'.",
    "If a 4K / 4000 damage hammer badge is visibly shown on a legend, return type='four_k' and name='4K Damage Badge'.",
    "If a badge icon is visible but unidentified, return type='unknown_als_badge' and name='Unknown ALS badge slot'.",
    "Return badges under the legend card they visibly belong to. Separate account-wide badges."
  ].join("\\n");

  const raw = await browserJson(env, target, prompt, schema, { waitUntil: "networkidle2", timeout: 60000 });
  return { raw };
}



async function handleBadgeScan(url, env, ctx, request) {
  // Default to the rate-limit-safe scanner. Use deep=1 only for debugging.
  if (url.searchParams.get("deep") !== "1") return handleBadgeScanLite(url, env, ctx, request);
  const player = String(url.searchParams.get("player") || "imissanyway").trim();
  const platformReq = cleanPlatform(url.searchParams.get("platform") || "PC");
  const force = url.searchParams.get("refresh") === "1" || url.searchParams.get("nocache") === "1";
  if (!player) return { ok: false, error: "Missing player.", version: VERSION };

  const cacheKey = new Request(url.toString().replace(/([?&])(refresh|nocache|_)=([^&]*)/g, "$1"), request);
  if (!force) {
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached.json();
  }

  let platform = platformReq === "auto" ? "PC" : platformReq;
  let uid = "";
  let bridgeOk = false;
  let bridgeError = "";

  if (env.ALS_API_KEY) {
    try {
      const bridge = await fetchBestBridge(player, platformReq, env.ALS_API_KEY);
      bridgeOk = !!bridge.ok;
      bridgeError = bridge.error || "";
      platform = bridge.platformUsed || platform;
      const raw = bridge.raw || {};
      uid = first(raw.uid, raw.global && raw.global.uid, raw.realtime && raw.realtime.uid, "");
    } catch (e) {
      bridgeError = e.message;
    }
  } else {
    bridgeError = "ALS_API_KEY not set";
  }

  let rendered = { ok: false, source: "Browser Run", error: "Browser Run not enabled.", legendCards: [], accountBadges: [] };
  let visual = { ok: false, source: "Browser Run visual badge AI extractor", legendCards: [], accountBadges: [] };
  if (browserReady(env)) {
    try { rendered = await getRenderedProfile(player, platform, uid, env); }
    catch (e) { rendered = { ok: false, source: "Browser Run", error: e.message, legendCards: [], accountBadges: [] }; }
    try { visual = await getVisualBadgeProfile(player, platform, uid, env); }
    catch (e) { visual = { ok: false, source: "Browser Run visual badge AI extractor", error: e.message, legendCards: [], accountBadges: [] }; }
    rendered = mergeRenderedBadgeSources(rendered, visual);
  }

  const out = buildBadgeScanResult(player, platform, rendered, {
    bridgeOk,
    bridgeError,
    uid,
    renderedRecovery: browserReady(env),
    browserBindingSet: !!(env.BROWSER && typeof env.BROWSER.quickAction === "function"),
    browserRestSet: !!(env.CF_ACCOUNT_ID && env.CF_BROWSER_API_TOKEN)
  });
  ctx.waitUntil(caches.default.put(cacheKey, json(out, "*", 200)));
  return out;
}

function buildBadgeScanResult(player, platform, rendered, sourceFlags) {
  const cards = sanitizeLegendRowsStrict(sanitizeLegendCards(rendered && rendered.legendCards || []));
  const accountBadges = normalizeBadges(rendered && rendered.accountBadges || []).map(b => normalizeVerifiedBadge(b, "", "account_verified", "ALS rendered account-wide badge"));
  const badgesByLegend = {};
  const legendVerified = [];

  for (const card of cards) {
    const legend = normalizeLegendName(card.legend);
    if (!legend) continue;
    const list = normalizeBadges([...(card.badges || []), ...(card.officialBadges || [])])
      .map(b => normalizeVerifiedBadge(b, legend, "legend_verified", card.source || "ALS rendered legend badge"))
      .filter(b => b.name || b.src);
    if (list.length) {
      badgesByLegend[legend] = uniqueVerifiedBadges(list);
      legendVerified.push(...badgesByLegend[legend]);
    }
  }

  const badgeTypes = {};
  for (const b of [...legendVerified, ...accountBadges]) {
    const t = b.type || badgeTypeFromName(b.name);
    if (!badgeTypes[t]) badgeTypes[t] = { type: t, name: badgeLabelFromType(t), legendVerified: 0, accountVerified: 0, legends: [] };
    if (b.trust === "legend_verified") {
      badgeTypes[t].legendVerified++;
      if (b.legend && !badgeTypes[t].legends.includes(b.legend)) badgeTypes[t].legends.push(b.legend);
    } else if (b.trust === "account_verified") {
      badgeTypes[t].accountVerified++;
    }
  }

  const summary = {
    legendVerified: legendVerified.length,
    accountVerified: accountBadges.length,
    legendsWithBadges: Object.keys(badgesByLegend).length,
    badgeTypes: Object.keys(badgeTypes).length,
    twentyKillLegendVerified: legendVerified.filter(b => b.type === "twenty_kill").length,
    fourKLegendVerified: legendVerified.filter(b => b.type === "four_k").length,
    twentyKillAccountWide: accountBadges.filter(b => b.type === "twenty_kill").length,
    fourKAccountWide: accountBadges.filter(b => b.type === "four_k").length
  };

  return {
    ok: !!(rendered && rendered.ok) || legendVerified.length > 0 || accountBadges.length > 0,
    version: VERSION,
    player,
    platform,
    uid: sourceFlags.uid || "",
    source: "ApexIQ Badge Verification Engine",
    fetchedAt: new Date().toISOString(),
    sourceAvailability: {
      renderedRecovery: !!sourceFlags.renderedRecovery,
      browserBindingSet: !!sourceFlags.browserBindingSet,
      browserRestSet: !!sourceFlags.browserRestSet,
      alsBridge: !!sourceFlags.bridgeOk,
      alsBridgeError: sourceFlags.bridgeError || ""
    },
    rendered: {
      ok: !!(rendered && rendered.ok),
      source: rendered && rendered.source || "",
      mode: rendered && rendered.mode || "",
      url: rendered && rendered.url || profileUrl(platform, player),
      attempts: rendered && rendered.attempts || [],
      visualBadgeAttempts: rendered && rendered.badgeVisualAttempts || [],
      error: rendered && rendered.error || ""
    },
    profile: {
      visibleLevel: rendered && rendered.visibleLevel,
      prestigeCompleted: rendered && rendered.prestigeCompleted,
      prestigeLabel: rendered && rendered.prestigeLabel,
      trueLevel: rendered && rendered.trueLevel,
      selectedLegend: rendered && rendered.selectedLegend
    },
    verification: { badgesByLegend, legendBadges: legendVerified, accountBadges, badgeTypes },
    summary,
    rules: {
      legend_verified: "Badge was visibly attached to a specific legend card/region on the rendered ALS profile.",
      account_verified: "Badge was visible at account level but not tied to a specific legend.",
      stat_supported: "ApexIQ progress can be calculated from returned stats only.",
      proof_pending: "User saved proof locally but it is not approved.",
      manual_approved: "User/admin approved proof locally.",
      unverified: "No trusted source returned this badge."
    },
    warning: rendered && rendered.ok ? "" : "Legend-specific badge verification requires Browser Run access to render the ALS profile."
  };
}

function normalizeVerifiedBadge(b, legend, trust, source) {
  const rawName = String(first(b.name, b.label, b.title, b.rawName, b.id, b.type, b.src ? "Unknown ALS badge slot" : "Badge")).trim();
  const type = first(b.type, b.badgeType, b.id, badgeTypeFromName(rawName));
  const name = type && type !== "unknown_als_badge" ? badgeLabelFromType(type, rawName) : rawName;
  return {
    id: b.id || type,
    type,
    name,
    rawName,
    legend: legend || "",
    trust,
    verified: trust === "legend_verified",
    accountWide: trust === "account_verified",
    src: first(b.src, b.url, b.icon, b.image, ""),
    slotIndex: b.slotIndex,
    confidence: first(b.confidence, ""),
    reason: first(b.reason, b.imageDescription, ""),
    source: source || b.source || "ApexIQ badge scan"
  };
}

function uniqueVerifiedBadges(list) {
  const out = [], seen = new Set();
  for (const b of list || []) {
    const knownType = b.type && b.type !== "unknown_als_badge" && b.type !== "badge";
    const key = knownType
      ? `${norm(b.legend)}|${b.type}`
      : `${norm(b.legend)}|${b.type}|${norm(b.name)}|${b.src || ""}|${b.slotIndex ?? ""}|${b.trust}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

function badgeTypeFromName(name) {
  const s = norm(name);
  if (/20kill|20bomb|twenty|wake|badge20/.test(s)) return "twenty_kill";
  if (/4k|4000|fourk|hammer|damage4000/.test(s)) return "four_k";
  if (/tripletriple/.test(s)) return "triple_triple";
  if (/teamwork/.test(s)) return "team_work";
  if (/nowitnesses/.test(s)) return "no_witnesses";
  if (/rapidelimination/.test(s)) return "rapid_elimination";
  if (/apexpredator|predator/.test(s)) return "pred_badge";
  if (/master/.test(s)) return "master_badge";
  if (/diamond/.test(s)) return "diamond_badge";
  if (/platinum/.test(s)) return "platinum_badge";
  if (/gold/.test(s)) return "gold_badge";
  if (/silver/.test(s)) return "silver_badge";
  if (/bronze/.test(s)) return "bronze_badge";
  if (/assassin/.test(s)) return "assassin";
  return badgeIdFromName(name);
}

function badgeLabelFromType(type, fallback) {
  const map = { twenty_kill: "20 Kill Badge", four_k: "4K Damage Badge", triple_triple: "Triple Triple", team_work: "Team Work", no_witnesses: "No Witnesses", rapid_elimination: "Rapid Elimination", pred_badge: "Apex Predator Badge", master_badge: "Master Badge", diamond_badge: "Diamond Badge", platinum_badge: "Platinum Badge", gold_badge: "Gold Badge", silver_badge: "Silver Badge", bronze_badge: "Bronze Badge", assassin: "Assassin" };
  return map[type] || fallback || String(type || "Badge").replace(/_/g, " ");
}


async function handleMeta(url, env, ctx, request) {
  const force = url.searchParams.get("refresh") === "1" || url.searchParams.get("nocache") === "1";
  const cacheUrl = new URL(url.toString());
  for (const key of ["refresh", "nocache", "_", "callback", "client", "prefetch"]) cacheUrl.searchParams.delete(key);
  const cacheKey = new Request(cacheUrl.toString(), request);

  if (!force) {
    try {
      const cached = await caches.default.match(cacheKey);
      if (cached) {
        const cachedData = await cached.json();
        if (cachedData && (cachedData.pickrates || cachedData.rows || cachedData.legends || cachedData.meta)) {
          return { ...cachedData, cached: true, cacheSource: "edge-cache", fast: true };
        }
      }
    } catch (_) {}

    try {
      const kvCached = await readMetaKV(env);
      if (kvCached && normalizeMetaRows(kvCached.pickrates || kvCached.rows || kvCached.legends || kvCached.meta || []).length) {
        if (ctx) ctx.waitUntil(refreshMetaCache(cacheKey, env, ctx, request));
        return { ...kvCached, cached: true, cacheSource: "kv-last-good", fast: true };
      }
    } catch (_) {}
    if (ctx) ctx.waitUntil(refreshMetaCache(cacheKey, env, ctx, request));
    return buildMetaOutput([], {
      source: "ALS live legend pick-rates",
      sourceKind: "unavailable",
      fallback: false,
      liveOk: false,
      liveError: "Live meta unavailable and no last-good KV cache is available yet.",
      attempts: []
    });
  }

  return await fetchLiveMetaAndStore(cacheKey, env, ctx, request, true);
}

function buildMetaOutput(rows, opts = {}) {
  rows = normalizeMetaRows(rows || []);
  return {
    ok: rows.length > 0,
    version: VERSION,
    source: opts.source || "ALS public legend pick-rates",
    sourceKind: opts.sourceKind || "live",
    fallback: !!opts.fallback,
    liveOk: !!opts.liveOk,
    liveError: opts.liveError || "",
    error: rows.length ? "" : (opts.liveError || "No live meta rows available"),
    fetchedAt: new Date().toISOString(),
    count: rows.length,
    expectedLegends: LEGEND_NAMES.length,
    complete: rows.length >= LEGEND_NAMES.length,
    partial: rows.length > 0 && rows.length < LEGEND_NAMES.length,
    attempts: opts.attempts || [],
    pickrates: rows,
    legends: rows,
    meta: rows
  };
}

async function readMetaKV(env) {
  if (!env || !env.APEXIQ_BETA_KV || typeof env.APEXIQ_BETA_KV.get !== "function") return null;
  try {
    const text = await env.APEXIQ_BETA_KV.get("meta:last-good");
    return text ? JSON.parse(text) : null;
  } catch (_) {
    return null;
  }
}

async function writeMetaKV(env, data) {
  if (!env || !env.APEXIQ_BETA_KV || typeof env.APEXIQ_BETA_KV.put !== "function" || !data || !data.ok) return;
  try {
    await env.APEXIQ_BETA_KV.put("meta:last-good", JSON.stringify(data), { expirationTtl: 60 * 60 * 24 });
  } catch (_) {}
}

async function refreshMetaCache(cacheKey, env, ctx, request) {
  try {
    await fetchLiveMetaAndStore(cacheKey, env, ctx, request, false);
  } catch (_) {}
}

async function fetchLiveMetaAndStore(cacheKey, env, ctx, request, browserFallback) {
  let live = { ok: false, pickrates: [], source: "", attempts: [], error: "" };
  try {
    live = await fetchAlsPickRates(env, { browserFallback: !!browserFallback });
  } catch (e) {
    live = { ok: false, pickrates: [], source: "", attempts: [], error: String(e && e.message ? e.message : e) };
  }

  let rows = normalizeMetaRows(live.pickrates || []);
  const liveRows = rows.length;
  const liveError = live.error || "";
  if (!rows.length) {
    const kvCached = await readMetaKV(env);
    const kvRows = normalizeMetaRows(kvCached && (kvCached.pickrates || kvCached.rows || kvCached.legends || kvCached.meta) || []);
    if (kvRows.length) {
      return buildMetaOutput(kvRows, {
        source: (kvCached && kvCached.source) || "Last successful Meta cache",
        sourceKind: "kv-last-good",
        fallback: false,
        liveOk: false,
        liveError: liveError || "Live meta refresh failed; showing last successful cached rows.",
        attempts: live.attempts || []
      });
    }
  }
  const out = buildMetaOutput(rows, {
    source: live.source || "ALS public legend pick-rates",
    sourceKind: liveRows > 0 ? "live" : "unavailable",
    fallback: false,
    liveOk: liveRows > 0,
    liveError: liveRows > 0 ? "" : (liveError || "No live meta rows available and no last-good KV cache exists."),
    attempts: live.attempts || []
  });
  if (out.ok) {
    const response = new Response(JSON.stringify(out, null, 2), { headers: corsHeaders("*", 300) });
    if (ctx) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    if (ctx) ctx.waitUntil(writeMetaKV(env, out)); else await writeMetaKV(env, out);
  }
  return out;
}

async function fetchAlsPickRates(env, options = {}) {
  const url = "https://apexlegendsstatus.com/game-stats/legends-pick-rates";
  const attempts = [];
  let bestRows = [];
  let bestSource = "";
  let error = "";

  try {
    const html = await fetchText(url, {
      timeoutMs: 10000,
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36 ApexIQ Meta Parser"
      }
    });
    const rows = parsePickRatesHtml(html);
    attempts.push({ step: "static-html", ok: rows.length > 0, rows: rows.length, source: "ALS static HTML" });
    if (rows.length > bestRows.length) {
      bestRows = rows;
      bestSource = "ALS public legend pick-rates HTML";
    }
  } catch (e) {
    error = String(e && e.message ? e.message : e);
    attempts.push({ step: "static-html", ok: false, error });
  }

  // ALS can occasionally block server-side HTML requests even while the public page works in a browser.
  // Use Jina Reader as a text-only recovery lane before the heavier Browser Rendering fallback.
  if (bestRows.length < 20) {
    try {
      const readerText = await fetchText(jinaReaderUrl(url), {
        timeoutMs: 14000,
        headers: {
          "Accept": "text/plain,text/markdown,*/*",
          "User-Agent": "ApexIQ Meta Reader Recovery/4.9.9.96",
          "X-No-Cache": "true",
          "X-Return-Format": "markdown"
        }
      });
      const rows = parsePickRatesHtml(readerText);
      attempts.push({ step: "jina-reader", ok: rows.length > 0, rows: rows.length, source: "Jina Reader of ALS public page" });
      if (rows.length > bestRows.length) {
        bestRows = rows;
        bestSource = "ALS public legend pick-rates via Jina Reader";
      }
    } catch (e) {
      attempts.push({ step: "jina-reader", ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  // If the static/reader parse is incomplete and Browser Rendering is configured, try rendered content once.
  // This is intentionally not a background loop; it only runs for refresh/render calls or when static rows are weak.
  if (browserReady(env) && (options.browserFallback || bestRows.length < 20)) {
    try {
      const rendered = await browserContent(env, url);
      const rows = parsePickRatesHtml(rendered);
      attempts.push({ step: "browser-rendered-content", ok: rows.length > 0, rows: rows.length, source: "ALS rendered content" });
      if (rows.length > bestRows.length) {
        bestRows = rows;
        bestSource = "ALS public legend pick-rates rendered HTML";
      }
    } catch (e) {
      attempts.push({ step: "browser-rendered-content", ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  const rows = normalizeMetaRows(bestRows);
  return { ok: rows.length > 0, source: bestSource || "ALS public legend pick-rates", url, pickrates: rows, attempts, error };
}

function parsePickRatesHtml(html) {
  const raw = String(html || "");
  const visibleText = textFromHtml(raw);
  const lineRows = parsePickRatesLines(visibleText);
  const bandRows = parsePickRatesText(visibleText);
  const rawRows = parsePickRatesText(raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
  return mergeMetaRows(lineRows, bandRows, rawRows);
}

function parsePickRatesLines(text) {
  const lines = String(text || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map(s => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const legend = canonicalLegendName(lines[i]);
    if (!legend) continue;
    const pctLine = lines.slice(i + 1, i + 5).find(l => /\b\d+(?:\.\d+)?\s*%/.test(l));
    if (!pctLine) continue;
    const pct = (pctLine.match(/\b(\d+(?:\.\d+)?)\s*%/) || [])[1];
    if (!pct) continue;
    const trendLine = lines.slice(i + 1, i + 7).find(l => /[▲▼]\s*\d+(?:\.\d+)?\s*%/.test(l)) || "—";
    const trend = (trendLine.match(/([▲▼]\s*\d+(?:\.\d+)?\s*%)/) || ["", "—"])[1].replace(/\s+/g, "");
    const avgLine = lines.slice(i + 1, i + 10).find(l => /Avg\s*rank/i.test(l) || /level\s*\d+/i.test(l)) || "";
    const avg = parseAvgRankLevel(avgLine);
    rows.push(metaRow(legend, pct, trend, avg.avgRank, avg.avgLevel, "ALS public legend pick-rates HTML"));
  }
  return dedupeMetaRows(rows);
}

function parsePickRatesText(text) {
  const compact = String(text || "").replace(/\r/g, "\n").replace(/\s+/g, " ").trim();
  const rows = [];
  const positions = [];
  for (const legend of LEGEND_NAMES) {
    const re = new RegExp(`\\b${escapeRegExp(legend)}\\b`, "ig");
    let m;
    while ((m = re.exec(compact))) positions.push({ legend, idx: m.index });
  }
  positions.sort((a, b) => a.idx - b.idx);

  for (let i = 0; i < positions.length; i++) {
    const { legend, idx } = positions[i];
    if (rows.some(r => norm(r.legend) === norm(legend))) continue;
    const nextLegendIdx = positions.slice(i + 1).find(p => p.legend !== legend)?.idx;
    const end = nextLegendIdx && nextLegendIdx > idx ? Math.min(nextLegendIdx, idx + 900) : Math.min(compact.length, idx + 900);
    const band = compact.slice(idx, end);
    const pct = (band.match(/\b(\d+(?:\.\d+)?)\s*%/) || [])[1];
    if (!pct) continue;
    const trend = ((band.match(/([▲▼]\s*\d+(?:\.\d+)?\s*%)/) || [])[1] || "—").replace(/\s+/g, "");
    const avg = parseAvgRankLevel(band);
    rows.push(metaRow(legend, pct, trend, avg.avgRank, avg.avgLevel, "ALS public legend pick-rates HTML"));
  }
  return dedupeMetaRows(rows).sort((a,b) => Number(b.pickRate || 0) - Number(a.pickRate || 0));
}

function canonicalLegendName(value) {
  const n = norm(value);
  return LEGEND_NAMES.find(l => norm(l) === n) || "";
}

function parseAvgRankLevel(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  let avgRank = "—";
  let avgLevel = "—";
  const rank = s.match(/\b(Bronze|Silver|Gold|Platinum|Diamond|Master|Apex Predator|Predator)\s*([1-4])?\b/i);
  if (rank) avgRank = rank[0].replace(/\s+/g, " ").replace(/^Predator$/i, "Apex Predator").trim();
  const lvl = s.match(/\b(?:level|lvl)\s*(\d{1,5})\b/i);
  if (lvl) avgLevel = lvl[1];
  return { avgRank, avgLevel };
}

function metaRow(legend, pct, trend, avgRank, avgLevel, source) {
  const rate = String(pct || "").replace(/[^0-9.]/g, "");
  return {
    legend,
    name: legend,
    pickRate: rate,
    rate,
    trend: trend || "—",
    avgRank: avgRank || "—",
    averageRank: avgRank || "—",
    avgLevel: avgLevel || "—",
    averageLevel: avgLevel || "—",
    level: avgLevel || "—",
    source: source || "ALS public legend pick-rates HTML",
    sourceKind: "live",
    fetchedAt: new Date().toISOString()
  };
}

function mergeMetaRows(...groups) {
  const byLegend = new Map();
  for (const group of groups) {
    for (const row of group || []) {
      const key = norm(row.legend || row.name);
      if (!key || !isNumeric(row.pickRate || row.rate)) continue;
      const current = byLegend.get(key);
      const score = metaRowQuality(row);
      if (!current || score > metaRowQuality(current)) byLegend.set(key, row);
    }
  }
  return Array.from(byLegend.values()).sort((a,b) => Number(b.pickRate || b.rate || 0) - Number(a.pickRate || a.rate || 0)).map((r, i) => ({ ...r, order: i + 1 }));
}

function metaRowQuality(row) {
  let score = 0;
  if (isNumeric(row.pickRate || row.rate)) score += 10;
  if (row.trend && row.trend !== "—") score += 3;
  if (row.avgRank && row.avgRank !== "—") score += 2;
  if (row.avgLevel && row.avgLevel !== "—") score += 2;
  return score;
}

function dedupeMetaRows(rows) {
  const byLegend = new Map();
  for (const row of rows || []) {
    const key = norm(row.legend || row.name);
    if (!key) continue;
    const current = byLegend.get(key);
    if (!current || metaRowQuality(row) > metaRowQuality(current)) byLegend.set(key, row);
  }
  return Array.from(byLegend.values());
}

function normalizeMetaRows(rows) {
  return mergeMetaRows(rows).map((row, i) => ({
    ...row,
    legend: canonicalLegendName(row.legend || row.name) || row.legend || row.name,
    name: canonicalLegendName(row.legend || row.name) || row.legend || row.name,
    pickRate: String(row.pickRate || row.rate || "").replace(/[^0-9.]/g, ""),
    rate: String(row.rate || row.pickRate || "").replace(/[^0-9.]/g, ""),
    trend: row.trend || "—",
    avgRank: row.avgRank || row.averageRank || "—",
    averageRank: row.averageRank || row.avgRank || "—",
    avgLevel: row.avgLevel || row.averageLevel || row.level || "—",
    averageLevel: row.averageLevel || row.avgLevel || row.level || "—",
    level: row.level || row.avgLevel || row.averageLevel || "—",
    source: row.source || "ALS public legend pick-rates HTML",
    sourceKind: row.sourceKind || "live",
    order: i + 1
  }));
}

function fallbackPickratesMeta() {
  return [];
}



function toNum(x) {
  const n = Number(String(x ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function isNumeric(x) {
  return x !== null && x !== "" && Number.isFinite(Number(String(x).replace(/,/g, "")));
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
