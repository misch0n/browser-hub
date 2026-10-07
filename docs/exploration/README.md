# Exploration

Ideas researched but **not approved for building**. An exploration records
what is possible, the options, their costs and risks, and the questions only
the owner can answer, so the research isn't repeated. Don't build from here:
when the owner says go, write a [plan](../plans/README.md) and add it to
[todo.md](../todo.md).

| Topic | Status | Summary |
| --- | --- | --- |
| [iOS notifications](ios-notifications.md) | open: research task (6 Oct 2026); draft [plan 001](../plans/001-ios-notifications.md) | Home Screen web app + Web Push; needs a scheduled sender (GitHub Action or Cloudflare Worker). |
| [Graph mode](graph-mode.md) | open: built as an experiment, refined 7 Oct 2026 ([plan 003](../plans/003-graph-mode-refinement.md)) | The owner's design note: two graphs, forward and backward panes, fisheye; the ring parked. |
| [Apple Calendar, Reminders, Notes sync](apple-sync.md) | dropped by the owner, 5 Oct 2026 | No direct API; options from `.ics` export to a Mac helper. Revisit only if it becomes a pain point. |

Statuses: **open** (being looked into), **parked** (owner said not now),
**dropped** (owner said no unless circumstances change), **approved** (moved
to a plan; keep the file for its reasoning).

## Template

```markdown
# <Topic>

Status: open | parked | dropped | approved (<date>, <owner's words if any>)

## Question
What the owner asked, in their words.

## Findings
What is and isn't possible, with sources or how it was verified.

## Options
Each with effort, cost, risks, and what it needs from the owner.

## Recommendation
One option, and why.

## Open questions for the owner
```
