# Grok Build Remote

Control [Grok Build](https://github.com/xai-org/grok-build) sessions running on your Mac from a native Android app.
You see the same live session as the terminal, send prompts (typed or dictated), approve or reject tool calls, and stop the agent.

**Status: first draft.** The bridge is tested end to end against a fake `grok`, and
[Milestone 0](#milestone-0-check-live-attach-first) passed against real Grok Build 1.0.89: live attach to a session open
in the terminal, and approvals answered from either side. The Android app builds in CI (see
[Build the APK](#build-the-apk)) but hasn't been run on a phone yet.

## How it works

```
 Android phone                         Mac Mini (your user account)
┌──────────────────────┐             ┌─────────────────────────────────────────────────────┐
│ Grok Build Remote    │  wss + TLS  │ gbr bridge ──► grok agent    ──► Grok Build leader   │
│ (Kotlin, Compose)    │◄═══════════►│ (this repo)    --leader stdio        (~/.grok/       │
│ Keystore key         │  mutual,    │  allow list,   (one per session,      leader.sock)   │
│ pinned bridge cert   │  pinned     │  audit log      ACP JSON-RPC)             ▲          │
└──────────────────────┘             │                                           │          │
          inside Tailscale (WireGuard)│               grok --leader in Terminal ──┘          │
                                     └─────────────────────────────────────────────────────┘
```

- `grok agent --leader stdio` is Grok Build's documented [ACP](https://agentclientprotocol.com) entry point, joined to
  the Grok Build *leader* process, which owns the sessions of every client connected to it. A Grok window in the
  terminal is another client of the same leader **only if it runs in leader mode**, which is off by default: start it
  with `grok --leader`, or set it once in `~/.grok/config.toml` (see [setup](#2-grok-build-in-leader-mode)). Then the
  phone and the terminal see the same session. A plain `grok` window runs its session by itself; the phone can still
  open that session from disk, but won't see it live.
- The leader sends permission prompts to **every** connected client. The first answer wins, so you can approve on the
  phone or in the terminal; when the terminal answers, the tool call moves to `in_progress` and the phone closes its
  sheet. A Grok window starts in *auto-review* mode, which approves routine calls without asking anyone, so only the
  calls it doesn't approve reach the phone. Switch to ask mode (`Shift+Tab`) to approve each call yourself.
- Attaching uses ACP `session/load`. The leader replays the history and then streams live updates. Sessions are
  listed with ACP `session/list`.
- Grok Build has a remote control of its own through xAI's servers (`/remote` in a Grok window, or
  `grok agent headless`). In leader mode the leader opens that connection to `code.grok.com` only when one of those is
  used. The bridge never triggers it, and none of the layers below protect it; your xAI account does. To keep the
  phone the only remote way in, don't use `/remote` or `grok agent headless` on this Mac.

Layout:

| Path | What |
| --- | --- |
| `bridge/` | `gbr`, the Mac daemon (Rust). `cargo test` runs unit tests and end-to-end tests against `fake-grok`. |
| `android/` | The app (Kotlin, Jetpack Compose, minSdk 29). |
| `docs/protocol.md` | The phone ⇄ bridge protocol. |
| `.github/workflows/grok-build-remote-ci.yml` (repo root) | CI: bridge tests on Linux and macOS, Android unit tests and debug APK. |

## Security model

The bridge is effectively remote control of your Mac: Grok Build runs commands and edits files. Five layers each stop
a different attacker:

1. **Network.** `gbr serve` listens only on the address you give it, normally the Mac's Tailscale IP, and refuses
   `0.0.0.0` unless you force it. Other devices on your Wi-Fi can't reach it, and nothing is opened on your router.
2. **Mutual TLS, pinned both ways.** TLS 1.3 only. The phone pins the bridge's self-signed certificate fingerprint
   from the pairing QR code. The phone's key is created in the Android Keystore (StrongBox when available) and can't
   be exported. The bridge only accepts certificates listed in `~/.config/gbr/devices.json`. No certificate authority
   is involved.
3. **One-time pairing.** `gbr pair` shows a QR code with a token that works once and expires after 5 minutes. Both
   screens then show a 6-digit code derived from both keys, and the phone is only added when you type `y` on the Mac.
   A swapped QR code or a leaked token shows a different code.
4. **The phone can't widen permissions.** The bridge never turns on Grok Build's auto-approve (`yolo`/`auto` modes).
   It forwards only `session/prompt`, `session/cancel`, `session/set_model`, `session/set_mode` (auto-approve modes
   refused) and answers to permission requests the agent actually asked, and only with a one-time allow or reject:
   options that are remembered ("for this session", "never allow") or that turn on always-approve stay in the
   terminal, whatever kind Grok gives them. The phone can't send `initialize`,
   `session/load` or `session/new` itself, and can't touch a session it isn't attached to. Your Grok Build
   `--allow` / `--deny` / `--sandbox` rules still apply. On the phone, approving a command or a file change needs a
   fingerprint (or screen lock). Dictated text is only ever a prompt.
5. **You can see and stop it.** `~/Library/Logs/gbr/audit.log` records every connection, attach, prompt, approval and
   refusal, without prompt text unless you pass `--log-prompts`. The Mac shows a notification when a phone attaches.
   `gbr stop` closes everything, and `gbr devices revoke <name>` cuts a phone off within 20 seconds.

## Setup

### 1. Tailscale (about 15 minutes, free)

1. Create a Tailscale account (Google, Apple or GitHub sign-in puts you on the free Personal plan).
2. Mac: install the **Standalone** app from tailscale.com/download (not also the App Store version), sign in, approve
   the system extension.
3. Phone: install Tailscale from Google Play, sign in with the same account, accept the VPN prompt.
4. In the Tailscale admin console, **disable key expiry** for the Mac, so it doesn't log out while you're away.
5. Phone: Settings → Network → VPN → Tailscale → **Always-on VPN**, and set Tailscale's battery use to *Unrestricted*.
6. Mac: never sleep, start after power failure, log in automatically (Grok Build and the bridge run in your session).

Android allows one VPN at a time, so another VPN app on the phone would conflict.

### 2. Grok Build in leader mode

So the sessions you open in the terminal can be followed from the phone, turn on leader mode once in
`~/.grok/config.toml`:

```toml
[cli]
use_leader = true
```

(or start each window with `grok --leader`). Leader mode is refused when a Grok Build sandbox profile is on; such a
window keeps its session to itself.

### 3. Bridge on the Mac

```bash
cd grok-build-remote/bridge
cargo install --path .            # puts gbr in ~/.cargo/bin
gbr serve --listen "$(tailscale ip -4):7443" --grok-bin "$(which grok)"
```

### Milestone 0: check live attach first

The multi-client leader is internal to Grok Build, and Grok Build updates itself, so check this again after a Grok
Build update. **Passed on 2026-11-21 with Grok Build 1.0.89.**

1. Start Grok Build in leader mode in a project (`grok`, with `use_leader = true`, or `grok --leader`) and send one
   prompt. Each new window opens a **new** session; its id is in `~/.grok/active_sessions.json`, or
   `grok sessions list --all` (a plain `grok sessions list` only shows labelled sessions from the current folder).
2. In another terminal: `gbr spike --session <id> --cwd <project dir> --grok-bin "$(which grok)"`.
3. You should see the session history, then `session/load OK`. Prompt in the Grok window: its replies stream into the
   spike as `session/update` lines.
4. Press `Shift+Tab` in the Grok window until it is in ask mode, and ask for a file change. The permission prompt shows
   in both places. Answer it in the spike (type its number): Grok goes ahead. Next time answer it in the Grok window:
   the spike prints `>>> permission request answered elsewhere`.

If history shows but live updates don't, check that the Grok window runs in leader mode and that the spike has the
id of the session that window opened.

### 4. Pair the phone

With `gbr serve` running: `gbr pair`, scan the QR code in the app, check the 6-digit code matches, type `y`.
`gbr devices list` shows paired phones.

### Run the bridge at login

Edit `bridge/launchd/com.grokbuildremote.gbr.plist` (your user name, Tailscale IP, path to `grok`), then:

```bash
mkdir -p ~/Library/Logs/gbr
cp bridge/launchd/com.grokbuildremote.gbr.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.grokbuildremote.gbr.plist
```

## Build the APK

CI builds a debug APK on every pull request that touches this folder:

1. Open the PR's **Checks** tab → *grok-build-remote CI* → **Artifacts** → `grok-build-remote-debug-apk`.
2. On the phone: allow installs from your browser or Files app, open the APK.

Or build locally with Android Studio (open `grok-build-remote/android`) or `./gradlew assembleDebug`.

## Roadmap

| Milestone | Scope | State |
| --- | --- | --- |
| M0 Spike | Prove live attach and shared approvals with `gbr spike` | Passed with Grok Build 1.0.89 (needs leader mode) |
| M1 Bridge | TLS server, pairing, allow list, replay buffer, audit, launchd | Drafted and tested against fake-grok |
| M2 App core | Pairing, sessions, live transcript, prompt, Stop | Drafted; not yet compiled |
| M3 Approvals, dictation, notifications | Approval sheet with fingerprint, dictation, foreground service | Drafted; not yet compiled |
| M4 Hardening | Real-device testing, Grok Build update handling, Room cache, app lock | Not started |

## Known gaps (TODO)

- `x.ai/ask_user_question`, `x.ai/exit_plan_mode` and MCP elicitation show "answer in the terminal" on the phone.
- The phone keeps transcripts in memory only; after the app is killed it reloads from the bridge's buffer.
- Sessions the bridge has opened stay open until `gbr serve` restarts (no idle reaping yet).
- Idle/running status in the sessions list is only known for sessions the phone follows.
