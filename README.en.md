# WeMod Script Author · Skill Pack

> Turn a one-line requirement into an automation script JSON that **imports and runs as-is**. This pack is **self-contained with zero source-code dependency** — you can write scripts, run offline validation and ship working output without the project source.
>
> Language: [English](README.en.md) | [中文](README.md)
>
> License: [MIT](LICENSE)

## What this is

A **skill pack** for AI assistants (Reasonix / Claude Code and other tools that understand `SKILL.md`), distilled from the real implementations of the three engines in the WeMod Android automation project. Field names, enum values and semantics are **fully embedded** in `SKILL.md` — they are not links into the source tree.

| Engine | Coverage |
|---|---|
| Action model | 22 node kinds, all action types (key injection, Shell command, screenshot, AI vision / reply / agent included), `ActionConfig`, condition model, `NodeSelector`, virtual controls, full enum sets |
| Variable engine | Variable scopes, expression syntax with 100+ built-in functions, field resolution rules |
| Execution engine | Lifecycle, control-flow semantics, soft / hard failures, run requirements, events, JS APIs |

Field names and enum values were verified one by one against the source. Traps of `.axs` import (which uses strict JSON — e.g. `consoleVariables[].defaultValue` must be a string) are already baked into the validator.

## Three ways to use it

1. **As an AI skill (recommended)** — drop the whole directory into your skills folder (for Reasonix: `.reasonix/skills/wemod-script-author/`), then ask your assistant to "use wemod-script-author to write …";
2. **As a manual** — read `SKILL.md` directly (§0 boundaries, §3 action table, §4 variables, §7 self-check list) and write scripts by hand;
3. **Validator only** — `node tools/validate-script.mjs your-script.axs` for an offline pre-check.

## Repository layout

```
wemod-script-author/
├── SKILL.md                    # main skill: five-step delivery flow + full model manual + self-check list (self-contained)
├── examples/                   # importable, complete samples (each one must pass the validator below)
│   ├── auto-douyin-skin-001.axs       # like/save by skin-tone check: vision condition + jumpTargetOnFail
│   ├── auto-quiz-answer-001.axs       # auto quiz answering: subflow_def reuse
│   ├── vision-loop-retry-001.axs      # vision loop with retry: wait_for_vision + outputs to variables + events.onTimeout jump
│   ├── branch-conditions-001.axs      # branches and loops: if + condition groups (ALL / N_OF) + var_switch + while_var + while_vision
│   ├── notification-trigger-001.axs   # notification trigger: run a subflow when a matching notification arrives
│   └── window-trigger-001.axs         # window trigger: run when the target window appears
├── tools/
│   └── validate-script.mjs     # offline validator (runs on node; no Android / source needed)
└── .github/workflows/
    └── validate-examples.yml   # CI: keeps every sample green, and smoke-tests the validator's failure path
```

## Quick start

```bash
# 1) smoke-test the pack (should print "校验通过" / passed)
node tools/validate-script.mjs examples/auto-douyin-skin-001.axs

# 2) validate your own script
node tools/validate-script.mjs your-script.axs
#    checks: JSON syntax / required fields / enum values / reference integrity / consoleVariables types

# 3) ship it to the phone
#    The script itself is JSON: rename it to .axs and open it with a file manager (or import inside the app)
#    for a FULL import that keeps console variables / settings / virtual controls.
#    Note: "paste JSON" in the editor only inserts nodes and drops top-level settings — full import must go through .axs.
```

## Exit codes of the validator (for scripting / CI)

| Code | Meaning |
|---|---|
| `0` | passed |
| `1` | validation errors (JSON syntax, required fields, enums, references, types) |
| `2` | wrong usage (missing file argument) |

## Version and model baseline

- Data baseline: model snapshot **2026-09-16** (calibration notes are at the top of `SKILL.md`).
- If the app on your phone is a different version: **import one of the samples first as a smoke test**; when in doubt, **the model inside the app wins**.
- Maintainer flow: after editing `SKILL.md`, run `node tools/validate-script.mjs examples/*.axs` (one file at a time) and make sure everything is green before committing. CI does the same on every push.

## Maintainers: sync from the project

This repository is the **public release** of the skill pack that lives inside the WeMod project (the only difference: three ticket-grabbing / order-snatching samples are removed here). After the project-side `SKILL.md` or validator changes, run this **inside this repository**:

```bash
node tools/sync-from-project.mjs                 # default source: the in-project skill directory
node tools/sync-from-project.mjs --dry-run       # show what would change, write nothing
node tools/sync-from-project.mjs --project <dir> # use another in-project skill path
```

What it does:

- **Overwrites** `SKILL.md` and `tools/validate-script.mjs`, and mirrors `examples/*.axs` (excluding the ticket-grabbing samples);
- Extra samples on this side are **reported, never deleted automatically**;
- Then it self-checks that **no public document references an excluded sample** (a dangling reference exits non-zero) and re-validates every sample;
- **Never touches** `README*`, `LICENSE`, `.gitignore`, `.github/` — those are specific to this repository.

## Contributing

Issues and PRs are welcome: add fields, fix semantics, contribute samples. **Every new sample must pass `tools/validate-script.mjs`.**

## Disclaimer

This pack only provides knowledge and tooling for *writing* automation scripts. You are responsible for ensuring that your scripts comply with the terms of service of the target platform and with the laws of your jurisdiction. Any consequences of using this pack are borne by the user.

## License

[MIT](LICENSE)