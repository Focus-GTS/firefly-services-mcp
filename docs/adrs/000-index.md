# Architecture Decision Records

Each ADR documents a single non-obvious architectural decision and the rationale behind it. A new ADR is required to supersede or contradict an existing one.

| # | Title | Status | Date |
|---|---|---|---|
| [001](001-wrap-adobe-sdks-not-reimplement.md) | Wrap Adobe SDKs; do not reimplement the API surface | Accepted | 2026-05-18 |
| [002](002-node-typescript-stdio-transport.md) | Node.js + TypeScript + stdio transport | Accepted | 2026-05-18 |
| [003](003-single-credential-per-instance-v0.1.md) | Single-credential-per-server-instance for v0.1 | Accepted | 2026-05-18 |
| [004](004-storage-references.md) | Storage references: triple-mode input, dual-mode output | Accepted | 2026-05-18 |
| [005](005-tool-naming-convention.md) | Tool naming: `<product>_<action>_<object>` snake_case | Accepted | 2026-05-18 |

## When to write a new ADR

Add a new ADR when:
- Making a non-obvious technical decision a future contributor would need rationale for
- Superseding an existing ADR (link both ways)
- Documenting a deferred decision (mark **Deferred** in status)

Skip ADRs for:
- Standard library / framework choices that follow community convention
- Decisions that have one obvious answer
- Implementation details below the architectural level

## Format

Each ADR has the following structure:

- **Context** — the situation requiring a decision
- **Decision** — what we decided
- **Consequences** — what follows from the decision, both good and constraining
- **Alternatives considered** — what else was on the table and why it was not chosen
