function Resolve-CodexExecutable {
    param(
        [string]$ExplicitPath,
        [string]$BundledDirectory
    )
    if ($ExplicitPath) {
        if (-not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) {
            throw "Codex executable does not exist: $ExplicitPath"
        }
        return (Resolve-Path -LiteralPath $ExplicitPath).ProviderPath
    }

    $command = Get-Command codex -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }

    # Codex Desktop adds its CLI to its own terminal PATH, but ordinary terminals
    # may not inherit that PATH. Resolve the installed bundle without changing PATH.
    if (-not $BundledDirectory -and $env:LOCALAPPDATA) {
        $BundledDirectory = Join-Path $env:LOCALAPPDATA 'OpenAI/Codex/bin'
    }
    if ($BundledDirectory -and (Test-Path -LiteralPath $BundledDirectory -PathType Container)) {
        $candidate = Get-ChildItem -LiteralPath $BundledDirectory -Filter codex.exe -File -Recurse -ErrorAction SilentlyContinue |
            Sort-Object -Property LastWriteTimeUtc,FullName -Descending |
            Select-Object -First 1
        if ($candidate) { return $candidate.FullName }
    }

    throw 'Codex CLI was not found in PATH or the Codex Desktop installation. Open/install Codex Desktop, or run scripts/register-codex.ps1 -CodexPath "C:\path\to\codex.exe". Your saved Discord token does not need to be entered again.'
}
