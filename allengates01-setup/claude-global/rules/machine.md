# This machine

- Hostname `allengates01`. Debian 13 (trixie). Use `apt`, not `apt-get`,
  for anything interactive.
- 15 GB RAM, no headroom. It runs Jellyfin, Sonarr, Radarr, Prowlarr,
  qBittorrent, Home Assistant, Ollama/Open WebUI and the n8n stack. It has
  hit the kernel OOM-killer before. Check `free -h` before starting
  anything heavy, and give every new container a `mem_limit`.
- Python: always a venv per project. Never `pip install` outside a venv.
- Docker Compose project `ai-stack` lives in `~/ai-stack`
  (`docker-compose.lite.yml`). n8n is at `http://localhost:5678`. Its AI
  Assistant model is set by env vars in the compose file, not the UI.
  Secrets for that stack are in `~/ai-stack/.env` — reference them by
  name, never read them into chat.
- Samba shares exist to the Windows PC and the MacBook. Don't touch the
  share config — that's covered by the home-network project, not general
  work.
- Personal knowledge vault is `~/vault` (git-backed). Use `vnote`,
  `vclaude`, `vupdate` from `vault/scripts/vault-functions.sh`; never
  `git push` the vault directly.
- Finished deliverables for the Brain Hub go in `~/claude/brain-hub-sync/`;
  a user timer mirrors that folder to Google Drive every 15 minutes.
