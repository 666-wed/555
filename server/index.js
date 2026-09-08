import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import initSqlJs from 'sql.js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
// Render 持久磁盘用环境变量 DB_PATH；本地默认项目 data 目录
const dbPath = process.env.DB_PATH || path.join(rootDir, 'data', 'bridge.sqlite')
const dataDir = path.dirname(dbPath)
fs.mkdirSync(dataDir, { recursive: true })

const stageProfiles = {
  小学阶段: { age: 10, interests: ['画画', '积木', '自然观察'] },
  青春期: { age: 15, interests: ['篮球', '摄影', '游戏音乐'] },
  成年早期: { age: 21, interests: ['旅行', '电影', '新鲜的工作想法'] }
}

const SQL = await initSqlJs({
  locateFile: (file) => path.join(rootDir, 'node_modules', 'sql.js', 'dist', file)
})
const db = fs.existsSync(dbPath)
  ? new SQL.Database(new Uint8Array(fs.readFileSync(dbPath)))
  : new SQL.Database()

db.run(`
  CREATE TABLE IF NOT EXISTS children (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    age INTEGER NOT NULL,
    stage TEXT NOT NULL,
    interests TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL,
    stage TEXT NOT NULL,
    mood TEXT NOT NULL,
    energy INTEGER NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(child_id) REFERENCES children(id)
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL,
    stage TEXT NOT NULL,
    topic TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(child_id) REFERENCES children(id)
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS email_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`)

function queryAll(sql, params = []) {
  const statement = db.prepare(sql)
  statement.bind(params)
  const rows = []
  while (statement.step()) rows.push(statement.getAsObject())
  statement.free()
  return rows
}

function queryOne(sql, params = []) {
  return queryAll(sql, params)[0] || null
}

function persist() {
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
}

function run(sql, params = []) {
  db.run(sql, params)
  persist()
}

if (!queryOne('SELECT id FROM children WHERE id = 1')) {
  run(
    'INSERT INTO children (id, name, age, stage, interests, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [1, '我的孩子', 10, '小学阶段', JSON.stringify(stageProfiles['小学阶段'].interests), new Date().toISOString()]
  )
  persist()
}

// 一次性清理旧的模拟数据
{
  const child = queryOne('SELECT name FROM children WHERE id = 1')
  if (child && child.name === '林予安') {
    db.run("UPDATE children SET name = '我的孩子', age = 10, stage = '小学阶段', interests = ? WHERE id = 1", [JSON.stringify(stageProfiles['小学阶段'].interests)])
    db.run("DELETE FROM checkins WHERE child_id = 1 AND note IN ('放学回来比平时安静，主动把耳机摘下来吃了晚饭。', '写作业到很晚，中间出来倒了一杯水，没有催促。', '和朋友打完球回来，路上分享了一首歌。')")
    db.run("DELETE FROM conversations WHERE child_id = 1 AND message = '这周有没有什么时刻，让你觉得自己做得不错？'")
    persist()
  }
}

const app = express()
app.use(cors({
  origin: (origin, callback) => {
    // 允许同源（一体化部署/Render）、Vercel 域名、FRONTEND_URL、本地开发
    if (!origin
      || /^https:\/\/.*\.onrender\.com$/.test(origin)
      || /^https:\/\/.*\.vercel\.app$/.test(origin)
      || origin === process.env.FRONTEND_URL
      || /^http:\/\/localhost:\d+$/.test(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  }
}))
app.use(express.json())

function getSessionUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  return queryOne(
    'SELECT users.id, users.email, users.name FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ?',
    [token]
  )
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req)
  if (!user) return res.status(401).json({ message: '请先登录' })
  req.user = user
  next()
}

function getChild(stage = '青春期') {
  const profile = stageProfiles[stage] || stageProfiles.青春期
  const record = queryOne('SELECT * FROM children WHERE id = 1')
  return { ...record, age: profile.age, stage, interests: profile.interests }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
}

