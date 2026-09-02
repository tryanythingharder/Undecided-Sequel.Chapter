'use strict'
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const os = require('node:os')

const root = path.join(__dirname, '..')
const mobile = path.join(root, 'mobile')
const wrapper = path.join(mobile, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
const buildDir = path.join(os.tmpdir(), 'sixworlds-mobile-gradle-build')
const command = process.platform === 'win32' ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe') : wrapper
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'call "' + wrapper + '" -p "' + mobile + '" testDebugUnitTest']
  : ['-p', mobile, 'testDebugUnitTest']
const result = spawnSync(command, args, {
  cwd: root,
  stdio: 'inherit',
  windowsVerbatimArguments: process.platform === 'win32',
  env: { ...process.env, SIXWORLDS_GRADLE_BUILD_DIR: buildDir }
})
if (result.error) throw result.error
process.exitCode = result.status || 0
