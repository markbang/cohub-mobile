# Debug Diagnostics

The mobile client always records diagnostic sessions in SQLite; there is no switch to turn recording off. It keeps the most recent sessions and prunes older ones on the next launch, and it uploads only one session at a time: when a user submits feedback, or when they choose **Upload diagnostic log** in About. It never uploads credentials, message bodies, attachment bytes, image data, or raw Cohub IDs.

## Ingest contract

Uploads go to [cfeed](https://github.com/netaart/cfeed) at `config.diagnosticsOrigin` (default `https://cfeed.neta.art`, overridable with `EXPO_PUBLIC_DIAGNOSTICS_ORIGIN`), app slug `cohub-mobile`.

`POST /api/v1/feedback` is sent as `multipart/form-data` because the session travels as a file:

| Field | Value |
|---|---|
| `app` | `cohub-mobile` |
| `content` | The user's feedback description, or a fixed line for a log-only upload |
| `extra` | JSON: `app_version`, `platform`, `os_version`, `runtime_version`, `update_id`, `source` (`feedback` or `diagnostics`), and `session` (`id`, `started_at`, `events`, `dropped`) |
| `files` | One `text/plain` attachment: the session as `cohub-diagnostics-v1` JSON Lines |

cfeed accepts only `app`, `content`, `extra`, and `website` as top-level fields; anything app-specific belongs in `extra` and is filterable as `x.<path>` (for example `x.platform=android` or `x.session.id=...`).

The response must be `2xx` with `{ "id": "<ulid>" }`. The id is shown back to the user as a receipt and recorded as `diagnostics.upload.completed`.

The client writes the attachment to the cache directory, uploads it, and deletes it in the same call; no log file is kept on the device. The endpoint enforces rate limiting and app status; the mobile app carries no write secret because mobile bundle secrets are extractable.

## Event rules

Use namespaced events such as:

```text
app.foregrounded
app.backgrounded
chat.send.pressed
chat.send.optimistic_bubble_layout
chat.send_transition.source_measured
chat.send_transition.target_measured
chat.queue.state
```

Geometry fields may include composer, bubble, marker, keyboard, and scroll frames. Message and turn identifiers must be recording-local aliases. Event payloads must not contain message text, assistant output, file paths, image bytes, access tokens, or authorization headers. Fields whose names look like content, titles, tokens, or bodies are stripped before storage, and cfeed never exposes submitted data publicly.

## Local verification

The client can be tested against a local cfeed by pointing `EXPO_PUBLIC_DIAGNOSTICS_ORIGIN` at it, exercising a flow, and inspecting the `debug_sessions` and `debug_events` tables in `cohub-mobile.db`. Upload failures must not affect chat sending or navigation.

## Retention and upload scope

A session is one app process lifetime; a relaunch starts a new one and marks the previous session closed when it is next read. The newest `SESSION_RETENTION` sessions are kept and the rest pruned at session start. Both uploads send only the most relevant session: the live one when it captured activity beyond its start markers, otherwise the most recent stored session (typically the frozen session that a relaunch shadowed). The chat scroll trace stays opt-in: it records only while the Scroll Diagnostics screen's Recording switch is on, and its events are written to the current session.