async function deliverVerificationCode(email, code) {
  // 优先使用 Resend HTTP API（443 端口，云平台友好）
  if (process.env.RESEND_API_KEY) {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.SMTP_FROM || 'onboarding@resend.dev',
        to: email,
        subject: '童心小守护登录验证码',
        text: `你的童心小守护登录验证码是 ${code}，10分钟内有效。`
      })
    })
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      throw new Error(`resend api ${resp.status}: ${errText.slice(0, 300)}`)
    }
    return { sent: true }
  }
  // 兼容旧 SMTP 配置（云平台通常不支持，仅本地用）
  if (process.env.SMTP_HOST) {
    const nodemailer = await import('nodemailer')
    const transporter = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
    })
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: '童心小守护登录验证码',
      text: `你的童心小守护登录验证码是 ${code}，10分钟内有效。`
    })
    return { sent: true }
  }
  console.log(`[童心小守护] 开发模式验证码 ${email}: ${code}`)
  return { sent: false, devCode: code }
}

app.post('/api/auth/request-code', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!isValidEmail(email)) return res.status(400).json({ message: '请输入真实有效的邮箱地址' })
  const code = String(crypto.randomInt(100000, 1000000))
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + 10 * 60 * 1000)
  run('DELETE FROM email_codes WHERE email = ? OR expires_at < ?', [email, createdAt.toISOString()])
  run(
    'INSERT INTO email_codes (email, code, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)',
    [email, code, expiresAt.toISOString(), createdAt.toISOString()]
  )
  try {
    const delivery = await deliverVerificationCode(email, code)
    res.json({
      ok: true,
      message: delivery.sent ? '验证码已发送，请查收邮箱' : '开发模式已生成验证码',
      development: !delivery.sent,
      devCode: delivery.devCode
    })
  } catch (error) {
    console.error('[童心小守护] 验证码发送失败', email, error.message)
    res.status(500).json({ message: '验证码发送失败', detail: String(error.message).slice(0, 500) })
  }
})

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const code = String(req.body?.code || '').trim()
  const password = String(req.body?.password || '')
  if (!isValidEmail(email)) return res.status(400).json({ message: '请输入真实有效的邮箱地址' })

  // 模式一：邮箱+密码登录
  if (password) {
    const user = queryOne('SELECT id, email, name, password FROM users WHERE email = ?', [email])
    if (!user || !user.password) return res.status(401).json({ message: '邮箱未注册或未设密码' })
    const [salt, hash] = user.password.split(':')
    const derived = crypto.scryptSync(password, salt, 64).toString('hex')
    if (derived !== hash) return res.status(401).json({ message: '密码不正确' })
    const token = `${crypto.randomUUID()}-${Date.now()}`
    run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', [token, user.id, new Date().toISOString()])
    return res.json({ token, user: { id: user.id, email: user.email, name: user.name } })
  }

  // 模式二：邮箱验证码登录（保留兼容）
  if (!code) return res.status(400).json({ message: '请输入密码或验证码' })
  const codeRecord = queryOne(
    'SELECT id FROM email_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1',
    [email, code, new Date().toISOString()]
  )
  if (!codeRecord) return res.status(401).json({ message: '验证码不正确或已过期' })
  run('UPDATE email_codes SET used = 1 WHERE id = ?', [codeRecord.id])
  let user = queryOne('SELECT id, email, name FROM users WHERE email = ?', [email])
  if (!user) {
    const nextId = queryOne('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM users').id
    const name = email.split('@')[0].slice(0, 20)
    run(
      'INSERT INTO users (id, email, password, name, created_at) VALUES (?, ?, ?, ?, ?)',
      [nextId, email, '', name, new Date().toISOString()]
    )
    user = { id: nextId, email, name }
  }
  const token = `${crypto.randomUUID()}-${Date.now()}`
  run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', [token, user.id, new Date().toISOString()])
  res.json({ token, user })
})

