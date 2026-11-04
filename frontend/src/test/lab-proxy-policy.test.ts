import { describe, expect, it, vi } from "vitest";

import {
  allowedOrigins, buildServerEnv, checkWriteAllowed, readCookie, relayFetch, resolveTarget, SESSION_TTL_SECONDS, sessionStatus, signIn,
  signOut, verifySession, WRITE_TOKEN_HEADER, writeMode,
} from "@/noesis/api/lab-proxy-policy";

const req = (target: string, extra = "") => `http://app.test/lab-proxy/state?target=${encodeURIComponent(target)}${extra}`;
const DEV = { NODE_ENV: "development" };
const PROD = { NODE_ENV: "production", NOESIS_LAB_ORIGINS: "https://lab.example.org" };

describe("lab proxy destinations", () => {
  it("allows the local bridge in development and keeps the query", () => {
    const u = resolveTarget(req("http://127.0.0.1:8765", "&source=lab_home%2Fr1"), "state", DEV);
    expect(u).toBeInstanceOf(URL);
    expect(String(u)).toBe("http://127.0.0.1:8765/lab/state?source=lab_home%2Fr1");
  });

  it("allows a configured production origin", () => {
    expect(String(resolveTarget(req("https://lab.example.org/"), "run", PROD))).toBe("https://lab.example.org/lab/run");
  });

  it.each([
    ["an arbitrary host", "https://evil.example.com", DEV],
    ["a cloud metadata address", "http://169.254.169.254", DEV],
    ["the right host on another port", "http://127.0.0.1:9999", DEV],
    ["a look-alike origin", "https://lab.example.org.evil.com", PROD],
    ["the dev default in production", "http://127.0.0.1:8765", PROD],
  ])("denies %s", (_label, target, env) => {
    const r = resolveTarget(req(target), "state", env);
    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(403);
  });

  it.each(["file:///etc/passwd", "not a url", "http://user:pw@127.0.0.1:8765"])("rejects malformed target %s", (t) => {
    const r = resolveTarget(req(t), "state", DEV);
    expect((r as Response).status).toBe(400);
  });

  it("allows nothing in production until an origin is configured", () => {
    expect(allowedOrigins({ NODE_ENV: "production" }).size).toBe(0);
  });
});

const APP = "https://noesis.example.org";
const OPERATOR = { ...PROD, NOESIS_LAB_WRITE_TOKEN: "s3cret-test" };
const NOW = Date.UTC(2026, 10, 4, 12);

function post(path: string, headers: Record<string, string> = {}, body = "{}") {
  return new Request(`${APP}/lab-proxy/${path}?target=https%3A%2F%2Flab.example.org`, { method: "POST", headers, body });
}

async function cookieFromSignIn(env: Record<string, string> = OPERATOR, now = NOW) {
  const res = await signIn(post("session", { origin: APP }, JSON.stringify({ token: "s3cret-test" })), env, now);
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie") ?? "";
}

/** The `name=value` pair a browser would send back. */
async function sessionPair(env: Record<string, string> = OPERATOR) {
  return (await cookieFromSignIn(env)).split(";")[0] ?? "";
}

describe("lab proxy writes", () => {
  it("are open in development", async () => {
    expect(await checkWriteAllowed(post("runs"), DEV)).toBeNull();
    expect(writeMode(DEV)).toBe("open");
  });

  it("make a hosted app read-only when no operator token is configured", async () => {
    expect(writeMode(PROD)).toBe("disabled");
    const refused = await checkWriteAllowed(post("runs", { origin: APP }), PROD);
    expect(refused?.status).toBe(403);
    expect((await refused!.json()).error.code).toBe("writes_disabled");
    expect((await signIn(post("session", { origin: APP }, '{"token":"x"}'), PROD)).status).toBe(403);
    expect(await (await sessionStatus(post("session"), PROD)).json()).toEqual({ write_mode: "disabled", signed_in: false });
  });

  it("need an operator session in production", async () => {
    const refused = await checkWriteAllowed(post("runs", { origin: APP }), OPERATOR, NOW);
    expect(refused?.status).toBe(401);
    expect((await refused!.json()).error.code).toBe("operator_session_required");
  });

  it("accept the exact token header from scripts", async () => {
    expect((await checkWriteAllowed(post("runs", { [WRITE_TOKEN_HEADER]: "wrong" }), OPERATOR, NOW))?.status).toBe(401);
    expect(await checkWriteAllowed(post("runs", { [WRITE_TOKEN_HEADER]: "s3cret-test" }), OPERATOR, NOW)).toBeNull();
  });
});

