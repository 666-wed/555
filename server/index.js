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
  const now = Date.now()
  run(
    'INSERT INTO children (id, name, age, stage, interests, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [1, '林予安', 15, '青春期', JSON.stringify(stageProfiles.青春期.interests), new Date().toISOString()]
  )
  db.run(
    'INSERT INTO checkins (child_id, stage, mood, energy, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [1, '青春期', '平静', 3, '放学回来比平时安静，主动把耳机摘下来吃了晚饭。', new Date(now - 86400000).toISOString()]
  )
  db.run(
    'INSERT INTO checkins (child_id, stage, mood, energy, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [1, '青春期', '疲惫', 2, '写作业到很晚，中间出来倒了一杯水，没有催促。', new Date(now - 2 * 86400000).toISOString()]
  )
  db.run(
    'INSERT INTO checkins (child_id, stage, mood, energy, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [1, '青春期', '开心', 4, '和朋友打完球回来，路上分享了一首歌。', new Date(now - 3 * 86400000).toISOString()]
  )
  db.run(
    'INSERT INTO conversations (child_id, stage, topic, message, created_at) VALUES (?, ?, ?, ?, ?)',
    [1, '青春期', '周末安排', '这周有没有什么时刻，让你觉得自己做得不错？', new Date(now - 4 * 86400000).toISOString()]
  )
  persist()
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
    res.status(500).json({ message: '验证码发送失败，请检查邮箱服务配置' })
  }
})

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const code = String(req.body?.code || '').trim()
  if (!isValidEmail(email)) return res.status(400).json({ message: '请输入真实有效的邮箱地址' })
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
  const ernieKey = process.env.ERNIE_API_KEY
  if (!ernieKey) {
    return res.status(503).json({ message: '请先在 .env 中配置 ERNIE_API_KEY（百度千帆 console.bce.baidu.com）' })
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
    const modelPath = process.env.ERNIE_MODEL || 'ernie-speed-128k'
    const response = await fetch(`https://qianfan.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${modelPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ernieKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.65,
        max_output_tokens: 700
      })
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`ernie returned ${response.status}: ${errText.slice(0, 200)}`)
    }
    const data = await response.json()
    const reply = String(data?.result || '').trim()
    if (!reply) throw new Error('empty AI response')
    res.json({
      reply,
      source,
      target,
      tone
    })
  } catch (error) {
    console.error('[童心小守护] 免费 AI 服务请求失败', error.message)
    res.status(502).json({ message: '免费 AI 服务暂时不可用，请检查 ERNIE_API_KEY 或稍后重试' })
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
