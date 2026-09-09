# Phase 6 — skills and MCP on allengates01

Open item 2 from the original plan was "which custom skills should be
global vs Steelcraft-only?" This is a proposed split to decide against,
based on the skill names visible in Chris's Claude account on 10 Sep 2026.
Nothing here is installed.

The deciding rule is the manifest's own line for the `steelcraft` project:
**no client data on this box.** A skill that embeds Steelcraft SharePoint
site URLs, list IDs, flow IDs, people's names or plant details *is* client
data. Those stay on the work machine.

## Global on the box (`~/.claude/skills/`)

General tooling with nothing Steelcraft-specific inside:

| Skill | Why global |
|---|---|
| `skill-creator` | needed to make any of the others |
| `docx`, `pdf`, `xlsx`, `pptx` | document tooling, used by every project |
| `mcp-builder` | Weekends Back and Minute Man both build MCP servers |
| `afk-deploy-system` | Chris's own deploy pattern, project-agnostic |
| `backlog-clearance-orchestrator` | pairs with the above |
| `cloudflare-html-review` | throwaway review links, any project |
| `project-handover` | portfolio-level, not client-specific |
| `web-artifacts-builder` | front-end scaffolding, any project |

## Steelcraft only — do NOT copy to this box

| Skill | What makes it client data |
|---|---|
| `sce-*` (change-management, competency-verifier, compliance-tracking, contractor-review, file-sweep, incident-investigation, officer-due-diligence, safety-report, safety-runbook) | HSWA workflows tied to Steelcraft sites, lists and people |
| `astron-jsa-builder`, `astron-sop-builder` | Pact Recycling / Astron plant detail |
| `audit` | Steelcraft Structural job data |
| `pa-flow-expert` | Power Automate flow IDs, SharePoint schemas |
| `sharepoint-list-manager` | steelcraftnz.sharepoint.com |
| `ws4-safety-backbone` | the SBB pipeline, list names, flow health |
| `internal-comms` | company templates |

If a `steelcraft` project on the box needs one of these for a
home-side prototype, copy a **redacted** version into
`~/claude/steelcraft/.claude/skills/` (project scope, not global) and strip
the IDs first.

## Per-project (`~/claude/<project>/.claude/skills/`)

Nothing yet. The rule from `project-template/`: a skill lives at project
scope until two projects need it, then it moves up.

## How to move a skill onto the box

Skills are folders with a `SKILL.md`. From the machine that has them:

```bash
# on the source machine
tar -C ~/.claude/skills -czf skills-global.tgz skill-creator docx pdf xlsx pptx mcp-builder \
    afk-deploy-system backlog-clearance-orchestrator cloudflare-html-review project-handover web-artifacts-builder
scp skills-global.tgz allengates01:

# on allengates01
mkdir -p ~/.claude/skills && tar -C ~/.claude/skills -xzf ~/skills-global.tgz && rm ~/skills-global.tgz
claude   # then ask it which skills it can see, to confirm they loaded
```

Before the tar: `grep -rl "sharepoint\|steelcraft" ~/.claude/skills/<name>`
on each global candidate. Anything that hits gets reviewed before it
travels.

## MCP servers

The plan said `claude mcp add` without naming servers. Candidates, with the
scope they should get:

| Server | Scope | Note |
|---|---|---|
| GitHub | user (`-s user`) | all projects push to GitHub |
| Filesystem | none | Claude Code already has file tools |
| n8n (community MCP) | project: `home/openclaw` | only if OpenClaw drives n8n |
| Google Drive / Calendar | user | the airbnb-turnover project is Google-stack |
| Microsoft 365 / SharePoint | **none on this box** | client data rule |

Add with `claude mcp add --scope user <name> ...` and confirm with
`claude mcp list`. Tokens for these go in the MCP config, which lives in
`~/.claude.json` alongside OAuth state. `audit.sh` prints only the server
names from it, never values, and it should be in no backup that leaves
the box unencrypted (restic encrypts, so the backup unit is fine).

## Decision needed from Chris

- Confirm the global list above, or move items between tables.
- Which MCP servers, if any, at user scope on the box.
- Whether `~/claude/` itself becomes a git repo (open item 3). Recommended:
  yes, with every `<project>/` in `.gitignore` so only `MANIFEST.md`, the
  templates and any shared skills are tracked. Then the config has a
  history and a remote, and the box can be rebuilt from three clones:
  `vault`, `claude`, and this setup folder.
