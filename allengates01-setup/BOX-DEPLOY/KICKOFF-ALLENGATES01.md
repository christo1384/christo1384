# Kick-off — run the allengates01 queue unattended

Ten minutes of your time, then the box works through 17 tickets on its
own while overwatch watches the reports come in through git. Everything
below is copy/paste in a terminal on `allengates01`, as your own user.

## 1. Claude Code on the box

```bash
claude --version || curl -fsSL https://claude.ai/install.sh | bash
claude          # first run: log in (subscription or API key — your call, open item 1), then /exit
```

## 2. Fresh clone

A fresh clone means no stale memory. Do not reuse an old checkout.

```bash
git clone -b claude/linux-box-setup-l1qmkh https://github.com/christo1384/christo1384 ~/claude-setup
cd ~/claude-setup/allengates01-setup/BOX-DEPLOY
git config user.name "Chris" && git config user.email "crsroe@gmail.com"
```

The driver pushes reports back to this branch, so the clone needs push
rights: use `gh auth login` or an SSH remote if the HTTPS push asks for a
password.

## 3. Read and sign GO.md

```bash
nano GO.md
```

Delete any class row you do not want run. Then change the last line to
`Status: **SIGNED**`. Save, then:

```bash
git commit -am "GO signed" && git push
```

Nothing is written on the box until this is pushed.

## 4. First cycle, watched

```bash
sudo -v                                  # cache sudo once; the driver keeps it warm
bash run-cycle.sh --max-cycles 1
cat reports/B01-*.md
```

B01 is read-only. If the report reads sensibly, continue.

## 5. Let it run

```bash
bash run-cycle.sh
```

Runs until the queue is empty, `OVERWATCH.md` says STOP, or 20 cycles.
Keep the box awake (it is a server, so it should be). `Ctrl+C` stops it
between cycles. Reports land in `reports/`, and every cycle is pushed, so
you can read progress from your phone on GitHub.

If a cycle stalls on a permission prompt, stop it, read the log in
`logs/` to see which command asked, and add that command to the `allow`
list in `~/.claude/settings.json`. Do not widen the driver.

## 6. What comes back to you

Read `QUEUE.md` § Needs-Chris. Each item there has the evidence file the
agent wrote. In order of importance:

1. fstab fix (the one thing that can stop the box booting).
2. Rotate any secrets the audit flagged.
3. Log rclone into Google Drive, then repoint the restic backup to it and
   install the Brain Hub timer.
4. Copy the restic password file into your password manager.
5. Decide on Ollama.

## Stopping overwatch

Overwatch runs from Chris's Claude session and reads the reports through
git. Add a line `STOP` to `OVERWATCH.md` and push to halt the agent from
anywhere; tell the Claude session to stop overwatch.
