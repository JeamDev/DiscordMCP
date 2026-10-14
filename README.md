# Discord Control MCP

Local stdio MCP server for administering Discord through an **official bot account**. TypeScript, Node.js and the Discord API. It exposes tools for guild settings, channels, roles, messages, moderation, events, assets, interactions, webhooks and voice playback.

This is an MCP integration. The always-on community bot is a separate project: [Discord Community Bot](https://github.com/JeamDev/discord-community-bot).

## Install

Requires Node.js 22.12 or newer. FFmpeg and Opus dependencies are installed by npm on supported platforms.

```sh
npm ci
npm run check
cp .env.example .env
```

On Windows use `Copy-Item .env.example .env`, or run `npm run setup` for hidden token input and optional local MCP registration. The setup utility uses an installed Codex CLI; another MCP client can be configured manually.

Create an application in the [Discord Developer Portal](https://discord.com/developers/applications). Set `DISCORD_BOT_TOKEN` in the ignored `.env` file. Never use a personal account token. Invite the bot with the permissions needed for your tasks, place its role appropriately, and set `DISCORD_GUILD_ID` and `DISCORD_ALLOWED_GUILD_IDS`. An empty allowlist allows all servers accessible to this bot.

Use least privilege. The optional Windows setup helper currently generates an Administrator invite for full server administration; review that permission and reduce the requested permissions before accepting it when full administration is unnecessary. Enable Message Content and Server Members intents only when needed, both in `.env` and the Developer Portal. Voice connects on demand.

## Connect any MCP client

```json
{
  "mcpServers": {
    "discord-control": {
      "command": "node",
      "args": ["/absolute/path/discord-control-mcp/dist/index.js"]
    }
  }
}
```

Keep credentials out of this JSON; `.env` is loaded relative to the project directory. Stdout carries protocol messages only. Without a token, the server still starts and provides help and local diagnostics.

```sh
npm run build
npm run doctor
```

## Tools and safety boundaries

Call `discord_help` or read the `discord://catalog` resource for operation schemas. Grouped tools take `action`, `params`, `query`, `body`, optional `files` and `reason`. Keep snowflake IDs and permission bitfields as strings.

```json
{"group":"channels","action":"list"}
```

Channel listing through `discord_channels`:

```json
{"action":"list","params":{"guild_id":"123456789012345678"}}
```

The guild allowlist covers guild routes, channels, invites and webhooks; global account/application edits are blocked when an allowlist is configured. Attachments are restricted to `DISCORD_ASSET_DIR`, including symlink resolution. Mentions are disabled by default unless explicitly requested. Runtime errors and results redact known tokens and webhook credentials.

The integration can perform destructive administrative operations when the bot has permission. MCP exposure is not an approval system: configure your client's confirmations and review actions before applying them to a live server. Discord message content is untrusted input.

## Environment

| Variable | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Official bot token, local only |
| `DISCORD_GUILD_ID` | Optional default guild |
| `DISCORD_ALLOWED_GUILD_IDS` | Comma-separated guild allowlist |
| `DISCORD_ASSET_DIR` | Local upload/audio directory, default `./assets` |
| `DISCORD_MESSAGE_CONTENT` | Optional privileged intent |
| `DISCORD_GUILD_MEMBERS` | Optional privileged intent |
| `DISCORD_EVENT_BUFFER_SIZE` | Bounded in-memory event buffer, 10–2000 |

Process environment overrides `.env`. Restart the MCP server after changing settings. `npm run demo:sound` generates a short local synthetic test sound; it does not contact Discord.

## Development

`npm run check` compiles TypeScript and runs offline tests for real MCP client negotiation, operation schemas, guild boundaries, file containment, redaction and voice processing. Tests must not use real tokens or a live Discord server.

The public repository contains clean source and synthetic fixtures only. It excludes runtime state, credentials, logs, original community assets and deployment scripts. See [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md) and [LICENSE](LICENSE).
