# ADR-0015: A reply must lean on the answer, not merely be short (experimental)

- Status: accepted, experimental
- Date: 2026-10-22

## Context

A reply keeps the running task's grade with no new call: a clicked choice, a typed one, or up to three words ("why?", "go on", "and the tests?"). The three-word limit alone decided it, so any short message was a reply, whatever it said.

The person hit this directly: a plain "how are you" after other work was absorbed into the running task and never graded, so Suggest had nothing to offer for it, which read as "simple questions get no suggestion" even though the grading itself was never the problem — the message was never sent to the grader at all.

## Decision

A short message (at most three words, as before) is still a reply when it leans on the last answer: an acknowledgement, on its own or leading the message ("ok thanks"), a short continuation tied to the answer ("why?", "and the tests?", "go on", "go ahead", "makes sense"), or, outside an easy task, a short order ("push the change") — the same order-verbs `isOrder` already used to move an easy task up. A short message that stands on its own, such as a greeting or a fresh short question, is no longer a reply: it starts a task of its own and is graded like any other.

Shipped experimental: the pattern list is new and was checked against this project's own tests and a handful of real phrasings, not a large sample of real conversations. A continuation worded unusually may be graded afresh instead of staying free, which costs a grading call but never a wrong answer; nothing was found that goes the other way, a real new question staying ungraded.

## Consequences

- "How are you" and messages like it are graded as the short plain questions they are, so Suggest can offer a cheaper model for them, as Automatic already did.
- A short order ("push it", "merge it") still continues a running mid or hard task with no new grading, exactly as before.
- One more grading call than before on a short message that is not a true continuation — a greeting, a fresh short question — since it is now graded instead of absorbed for free. The grader's cost already answered a person's concern about this; see [ADR-0013](0013-suggest-mode-the-grade-suggests-the-person-switches.md).
- The pattern list (`ACK_LEAD`, `CONTINUES` in `hooks/register.tsx`) is expected to be tuned as more phrasings are found; this ADR stays the record of the decision even as the list changes.
