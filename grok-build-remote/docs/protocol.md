# Phone ⇄ bridge protocol (v1)

One WebSocket over TLS 1.3 at `wss://<mac>:7443/v1`, with mutual pinned certificates (see the README). Every text
frame is one JSON envelope:

```json
{ "v": 1, "type": "acp", "sid": "<grok session id>", "seq": 1842, "payload": "<raw ACP JSON-RPC string>" }
```

`sid`, `seq` and `payload` are omitted when not used. Unknown fields must be ignored. Binary frames are not used.

## Types

| type | from | sid | payload |
| --- | --- | --- | --- |
| `pair` | phone (unpaired cert only) | – | `{token, name}` |
| `pairing` | bridge | – | `{code}`: 6 digits; the phone checks it equals its own computation |
| `paired` | bridge | – | `{name}` |
| `hello` | phone | – | `{device, appVersion, lastSeq: {<sid>: n}}` |
| `welcome` | bridge | – | `{bridgeVersion, grokVersion, protocol, device}` |
| `sessions.list` | phone | – | optional ACP `session/list` params |
| `sessions` | bridge | – | the ACP `session/list` result: `{sessions: [{sessionId, cwd, title?, updatedAt?}]}` |
| `attach` | phone | yes | `{cwd}` (needed if the bridge doesn't have the session open yet) |
| `session.new` | phone | – | `{cwd, modelId?}`; the session starts in ask mode, or in auto-review under `gbr serve --auto-review` |
| `attached` | bridge | yes | `{from}`: the replay starts after this `seq`; `0` means the whole history, so the phone starts the transcript over |
| `detach` | phone | yes | – |
| `acp` | both | yes | a raw ACP message as a string; bridge → phone also carries `seq` |
| `bridge.status` | bridge | optional | `{code, message}`: `replay_gap`, `agent_exited` |
| `error` | bridge | optional | `{code, message}`: `not_paired`, `revoked`, `refused`, `not_attached`, `attach_failed`, … |
| `ping` / `pong` | phone / bridge | – | – |

WebSocket ping frames go both ways every 20 s; the bridge drops a connection after 60 s of silence.

## Sequence numbers and reconnecting

Every `acp` message the bridge sends for a session gets the next `seq` (1, 2, 3…). The bridge keeps the last 5,000
per session. A phone that reconnects sends `hello` with the last `seq` it saw per session, then `attach` again, and
receives only the messages after that. If some were already dropped, `bridge.status replay_gap` comes first.
Attaching again on the same connection (reopening a session) also continues after the last `seq` the bridge sent.

Besides what the agent sends, the bridge adds one kind of `acp` message: an ACP `session/update`
`user_message_chunk` for each prompt typed in a Grok window, read from Grok's saved history, because the leader
doesn't send other clients the prompt that starts a turn. Prompts the phone sent come back this way too; the phone
drops that echo of its own prompt.

## Flows

**Pair** (unknown client certificate): `pair {token}` → `pairing {code}` → (you type `y` in `gbr pair`) → `paired`.
An unknown certificate can't send anything else.

**Attach to a session open in the terminal**: `attach` → bridge spawns `grok agent --leader stdio`, sends ACP
`initialize` (no client fs/terminal capabilities; `_meta.clientType: "grok-tui"`, so in auto-review a call Grok's reviewer won't allow is asked instead of failing) and `session/load` → `attached` → the history as `acp`
`session/update` notifications → live updates.

**Prompt**: phone sends `acp` with `session/prompt` (numeric `id`) → `session/update` stream (`agent_message_chunk`,
`agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, …) → the prompt's response with `stopReason`.

**Approve**: the agent's `session/request_permission` arrives as `acp` (it has a `method` and an `id`). The phone
answers with `{"jsonrpc":"2.0","id":<same>,"result":{"outcome":{"outcome":"selected","optionId":"…"}}}`. The bridge
forwards an answer only for a request that is still pending. If the terminal answers first, the tool call moves to
`in_progress`/`completed`/`failed` and the phone closes its sheet.

**Stop**: `session/cancel` notification.

## What the bridge refuses from the phone

Any ACP method other than `session/prompt`, `session/cancel`, `session/set_model` and `session/set_mode`;
`session/set_mode` to an auto-approve mode (`yolo`, `auto`, `always`, `bypass`, …); a `sessionId` other than the
envelope's `sid`; request ids starting with `gbr-` (reserved for the bridge); answers to requests the agent didn't
ask; answers to anything but `session/request_permission` (ask-user questions, plan exit and MCP elicitation are
answered in the terminal for now).

A permission answer must be exactly `{"outcome":{"outcome":"selected","optionId":…}}` or
`{"outcome":{"outcome":"cancelled"}}`, with no other fields, and the option must be one the phone may pick: kind
`allow_once` or `reject_once`, and an id and name that don't mention `always`, `auto`, `yolo`, `bypass` or "don't
ask". So `allow_always`, `reject_always`, and Grok's "Yes, and don't ask again for anything (always-approve mode)"
(kind `allow_once`) are refused. The app hides the same options. Each refusal is audited and answered with
`error refused`.
