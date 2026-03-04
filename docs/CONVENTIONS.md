# CONVENTIONS.md — Monkey Run Multi-Agent Operating Conventions
# DRAFT v0.1 — 2026-03-04

> This file is the schema. It defines naming rules, commit formats, access control,
> entity resolution, and validation constraints for all Monkey Run projects.
> Every agent reads this at session start. Every pre-commit hook enforces it.
> When in doubt, the conventions file wins.

---

## 1. Why This File Exists

Agents are processes. They read files, do work, and write files. Without clear rules,
they invent their own conventions — and those conventions conflict across agents and
sessions. This file prevents that drift.

If an agent violates a convention, the pre-commit hook rejects the commit. If a
convention is ambiguous and an agent guesses wrong, we fix the convention — not the
agent. The file evolves through failure, like database constraints.

---

## 2. Project Structure (Standard Layout)

Every Monkey Run project follows HWW-1.5 layout:

```
project-root/
  .agents/                    # Agent definitions (prompt-as-code)
    agent-name/
      agent.yaml              # Identity, model, tools
      directives/             # .md instruction files
  .cursor/rules/              # Cursor orchestrator rules (.mdc)
  src/                        # Application source code
  tests/                      # Test suites
  docs/                       # Documentation
  evals/                      # Evaluation baselines (when applicable)
  FEATURES.yaml               # Feature contract (source of truth)
  COO_STATUS.md               # Cross-project status (COO reads this)
  PATTERNS.md                 # Lessons learned, reusable patterns
  DEPLOY_LOG.md               # Deployment history
  CONVENTIONS.md              # This file (or inherits from baseline)
```

---

## 3. Naming Conventions

### 3.1 Agent Names
Format: `FirstName (PROJECT-DEPT)`
Examples: `Atlas (HALO-FOUNDER)`, `Janet (FFCC-MKTG)`, `Nova (HALO-PM)`

Agent names are permanent. Never rename an agent once it has commits in the repo.
The name is a foreign key in commit messages and handoff files.

### 3.2 Branch Names
Format: `agent/slug-description`
Examples: `atlas/auth-module-refactor`, `hopper/league-sync-api`

Orchestrator branches: `orchestrator/phase-N-description`

### 3.3 Feature Slugs (FEATURES.yaml)
Format: `kebab-case`, max 40 chars
Examples: `portfolio-dashboard`, `league-import-wizard`

Slugs are permanent once a feature enters `in-progress`. Never rename. They're
referenced in commits, PRs, and COO_STATUS.md.

### 3.4 Commit Message Format
```
[type] scope — description

Types:
  [feat]          New feature or capability
  [fix]           Bug fix
  [refactor]      Code restructuring (no behavior change)
  [test]          Adding or updating tests
  [docs]          Documentation only
  [config]        Configuration changes
  [intake]        New entity/data ingested (CRM-style)
  [meta]          Metadata update (status change, field update)
  [materialized]  Auto-generated summary/report
  [admin]         Housekeeping, cleanup

Scope = feature slug or entity ID
Em-dash (—) required, not hyphen (-)
```

Examples:
```
[feat] portfolio-dashboard — add holdings table with real-time valuations
[fix] league-sync-api — handle null roster response from ESPN
[meta] halo — status: alpha → beta
[intake] diego-oppenheimer-2026 — person note from Seattle Foundations event
[materialized] all — regenerated project summaries 2026-03-04
```

---

## 4. FEATURES.yaml Contract

FEATURES.yaml is the source of truth for what's being built. Agents read it at
session start to understand scope, priorities, and constraints.

### 4.1 Required Fields Per Feature
```yaml
- slug: feature-slug          # Permanent, kebab-case
  name: Human-Readable Name
  status: planned | in-progress | review | shipped | cut
  priority: p0 | p1 | p2
  owner: agent-name            # Who's building it
  acceptance_criteria:          # What "done" looks like
    - criterion 1
    - criterion 2
  dependencies: []              # Feature slugs this blocks on
```

### 4.2 Status Values (Allowed)
- `planned` — Defined but not started
- `in-progress` — Active development
- `review` — Code complete, awaiting review/QA
- `shipped` — Deployed and verified
- `cut` — Deliberately removed from scope

No other status values. Pre-commit hook rejects anything else.

### 4.3 Status Transitions (Allowed)
```
planned → in-progress → review → shipped
                    ↘ cut
planned → cut
```

You cannot move backward (shipped → in-progress). If a shipped feature needs
rework, create a new feature with a `-v2` suffix.

---

## 5. Access Control (The PR Decision Tree)

This is the access control layer. It determines when an agent commits directly
to main vs. when it must open a PR for human review.

```
Was this explicitly instructed by a human (Matt or COO directive)?
├── YES → Was it destructive? (see §5.1)
│   ├── YES → Open PR, always
│   └── NO → Commit directly to main
└── NO (agent inferred the action)
    └── Open PR for review, always
```

