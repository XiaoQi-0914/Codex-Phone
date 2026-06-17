# Display Message Refactor Plan

## Goal

Clean up frontend message handling so UI rendering does not depend on fake `codex_event` objects.

Currently, stored assistant history is converted into a fabricated server event:

```ts
{
  type: "codex_event",
  event: {
    type: "item.completed",
    item: {
      type: "agent_message",
      text: message.content
    }
  }
}
```

This works, but it mixes transport protocol, stored history, and UI display state.

## Target Model

Separate the concepts:

- `ServerMessage`: raw WebSocket protocol.
- `StoredDisplayMessage`: SQLite-backed stored message shape returned by backend.
- `DisplayMessage`: frontend-only render model.

The UI should render only `DisplayMessage`.

## DisplayMessage Types

Use explicit frontend message variants:

- `display_user`
- `display_assistant`
- `display_command`
- `display_command_group`
- `display_error`
- `display_notice`
- `display_summary`
- `display_event`
- `display_text`

## Mapping

Add mapping functions in `web/src/App.tsx` first:

- `storedMessageToDisplayMessage`
- `serverMessageToDisplayMessages`

Keep the refactor local to `App.tsx` for now. Do not split files until behavior is stable.

## Command Handling

Real-time command events become `display_command`.

`buildRenderItems` should aggregate consecutive `display_command` messages into one `display_command_group`.

Stored command groups remain `display_command_group`.

## Verification

Run until passing:

```powershell
npx tsc --noEmit
npm run build
```
