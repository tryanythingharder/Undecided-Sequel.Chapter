// Mock OpenAI SSE server v2: 规避转义问题，用 fromCharCode 构造换行
const http = require('http')
const PORT = 9334
const NL = String.fromCharCode(10)
const STORY = [
  '甲龙历四年，晨光透过窗帘，鲁迪乌斯睁开眼。',
  '今天要和洛琪希学习水圣级魔法，他快步走向院子。',
  '「鲁迪，先从聚水开始。」洛琪希平静地说。',
  '他集中精神，水滴在掌心缓缓聚成一个球体。',
  '「做得好，接下来让它悬浮。」洛琪希罕见地笑了。',
  '穿越以来，他第一次感到真正的成就感。',
  '### 选项：',
  'A. 尝试将水球冻结成冰',
  'B. 询问洛琪希关于菲托亚领的传闻',
  'C. 继续练习，直到魔力见底'
].join(NL)
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.includes('/chat/completions')) {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const chunks = []
      for (let i = 0; i < STORY.length; i += 4) chunks.push(STORY.slice(i, i + 4))
      let i = 0
      const timer = setInterval(() => {
        if (i < chunks.length) {
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] }) + NL + NL)
          i++
        } else {
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } }) + NL + NL)
          res.write('data: [DONE]' + NL + NL)
          res.end()
          clearInterval(timer)
        }
      }, 60)
    })
  } else {
    res.writeHead(404); res.end()
  }
}).listen(PORT, () => console.log('mock v2 on ' + PORT))