# Architectural Decision Records (ADRs)

## What are ADRs?

Architectural Decision Records capture significant structural and architectural decisions made during the development of this project. Each ADR describes a decision, its context, the alternatives considered, and the consequences of the choice made.

This project uses ADRs to maintain a transparent, searchable history of *why* the codebase is shaped the way it is — not just *what* was built.

## Where they live

All ADRs are stored in `docs/adr/` at the repository root.

## Naming convention

ADR files follow this pattern:

```
YYYY-MM-DD-short-slug.md
```

For example: `2026-03-21-adopt-adapter-registry-pattern.md`

Use lowercase, hyphen-separated slugs. Keep them short but descriptive.

## Status lifecycle

Every ADR has a status field that follows this lifecycle:

```
proposed → accepted → superseded / deprecated
```

| Status | Meaning |
|---|---|
| **proposed** | Under discussion; not yet agreed upon |
| **accepted** | Agreed and in effect |
| **superseded** | Replaced by a newer ADR (link to the replacement) |
| **deprecated** | No longer relevant; withdrawn without a replacement |

## When to create an ADR

Create an ADR for **structural and architectural decisions only**:

- New patterns or conventions that affect the codebase structure
- Technology choices (frameworks, libraries, infrastructure)
- Service boundaries and integration approaches
- Data model design decisions
- Deployment topology changes
- Authentication/authorisation strategy changes

**Do not** create an ADR for:

- Bug fixes
- Minor code style or formatting choices
- Routine dependency updates
- Individual feature implementations (unless they introduce a new pattern)

## How to create one

**Preferred:** Use the `creating-adrs` skill, which guides you through the process.

**Manual:** Copy `TEMPLATE.md` from this directory, rename it following the naming convention above, and fill in each section.
