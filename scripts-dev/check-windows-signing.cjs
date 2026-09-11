'use strict'

/* Windows Authenticode 签名验证闸门（发布链路的防回归）
 * 背景：release.yml 已把 CSC_LINK / CSC_KEY_PASSWORD 透传给 npm run dist——证书配置
 * 后 electron-builder 会自动签名，但没有任何环节断言「签名真的落上了」。签名被静默
 * 跳过（证书格式漂移、secret 名写错、electron-builder 行为变更）时，Release 会照常
 * 发布出未签名产物，SmartScreen 直接弹「未知发布者」，用户侧才暴露。
 *
 * 语义（与 npm run dist 的契约一致）：
 *   - 配置了 CSC_LINK（env 非空）→ 主 exe 与 Setup/Portable 三个产物必须全部带
 *     Authenticode 签名，缺一个即失败；
 *   - 未配置 → 打印显式警告（::warning:: 注解保留 CI 可见性），不失败——未签名出包
 *     是当前文档化的现状，闸门只负责「不许静默从签名退化到未签名」。
 *   - 自签名/时间戳服务器不可达导致 Status 非 Valid 时不失败，只提示——Status 取决于
 *     信任链，CI runner 的根证书信任与真实发布证书强相关，这里只锁「有没有签名」。
 *
 * 本地复现（自签名证书，output/ 已 gitignore 不入库）：
 *   powershell New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=...' ^
 *     -CertStoreLocation Cert:\CurrentUser\My | Export-PFXCertificate ... test-signing.pfx
 *   CSC_LINK=<绝对路径或 base64> CSC_KEY_PASSWORD=... npm run dist
 *   node scripts-dev/check-windows-signing.cjs   # CSC_LINK 已在 env 里则按「已配置」校验
 * 用 PowerShell Get-AuthenticodeSignature 校验，无需 Windows SDK。
 */

const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const distDir = path.join(root, 'dist')

function fail(msg) { console.error('FAIL  ' + msg); process.exit(1) }

const configured = !!(process.env.CSC_LINK && process.env.CSC_LINK.trim())

// 版本号随 package.json 变：产物名一律 pattern 兜底（不硬编码版本——硬编码在 bump
// 后的第一个 tag 上必炸）；正则转义须先转义 '.' 再替换 '*'（顺序反了会把 '.*' 也
// 转义成「零个或多个点」，永远匹配不到带数字的版本号）
const fs = require('node:fs')
const byMtimeDesc = (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs
const pick = (pattern) => {
  const re = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
  const hits = fs.readdirSync(distDir)
    .filter((n) => re.test(n))
    .map((n) => path.join(distDir, n))
    .filter((p) => fs.statSync(p).isFile())
    .sort(byMtimeDesc)
  return hits[0] || null
}
const targets = [
  { file: path.join(distDir, 'win-unpacked', '六面世界.exe'), label: '主程序（win-unpacked）' },
  { label: 'NSIS 安装包', file: pick('SixWorlds-Setup-*.exe') || '' },
  { label: '便携版', file: pick('SixWorlds-Portable-*.exe') || '' }
]
if (targets.some((t) => !t.file)) {
  fail('产物缺失（先跑 npm run dist）: ' + targets.filter((t) => !t.file).map((t) => t.label).join(', ') +
    '——dist 目录: ' + (fs.existsSync(distDir) ? fs.readdirSync(distDir).join(', ') : '不存在'))
}

const psScript = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$files = @(' + targets.map((t) => "'" + t.file.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'").join(', ') + ')',
  'foreach ($f in $files) {',
  '  $s = Get-AuthenticodeSignature -LiteralPath $f',
  '  $cn = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { "" }',
  '  Write-Output ($f + "`t" + $s.Status + "`t" + $cn)',
  '}'
].join('\n')

const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { encoding: 'utf8' })
if (ps.status !== 0) fail('Get-AuthenticodeSignature 执行失败: ' + (ps.stderr || ps.stdout || ''))

const rows = ps.stdout.split(/\r?\n/).filter((l) => l.includes('\t')).map((l) => l.split('\t'))

if (!configured) {
  console.log('WARN  未配置 CSC_LINK——产物未签名出包（SmartScreen 会弹未知发布者警告）。')
  console.log('      配置 GitHub secrets CSC_LINK（base64 的 .pfx）与 CSC_KEY_PASSWORD 后自动签名。')
  for (const r of rows) console.log('      ' + r[0] + ' -> ' + r[1])
  process.exit(0)
}

const unsigned = rows.filter((r) => !r[2])
for (const r of rows) console.log((r[2] ? 'PASS' : 'FAIL') + '  ' + r[0] + '  ' + r[1] + (r[2] ? '  | ' + r[2] : '  | 无签名'))
if (unsigned.length) {
  fail('已配置 CSC_LINK 但 ' + unsigned.length + ' 个产物未签名——签名被静默跳过（检查 secret 值/证书格式/electron-builder 日志中的 signing 行）')
}
const valid = rows.filter((r) => r[1] === 'Valid').length
console.log('NOTE  ' + valid + '/' + rows.length + ' 个产物签名状态 Valid；其余为 ' + [...new Set(rows.map((r) => r[1]))].join('/') + '（自签名或时间戳异常不影响「已签名」判定）')
console.log('PASS  Windows 产物 Authenticode 签名闸门通过（' + rows.length + ' 个产物全部带签名）')
