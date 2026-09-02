'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const mobile = path.join(root, 'mobile')
const buildCommand = process.platform === 'win32'
  ? {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', path.join('mobile', 'gradlew.bat'), '-p', 'mobile', 'assembleRelease']
    }
  : { command: path.join('.', 'mobile', 'gradlew'), args: ['-p', 'mobile', 'assembleRelease'] }

const build = spawnSync(buildCommand.command, buildCommand.args, {
  cwd: root,
  encoding: 'utf8'
})
process.stdout.write(build.stdout || '')
process.stderr.write(build.stderr || '')
if (build.status !== 0) process.exit(build.status || 1)

const outputDir = path.join(mobile, 'app', 'build', 'outputs', 'apk', 'release')
const apk = fs.readdirSync(outputDir)
  .filter((name) => name.endsWith('.apk'))
  .map((name) => path.join(outputDir, name))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
if (!apk) throw new Error('未生成 Android release APK')

const listing = spawnSync('jar', ['tf', apk], { cwd: root, encoding: 'utf8' })
if (listing.status !== 0) {
  process.stderr.write(listing.stderr || '')
  throw new Error('无法读取 Android release APK 内容')
}
const abis = [...new Set(listing.stdout.split(/\r?\n/)
  .map((entry) => /^lib\/([^/]+)\//.exec(entry)?.[1])
  .filter(Boolean))].sort()
if (abis.length !== 1 || abis[0] !== 'arm64-v8a') {
  throw new Error('release APK ABI 不合规：' + (abis.join(', ') || '未找到原生库'))
}

console.log('PASS  Android release APK 仅包含 arm64-v8a')
console.log('      ' + apk)
