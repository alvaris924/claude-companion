# CLAUDE.md

The binding rules for this repository live in `AGENTS.md`, imported below. They apply to every AI assistant; this file only adds Claude Code specifics.

@AGENTS.md

## Claude Code specifics

- Use `gh` for issues and pull requests, and open PRs with the template as the body.
- Before any git action, state the branch name, the Conventional Commit title and the files touched, then wait for the go-ahead in that same turn.
- If a request would touch `main` directly, decline and offer the branch-and-PR route.
- Before changing the hooks module, load the plugin-authoring skill: it carries the plugin API of the running build, the validator's rules and the test kit.
- When working on this repository from another project directory, read `AGENTS.md` here first; the rules do not depend on where the session started.
