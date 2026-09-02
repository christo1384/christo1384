# Safety limits

- Never run `rm -rf` outside the current project folder.
- Never edit `/etc/fstab`, sudoers, or network config without asking me
  first and explaining exactly what will change.
- There's a known, unresolved fstab parse error on this box. Don't try to
  fix it in passing — it's a separate job.
- Never commit secrets: API keys, tokens, rclone credentials, `.env` files.
  If you're about to write one into a file, stop and tell me instead.
- Ask before `git push --force` or any history rewrite.
- Ask before deleting configs or removing packages — audit first, then ask.
