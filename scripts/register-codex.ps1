param([string]$Name = 'discord-control', [string]$CodexPath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'resolve-codex.ps1')
$project = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$entry = Join-Path $project 'dist/index.js'
$node = (Get-Command node -ErrorAction Stop).Source
$codexExecutable = Resolve-CodexExecutable -ExplicitPath $CodexPath
if (-not (Test-Path -LiteralPath $entry)) { throw 'Run npm install and npm run build before registration.' }
$oldPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$existingJson = & $codexExecutable mcp get $Name --json 2>$null
$found = $LASTEXITCODE -eq 0
$ErrorActionPreference = $oldPreference
if ($found) {
    $existing = $existingJson | ConvertFrom-Json
    if ($existing.transport.command -eq $node -and $existing.transport.args.Count -eq 1 -and $existing.transport.args[0] -eq $entry) {
        Write-Host "MCP '$Name' is already registered."
        return
    }
    throw "An MCP server named '$Name' already exists with a different configuration. Choose another -Name."
}
& $codexExecutable mcp add $Name -- $node $entry
if ($LASTEXITCODE -ne 0) { throw 'Codex MCP registration failed.' }
