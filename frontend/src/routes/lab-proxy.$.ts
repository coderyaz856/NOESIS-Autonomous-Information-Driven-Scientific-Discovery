import { createFileRoute } from "@tanstack/react-router";

import {
  allowedOrigins, bridgeAuthHeaders, checkWriteAllowed, clientHeaders, relayFetch, resolveTarget, serverEnv, sessionStatus, signIn, signOut,
} from "@/noesis/api/lab-proxy-policy";

/** Operator session for hosted writes (see lab-proxy-policy.ts). Not relayed to a bridge. */
const SESSION_PATH = "session";
/** The lab address configured on the server (public, not a secret). */
const CONFIG_PATH = "config";

const READ_PATHS = new Set(["sources", "state", "activity", "experiment", "stream", "run", "capabilities"]);
const WRITE_PATHS = new Set(["runs", "approvals"]);
const MAX_BODY_BYTES = 4096;
const noStore = { "cache-control": "no-store" };

/** Relay to a configured discovery-lab bridge (allow-listed origins, server-side
 * bridge token, no redirects). Expected states — no lab, lab can't start runs,
 * experiment not ready — answer softly so the page never goes blank. */
export const Route = createFileRoute("/lab-proxy/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const path = params._splat ?? "";
        const env = serverEnv();
        if (path === SESSION_PATH) return sessionStatus(request, env);
        if (path === CONFIG_PATH) {
          const origins = [...allowedOrigins(env)];
          const configured = !!(env["NOESIS_LAB_ORIGINS"] ?? "").trim();
          return Response.json({ lab_url: configured ? origins[0] ?? null : null, origins }, { headers: noStore });
        }
        if (!READ_PATHS.has(path)) return new Response("Unknown lab path", { status: 404 });
        const upstream = resolveTarget(request.url, path, env);
        if (upstream instanceof Response) {
          if (path === "sources") return Response.json({ sources: [], offline: true, refused: true }, { headers: noStore });
          return upstream;
        }
        const auth = bridgeAuthHeaders(env);
        if (auth instanceof Response) {
          if (path === "sources") return Response.json({ sources: [], offline: true, refused: true }, { headers: noStore });
          return auth;
        }
        try {
          const res = await relayFetch(upstream, {
            headers: { accept: request.headers.get("accept") ?? "*/*", "ngrok-skip-browser-warning": "1", ...auth },
            signal: request.signal,
          });
          if (path === "experiment" && res.status >= 500) return Response.json({ unavailable: true }, { headers: noStore });
          if ((path === "run" || path === "capabilities") && res.status === 404) return Response.json({ unsupported: true }, { headers: noStore });
          return new Response(res.body, {
            status: res.status,
            headers: { "content-type": res.headers.get("content-type") ?? "application/json", ...noStore },
          });
        } catch {
          if (path === "sources") return Response.json({ sources: [], offline: true }, { headers: noStore });
          return Response.json(
            { error: { code: "lab_unreachable", message: `Could not reach the lab at ${upstream.origin}`, details: {} } },
            { status: 502 },
          );
        }
      },
      POST: async ({ request, params }) => {
        const path = params._splat ?? "";
        const env = serverEnv();
        if (path === SESSION_PATH) return signIn(request, env);
        if (!WRITE_PATHS.has(path)) return new Response("Unknown lab path", { status: 404 });
        const refused = await checkWriteAllowed(request, env);
        if (refused) return refused;
        const upstream = resolveTarget(request.url, path, env);
        if (upstream instanceof Response) return upstream;
        const auth = bridgeAuthHeaders(env);
        if (auth instanceof Response) return auth;
        const body = await request.text();
        if (body.length > MAX_BODY_BYTES) return new Response("Request too large", { status: 413 });
        try { JSON.parse(body); } catch { return new Response("Expected a JSON body", { status: 400 }); }
        try {
          const res = await relayFetch(upstream, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json", "ngrok-skip-browser-warning": "1", ...auth,
              ...(await clientHeaders(request, env)) },
            body,
            signal: request.signal,
          });
          // A lab without the run endpoint (older bridge) is an expected state.
          if (path === "runs" && (res.status === 404 || res.status === 405 || res.status === 501)) {
            return Response.json({ unsupported: true }, { headers: noStore });
          }
          return new Response(await res.text(), {
            status: res.status,
            headers: { "content-type": res.headers.get("content-type") ?? "application/json", ...noStore },
          });
        } catch {
          return Response.json({ offline: true }, { headers: noStore });
        }
      },
      DELETE: async ({ params }) => {
        if ((params._splat ?? "") !== SESSION_PATH) return new Response("Unknown lab path", { status: 404 });
        return signOut(serverEnv());
      },
    },
  },
});
