# ADR-0008: GitHub flow with tags, no development branch

- Status: accepted
- Date: 2026-10-19

## Context

The plugin is maintained by one person, every pull request runs CI, and people install the plugin straight from this repository through its marketplace file.

## Decision

`main` is the only long-lived branch and is protected for everyone, administrators included. Every change is a short-lived `type/topic` branch merged by squash through a pull request whose title is a Conventional Commit, once the `PR title` and `Validate and test` checks pass. Releases are tags on `main`. A `release/x.y` branch is cut from a tag only when an older version needs a fix, and deleted afterwards.

## Consequences

- Each change merges once, and `main` is always the state CI last validated.
- A new install takes `main` as it stands, so `main` must always be releasable.
- Outside contributors target the default branch, which is what they expect.

## Alternatives considered

- A permanent `dev` branch promoted to `main` at release time: it doubles the merges and adds a promotion step that buys nothing when every pull request is already validated.