### 5.1 Destructive Actions (Always PR)
- Deleting any file that's been in main for >1 commit
- Changing a feature status to `cut`
- Modifying FEATURES.yaml priorities
- Bulk updates (touching >5 files in one commit)
- Removing or renaming an agent
- Changing CONVENTIONS.md itself

### 5.2 Safe Actions (Direct Commit When Instructed)
- Adding new files
- Updating code within an assigned feature
- Adding tests
- Updating documentation
- Writing to COO_STATUS.md, PATTERNS.md, DEPLOY_LOG.md
- Commit messages in the standard format

### 5.3 Agent-Inferred Actions
Agents have autonomy to act on their own judgment for non-destructive work within
their assigned scope. This means an agent working on a feature can refactor related
code, add missing tests, update docs, or fix adjacent bugs without opening a PR.

Agent-inferred actions that DO require a PR:
- Anything outside the agent's assigned feature/scope
- Adding new dependencies or changing the build system
- Creating new features or modifying FEATURES.yaml
- Any action that falls under §5.1 (destructive)

The goal is speed with guardrails: agents move fast within their lane, but need
approval to change lanes.

> NOTE (2026-03-04): This is deliberately permissive. Reviewing in 2 days (March 6)
> to assess whether agents are overstepping or if this balance is right.

---

## 6. Entity Resolution Protocol

Before creating any new entity (person, company, project reference), the agent
must search existing files for matches.

### 6.1 Signal Matching
Signals: name, email, domain, LinkedIn URL, GitHub handle, company name

```
Matching signals found across existing entities:
├── 2+ signals match → Route to existing entity, update it
├── 1 signal matches → STOP. Ask human to confirm: new or existing?
└── 0 signals match → Create new entity
```

### 6.2 Where This Applies
- Obsidian vault (COO-Research): people/, products/, themes/
- Open Brain captures: check for duplicate thoughts before ingesting
- FEATURES.yaml: check for duplicate feature slugs
- Any CRM-like data (contacts from events, meetings, etc.)

A bad merge is worse than a delayed record. When in doubt, ask.

---

## 7. COO_STATUS.md Contract

Every project maintains a COO_STATUS.md that the COO (Jared) reads during
cross-project sweeps. Format:

```markdown
# COO Status — [Project Name]
_Last updated: YYYY-MM-DD by [agent-name]_

## Health: 🟢 | 🟡 | 🔴
## Phase: [current phase]
## Blockers: [none | list]

## Recent Activity (last 7 days)
- [date] — [what happened]

## Next Steps
- [ ] [what's planned]

## Flags for COO
- [anything that needs cross-project attention]
```

Agents update this at the end of every significant work session. The COO reads
it; agents write it. This is a one-way handoff — the COO never edits
COO_STATUS.md directly (communicates via orchestrator directives instead).

---

## 8. Schema Validation (Pre-Commit Hooks)

Pre-commit hooks run on every commit and reject invalid data:

### 8.1 FEATURES.yaml Validation
- All required fields present (slug, name, status, priority, owner)
- Status values in allowed set (§4.2)
- No duplicate slugs
- Dependencies reference existing slugs
- Priority values in allowed set

### 8.2 Commit Message Validation
- Starts with a valid [type] tag (§3.4)
- Contains em-dash separator
- Scope is present

### 8.3 Relationship Integrity
- Any `dependencies` in FEATURES.yaml point to real feature slugs
- Any `related_*` fields in entity files point to entities that exist

### 8.4 File Format
- YAML files parse without errors
- Markdown files have valid frontmatter (if frontmatter is expected)
- No files with spaces in names (use kebab-case)

---

## 9. Materialized Views (Auto-Generated Reports)

Certain files are auto-generated by cron jobs or agents and should never be
hand-edited. They are regenerated from raw data on schedule.

### 9.1 Materialized Files
- `COO Dashboard` — regenerated daily by Jared (cross-project summary)
- `materialized/summary.md` — per-entity summaries (when CRM pattern is adopted)
- Open Brain daily sync — pushes daily notes to vector DB

### 9.2 Rules
- Materialized files include a generation timestamp at the top
- Never hand-edit a materialized file (edit the source data instead)
- If a materialized file has stale data, regenerate it — don't patch it

---

## 10. Evolution

This file evolves through failure. When an agent makes a mistake that a
convention should have prevented, we add the rule here. When a rule is
too restrictive and blocks legitimate work, we relax it.

Every change to CONVENTIONS.md requires a PR (§5.1) — even if a human asks for it.
This ensures the change is visible in the commit log and can be reviewed.

### Changelog
- 2026-03-04: v0.1 — Initial draft. Based on HWW-1.5 patterns + Diego Oppenheimer's
  git-as-CRM architecture. Covers naming, commits, FEATURES.yaml, access control,
  entity resolution, COO status, schema validation, materialized views.
