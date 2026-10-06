# Plans

A plan is written for approved work that takes more than one sitting or more
than one commit, before building it. It lets any agent pick the work up
halfway. Small, clear tasks don't need one: their [todo.md](../todo.md) entry
is enough.

## Active

| Plan | Status |
| --- | --- |
| [001 · iOS notifications](001-ios-notifications.md) | approved, not started |

New plans: `NNN-short-name.md`, listed here and linked from todo.md.

## Archive

| Plan | Outcome |
| --- | --- |
| [v1 spec](archive/v1-spec.md) | Built on 5 October 2026, then superseded by later work. |

When a plan is done, move it to `archive/`, set its status to done, and note
the commits in [changelog.md](../changelog.md).

## Template

```markdown
# <Title>

Status: approved | in progress | done (<date>) · Todo: <link to the todo entry>

## Goal
What the owner asked for (their words) and what "done" means for them.

## Approach
How it fits the architecture; files and modules touched; data changes
(collections, sync, migrations); security or CSP impact.

## Steps
- [ ] 1. … (each step small enough to commit, with its tests)
- [ ] 2. …

## Tests
Unit, decoder, e2e checks to add; what to verify by hand.

## Open questions
Anything to ask the owner before or during the work.

## Log
Dated notes as work progresses: what was done, what changed from the plan, where it stopped.
```
