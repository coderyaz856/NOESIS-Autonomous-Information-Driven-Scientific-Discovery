# Noesis polish + Meta Model API identity

## 1. Meta Model API labels (always shown, per your choice)
- Timeline: a pill "Powered by Meta Model" (deep blue to cyan) next to the Insight Agent and Analysis Agent names.
- While an agent is working: the spinner becomes pulsing text "Meta Model API synthesizing evidence...".
- Report: a footer under "Measured findings" and "Next decision": "Reasoning and hypothesis generation executed via Meta Llama / Meta Model API."
- PDF: first-page header "Orchestrated by Omnigent | Powered by Meta Model API".
- Note: these are fixed labels. They are only accurate if your lab really calls Meta Llama for these agents.

## 2. Visual polish
- Frosted-glass cards and detail panels with a faint glowing 1px border.
- Fonts: Geist for text, JetBrains Mono for every number (AUROC, Compute saved, intervals). Fraunces headings replaced by Geist for a sharper SaaS look.
- Timeline: a softly glowing line that flows from one step to the next when work passes between agents (off for people who prefer reduced motion).
- Charts: high-contrast neon colours (pink for baseline, cyan for intervention) on the dark background.

## 3. Constraints
- Same single page (Question, Live run, Report). No invented data; recording/lab data only.
- Checked on desktop and phone width, accessibility scan re-run, PDF re-exported.

## Technical details
- Tokens in `src/styles.css`: `--gradient-meta`, `--glass`, `--glow-border`, `--chart-neon-pink`, `--chart-neon-cyan`; `@utility glass`, `@keyframes trace-flow`.
- Fonts via `<link>` in `__root.tsx` (Geist, JetBrains Mono); update `--font-sans/--font-mono/--font-display`.
- New `MetaBadge`, `MetaThinking`, `MetaFooter` in `parts.tsx`; used in `Workspace.tsx` timeline and `Report.tsx`; print header in the print layout.
- `charts.tsx` series colours switched to neon tokens; print keeps darker equivalents for contrast.
