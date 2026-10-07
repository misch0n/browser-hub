# Graph mode: design reference

Status: **open** (experimental feature, built 7 Oct 2026; refined from the
owner's design note of the same day). What's built follows
[plan 003](../plans/003-graph-mode-refinement.md); this file keeps the design
thinking, including the parts deliberately not built yet.

## The owner's design note (7 Oct 2026, condensed)

**What it is.** A spatial view of the command structure, turned on by the
`graph ` prefix. Non-destructive: normal mode is unchanged and is the
control. Graph mode changes how input is resolved and displayed, never what a
command does. The fan is a read-only display beside an unchanged input; it
never takes Tab or Enter from normal autocomplete, so it is additive: the
same autocomplete and Tab, with more shown on top. (Fuzzy matching resolving
a typo to the wrong node already exists in plain autocomplete; here a visible
neighbourhood makes a wrong landing obvious instead of silent.)

**Two graphs.**
- *Letter graph (trie)*: what is rendered while typing a word. Nodes are
  letters, paths spell names, leaves are where a name resolves. A pure tree:
  inside a word every node has one parent, so display only branches forward.
- *Command graph*: command › mode › subcommand › parameters. At any slot the
  valid set is a finite sorted list. Convergence (a node reached by several
  routes: shared modes or parameters, aliases) exists only here.

Matching goes one word at a time, left to right: a trie per slot, chained at
resolution points (the leaf of one is the root of the next), so the whole is a
forest of letter tries stitched end to end. The user stands at one node (the
cursor); what's live on screen is the tree rooted there.

**Two panes.**
- *Forward pane* (the suggestion engine): from the current node, every
  reachable leaf, collecting the complete commands on the way: "what can I
  still reach?". Spatial, because you're choosing. Narrows as you type.
- *Backward pane* (context): for each word already passed, the other choices
  at that fork, as a plain sorted list. Reference, not navigation. (Siblings,
  not convergence.)

**Layout.** The tree rooted at the cursor, fisheye: the current node and its
neighbours large and sharp, the rest smaller but still present.

**Ring (parked, not decided).** A ring adds an axis (angle) that could carry
spatial memory ("cooking is down-left"). But one ring can't be both a stable
map and a live position indicator. Candidates: *bloom and contract* (the ring
blooms at each node and contracts to a small indicator travelling with the
cursor once you choose), or *two rings* (a fixed outer alphabet for memory, a
moving inner marker for position). Fisheye is preferred for now.

**Parameters.** Each slot is "what's valid here", and a parameter is just
another slot. Closed sets (modes) are nodes; open parameters (a number, free
text, an ingredient) can't be listed, so show their shape (`<amount:number>`)
plus a few recent or common values from history. Structural words are nodes;
parameters are typed slots on the terminal node.

**A real graph.** The command structure as an explicit, queryable data
structure, the single source of truth: rendering asks for a node's neighbours,
and the same graph feeds autocomplete, the fan, validation, the parameter
schema and ranking.

**Build order.** Forward pane first; see whether the backward pane and any
command-graph convergence earn their place once it's on screen.

## Open questions (for the owner, after trying it)

- Does the backward pane (siblings of words already passed) earn its place?
- Should normal-mode autocomplete move onto the graph too? Not done: normal
  mode is the control, so it stays as it was (see plan 003).
- Ring: bloom and contract, two rings, or neither?
- Convergence in the command graph (shared modes, aliases as one node): worth
  showing?
- Ranking: by use or a to z (`graph :sort freq|alpha`), after comparing both.
