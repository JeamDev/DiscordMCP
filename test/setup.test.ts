import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('Windows setup resolves Codex with and without PATH and supports a custom installation', { skip: process.platform !== 'win32', timeout: 15_000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'discord-mcp-setup-test-'));
  t.after(async () => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('discord-mcp-setup-test-'));
    await rm(resolved, { recursive: true, force: true });
  });
  const bundle = path.join(root, 'Codex Desktop', 'bin');
  const old = path.join(bundle, 'old-release', 'codex.exe');
  const current = path.join(bundle, 'current-release', 'codex.exe');
  for (const file of [old, current]) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'fixture, never executed');
  }
  await utimes(old, new Date('2025-01-01'), new Date('2025-01-01'));
  await utimes(current, new Date('2026-01-01'), new Date('2026-01-01'));
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const resolver = fileURLToPath(new URL('../scripts/resolve-codex.ps1', import.meta.url));
  const driver = path.join(root, 'resolve-test.ps1');
  await writeFile(driver, `
$ErrorActionPreference = 'Stop'
. ${quote(resolver)}
# Mock lookup only. No CLI executable is run and no user config is modified.
function Get-Command { param($Name, $CommandType, $ErrorAction) if ($script:fakeCommand) { [pscustomobject]@{ Source = $script:fakeCommand } } }
$script:fakeCommand = 'C:\\custom-cli\\codex.cmd'
$fromPath = Resolve-CodexExecutable -BundledDirectory ${quote(bundle)}
$script:fakeCommand = $null
$fromBundle = Resolve-CodexExecutable -BundledDirectory ${quote(bundle)}
$explicit = Resolve-CodexExecutable -ExplicitPath ${quote(old)} -BundledDirectory ${quote(bundle)}
$missing = $false
try { Resolve-CodexExecutable -BundledDirectory ${quote(path.join(root, 'absent'))} } catch { $missing = $_.Exception.Message -match 'does not need to be entered again' }
$badOverride = $false
try { Resolve-CodexExecutable -ExplicitPath ${quote(path.join(root, 'absent.exe'))} } catch { $badOverride = $_.Exception.Message -match 'does not exist' }
[pscustomobject]@{ fromPath = $fromPath; fromBundle = $fromBundle; explicit = $explicit; missing = $missing; badOverride = $badOverride } | ConvertTo-Json -Compress
`);
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const output = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', driver], { encoding: 'utf8', windowsHide: true, timeout: 12_000 });
  const result = JSON.parse(output.trim());
  assert.equal(result.fromPath, 'C:\\custom-cli\\codex.cmd');
  assert.equal(result.fromBundle, current);
  assert.equal(result.explicit, old);
  assert.equal(result.missing, true);
  assert.equal(result.badOverride, true);
});
