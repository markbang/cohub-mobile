# Skill Sources

## Expo Skills Source

- Repository: https://github.com/expo/skills
- Pinned commit: `d0075ffa09928f1edb3e7ac4f5af07586d4b344d`
- Source directory: `plugins/expo/skills/`
- Installed skills: `expo-router`, `expo-animation`, `expo-design-system`, `expo-upgrade`
- Local modifications to skill directories: none. Full directories include references, recipes, and agent metadata.
- License: upstream root MIT license in `EXPO-SKILLS-LICENSE`; the animation directory also retains its own `LICENSE`.

## Maintenance

These are repository-local snapshots, not a plugin installation or a submodule. Update only when requested: review the upstream diff from the pinned commit, replace the selected directories in full, retain license files, and record the new commit here. Verify file equality against that checkout and check bundled reference paths after updating.

Project-specific usage boundaries live in the root `AGENTS.md`; keep them there rather than editing upstream skill files. The selection rationale is in `docs/expo-skills-assessment.md` at the repository root.

## cfeed Source

- Repository: https://github.com/netaart/cfeed
- Pinned commit: `74092f1ad2d691120c35f84dc359c6b9ccaa195d`
- Source: `skills/cfeed/SKILL.md`, served at https://cfeed.neta.art/skill.md. The older `/skills.md` path is now a 404.
- Installed skill: `cfeed`, unmodified; the upstream MIT license is in `cfeed/LICENSE`.
- The local `feedback` skill adds the Cohub Mobile resolution workflow and is not upstream.

Update only when requested: replace `cfeed/SKILL.md` and `cfeed/LICENSE` from the pinned commit, then recompute the `cfeed` entry in `skills-lock.json`.
