# Usability walkthrough — Noesis workspace

Run against the preview with Playwright at 1280×1000 (desktop) and 390×844 (mobile). The recording used here was a **test fixture injected only during the walkthrough**. It is not shipped and its numbers are not results. Screenshots are in `docs/walkthrough/`.

| # | Task | Expected | Observed | Issue / fix |
|---|---|---|---|---|
| 1 | Understand what Noesis does from the first screen | One-sentence promise, question box, examples | Headline, question box, 4 pre-registered examples, note on what "falsifiable" means (`d_1ask.png`) | The send button is disabled until 10 characters are typed |
| 2 | Ask a question with no lab connected | Clear note that a recording plays instead | RECORDED DEMONSTRATION badge plus a banner quoting the visitor's own question (`d_2run.png`) | — |
| 3 | Follow the live flow | See which agent acts, what it did, and the status | Timeline with agent, action type, status chip; current step highlighted; a failed tool call shows "Failed" (`d_3report.png`) | — |
| 4 | Read the report and judge the evidence | Six sections; inconclusive is not shown as success | A "supported" verdict whose interval crosses zero is shown as **inconclusive** (`d_3report.png`, `m_3report.png`) | — |
| 5 | Learn what a metric means | Plain explanation and documented formula | The dialog quotes the formula and links to the source document (`m_4explain.png`) | — |
| E | No lab and no recording | Honest empty state | "No lab is connected and no recording is available yet" with next steps (`empty_2run.png`) | — |
| F | Lab address doesn't answer | Failure explained, with a recovery path | "Could not reach the lab" with Try again and Open recording buttons | — |

## Accessibility (axe-core 4.10, WCAG 2 A/AA + best practice)
- Desktop and mobile, start and report screens: 0 violations. The missing top-level heading on the run screen was fixed by making the pinned question the page heading.
- Status always pairs an icon with text. Live timeline updates are announced politely. Tap targets are at least 44px. Animations are disabled when reduced motion is requested.

## Not yet verified
- A real live run, because no lab with the start-a-run endpoint is reachable from the preview.
- A real recording, which is waiting on `public/recordings/demo.json`.
