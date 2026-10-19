# Copilot instructions

Follow `AGENTS.md` at the repository root. It is the binding workflow and engineering contract for every AI assistant.

The essentials, repeated because Copilot does not import files:

- No commits, pushes, tags, merges or pull requests without the user's explicit go-ahead in the current turn. Never push to `main`; never force-push.
- Branch `type/topic` from an up-to-date `main`. Commit messages and PR titles are Conventional Commits, `type(scope): subject`. Squash merge only, after the `PR title` check passes.
- Zero dependencies, the published Claude Code plugin API only, Claude Code floor 2.1.300, a `.catch` on every hook that can refuse what the person asked.
- A `CHANGELOG.md` line under `[Unreleased]` for every user-visible change.
- Nothing private in the repository: no keys, tokens, personal paths, email addresses or text from real sessions.
- Clean room: never read, decompile or copy code from Claude Code's bundled source, its IDE extensions or closed-source plugins.
