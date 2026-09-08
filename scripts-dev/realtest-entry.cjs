/* 真实测试专用入口（不进 git）：文件级入口让 Chromium 单例标识区别于用户真实实例（其以 electron . 启动），
 * 避免被 requestSingleInstanceLock 静默退出；同时文件入口丢失 package.json 应用名 → userData 默认变成
 * %APPDATA%\Electron，所以必须在 require main.cjs 前显式指回沙盒副本。 */
const path = require('node:path')
const { app } = require('electron')

const SANDBOX = path.join(__dirname, '..', 'test-shots', 'realtest-appdata', '六面世界')
app.setPath('userData', SANDBOX)
console.log('[realtest-entry] userData =', app.getPath('userData'))

require(path.join(__dirname, '..', 'main.cjs'))
