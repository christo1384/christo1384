# Safety limits

- Recursive deletes (`rm -r`, `rm -rf`) are blocked in settings.json. Don't
  work around it with `find -delete`, `xargs rm`, or a script. If something
  needs a recursive delete, tell me what and why and I'll run it.
- Never edit `/etc/fstab`, sudoers, or network config without asking me
  first and explaining exactly what will change.
- There's a known, unresolved fstab parse error on this box. Don't try to
  fix it in passing — it's a separate job.
- Never commit secrets: API keys, tokens, rclone credentials, `.env` files.
  If you're about to write one into a file, stop and tell me instead.
- Never echo a secret into the terminal or ask me to paste one into chat.
  Secrets go into `.env` via `nano`, then get referenced by name.
- Ask before `git push --force` or any history rewrite.
- Ask before deleting configs or removing packages — audit first, then ask.
- Ask before starting or restarting any Docker container. The box has
  15 GB of RAM and has been OOM-killed before; a new container without a
  memory limit can take the others down.
