// 预检沙盒副本里的 localStorage 配置（只打印白名单非密钥字段）
const fs = require('fs'), path = require('path')
const dir = 'test-shots/realtest-appdata/六面世界/Local Storage/leveldb'
let buf = ''
for (const f of fs.readdirSync(dir)) {
  if (f.startsWith('.')) continue
  const b = fs.readFileSync(path.join(dir, f))
  buf += b.toString('latin1')
  if (b.length % 2 === 0) buf += b.toString('utf16le').replace(/\0/g, '')
}
const fields = ['baseUrl', 'illustBaseUrl', 'model', 'illustModel', 'illustSize', 'illustQuality', 'currentSessionId', 'theme', 'scheme']
for (const f of fields) {
  const re = new RegExp('"' + f + '"\\s*:\\s*"([^"\\\\]{1,120})"')
  const m = buf.match(re)
  console.log(f, '=', m ? m[1] : '(not found)')
}
console.log('has storeKey v3:', buf.includes('sixworlds.codex.state.v3'))
