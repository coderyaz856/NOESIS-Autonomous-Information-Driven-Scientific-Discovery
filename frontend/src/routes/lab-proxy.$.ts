import { createFileRoute } from "@tanstack/react-router";

import {
  checkWriteAllowed, relayFetch, resolveTarget, serverEnv, sessionStatus, signIn, signOut,
} from "@/noesis/api/lab-proxy-policy";

/** Operator session for hosted writes (see lab-proxy-policy.ts). Not relayed to a bridge. */
const SESSION_PATH = "session";

const READ_PATHS = new Set(["sources", "state", "activity", "experiment", "stream", "run", "capabilities"]);
/** Write paths: start a Muse Code run, answer a confirmatory-run approval.
 * The lab itself refuses both unless it was started with --enable-runs. */
const WRITE_PATHS = new Set(["runs", "approvals"]);
const MAX_BODY_BYTES = 4096;

function unreachable(upstream: URL) {
  return Response.json(
    { error: { code: "lab_unreachable", message: `Could not reach the lab at ${upstream.origin}`, details: {} } },
    { status: 502 },
  );
}

/** Relay to a configured discovery-lab bridge, so the browser can reach a feed
 * that sends no CORS headers. Only configured bridge origins are reachable
 * (see lab-proxy-policy.ts), redirects are refused, and only the feed's
 * documented paths are relayed: GET for the read views, POST (small JSON
 * bodies; in production only with an operator session, or read-only when no
 * operator token is configured) for starting a run and answering an approval
 * request. `/lab-proxy/session` signs an operator in and out. */
export const Route = createFileRoute("/lab-proxy/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const path = params._splat ?? "";
        if (path === SESSION_PATH) return sessionStatus(request, serverEnv());
        if (!READ_PATHS.has(path)) return new Response("Unknown lab path", { status: 404 });
        const upstream = resolveTarget(request.url, path, serverEnv());
        if (upstream instanceof Response) return upstream;
        try {
          const res = await relayFetch(upstream, {
            headers: { accept: request.headers.get("accept") ?? "*/*" },
            signal: request.signal,
          });
          return new Response(res.body, {
            status: res.status,
            headers: {
              "content-type": res.headers.get("content-type") ?? "application/json",
              "cache-control": "no-store",
            },
          });
        } catch {
          return unreachable(upstream);
        }
      },
      POST: async ({ request, params }) => {
        const path = params._splat ?? "";
        if (path === SESSION_PATH) return signIn(request, serverEnv());
        if (!WRITE_PATHS.has(path)) return new Response("Unknown lab path", { status: 404 });
        const env = serverEnv();
        const refused = await checkWriteAllowed(request, env);
        if (refused) return refused;
        const upstream = resolveTarget(request.url, path, env);
        if (upstream instanceof Response) return upstream;
        const body = await request.text();
        if (body.length > MAX_BODY_BYTES) return new Response("Request too large", { status: 413 });
        try {
          JSON.parse(body);
        } catch {
          return new Response("Expected a JSON body", { status: 400 });
        }
        try {
          const res = await relayFetch(upstream, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body,
            signal: request.signal,
          });
          return new Response(await res.text(), {
            status: res.status,
            headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
          });
        } catch {
          return unreachable(upstream);
        }
      },
      DELETE: async ({ params }) => {
        if ((params._splat ?? "") !== SESSION_PATH) return new Response("Unknown lab path", { status: 404 });
        return signOut(serverEnv());
      },
    },
  },
});
