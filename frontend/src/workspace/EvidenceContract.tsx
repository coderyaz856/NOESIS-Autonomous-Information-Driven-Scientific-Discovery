import { useState } from 'react';
import { REPO_URL } from './Report';

type Lang = 'Python' | 'Rust' | 'Julia';

function snippet(lang: Lang, runId: string): string {
  if (lang === 'Python') return `# pip install noesis_discovery  (import name: discolab)
from discolab import DiscoveryLab

lab = DiscoveryLab("${runId}", actor="reviewer")
# Same ledger, same evidence bundle the report above was built from.`;
  if (lang === 'Rust') return `// cargo add noesis-discovery   (needs the Python sidecar: discolab)
use noesis_discovery::*;

// The client starts \`python -m discolab.rpc\` for the run lifecycle;
// entropy and CVaR are recomputed by native Rust kernels.
with_resumed_research_run(&mut client, "${runId}", |run_id, state| { /* … */ })?;`;
  return `# Pkg.add(url=REPO, subdir="sdk/julia")  (needs the Python sidecar: discolab)
using NoesisDiscovery

client = open_client()
# Lifecycle via the Python sidecar; AUROC and clustered
# uncertainty are recomputed independently in Julia.
with_resumed_research_run(client, "${runId}") do run_id, state
    # …
end`;
}

/** "One evidence contract. Three ways to do science." All tabs point at the same run. */
export function EvidenceContract({ runId, print = false }: { runId: string | null | undefined; print?: boolean }) {
  const [lang, setLang] = useState<Lang>('Python');
  const id = runId ?? '<run-id>';
  const langs: Lang[] = ['Python', 'Rust', 'Julia'];
  return (
    <section className="avoid-break space-y-3" aria-labelledby="contract-title">
      <h3 id="contract-title" className="font-display text-xl">One evidence contract. Three ways to do science.</h3>
      <p className="text-sm text-muted-foreground">
        Every snippet opens the same run <span className="font-mono">{id}</span> and its evidence bundle. Rust and Julia use the Python sidecar for the research lifecycle, but perform the numerical calculations independently to prove parity.
      </p>
      {print ? langs.map((l) => (
        <div key={l}><p className="text-xs font-medium">{l}</p><pre className="overflow-hidden whitespace-pre-wrap rounded-md border bg-muted p-3 font-mono text-[11px]">{snippet(l, id)}</pre></div>
      )) : (
        <div className="overflow-hidden rounded-lg border bg-console text-console-foreground">
          <div role="tablist" aria-label="Language" className="flex border-b border-console-foreground/10">
            {langs.map((l) => (
              <button key={l} role="tab" aria-selected={lang === l} onClick={() => setLang(l)}
                className={`px-4 py-2 font-mono text-xs ${lang === l ? 'border-b-2 border-primary text-primary' : 'opacity-60 hover:opacity-100'}`}>{l}</button>
            ))}
          </div>
          <pre role="tabpanel" className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">{snippet(lang, id)}</pre>
        </div>
      )}
      <p className="text-xs text-muted-foreground">SDK docs and the one-command parity proof (<span className="font-mono">python -m sdk.interop.demo</span>): <a className="text-primary underline" href={`${REPO_URL}/tree/main/sdk`} target="_blank" rel="noreferrer">sdk/</a></p>
    </section>
  );
}
