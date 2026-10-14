# Security

Use only official Discord bot tokens. Never use personal account tokens. Keep tokens in environment variables or an ignored .env file. Restrict bot permissions, channel access and guild allowlists. Review generated actions before running them against your server.

Runtime state and logs may contain Discord IDs, membership applications and message content; they are excluded from Git. Keep this data private and define an appropriate retention policy. Audit message content is opt-in. Self-assignable roles must have zero permissions and remain below the bot role.

Report security issues privately through https://t.me/jeamoff. Do not post tokens or private messages in public issues.