describe("operator session", () => {
  it("sets an HttpOnly, Strict, Secure cookie that carries no token", async () => {
    const cookie = await cookieFromSignIn();
    expect(cookie).toMatch(/^noesis_lab_session=\d+\.[A-Za-z0-9_-]{43}; Path=\/lab-proxy; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
    expect(cookie).not.toContain("s3cret-test");
  });

  it("authorises same-origin writes and reports the session", async () => {
    const value = await sessionPair();
    expect(await checkWriteAllowed(post("runs", { origin: APP, cookie: value }), OPERATOR, NOW)).toBeNull();
    expect(await checkWriteAllowed(post("runs", { "sec-fetch-site": "same-origin", cookie: value }), OPERATOR, NOW)).toBeNull();
    const status = await sessionStatus(post("session", { cookie: value }), OPERATOR, NOW);
    expect(await status.json()).toEqual({ write_mode: "operator", signed_in: true });
  });

  it("refuses cross-site writes even with a valid session", async () => {
    const value = await sessionPair();
    expect((await checkWriteAllowed(post("runs", { origin: "https://evil.example.com", cookie: value }), OPERATOR, NOW))?.status).toBe(403);
    expect((await checkWriteAllowed(post("runs", { cookie: value }), OPERATOR, NOW))?.status).toBe(403);
  });

  it("honours a configured public origin behind a reverse proxy", async () => {
    const env = { ...OPERATOR, NOESIS_PUBLIC_ORIGIN: "https://public.example.org" };
    const value = await sessionPair(env);
    expect(await checkWriteAllowed(post("runs", { origin: "https://public.example.org", cookie: value }), env, NOW)).toBeNull();
  });

  it("rejects wrong tokens, cross-site sign-in and malformed bodies", async () => {
    expect((await signIn(post("session", { origin: APP }, '{"token":"wrong"}'), OPERATOR, NOW)).status).toBe(401);
    expect((await signIn(post("session", { origin: APP }, '{"token":""}'), OPERATOR, NOW)).status).toBe(401);
    expect((await signIn(post("session", { origin: APP }, "not json"), OPERATOR, NOW)).status).toBe(400);
    expect((await signIn(post("session", { origin: "https://evil.example.com" }, '{"token":"s3cret-test"}'), OPERATOR, NOW)).status).toBe(403);
    expect((await signIn(post("session", { origin: APP }, JSON.stringify({ token: "x".repeat(2000) })), OPERATOR, NOW)).status).toBe(413);
  });

  it("expires, rejects tampering, and dies when the token is rotated", async () => {
    const value = (await sessionPair()).split("=")[1] ?? "";
    expect(await verifySession(value, OPERATOR, NOW)).toBe(true);
    expect(await verifySession(value, OPERATOR, NOW + (SESSION_TTL_SECONDS + 1) * 1000)).toBe(false);
    const [exp = "", sig = ""] = value.split(".");
    expect(await verifySession(`${Number(exp) + 3600}.${sig}`, OPERATOR, NOW)).toBe(false);
    expect(await verifySession(`${exp}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`, OPERATOR, NOW)).toBe(false);
    expect(await verifySession(value, { ...OPERATOR, NOESIS_LAB_WRITE_TOKEN: "rotated" }, NOW)).toBe(false);
    expect(await verifySession(value, PROD, NOW)).toBe(false);
  });

  it("signs out by clearing the cookie", async () => {
    const res = signOut(OPERATOR);
    expect(res.headers.get("set-cookie")).toMatch(/^noesis_lab_session=; .*Max-Age=0/);
    expect(await res.json()).toEqual({ write_mode: "operator", signed_in: false });
  });

  it("reads only the named cookie", () => {
    const h = new Headers({ cookie: "a=1; noesis_lab_session=v.x; b=2" });
    expect(readCookie(h, "noesis_lab_session")).toBe("v.x");
    expect(readCookie(new Headers({ cookie: "xnoesis_lab_session=v" }), "noesis_lab_session")).toBeNull();
  });
});

describe("server settings", () => {
  it("treat a production build as production even when NODE_ENV is missing or says development", () => {
    expect(buildServerEnv({}, {}, false)["NODE_ENV"]).toBe("production");
    expect(buildServerEnv({ NODE_ENV: "development" }, {}, false)["NODE_ENV"]).toBe("production");
    expect(writeMode(buildServerEnv({}, {}, false))).toBe("disabled");
    expect(allowedOrigins(buildServerEnv({}, {}, false)).size).toBe(0);
  });

  it("keep a dev build in development", () => {
    expect(writeMode(buildServerEnv({ NODE_ENV: "production" }, {}, true))).toBe("open");
  });

  it("read Cloudflare string bindings and let process.env override them", () => {
    const env = buildServerEnv(
      { NOESIS_LAB_ORIGINS: "https://lab.example.org" },
      { NOESIS_LAB_WRITE_TOKEN: "from-binding", NOESIS_LAB_ORIGINS: "https://old.example.org", ASSETS: { fetch() {} } },
      false,
    );
    expect(writeMode(env)).toBe("operator");
    expect([...allowedOrigins(env)]).toEqual(["https://lab.example.org"]);
    expect(env["ASSETS"]).toBeUndefined();
  });
});

describe("lab proxy redirects", () => {
  it("refuses an upstream redirect instead of following it", async () => {
    const fake = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example.com/" } }));
    const res = await relayFetch(new URL("http://127.0.0.1:8765/lab/run"), {}, fake as unknown as typeof fetch);
    expect(res.status).toBe(502);
    expect(fake).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: "manual" }));
  });

  it("passes a normal response through", async () => {
    const fake = vi.fn(async () => Response.json({ ok: true }));
    const res = await relayFetch(new URL("http://127.0.0.1:8765/lab/run"), {}, fake as unknown as typeof fetch);
    expect(res.status).toBe(200);
  });
});
