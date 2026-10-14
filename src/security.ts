// Discord payloads are untrusted user content. Never expose credentials in results/errors.
export function sanitize(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    let result = value;
    for (const secret of secrets) if (secret) result = result.split(secret).join('[REDACTED]');
    return result.replace(/(\/webhooks\/\d+\/)[A-Za-z0-9_.-]{20,}/g, '$1[REDACTED]')
      .replace(/(\/interactions\/\d+\/)[A-Za-z0-9_.-]{20,}/g, '$1[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(v => sanitize(v, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k,
      /^(token|access_token|refresh_token|authorization|client_secret)$/i.test(k) ? '[REDACTED]' : sanitize(v, secrets),
    ]));
  }
  return value;
}

export function errorPayload(error: unknown, secrets: string[] = []) {
  const e = error as { message?: string; status?: number; code?: number | string; rawError?: { errors?: unknown } };
  const hints: Record<number, string> = {
    401: 'Check DISCORD_BOT_TOKEN in the local .env file and restart the MCP server.',
    403: 'Check bot permissions, channel overwrites, privileged intents and the bot highest role.',
    404: 'Check resource IDs and whether the bot can see this resource.',
    429: 'Discord rate limit: wait before retrying. Do not retry successful writes.',
  };
  return sanitize({
    error: e?.message ?? String(error),
    ...(e?.status ? { status: e.status, hint: hints[e.status] } : {}),
    ...(e?.code ? { code: e.code } : {}),
    ...(e?.rawError?.errors ? { fields: e.rawError.errors } : {}),
  }, secrets);
}
