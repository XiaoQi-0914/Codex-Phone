# Session DB Implementation Plan

## Goal

Upgrade Codex Phone from a single in-memory chat to:

- SQLite-backed session metadata and message history.
- Single project with multiple sessions.
- Explicit Codex `thread_id` per session.
- No more `codex exec resume --last`.
- Historical messages visible after refresh.

## Scope

Implement now:

1. Add SQLite via `better-sqlite3`.
2. Store database at `data/codex-phone.db`.
3. Create tables:
   - `projects`
   - `sessions`
   - `messages`
   - `runs`
4. Seed the configured project into `projects`.
5. Maintain one active session.
6. Add create/select session over WebSocket.
7. Send `sessionId` with run events.
8. Save display-worthy history:
   - user messages
   - assistant final messages
   - command groups
   - errors/notices
   - useful run summaries
9. Do not save noisy/internal events:
   - `thread.started`
   - `turn.started`
   - `turn.completed`
   - `web_search`
   - non-useful git summaries
10. Refactor `runCodex`:
    - use `threadId: string | null`
    - save `thread.started.thread_id`
    - resume with `codex exec resume <threadId>`
11. Keep existing permission mode dropdown.
12. Keep existing runId stale-run protection.

## Out of Scope

Do not implement now:

- Multiple projects UI.
- Delete/rename sessions.
- Full raw JSONL event archive.
- Terminal/PTY mode.
- Authentication or pairing.
- Cloud relay.

## Verification

Run until passing:

```powershell
npm install
npx tsc --noEmit
npm run build
```

If `npm run build` fails because of environment-specific Vite/esbuild access, diagnose and fix if it is project-related. If it is external environment access only, document it clearly.