// 邮箱+密码注册
app.post('/api/auth/register', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const name = String(req.body?.name || '').trim() || email.split('@')[0].slice(0, 20)
  if (!isValidEmail(email)) return res.status(400).json({ message: '请输入真实有效的邮箱地址' })
  if (password.length < 6) return res.status(400).json({ message: '密码至少 6 位' })

  const existing = queryOne('SELECT id FROM users WHERE email = ?', [email])
  if (existing) return res.status(409).json({ message: '该邮箱已注册' })

  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  const passwordHashed = `${salt}:${hash}`
  const nextId = queryOne('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM users').id
  run(
    'INSERT INTO users (id, email, password, name, created_at) VALUES (?, ?, ?, ?, ?)',
    [nextId, email, passwordHashed, name, new Date().toISOString()]
  )
  const token = `${crypto.randomUUID()}-${Date.now()}`
  run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', [token, nextId, new Date().toISOString()])
  res.json({ token, user: { id: nextId, email, name } })
})

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }))

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (token) run('DELETE FROM sessions WHERE token = ?', [token])
  res.json({ ok: true })
})

app.get('/api/dashboard', requireAuth, (req, res) => {
  const stage = req.query.stage || '青春期'
  const child = getChild(stage)
  const checkins = queryAll('SELECT * FROM checkins WHERE child_id = 1 ORDER BY datetime(created_at) DESC LIMIT 30')
  const conversations = queryAll('SELECT * FROM conversations WHERE child_id = 1 ORDER BY datetime(created_at) DESC LIMIT 30')
  res.json({ child, checkins, conversations })
})

app.post('/api/checkins', requireAuth, (req, res) => {
  const { stage = '青春期', mood, energy = 3, note = '' } = req.body || {}
  if (!mood || !Number.isInteger(Number(energy)) || Number(energy) < 1 || Number(energy) > 5) {
    return res.status(400).json({ message: 'mood and energy are required' })
  }
  run(
    'INSERT INTO checkins (child_id, stage, mood, energy, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [1, String(stage).slice(0, 20), String(mood).slice(0, 20), Number(energy), String(note).slice(0, 300), new Date().toISOString()]
  )
  res.status(201).json({ id: queryOne('SELECT id FROM checkins ORDER BY id DESC LIMIT 1').id })
})

app.post('/api/conversations', requireAuth, (req, res) => {
  const { stage = '青春期', topic = '今天的状态', message } = req.body || {}
  if (!message) return res.status(400).json({ message: 'message is required' })
  run(
    'INSERT INTO conversations (child_id, stage, topic, message, created_at) VALUES (?, ?, ?, ?, ?)',
    [1, String(stage).slice(0, 20), String(topic).slice(0, 60), String(message).slice(0, 300), new Date().toISOString()]
  )
  res.status(201).json({ id: queryOne('SELECT id FROM conversations ORDER BY id DESC LIMIT 1').id })
})

function detectLanguage(text) {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja'
  if (/[\uac00-\ud7af]/.test(text)) return 'ko'
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh-CN'
  if (/[áéíóúñ¿¡]/i.test(text)) return 'es'
  return 'en'
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

// AI 提供商优先级：硅基流动(免费) > DeepSeek > 文心
function getAIProvider() {
  if (process.env.SILICONFLOW_API_KEY) {
    return {
      apiUrl: 'https://api.siliconflow.cn/v1/chat/completions',
      apiKey: process.env.SILICONFLOW_API_KEY,
      model: process.env.SILICONFLOW_MODEL || 'Qwen/Qwen2.5-7B-Instruct',
      provider: 'siliconflow'
    }
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return {
      apiUrl: 'https://api.deepseek.com/chat/completions',
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: 'deepseek-chat',
      provider: 'deepseek'
    }
  }
  if (process.env.ERNIE_API_KEY) {
    return {
      apiUrl: 'https://qianfan.baidubce.com/v2/chat/completions',
      apiKey: process.env.ERNIE_API_KEY,
      model: process.env.ERNIE_MODEL || 'ernie-speed-128k',
      provider: 'ernie'
    }
  }
  return null
}

// 统一调用 AI 对话接口，返回纯文本回复
// 支持 prompt（单轮）或 messages（多轮，含 system/user/assistant）
async function chatCompletion({ prompt, messages, temperature = 0.65, maxTokens = 700 }) {
  const ai = getAIProvider()
  if (!ai) {
    const err = new Error('NO_AI_KEY')
    err.code = 'NO_AI_KEY'
    throw err
  }
  const { apiUrl, apiKey, model, provider } = ai
  const payloadMessages = messages || [{ role: 'user', content: prompt }]
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: payloadMessages,
      temperature,
      max_tokens: maxTokens
    })
  })
  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`${provider} returned ${response.status}: ${errText.slice(0, 200)}`)
  }
  const data = await response.json()
  const reply = String(data?.choices?.[0]?.message?.content || '').trim()
  if (!reply) throw new Error(`empty AI response: ${JSON.stringify(data).slice(0, 200)}`)
  return reply
}

