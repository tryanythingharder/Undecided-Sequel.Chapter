// 读沙盒 localStorage 里配置的画风（复用已提交的 scan-ls 思路，只读白名单字段）
const fs = require('fs'), path = require('path')
const dir = 'test-shots/realtest-appdata/六面世界/Local Storage/leveldb'
let buf = ''
for (const f of fs.readdirSync(dir)) {
  if (f.startsWith('.')) continue
  const b = fs.readFileSync(path.join(dir, f))
  buf += b.toString('latin1')
  if (b.length % 2 === 0) buf += b.toString('utf16le').replace(/\0/g, '')
}
const m = buf.match(/"illustStyle"\s*:\s*"([^"\\]{1,40})"/)
const m2 = buf.match(/"illustCustom"\s*:\s*"([^"\\]{1,240})"/)
console.log('illustStyle =', m ? m[1] : '(not found)', '| custom =', m2 ? m2[1] : '-')
