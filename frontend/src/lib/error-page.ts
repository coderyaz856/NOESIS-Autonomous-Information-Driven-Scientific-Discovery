/** A static fallback, deliberately free of request or exception details. */
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unable to load · Noesis</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: #101319; color: #f3f5f9; font: 16px system-ui, sans-serif; }
      main { width: min(28rem, calc(100% - 3rem)); }
      h1 { font-size: 1.5rem; font-weight: 600; }
      p { color: #aeb8c7; line-height: 1.6; }
      a { color: #91d4eb; }
    </style>
  </head>
  <body><main><h1>This page didn’t load</h1>
    <p>Something went wrong. Please retry, or return to the home screen.</p>
    <a href="/">Go home</a>
  </main></body>
</html>`;
}