app.post('/api/language/assist', requireAuth, async (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 1000)
  const requestedSource = String(req.body?.source || 'auto')
  const target = String(req.body?.target || 'en')
  const tone = String(req.body?.tone || 'warm')
  const allowedLanguages = new Set(['zh-CN', 'en', 'ja', 'ko', 'es'])
  const source = requestedSource === 'auto' ? detectLanguage(text) : requestedSource
  if (!text) return res.status(400).json({ message: '请输入需要翻译的内容' })
  if (!allowedLanguages.has(source) || !allowedLanguages.has(target)) {
    return res.status(400).json({ message: '暂不支持这组语言' })
  }
  try {
    const prompt = [
      '你是一个温和、准确的亲子语言助手。',
      `请把用户的话处理成适合使用 ${target} 的自然表达。原文语言是 ${source}，语气偏好是 ${tone}。`,
      '请严格按以下格式返回，不要添加额外标题：',
      '自然表达：',
      '中文解释：',
      '亲子沟通建议：',
      '',
      `用户原话：${text}`
    ].join('\n')
    const reply = await chatCompletion({ prompt, temperature: 0.65, maxTokens: 700 })
    res.json({ reply, source, target, tone })
  } catch (error) {
    console.error('[童心小守护] 免费 AI 服务请求失败', error.message)
    if (error.code === 'NO_AI_KEY') {
      return res.status(503).json({ message: '请先在 Render 环境变量配置 SILICONFLOW_API_KEY 或 DEEPSEEK_API_KEY' })
    }
    res.status(502).json({ message: '免费 AI 服务暂时不可用', detail: String(error.message).slice(0, 500) })
  }
})

