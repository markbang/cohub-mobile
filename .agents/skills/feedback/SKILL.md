---
name: feedback
description: Resolve feedback reports for Cohub Mobile end to end. Use when asked to list or triage cfeed feedback, reproduce a reported bug, implement and verify the fix, or close a report with its Cohub session and GitHub commit links.
---

# Feedback reports

Reports from About > Send feedback go to [cfeed](https://github.com/netaart/cfeed) under the `cohub-mobile` app slug. The `cfeed` skill (`.agents/skills/cfeed/SKILL.md`) documents the HTTP API. This skill is the repository workflow: find the report, verify the cause, fix it, and close the report with evidence.

## Credentials

Read `CFEED_BASE_URL` (default `https://cfeed.neta.art`) and `CFEED_KEY` from the environment. Never print the key, commit it, or move it into an `EXPO_PUBLIC_*` variable. If `CFEED_KEY` is missing, ask the user; do not guess a key or use another app's key.

## 1. Read the report

List open reports for this app:

```bash
curl -s -H "Authorization: Bearer $CFEED_KEY" \
  "${CFEED_BASE_URL:-https://cfeed.neta.art}/api/v1/feedback?app=cohub-mobile&status=open&limit=50"
```

Read one report, including attachment metadata, with `GET /api/v1/feedback/{id}`. Download an attachment only when it is needed for diagnosis (`GET /api/v1/attachments/{id}`).

Use the report before touching code:

- `content` is the reporter's description.
- `extra` carries `app_version`, `platform`, `os_version`, `device_model`, `runtime_version`, `update_id`, `include_log`, and the diagnostics `session`/`launches` summary.
- `extra.session` is a diagnostics launch, not a Cohub conversation. Do not call it a Cohub session.
- The attached `cohub-diagnostics.jsonl` records the launch, screen, interaction, and redacted network events. Compare the reported build and platform with the current source before assuming the bug still exists.
- `x.<path>` filters can narrow a backlog, for example `x.platform=android` or `x.app_version=2.2.21`.

If the report is not actionable (missing steps, a question, a duplicate), say why and leave it open. Never mark a report resolved without a verified fix or an explicit product decision.

## 2. Verify and fix

Follow the root `AGENTS.md`. Reproduce on the reported platform when the environment permits; for native-only behavior state that browser checks prove nothing. Preserve unrelated behavior and keep the change inside the reported scope.

Run the checks that cover the change:

- `npm run lint`
- `npm run typecheck`
- `npm run test:workflow` when chat workflow or state transitions change
- `npm run check` before PR handoff when the environment permits

Record loading, empty, error, and reconnect behavior actually checked. Distinguish pre-existing failures from regressions.

## 3. Collect the links

**Cohub session.** In a Cohub sandbox the current session is identified by `COHUB_SPACE_ID` and `COHUB_SESSION_ID`:

```text
https://cohub.live/spaces/$COHUB_SPACE_ID/sessions/$COHUB_SESSION_ID
```

Use the live values; do not invent an ID. If either variable is unset, the work is not running in a Cohub session: ask the user for the session URL and omit the line when none exists.

**Commit.** Commit only when the user asked for a commit or the task includes delivery. Use a Conventional Commit message, then record the full SHA:

```bash
git rev-parse HEAD
gh repo view --json url -q .url   # <repo-url>/commit/<sha>
```

If the fix is not committed, omit the commit line and say the change is uncommitted. Do not imply a release: an OTA or store update may not have reached the reporter. Mention the first build that contains the fix only when it is known from `docs/releasing.md` or the user.

## 4. Close the report

`PATCH /api/v1/feedback/{id}` returns the updated item:

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $CFEED_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "status": "resolved",
    "note": "Fixed: <one-line summary>\nCohub session: <session-url>\nCommit: <commit-url>"
  }' \
  "${CFEED_BASE_URL:-https://cfeed.neta.art}/api/v1/feedback/<id>"
```

- Keep the note short and internal; include the diagnosis, the session, the commit, and the release/build only when true.
- Do not paste reporter text, message content, tokens, file paths, or personal data into the note.
- Omit `tags` unless the user asked for them. `tags` replaces the whole array, so send the existing tags plus the new one.
- `status: "spam"`, `status: "open"`, and `DELETE` are explicit user decisions. Do not delete or mark spam on your own.

Report back the item id, status, and the linked evidence.
