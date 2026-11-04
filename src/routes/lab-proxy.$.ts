import { createFileRoute } from "@tanstack/react-router";

const ALLOWED = new Set(["sources", "state", "activity", "experiment", "stream"]);

/** Read-only relay to a user-supplied discovery-lab feed address, so the
 * browser can reach a feed that sends no CORS headers. GET only, and only the
 * feed's five documented paths. */
const MAX_BODY = 4096;

function resolveTarget(request: Request): { url: URL; base: URL } | Response {
  const url = new URL(request.url);
  const target = url.searchParams.get("target") ?? "";
  let base: URL;
  try {
    base = new URL(target);
  } catch {
    return new Response("Invalid lab address", { status: 400 });
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    return new Response("Invalid lab address", { status: 400 });
  }
  url.searchParams.delete("target");
  return { url, base };
}

export const Route = createFileRoute("/lab-proxy/$")({
  server: {
    handlers: {
      // Only one write path: start a run with a short question (proposed contract).
      POST: async ({ request, params }) => {
        if ((params._splat ?? "") !== "runs") return new Response("Unknown lab path", { status: 404 });
        const resolved = resolveTarget(request);
        if (resolved instanceof Response) return resolved;
        const text = await request.text();
        if (text.length > MAX_BODY) return new Response("Question too long", { status: 413 });
        let question = "";
        try {
          question = String((JSON.parse(text) as { question?: unknown }).question ?? "").trim();
        } catch {
          return new Response("Invalid body", { status: 400 });
        }
        if (question.length < 10 || question.length > 1000) {
          return Response.json({ error: { code: "invalid_question", message: "Questions must be 10–1000 characters.", details: {} } }, { status: 400 });
        }
        const { base } = resolved;
        const upstream = new URL(`${base.pathname.replace(/\/$/, "")}/lab/runs`, base.origin);
        try {
          const res = await fetch(upstream, {
            method: "POST",
            headers: { "content-type": "application/json", "ngrok-skip-browser-warning": "1" },
            body: JSON.stringify({ question }),
          });
          // A lab without the start-a-run endpoint is an expected state, not an error.
          if (res.status === 404 || res.status === 405 || res.status === 501) {
            return Response.json({ unsupported: true }, { headers: { "cache-control": "no-store" } });
          }
          return new Response(res.body, {
            status: res.status,
            headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
          });
        } catch {
          // An unreachable lab is an expected state; the app falls back to the recording.
          return Response.json({ offline: true }, { headers: { "cache-control": "no-store" } });
        }
      },
      GET: async ({ request, params }) => {
        const path = params._splat ?? "";
        if (!ALLOWED.has(path)) return new Response("Unknown lab path", { status: 404 });
        const url = new URL(request.url);
        const target = url.searchParams.get("target") ?? "";
        let base: URL;
        try {
          base = new URL(target);
        } catch {
          return new Response("Invalid lab address", { status: 400 });
        }
        if (base.protocol !== "https:" && base.protocol !== "http:") {
          return new Response("Invalid lab address", { status: 400 });
        }
        url.searchParams.delete("target");
        const upstream = new URL(`${base.pathname.replace(/\/$/, "")}/lab/${path}`, base.origin);
        upstream.search = url.searchParams.toString();
        try {
          const res = await fetch(upstream, {
            headers: { accept: request.headers.get("accept") ?? "*/*", "ngrok-skip-browser-warning": "1" },
            signal: request.signal,
          });
          // An experiment the lab can't serve yet (e.g. still running) is expected; report it softly.
          if (path === "experiment" && res.status >= 500) {
            return Response.json({ unavailable: true }, { headers: { "cache-control": "no-store" } });
          }
          return new Response(res.body, {
            status: res.status,
            headers: {
              "content-type": res.headers.get("content-type") ?? "application/json",
              "cache-control": "no-store",
            },
          });
        } catch {
          // No lab running at that address is a normal state, not a failure:
          // discovery answers with an empty list so the app shows "no lab".
          if (path === "sources") {
            return Response.json(
              { sources: [], offline: true },
              { headers: { "cache-control": "no-store" } },
            );
          }
          return Response.json(
            { error: { code: "lab_unreachable", message: `Could not reach the lab at ${base.origin}`, details: {} } },
            { status: 502 },
          );
        }
      },
    },
  },
});
