param([switch]$SkipRegistration)
$ErrorActionPreference = 'Stop'
$project = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$envFile = Join-Path $project '.env'
Write-Host 'Discord MCP: local setup'
Write-Host 'Create an application and bot at https://discord.com/developers/applications'
Write-Host 'On the Bot page enable Message Content Intent and Server Members Intent.'
Write-Host 'The bot token will be saved only in the local .env file.'
$secureToken = Read-Host 'Bot token (input is hidden)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $botToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim()
    if ($botToken -notmatch '^[A-Za-z0-9._-]{30,}$') { throw 'Expected a bot token, not an application ID or client secret.' }
    $serverId = (Read-Host 'Server ID (optional)').Trim()
    if ($serverId -and $serverId -notmatch '^\d{17,20}$') { throw 'Server ID must contain 17-20 digits.' }
    # Authenticate before replacing any existing configuration. Never print the token.
    try {
        $identity = Invoke-RestMethod -Uri 'https://discord.com/api/v10/users/@me' -Headers @{ Authorization = "Bot $botToken" } -TimeoutSec 20
        if (-not $identity.bot) { throw 'The supplied token is not a bot token.' }
    } catch { throw 'Bot authentication failed. Check the token and network; existing configuration has been preserved.' }
    $existing = if (Test-Path -LiteralPath $envFile) { Get-Content -LiteralPath $envFile -Raw } else { Get-Content -LiteralPath (Join-Path $project '.env.example') -Raw }
    $values = [ordered]@{
        DISCORD_BOT_TOKEN = $botToken
        DISCORD_GUILD_ID = $serverId
        DISCORD_ALLOWED_GUILD_IDS = $serverId
        DISCORD_MESSAGE_CONTENT = 'true'
        DISCORD_GUILD_MEMBERS = 'true'
    }
    foreach ($key in $values.Keys) {
        $line = "$key=$($values[$key])"
        if ($existing -match "(?m)^$key=") {
            $existing = [regex]::Replace($existing, "(?m)^$key=[^\r\n]*", [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $line })
        } else { $existing += "`n$line`n" }
    }
    [System.IO.File]::WriteAllText($envFile, $existing, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Configured bot: $($identity.username) ($($identity.id))"
    $invite = "https://discord.com/oauth2/authorize?client_id=$($identity.id)&permissions=8&scope=bot%20applications.commands"
    if ($serverId) { $invite += "&guild_id=$serverId&disable_guild_select=true" }
    Write-Host "Invite the bot to your server: $invite"
    Write-Host 'This invite requests Administrator for full server management. Put the bot role above roles it must manage.'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $botToken = $null
    $existing = $null
    $values = $null
    $line = $null
    $secureToken.Dispose()
}
if (-not $SkipRegistration) {
    try { & (Join-Path $PSScriptRoot 'register-codex.ps1') }
    catch {
        Write-Warning 'Discord credentials were saved successfully; only Codex MCP registration failed.'
        Write-Host 'After fixing registration, run npm run register. Do not repeat token setup.'
        throw
    }
}
Write-Host 'Restart the discord-control MCP server in Codex, then run npm run doctor.'
