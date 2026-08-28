# run-cdp-suite.ps1 - one-command full CDP regression for six-worlds app
# Usage: powershell -File scripts-dev\run-cdp-suite.ps1 [-Port 9335]
# Rules baked in (see docs-ux-research.md): sweep mocks by cmdline before AND after;
# validators must be call-order independent; electron launched by Start-Process (pipes are sandbox-blocked).
param([string]$Port = '9335')

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$mock = $null
$app = $null
$results = @()

function Sweep-Mocks {
  # 双保险：①按命令行清（ForEach+Id，直接管道会静默失败）②按端口占用清（残留 DSH-node mock 可逃逸①）
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'mock-server' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $conn = Get-NetTCPConnection -LocalPort 4599 -State Listen -ErrorAction SilentlyContinue
  if ($conn) { $conn | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }
}

function Sweep-Mocks {
  # 双保险：①按命令行清（ForEach+Id，直接管道会静默失败）②按端口占用清（残留 DSH-node mock 可逃逸①）
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'mock-server' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $conn = Get-NetTCPConnection -LocalPort 4599 -State Listen -ErrorAction SilentlyContinue
  if ($conn) { $conn | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }
}

function Sweep-Electron {
  # R70：清残留 electron（上轮套件/用户实例未完全退出的进程树会抢占 CDP 端口与 userData SingletonLock）
  Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $cdp = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($cdp) { $cdp | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }
  Start-Sleep -Seconds 2
}

try {
  Sweep-Electron
  Sweep-Mocks
  $mock = Start-Process -FilePath 'node' -ArgumentList 'scripts-dev\mock-server.cjs' -WorkingDirectory $root -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 2
  $env:SIXWORLDS_TEST = '1'
  $app = Start-Process -FilePath (Join-Path $root 'node_modules\electron\dist\electron.exe') -ArgumentList '.', "--remote-debugging-port=$Port" -WorkingDirectory $root -RedirectStandardError "$env:TEMP\suite-err.txt" -RedirectStandardOutput "$env:TEMP\suite-out.txt" -PassThru
  Start-Sleep -Seconds 5

  $suites = @(
    'validate-r20', 'validate-r21', 'validate-r22',
    'validate-r5', 'validate-r7', 'validate-r10', 'validate-r13',
    'validate-r15', 'validate-r19', 'validate-r23', 'validate-r24', 'validate-r25', 'validate-r26', 'validate-r27', 'validate-r28', 'validate-r29',     'validate-r30', 'validate-r31', 'validate-r32', 'validate-r33', 'validate-r34', 'validate-r35', 'validate-r36', 'validate-r37', 'validate-r38', 'validate-r39', 'validate-r40', 'validate-r41', 'validate-r42', 'validate-r75',
    'audit-r9-matrix', 'audit-r11-responsive', 'audit-r53-longsession', 'audit-r70-structure'
  )
  foreach ($s in $suites) {
    $last = node (Join-Path $root "scripts-dev\$s.cjs") $Port 2>&1 | Select-Object -Last 1
    $ok = ("$last" -match 'ALL PASS') -or ("$last" -match '^PASS ')
    $results += [pscustomobject]@{ Suite = $s; Result = "$last"; OK = $ok }
    "{0} => {1}" -f $s, $last
  }
}
finally {
  if ($app) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
  Sweep-Mocks
}

$failCount = @($results | Where-Object { -not $_.OK }).Count
"----"
"SUITE SUMMARY: $($results.Count - $failCount)/$($results.Count) green"
if ($failCount -gt 0) { exit 1 } else { exit 0 }