// 情绪镜头深度分析：接收前端 MediaPipe 检测到的情绪数据，调用 AI 生成解读与沟通建议
app.post('/api/camera/analyze', requireAuth, async (req, res) => {
  const stage = String(req.body?.stage || '青春期').slice(0, 20)
  const mood = String(req.body?.mood || '').slice(0, 20)
  const confidence = Math.max(0, Math.min(1, Number(req.body?.confidence) || 0))
  const signals = Array.isArray(req.body?.signals) ? req.body.signals.slice(0, 8).map((s) => String(s).slice(0, 80)) : []
  const summary = String(req.body?.summary || '').slice(0, 200)
  if (!mood) return res.status(400).json({ message: 'mood is required' })

  try {
    const prompt = [
      '你是一位温和、专业的亲子心理咨询师，擅长通过非语言信号理解孩子。',
      '用户通过摄像头捕捉到孩子的表情与动作特征，得到以下辅助观察结果：',
      `- 推断情绪：${mood}`,
      `- 置信度：${Math.round(confidence * 100)}%`,
      `- 观察摘要：${summary || '无'}`,
      `- 捕捉到的信号：${signals.length ? signals.join('、') : '无明显信号'}`,
      `- 孩子所处成长阶段：${stage}`,
      '',
      '请基于以上信息，给出一份温和、可操作的分析。要求：',
      '1. 先说明这只是辅助观察，真正的情绪需要在真实交流中确认（避免让家长过度依赖）。',
      '2. 用 1-2 句话解读这个情绪可能意味着什么，语气要共情、不评判。',
      '3. 给出 3 条具体的沟通建议，每条不超过 30 字，要可直接使用。',
      '4. 最后给出一句温暖的开场白，适合家长此时对孩子说。',
      '',
      '请严格按以下格式返回，不要添加 Markdown 标题或编号前缀：',
      '解读：',
      '建议1：',
      '建议2：',
      '建议3：',
      '开场白：'
    ].join('\n')

    const reply = await chatCompletion({ prompt, temperature: 0.7, maxTokens: 600 })

    // 解析结构化输出
    const interpretation = (reply.match(/解读[：:]\s*([\s\S]*?)(?=建议1[：:]|$)/)?.[1] || '').trim()
    const suggestion1 = (reply.match(/建议1[：:]\s*([^\n]*)/)?.[1] || '').trim()
    const suggestion2 = (reply.match(/建议2[：:]\s*([^\n]*)/)?.[1] || '').trim()
    const suggestion3 = (reply.match(/建议3[：:]\s*([^\n]*)/)?.[1] || '').trim()
    const opener = (reply.match(/开场白[：:]\s*([\s\S]*)/)?.[1] || '').trim()

    const suggestions = [suggestion1, suggestion2, suggestion3].filter(Boolean)

    res.json({
      interpretation: interpretation || reply,
      suggestions: suggestions.length ? suggestions : ['先安静地陪在他身边，不急着问为什么。', '用具体的小事开口，比如“今天晚饭想吃什么？”', '告诉他“不管怎样，我都在”。'],
      opener: opener || '我在这里，你想说的时候我都听着。',
      raw: reply
    })
  } catch (error) {
    console.error('[童心小守护] 情绪镜头 AI 分析失败', error.message)
    if (error.code === 'NO_AI_KEY') {
      return res.status(503).json({ message: '请先在 Render 环境变量配置 SILICONFLOW_API_KEY 或 DEEPSEEK_API_KEY' })
    }
    res.status(502).json({ message: 'AI 分析暂时不可用', detail: String(error.message).slice(0, 500) })
  }
})

// AI 多轮对话：接收用户消息和历史记录，返回 AI 回复
app.post('/api/chat', requireAuth, async (req, res) => {
  const message = String(req.body?.message || '').trim().slice(0, 2000)
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-20) : []
  if (!message) return res.status(400).json({ message: '请输入消息内容' })

  try {
    const systemPrompt = [
      '你是「童心小守护」的 AI 助手，一位温和、专业的亲子沟通顾问。',
      '你的使命是帮助家长更好地理解孩子、改善亲子关系。',
      '请始终用温暖、共情、不评判的语气回应。',
      '回答要简洁实用，优先给出可操作的建议或可以直接使用的话术。',
      '当用户分享情绪或困扰时，先共情，再给建议。'
    ].join('\n')

    const messages = [{ role: 'system', content: systemPrompt }]
    for (const h of history) {
      const role = h.role === 'assistant' ? 'assistant' : 'user'
      messages.push({ role, content: String(h.content || '').slice(0, 1000) })
    }
    messages.push({ role: 'user', content: message })

    const reply = await chatCompletion({ messages, temperature: 0.7, maxTokens: 800 })
    res.json({ reply })
  } catch (error) {
    console.error('[童心小守护] AI 对话失败', error.message)
    if (error.code === 'NO_AI_KEY') {
      return res.status(503).json({ message: '请先在 Render 环境变量配置 SILICONFLOW_API_KEY 或 DEEPSEEK_API_KEY' })
    }
    res.status(502).json({ message: 'AI 暂时无法回复，请稍后再试', detail: String(error.message).slice(0, 500) })
  }
})

const distDir = path.join(rootDir, 'dist')
// 仅当本地一体化部署时托管 dist；生产环境前后端分离，不走这里
if (process.env.SERVE_STATIC !== 'false' && fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

const port = process.env.PORT || 3002
app.listen(port, () => {
  console.log(`Parent-child bridge API running at http://localhost:${port}`)
})
