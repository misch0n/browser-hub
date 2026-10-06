# Documentation

Everything about building the hub. The user guide is the top-level
[README](../README.md); the entry point for agents is [AGENTS.md](../AGENTS.md).

| File | Read it when | Keep it current when |
| --- | --- | --- |
| [todo.md](todo.md) | starting any session: state, the next Dev task, research and confirmation tasks | you start, stop or finish work |
| [architecture.md](architecture.md) | changing anything beyond one command | structure, data, sync, output or build changes |
| [conventions.md](conventions.md) | writing code, UI text or docs | the owner states a new preference |
| [security.md](security.md) | touching storage, sync, secrets, network, CSP, rendering | any of those change |
| [testing.md](testing.md) | running or writing tests | test setup, harness or CI changes |
| [recipes.md](recipes.md) | adding a command, a collection, an output op; changing the CSP | a recipe turns out incomplete |
| [commands.md](commands.md) | looking up a command's forms (generated; `npm run docs`) | never by hand |
| [changelog.md](changelog.md) | you need history ("when did X land?") | every push |
| [decisions.md](decisions.md) | before reversing something that looks odd | a choice with lasting consequences is made |
| [deferred.md](deferred.md) | before proposing a feature | something is consciously left out |
| [exploration/](exploration/README.md) | the owner asks "is it possible…" | research is done but not approved |
| [plans/](plans/README.md) | building approved multi-step work | the plan's steps progress |

Where new information goes:

- The owner asks for something → [todo.md](todo.md) under Dev, Research or Confirmation (plus a plan if it's big).
- The owner says "defer", "skip", "not now" → [deferred.md](deferred.md) or an exploration marked parked.
- The owner states a preference or rule → [conventions.md](conventions.md) (★) or [security.md](security.md).
- You decide something structural → [decisions.md](decisions.md).
- You ship → [changelog.md](changelog.md), and the feature's section in the user README.
