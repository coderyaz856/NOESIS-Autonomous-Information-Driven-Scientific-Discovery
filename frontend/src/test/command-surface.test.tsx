import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandSurface } from "@/noesis/components/CommandSurface";
import { ShellProvider, type ShellApi } from "@/noesis/components/shell";
import { resetLabSession } from "@/noesis/lab/OperatorAccess";

const lab = {
  baseUrl: "",
  status: "connected" as const,
  sources: [] as never[],
  setSourceId: vi.fn(),
  refresh: vi.fn(),
};
vi.mock("@/noesis/lab/LabContext", () => ({ useLab: () => lab }));

const capabilities = {
  runs_enabled: true,
  harness: "Muse Code (Meta Model API)",
  max_rounds: 2,
  max_ceiling_usd: 5,
  supported_domain: { domain: "GA stagnation early warning", hypotheses: [{ id: "H1", statement: "entropy warns" }] },
};

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

function renderSurface() {
  const shell = { navigate: vi.fn() } as unknown as ShellApi;
  render(<ShellProvider value={shell}><CommandSurface docked /></ShellProvider>);
  return shell;
}

async function ask(question: string) {
  const input = screen.getByLabelText("Ask Noesis a research question");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/lab-proxy/capabilities"), expect.anything()));
  fireEvent.change(input, { target: { value: question } });
  fireEvent.submit(input.closest("form")!);
}

let fetchMock: ReturnType<typeof vi.fn>;
let runResponse: () => Promise<Response>;
let session: { write_mode: string; signed_in: boolean };

function route(url: string) {
  if (url.includes("/lab-proxy/session")) return json(200, session);
  return url.includes("/capabilities") ? json(200, capabilities) : runResponse();
}

beforeEach(() => {
  resetLabSession();
  runResponse = () => json(500, {});
  session = { write_mode: "open", signed_in: true };
  fetchMock = vi.fn(route);
  vi.stubGlobal("fetch", fetchMock);
  lab.setSourceId.mockReset();
  lab.refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("CommandSurface", () => {
  it("starts a real run and opens it in Discovery", async () => {
    runResponse = () => json(201, { source: "lab_home/muse-1", run_id: "muse-1", scope: { in_scope: true, hypotheses: ["H1"], reason: "" }, rounds: 1, ceiling_usd: 2 });
    const shell = renderSurface();
    await ask("Does entropy predict stagnation onset?");

    await waitFor(() => expect(lab.setSourceId).toHaveBeenCalledWith("lab_home/muse-1"));
    expect(shell.navigate).toHaveBeenCalledWith("discovery");
    const post = fetchMock.mock.calls.find(([url]) => String(url).includes("/lab-proxy/runs"))!;
    expect(post[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(post[1].body))).toMatchObject({ question: "Does entropy predict stagnation onset?" });
  });

  it("accepts any research question and says when nothing will be executed", async () => {
    runResponse = () => json(201, { source: "lab_home/muse-2", run_id: "muse-2", mode: "open", scope: { in_scope: false, hypotheses: [], reason: "biology" }, rounds: 1, ceiling_usd: 2 });
    const shell = renderSurface();
    await ask("Does intermittent fasting improve insulin sensitivity?");

    await waitFor(() => expect(lab.setSourceId).toHaveBeenCalledWith("lab_home/muse-2"));
    expect(shell.navigate).toHaveBeenCalledWith("discovery");
    expect(screen.getByText(/open research/i)).toHaveTextContent("no experiments executed");
  });

  it("does not post when the lab feed is read-only", async () => {
    fetchMock.mockImplementation((url: string) => (url.includes("/capabilities") ? json(200, { ...capabilities, runs_enabled: false }) : runResponse()));
    renderSurface();
    await ask("Does entropy predict stagnation onset?");

    expect(await screen.findByRole("alert")).toHaveTextContent("--enable-runs");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/lab-proxy/runs"))).toBe(false);
  });

  it("says a hosted app without an operator token is read-only and never posts", async () => {
    session = { write_mode: "disabled", signed_in: false };
    renderSurface();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/lab-proxy/session", expect.anything()));
    await ask("Does entropy predict stagnation onset?");

    expect(await screen.findByRole("alert")).toHaveTextContent(/read-only/);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/lab-proxy/runs"))).toBe(false);
    expect(screen.queryByLabelText("Operator token")).toBeNull();
  });

  it("asks a hosted operator to unlock, then starts runs with the session cookie only", async () => {
    session = { write_mode: "operator", signed_in: false };
    renderSurface();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/lab-proxy/session", expect.anything()));
    await ask("Does entropy predict stagnation onset?");
    expect(await screen.findByRole("alert")).toHaveTextContent(/operator session/);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/lab-proxy/runs"))).toBe(false);

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/lab-proxy/session" && init?.method === "POST") {
        session = { write_mode: "operator", signed_in: true };
        return json(200, session);
      }
      return route(url);
    });
    const field = screen.getByLabelText("Operator token");
    fireEvent.change(field, { target: { value: "operator-test-token" } });
    fireEvent.submit(field.closest("form")!);
    await screen.findByText(/Operator session active/);

    const signIn = fetchMock.mock.calls.find(([url, init]) => url === "/lab-proxy/session" && init?.method === "POST")!;
    expect(JSON.parse(String(signIn[1].body))).toEqual({ token: "operator-test-token" });

    runResponse = () => json(201, { source: "lab_home/muse-3", run_id: "muse-3", mode: "open", scope: { in_scope: false, hypotheses: [], reason: "" }, rounds: 1, ceiling_usd: 2 });
    const input = screen.getByLabelText("Ask Noesis a research question");
    fireEvent.change(input, { target: { value: "Does entropy predict stagnation onset?" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(lab.setSourceId).toHaveBeenCalledWith("lab_home/muse-3"));
    const run = fetchMock.mock.calls.find(([url]) => String(url).includes("/lab-proxy/runs"))!;
    expect(JSON.stringify(run[1])).not.toContain("operator-test-token");
  });
});
