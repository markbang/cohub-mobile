---
name: action-ui-compare
description: Publish an iOS-vs-Android UI comparison report from the UI Snapshots GitHub Actions runs and record it in the `ui-compare` Cohub App. Use after dispatching or finishing `ui-snapshots-ios.yml` / `ui-snapshots-android.yml` runs while debugging UI, or when asked for a shareable comparison page.
---

# Action UI compare

Every comparison of a pair of UI Snapshots runs becomes a public report page plus one entry in the registry. The `ui-compare` App lists the registry, so the history stays in one place. How the capture itself works (inputs, secrets, screens, recordings) is in `docs/ui-snapshots.md`.

## 1. Get two finished runs

Reuse finished runs when they already cover the change. Otherwise, dispatch both workflows on the branch with the same inputs, using the commands in `docs/ui-snapshots.md`, then take the newest run IDs:

```bash
gh run list -R markbang/cohub-mobile --workflow ui-snapshots-ios.yml --branch <branch> -L 1 --json databaseId,status,headSha
gh run list -R markbang/cohub-mobile --workflow ui-snapshots-android.yml --branch <branch> -L 1 --json databaseId,status,headSha
gh run watch <run-id> -R markbang/cohub-mobile --exit-status
```

Done when both runs are `completed`. A failed run still publishes the screens it uploaded, and the App marks the report as not fully green. If only one platform changed, you can pair a fresh run with the other platform's latest run on another commit. The report shows both commits.

## 2. Publish

From the repository root:

```bash
node .agents/skills/action-ui-compare/publish.mjs --ios <ios-run-id> --android <android-run-id> --note "<what this run checks>"
```

The script downloads both artifacts, pairs them with `scripts/ui-snapshots.mjs compare` (which aligns the recordings), renders `report.html`, uploads the report to `ui-compare/<id>/` in the Space's public files, and prepends an entry to `ui-compare/reports.json`. Write the note as a single line naming the change or the PR. Use `--dry-run` to build under `dist/ui-compare/<id>/site` without uploading.

Done when the output ends with `Report: <url>` and `Registry: … (N reports)`, and the report URL returns HTTP 200.

## 3. Hand off

Reply with the report URL and the App URL, https://cohub.live/bangwu/cohub-mobile/w/ui-compare. Name the screens that appear on only one platform (the `compare` output lists them), because those screens are missing from the report.

## Reference

- **Public by design.** Reports and the registry are world-readable, and the repository is public. Only the PNG and MP4 captures go up. Maestro logs and `commands.json` can carry typed credentials, so they never leave `dist/`.
- **Registry** `ui-compare/reports.json` is `{ "reports": [entry] }`. An entry holds `id`, `url`, `date` (the later run's start), optional `note`, `runs.{ios,android}.{id,sha,branch,conclusion,createdAt}`, `themes`, `screens`, and `motions`. The script reads the registry before writing it and stops if the registry cannot be read. Two publishes running at once can drop an entry, so publish one at a time.
- **Report template** `report.html`: the labels for known screens and recordings live in `GROUPS` and `MOTIONS`. A new `SCREENS` or `MOTIONS` entry in `scripts/ui-snapshots.mjs` still renders under "Other screens" with its file name. Add a zh/en label here when the screen is permanent.
- **App** `app/index.html`: a static directory App (id `5b8ac1db-872d-4d0f-a199-3a0cf8d6abc5`) that fetches the registry at runtime. A new report needs no App release. After you edit the App source, release it with `cohub apps publish-version 5b8ac1db-872d-4d0f-a199-3a0cf8d6abc5`.
- **Retention.** The run artifacts expire after 7 days. Published reports do not expire.
