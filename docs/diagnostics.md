# Debug Diagnostics

The mobile client always records diagnostic sessions in SQLite; there is no switch to turn recording off. One session is one app launch (process start to exit). It keeps the most recent **three launches** and prunes older ones on the next launch, so the default feedback attachment contains the last three rounds. A session leaves the device only as part of a feedback submission: About > **Send feedback** attaches all retained launches when the **Attach diagnostic log** switch is on (it defaults to on). It never uploads credentials, message bodies, or raw Cohub IDs.

## Ingest contract

Uploads go to [cfeed](https://github.com/netaart/cfeed) at `config.diagnosticsOrigin` (default `https://cfeed.neta.art`, overridable with `EXPO_PUBLIC_DIAGNOSTICS_ORIGIN`), app slug `cohub-mobile`.

`POST /api/v1/feedback` is sent as `multipart/form-data` whenever files are attached (the session copy and/or the user's files). A text-only report with the log switched off is sent as JSON.

| Field | Value |
|---|---|
| `app` | `cohub-mobile` |
| `content` | The user's feedback description |
| `extra` | JSON: `app_version`, `platform`, `os_version`, `device_model`, `runtime_version`, `update_id`, `include_log`, `attachment_count`, and — when the log is attached — `session` (`id`, `started_at`, `events`, `dropped`) plus `launches` (`id`, `started_at`, `ended_at`, `events`, `live`) |
| `files` | Zero or more: `cohub-diagnostics.jsonl` (`text/plain`, up to three launches as `cohub-diagnostics-v2` JSON Lines) followed by the user's screenshots, recordings, or documents |

The log and up to four user attachments share cfeed's five-file limit; with the log off, five attachments fit.

cfeed accepts only `app`, `content`, `extra`, and `website` as top-level fields; anything app-specific belongs in `extra` and is filterable as `x.<path>` (for example `x.platform=android`, `x.device_model=Pixel 8`, or `x.session.id=...`).

Every request sets a custom `User-Agent` so cfeed's UA parser can identify the client:

```text
CohubMobile/2.2.21 (Android 14; Pixel 8; Mobile)
CohubMobile/2.2.21 (Android 14; Pixel Tablet)
CohubMobile/2.2.21 (iPhone; iOS 18.0)
CohubMobile/2.2.21 (iPad; iOS 18.0)
```

Without it Android sends `okhttp/4.x`, which cfeed classifies as a bot, and iOS hides the device type. `device_model` in `extra` is the same model name for direct filtering.

The response must be `2xx` with `{ "id": "<ulid>" }`. The id is shown back to the user as a receipt and recorded as `diagnostics.upload.completed`.

The client writes the combined launches to the cache directory, uploads the file with the request, and deletes it in the same call; no log file is kept on the device. The endpoint enforces rate limiting and app status; the mobile app carries no write secret because mobile bundle secrets are extractable.

### File format

The first line is a `cohub-diagnostics-v2` header with `startedAt`, `launches`, and `events`. Each launch then starts with a `cohub-diagnostics-v1` header (`launch`, `sessionId`, `startedAt`, `endedAt`, `dropped`, `events`) followed by one JSON object per event:

```json
{"at":"2026-10-19T09:12:03.412Z","t":18422,"name":"ui.touch.end","surface":"chat/:id","screen":"s4","kind":"tap","x":212,"y":644,"dx":3,"dy":2,"distance":4,"durationMs":92,"target":381}
```

`t` is milliseconds since the launch started. The live launch is flagged `"staged": true` in its header. The oldest events are dropped when a launch reaches 12,000 events, and the file is capped at 8 MB with the newest launch kept first (`truncated: true`).

The feedback POST itself is excluded from the network log, so a submitted file never describes its own upload.

## Event rules

Use namespaced events. The client records, at minimum:

```text
app.ready / app.lifecycle     startup timing and foreground/background changes
app.memory                    total device memory and ABI count
auth.environment / auth.sign_in
diagnostics.session.started    launch, device, screen, locale and update metadata
ui.screen                      route + screen ordinal whenever navigation settles
ui.touch.start/move/end        coordinates, target, duration, direction, speed, path bounds
ui.tap                         tap/long-press summary (including blank-space taps)
ui.action                      labelled control presses (buttons, rows, menus, composer)
ui.input                       composer length, line count and selection (never text)
ui.keyboard / ui.dimensions    keyboard frames and window/orientation changes
ui.scroll / chat.list.*        offsets, content/viewport sizes, velocity, drag and momentum
ui.dialog / ui.toast           sheets, menus and notices
net.request/response/error     method, redacted endpoint, query keys, status, duration, byte/shape metadata
net.response.error             sanitized error code, type and message
net.upload                     native attachment uploads (size, MIME, method, duration, status)
net.realtime                   websocket state transitions and event types
console.warn/error             app warnings and errors
error.uncaught / error.unhandled_rejection
chat.stream.*                  subscribe, seed, lifecycle, finalize, out-of-sync and errors
update.check / update.apk.*   in-app update checks, downloads, verification and handoff
update.channel.*              OTA channel switches
```

Geometry fields may include composer, bubble, marker, keyboard, and scroll frames. Message, Chat, Space and turn identifiers are recording-local aliases; route params are reduced to `:id`. Event payloads must not contain message text, assistant output, file paths, image bytes, access tokens, authorization headers, or presigned URLs. Free-form strings have bearer tokens, JWTs, UUIDs and email addresses redacted. Network requests log paths, query keys, body byte counts and JSON/form field **names**, never values. Fields whose names look like content, titles, tokens, or bodies are stripped before storage, and cfeed never exposes submitted data publicly.

## Local verification

The client can be tested against a local cfeed by pointing `EXPO_PUBLIC_DIAGNOSTICS_ORIGIN` at it, exercising a flow, and inspecting the `debug_sessions` and `debug_events` tables in `cohub-mobile.db`. Upload failures must not affect chat sending or navigation.

## Retention and upload scope

A session is one app process lifetime; a relaunch starts a new one and marks the previous session closed when it is next read. The newest `SESSION_RETENTION` (3) launches are kept and the rest pruned at session start. A submission attaches up to those three launches in one file, newest first; a live launch with no activity beyond its start markers is omitted so the previous useful launch is included instead. The chat scroll trace stays opt-in: it records only while the Scroll Diagnostics screen's Recording switch is on, and its events are written to the current session alongside the always-on interaction log.
