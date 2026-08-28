// 独立 mock OpenAI 兼容服务端（供 CDP 截图/手测使用）
// 端口固定 4599；/chat/completions 流式输出叙事+选项；/images/generations 返回 1px PNG；/models 返回模型清单
const http = require('node:http')
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
let chatCalls = 0
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const json = (code, obj, headers) => {
      res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers || {}))
      res.end(JSON.stringify(obj))
    }
    if (req.url.endsWith('/chat/completions')) {
      const user = (() => { try { const p = JSON.parse(body); const u = p.messages.filter((m) => m.role === 'user').pop(); return u ? u.content : '' } catch { return '' } })()
      const wantsStream = (() => { try { return JSON.parse(body).stream === true } catch { return false } })()
      if (user.includes('触发错误')) return json(429, { error: { message: 'rate limit exceeded' } })
      const first = '【甲龙历 407.03.01｜清晨｜布耶纳村】\n薄雾笼罩的清晨，有人敲响了你的家门。你披上外衣走到门边，透过门缝看到一位灰袍旅人站在门外，斗篷上还沾着夜露。\n\n「打扰了。」他的声音沙哑，「我在寻找一位懂得古代文字的人，村里人说你或许能帮上忙。」\n\n他取出一枚刻着奇异纹路的石片，递到你面前。石片上的纹路在晨光中泛着微弱的蓝光。\n\n【状态】体力 100/100 ｜ 魔力 50/50 ｜ 金币 12 枚\n\n【你需要决定】\n【A】接过石片仔细端详（触发鉴定）\n【B】询问报酬后再决定\n【C】婉拒并关门（可能错过机遇）\n【D】假装不在家'
      const second = '【甲龙历 407.03.02｜午后｜村口老槐树下】\n你接过石片，指尖传来一阵微弱的麻痹感，仿佛有细小的电流顺着手臂爬升。旅人的眼中闪过一丝期待。\n\n「这是从北方遗迹带出来的东西。」他压低声音，「据说与六面世界的传说有关。」\n\n远处传来教堂的钟声，惊起一群白鸽。你注意到旅人斗篷内侧绣着一个你从未见过的纹章——六边形，中央是一只竖瞳。\n\n【状态】体力 98/100 ｜ 魔力 50/50 ｜ 金币 12 枚 ｜ 新物品：神秘石片\n\n【你需要决定】\n【A】追问遗迹的具体位置\n【B】要求先看看酬劳\n【C】试探他对六面世界了解多少\n【D】邀请他进屋详谈（安全，但耗时）'
      const reply = chatCalls === 0 ? first : second
      chatCalls += 1
      try { require('node:fs').appendFileSync(require('node:os').tmpdir() + '\\mock-calls.log', 'CALL#' + chatCalls + ' stream=' + wantsStream + ' user=[' + String(user).slice(0, 40) + ']\n') } catch {}
      const usage = { prompt_tokens: 1240 * chatCalls, completion_tokens: 186 * chatCalls, total_tokens: 1426 * chatCalls }
      if (wantsStream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        let i = 0
        const timer = setInterval(() => { // MOCK_CHUNK_MS 可调（默认 24ms；busy 类测试用 200ms 拉大忙碌窗口）
          if (i >= reply.length) {
            clearInterval(timer)
            res.write('data: ' + JSON.stringify({ choices: [], usage }) + '\n\n')
            res.write('data: [DONE]\n\n')
            res.end()
            return
          }
          const piece = reply.slice(i, i + 14)
          i += 14
          try { require('node:fs').appendFileSync(require('node:os').tmpdir() + '\\mock-chunks.log', Date.now() + ' chunk ' + i + '/' + reply.length + '\n') } catch {}
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n')
        }, Number(process.env.MOCK_CHUNK_MS || 24))
        return
      }
      return json(200, { choices: [{ message: { role: 'assistant', content: reply } }], usage })
    }
    if (req.url.endsWith('/images/generations')) return json(200, { data: [{ b64_json: PNG_1PX }] })
    if (req.url.endsWith('/models')) {
      if (req.headers.authorization !== 'Bearer sk-mock') return json(401, { error: { message: 'bad key' } })
      return json(200, { data: [{ id: 'mock-chat' }, { id: 'mock-image' }, { id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }, { id: 'kimi-k2' }, { id: 'glm-4.6' }, { id: 'qwen-max' }] })
    }
    json(404, { error: 'not found: ' + req.url })
  })
})
server.listen(4599, '127.0.0.1', () => console.log('MOCK_READY http://127.0.0.1:4599'))
