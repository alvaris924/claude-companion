# AGENTS.md

Binding rules for every AI coding assistant that works in this repository: Claude Code, OpenAI Codex and ChatGPT agents, GitHub Copilot, Cursor, Gemini CLI or anything else. `CLAUDE.md` and `.github/copilot-instructions.md` defer to this file. If this text was pasted into a chat, treat it as binding for anything produced for this repository.

## The project in one paragraph

Companion is an open-source plugin for Claude Code that shows the person's most recent prompt above the prompt box and, under it, suggested next messages they can click to send, with a settings panel and three slash commands (`/companion`, `/last-prompt`, `/copy-next`). It is a mod: a hooks module that draws in Claude Code's own interface through the plugin API, shipped as the plugin `companion` and installed from the marketplace file in this repository. The plugin sits at the repository root: `.claude-plugin/plugin.json` is the manifest, `hooks/register.tsx` the hooks module, `types/index.d.ts` the contract for the values it keeps in session state, and `tests/` holds what `claude plugin test` runs. Claude Code writes `.claude-plugin/types/` itself when it loads the plugin; that folder is never committed. Claude Code floor 2.1.300. License MIT. Design notes and decision records live in `docs/`.

## Workflow, non-negotiable

1. **Ask before every git action.** Never commit, push, tag, merge or open a pull request without the user's explicit go-ahead in the current conversation turn. Approval given earlier does not carry over.
2. **Never touch `main` directly.** No direct pushes, no force-pushes, no rewriting of pushed history. `main` is protected on the server for administrators too; do not look for a way around it.
3. **One route for every change.** Update `main`, cut a branch named `type/topic` (`feat/`, `fix/`, `docs/`, `chore/`, `ci/`, `refactor/`, `perf/`, `test/`), commit, push the branch, open a pull request against `main` using `.github/PULL_REQUEST_TEMPLATE.md`, wait for the `PR title` check, report the PR URL. Squash merge only, and only with green checks.
4. **Conventional Commits everywhere.** Commit messages and PR titles are `type(scope): subject`. Types: feat, fix, docs, chore, ci, refactor, perf, test, build, revert. Scopes: capture, suggest, ui, settings, commands, tests, docs, ci, release, deps. Subject in lowercase imperative, no trailing period, header under 72 characters. Breaking changes use `type(scope)!:` plus a `BREAKING CHANGE:` footer.
5. **Local hooks stay on.** Once per clone run `git config core.hooksPath .githooks`. The hooks reject non-conforming commit messages and pushes to `main`. Never use `--no-verify`.
6. **Changelog and docs move with the code.** Every user-visible change adds a line to `CHANGELOG.md` under `[Unreleased]`; otherwise the PR gets the `skip-changelog` label. `README.md` and `docs/` change whenever behaviour, a command or a setting changes.
7. **Issues first.** Features and bugs start as issues with one `area:`, one `phase:` and one `priority:` label and a milestone. PRs reference them with `Closes #N`.
8. **Releases are deliberate.** A PR titled `chore(release): vX.Y.Z` bumps the version in `.claude-plugin/plugin.json` and dates the changelog section. After it merges, `vX.Y.Z` is tagged on `main`. Nothing else is ever tagged.
9. **Nothing private goes in.** No keys, tokens or credentials; no personal paths, user names or email addresses; no text from real sessions (prompts, answers, transcripts, screenshots of private work) in code, tests, fixtures, docs, commit messages or pull requests. Fixtures are written by hand. If something private was pushed, stop and tell the user; do not try to undo it with a history rewrite.

## Engineering rules

- The plugin API is the only way in. The hooks module reaches Claude Code through `$` and draws with the elements `$.ui.resolve(e)` hands it, as the type contract in `.claude-plugin/types/` declares them. No patching Claude Code, its IDE extensions or their files, no process wrappers, and no reliance on behaviour the types do not promise.
- Zero third-party dependencies. The module runs in an environment of its own with no Node and no DOM; the repository has no `package.json` and bundles nothing.
- At most one model call per finished turn, plus one fallback call when the chosen model gives no answer, and none where nobody will read the result, such as a headless `claude -p` run. Model calls go through `$.model.complete`; the plugin makes no network requests of its own.
- A hook at a site that can refuse what was asked (`prompt.submit`, `command.run`, `ui.close` and the other gating sites `claude plugin validate` lists) carries a `.catch` that lets the person's action through, so a failure in the plugin never holds up a prompt.
- Functions that take `$` are declared at the top level of the hooks module and receive per-load state as an argument; `claude plugin validate` refuses `$` passed to anything else.
- Values kept in `$.state` live under the plugin's own key and are declared in `types/index.d.ts`, which `claude plugin validate` holds the module to. Settings that must outlast a session go to `$.store` and are mirrored into a `$.state` value, so drawings that read them redraw.
- Every surface is a first-class target: terminal, desktop, VS Code and mobile. Elements come from `$.ui.resolve(e)`, never from an assumed surface. Outside the terminal, text is handed over whole and left to wrap; only the terminal truncates, to its measured width. Buttons in the band above the prompt never take digit hotkeys, since a digit typed into an empty prompt would press them.
- Prompts a machine made (task notifications, scheduled triggers, messages from other sessions and the like) are left out by their origin. The filter names what to drop, never what to keep, so a prompt from a surface the plugin has not met yet still counts as the person's.
- Behaviour ships with tests in `tests/`, run by `claude plugin test` against Claude Code's test kit with the clock, the store and model replies mocked. No test makes a real model call.
- Style per `.editorconfig`: two spaces, LF, UTF-8 without BOM, final newline. TypeScript follows Claude Code's plugin-authoring examples: single quotes, no semicolons, `const` unless a value is reassigned.
- Clean room: never read, decompile or copy code from Claude Code's bundled source, its IDE extensions or closed-source plugins, and never reproduce their UI text or icons. Features come from the published plugin API, its documentation and this project's own design.

## Definition of done for a pull request

CI green, tests added or updated, `claude plugin validate .` clean, changelog line present or `skip-changelog` applied, docs updated, checked on every surface the change draws on, self-review done including a read of the whole diff for anything private, every item of the PR template checklist ticked.

## Commands

```
git config core.hooksPath .githooks          # once per clone
claude --plugin-dir .                        # a Claude Code session with this checkout loaded as the plugin
claude plugin validate .                     # manifest, marketplace file and hooks module, read as Claude Code reads them
claude plugin test .                         # the tests in tests/
npx -y -p typescript@5.6 tsc -p .            # type-check; needs .claude-plugin/types/, written when Claude Code loads the plugin
gh pr create --base main --title "type(scope): subject" --body-file .github/PULL_REQUEST_TEMPLATE.md
```
