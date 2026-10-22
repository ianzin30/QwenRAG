# QwenRAG — Frontend

React + Vite + TypeScript frontend for QwenRAG (originally built in the RAG UFC project), rebuilt from the approved HF prototypes
(`ProtoDesktop.dc.html` and `ProtoMobile.dc.html` on the "RAG UFC — Wireframes" canvas).
The Python backend (`../backend`, over rag-ufc-core) keeps all ingestion, retrieval,
reranking and generation. This app only talks to it over HTTP.

> **Status:** the UI is complete and works in **mock mode**. The HTTP adapter matches the
> API implemented in `../backend` ([docs/INTEGRATION.md](docs/INTEGRATION.md)); the contract is
> covered by the backend tests. A run against the live model services is still pending.

## Quick start

Requires Node 18.18+ (developed on Node 24).

```bash
cd frontend
npm install
npm run dev:mock      # demo data in the browser, no backend needed → http://localhost:5173
```

Against the backend (`cd ../backend && uv run python -m qwenrag`):

```bash
cp .env.example .env.local     # set VITE_DEV_PROXY_TARGET=http://127.0.0.1:8000
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server using the HTTP adapter (`VITE_API_MODE=http`) |
| `npm run dev:mock` | Dev server using the in-browser mock adapter |
| `npm run build` | Type-check and build to `dist/` (HTTP adapter; mock code is not bundled) |
| `npm run preview` | Serve the built `dist/` |
| `npm run typecheck` | `tsc -b` only |
| `npm test` | Unit tests (Vitest): SSE parser, turn reducer, highlight helpers |

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_MODE` | `http` | `http` or `mock`. `vite --mode mock` also selects mock. |
| `VITE_API_BASE_URL` | `/api` | Base URL of the Python API. Relative paths work with a proxy. |
| `VITE_DEV_PROXY_TARGET` | — | Dev only: proxies `/api` to the backend to avoid CORS. |

Every `VITE_*` value is baked into the public bundle. **Never put secrets in them.**
Google OAuth and model credentials stay on the server.

### Mock mode demo triggers

- A question containing `#falha` gives a failed turn (shows "Tentar novamente").
- A question containing `#incerto` gives an *unknown outcome* turn (no auto-retry, shows "Atualizar histórico").
- Uploading a file whose name contains `erro` fails extraction for that file.
- Questions mentioning *tranc*, *aproveit*, *PPC/resum/curso* pick the canned answers. Anything else gets the "not found" answer.

Mock answers are illustrative; bracketed values like `[data-limite]` are placeholders, not facts.
Mock mode always shows a small `mock` badge.

## Architecture

```
src/
  app/
    App.tsx                 boot, adapter selection, desktop/mobile switch (≤640px → mobile)
    providers/              ApiProvider · ThemeProvider (light/dark, persisted) · ToastProvider
    store/                  reducer + typed actions (state.ts, reducer.ts) and StoreProvider:
                            the side effects (boot, turn streaming, uploads, deletes)
    layouts/                DesktopShell (sidebar + topbar) · MobileShell (drawer + sheets)
  components/
    icons/Icon.tsx          the prototype's stroke icons + brand mark
    ui/                     Button, IconButton, Dialog/Sheet/Drawer (focus trap, Esc, focus restore), primitives
  features/
    chat/                   ChatView, MessageList, AssistantMessage, AnswerText, PendingTurn, Composer, EmptyState
    sources/                SourceCard (grid / rail), SourceDetail, highlight rendering, citation helpers
    conversations/          ConversationList (search + Hoje/Ontem/Anteriores)
    documents/              FilesPanel, DocumentView (safe Markdown), DeleteDocumentConfirm, window drop hook
    models/                 ModelPicker (popover) + ModelOptionList (shared with the mobile sheet)
    collections/            chips / switches + scope summary
  services/api/
    types.ts                domain contracts (camelCase, UI-owned)
    RagApi.ts               the single interface every adapter implements
    dto.ts                  proposed wire format (snake_case) + mappers
    httpClient.ts           fetch wrapper: base URL, JSON, timeouts, error normalization
    httpAdapter.ts          proposed FastAPI routes, SSE turn stream, XHR upload progress
    sse.ts                  spec-compliant SSE decoder for fetch bodies (POST streams)
    errors.ts               ApiError + user-facing messages
  mocks/                    MockRagApi + fixtures, loaded through a dynamic import in mock mode only
  styles/                   tokens.css (themes) · base · animations · components · layout
```

**Data flow:** components read state with `useAppState()` and call `useActions()`.
Only `StoreProvider` and `DocumentView` (document content) talk to the `RagApi`.
Components never call `fetch` themselves.

### Prototype → React map

| Prototype (`.dc.html`) | React |
| --- | --- |
| `{{value}}` holes | JSX expressions |
| `<sc-for>` | `.map()` with stable keys (message ids, `sourceId`, document ids) |
| `<sc-if>` | conditional rendering |
| `DCLogic` state + `setTimeout` simulation | reducer + stream-driven actions. Timers only exist in `mocks/` |
| `.th` / `.th.dark` CSS vars | `:root` / `:root[data-theme='dark']` in `tokens.css` |
| keyframes `rise/fade/pop/expand/up/slide` | `animations.css`, same durations and easing |
| Desktop inline sources (grid + expanded panel) | `SourceCard variant="grid"` + `SourceDetail` |
| Mobile carousel + bottom sheet | `SourceCard variant="rail"` + `Sheet` + the same `SourceDetail` |
| Model popover / model sheet | `ModelPicker` / `ModelOptionList` in a `Sheet` |
| Collection chips / switch sheet | `CollectionChips` / `CollectionSwitchList` |

### Deliberate differences from the prototypes

These were needed to make the prototypes work as a real app, or for accessibility. Visually they stay close to the originals.

1. **Dark-mode accent is `#8EA2FF` instead of `#3355FF`.** The prototype's blue on the dark background is about 3.3:1 contrast, which fails WCAG for citation numbers. Light mode keeps `#3355FF`.
2. **Switching conversations no longer waits for an answer to finish.** Each conversation keeps its own turn state, so you can switch while an answer streams. The answer finishes in the background, and a toast ("Resposta pronta em …") tells you when it's done. The prototype (and Streamlit) blocked switching.
3. **A stop button replaces "send" while an answer streams.** It cancels on the client and calls the optional `cancelTurn` on the server.
4. **Failure, unknown-outcome and cancellation notices** come from the Streamlit flow (`Turns.run`), styled like wireframe 02-D.
5. **The mobile "Abrir doc" opens the real document view** instead of a toast.
6. **A new conversation is created on the server with its first question.** "Nova conversa" opens the empty state, so empty conversations aren't stored.
7. **Inline citations are built from `claims`** (one marker after each claim, numbered by source order) instead of hard-coded segments.

## Security notes

- Answer text, excerpts and highlights are rendered as React text nodes. No `dangerouslySetInnerHTML` anywhere.
- Document Markdown goes through `react-markdown` with `skipHtml`. Raw HTML in a document is dropped, and unsafe URLs are stripped by its default `urlTransform`. GFM (`remark-gfm`) is enabled because spreadsheets are ingested as Markdown tables.
- Uploads are checked on the client for type and size, using limits from `/config`. The server must enforce them as well.

## Known limitations

See the end of [docs/INTEGRATION.md](docs/INTEGRATION.md#not-connected-yet).
