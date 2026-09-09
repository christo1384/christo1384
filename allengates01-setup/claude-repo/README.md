# `~/claude` as a git repo — open item 3

Recommended: yes. The config that makes the box *yours* (`MANIFEST.md`,
shared skills, the templates) gets history and a remote; the project
folders do not, because each one is its own repo with its own remote.

## Set up once, after `apply.sh --apply`

```bash
cd ~/claude
cp ~/claude-setup/allengates01-setup/claude-repo/gitignore .gitignore
git init -b main
git add -A
git status            # should list MANIFEST.md, .gitignore and nothing under a project folder
git commit -m "chore: initial ~/claude config"
# private repo, same as the vault:
git remote add origin git@github.com:christo1384/claude-config.git
git push -u origin main
```

The `.gitignore` here ignores every top-level project folder by name (from
the manifest) and, as a catch-all, any directory that contains its own
`.git`. Add a line when a project is added to the manifest.

## What is tracked

- `MANIFEST.md`
- `.gitignore`
- `skills/` if you keep shared project-scope skills here
- `templates/` if you copy `project-template/` in

## What is not

- Every `<project>/` folder: their own repos, their own remotes.
- `brain-hub-sync/`: mirrored to Drive by the timer, and may hold client
  deliverables that should not be in a git remote.
- Anything named `.env`, `*.key`, `*.pem`, `credentials*`.

## Rebuild from scratch

With this in place the box is three clones plus `apply.sh`:

```bash
git clone git@github.com:christo1384/vault.git ~/vault
git clone git@github.com:christo1384/claude-config.git ~/claude
git clone -b claude/linux-box-setup-l1qmkh https://github.com/christo1384/christo1384 ~/claude-setup
bash ~/claude-setup/allengates01-setup/apply.sh --apply   # fills in ~/.claude and any missing project folders
```

Then clone each project repo into its manifest path.
