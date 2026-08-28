// Mock OpenAI SSE server: 流式返回小说叙事文本，分多个 chunk，带间隔
const http = require('http')
const PORT = 9333
const STORY = [
  '甲龙历四年，晨光透过鲁迪乌斯房间的窗帘。',
  '他睁开眼，想起今天要和洛琪希学习水圣级魔法。',
  '「鲁迪，先从聚水开始。」洛琪希的声音从院子里传来。',
  '他集中精神，水滴在掌心汇聚成一个完美的球体。',
  '「做得好！接下来试试让它在空中悬浮。」',
  '这是他穿越到这个世界后，第一次感到真正的成就感。',
  '### 选项：',
  'A. 尝试让水球变成冰',
  'B. 询问洛琪希关于转移事件的事',
  'C. 继续练习，直到魔力耗尽'
].join('\\n')
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.includes('/chat/completions')) {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      const isStream = body.includes('stream');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      if (isStream) {
        const chunks = STORY.match(/[\\u4e00-\\u9fa5]{1,6}|[^\\u4e00-\\u9fa5]{1,4}/g) || []
        let i = 0
        const timer = setInterval(() => {
          if (i < chunks.length) {
            const piece = JSON.stringify({ content: chunks[i] });
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] }) + '\\n\\n')
            i++
          } else {
            res.write('data: ' + JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } }) + '\\n\\n')
            res.write('data: [DONE]\\n\\n')
            res.end()
            clearInterval(timer)
          }
        }, 120)
      } else {
        res.end(JSON.stringify({ choices: [{ message: { content: STORY } }], usage: { total_tokens: 300 } }))
      }
    })
  } else {
    res.writeHead(404); res.end()
  }
}).listen(PORT, () => console.log('mock SSE on ' + PORT))