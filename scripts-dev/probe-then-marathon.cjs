'use strict'
/* 恢复探测 + 自动百轮：每 15 分钟跑一次 2 轮真实探针（npm run test:real），
 * 通过（API 恢复）→ 立即启动百轮真实马拉松。最多探测 6 次（~1.5h）。 */
const { execSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const root = path.join(__dirname, '..')

function probe() {
  try {
    const out = execSync('npm run test:real', { cwd: root, encoding: 'utf8', timeout: 15 * 60 * 1000, stdio: ['ignore', 'pipe', 'pipe'] })
    return out.includes('ALL_PASS')
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '')
    return out.includes('ALL_PASS')
  }
}

console.log('[' + new Date().toLocaleTimeString('zh-CN') + '] 恢复探测启动（每 15 分钟一次，最多 6 次）')
for (let i = 1; i <= 6; i++) {
  if (probe()) {
    console.log('[' + new Date().toLocaleTimeString('zh-CN') + '] 探测 ' + i + ' 次通过：API 已恢复，启动百轮马拉松')
    process.exit(0) // 退出码 0 = 恢复，外层立即启动马拉松
  }
  console.log('[' + new Date().toLocaleTimeString('zh-CN') + '] 探测 ' + i + ' 次失败（仍故障）')
  if (i < 6) {
    const until = Date.now() + 15 * 60 * 1000
    while (Date.now() < until) { require('node:child_process').execSync('timeout /t 30 /nobreak >nul 2>&1 || sleep 30') }
  }
}
console.log('6 次探测全部失败：服务 1.5 小时未恢复，放弃')
process.exit(1)
