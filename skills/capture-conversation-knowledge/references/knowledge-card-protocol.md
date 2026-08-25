# Knowledge card protocol

Emit machine-readable card data only when the user or a real state/UI consumer asks for it. The executable source of truth is `packages/card-protocol/index.ts`; this bundled reference defines the portable Skill contract.

Return an object with `events`, an array of lifecycle events. Every event contains `event`, `card_id`, `at_turn`, and `reason`. Supported events are `add`, `merge`, `revise`, `supersede`, `discard`, and `status_change`.

An `add` event includes a complete `card` with:

- identity: `card_id`, positive integer `revision`, `type`, `title`;
- content: `summary`, `body.definition_or_claim`, `body.mechanism`, `body.reasoning_chain`, `body.boundary`, `body.transfer`;
- evidence: `provenance[]`, `confidence`, `evidence_status`;
- state: `learning_status`, `lifecycle`, `supersedes[]`, `created_at_turn`, `updated_at_turn`, `tags[]`;
- optional type detail: `operation` or `learning_debt`.

For operations, preserve action, mode (`read_only`, `mutating`, `mixed`, `unknown`), actual effect, purpose, mechanism, prerequisites, before/after state, verification, risks, and reversibility. For learning debt, preserve the question, origin, learning value, task relation, and recommended stage.

Use `revise` when evidence changes an existing card, `supersede` when a conclusion is replaced, `merge` for duplicates, `discard` for invalid/noisy material, and `status_change` only for learning state. Never emit conflicting active facts as separate cards.
