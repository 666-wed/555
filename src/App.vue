<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  ArrowUpRight,
  BookOpen,
  Camera,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Copy,
  Frown,
  HeartHandshake,
  Languages,
  LayoutDashboard,
  LockKeyhole,
  LogIn,
  LogOut,
  Mail,
  Meh,
  MessageCircle,
  MessageCircleHeart,
  Moon,
  NotebookPen,
  Plus,
  ScanFace,
  Send,
  Settings2,
  ShieldCheck,
  Smile,
  Sparkles,
  Sun,
  ArrowLeftRight,
  Trash2,
  User,
  Video,
  VideoOff,
  Wind,
  Zap
} from 'lucide-vue-next'
import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

const stages = [
  { key: '小学阶段', age: '6—12 岁', label: '小学阶段' },
  { key: '青春期', age: '13—18 岁', label: '青春期' },
  { key: '成年早期', age: '18—25 岁', label: '成年早期' }
]

const moods = [
  { key: '开心', label: '开心', icon: Smile, color: 'yellow' },
  { key: '平静', label: '平静', icon: Wind, color: 'green' },
  { key: '疲惫', label: '疲惫', icon: Moon, color: 'blue' },
  { key: '烦躁', label: '烦躁', icon: Zap, color: 'orange' },
  { key: '低落', label: '低落', icon: Frown, color: 'rose' }
]

const child = ref(null)
const checkins = ref([])
const conversations = ref([])
const selectedStage = ref('青春期')
const selectedMood = ref('平静')
const energy = ref(3)
const note = ref('')
const loading = ref(true)
const saving = ref(false)
const activeSection = ref('overview')
const showAllRecords = ref(false)
const toast = ref('')
const isAuthenticated = ref(Boolean(localStorage.getItem('guardian_token')))
const authUser = ref(null)
const authForm = ref({ email: '', password: '', name: '', code: '' })
const authMode = ref('login') // 'login' | 'register'
const authError = ref('')
const authLoading = ref(false)
const codeSending = ref(false)
const codeSent = ref(false)
const codeMessage = ref('')
const codeCountdown = ref(0)
const languageText = ref('')
const languageSource = ref('auto')
const languageTarget = ref('en')
const languageTone = ref('warm')
const languageResult = ref('')
const languageDetected = ref('')
const languageLoading = ref(false)
const languageError = ref('')
const languageHistory = ref([])
const videoRef = ref(null)
const cameraCanvasRef = ref(null)
const cameraOpen = ref(false)
const cameraStatus = ref('idle')
const cameraError = ref('')
const modelStatus = ref('idle')
const analysis = ref({
  label: '等待镜头',
  confidence: 0,
  summary: '开启镜头，让观察多一个角度。',
  signals: ['视频只在本机处理', '结果需要结合真实交流确认']
})
const aiAnalysis = ref(null)
const aiLoading = ref(false)
const aiError = ref('')

// AI 对话
const chatMessages = ref([
  { role: 'assistant', content: '你好呀，我是童心小守护的 AI 助手。无论是关于孩子的情绪、沟通，还是你自己的困扰，都可以和我聊聊。' }
])
const chatInput = ref('')
const chatLoading = ref(false)
const chatError = ref('')
const chatScrollRef = ref(null)

let mediaStream = null
let faceLandmarker = null
let poseLandmarker = null
let analysisFrame = 0
let lastAnalysisAt = 0
let previousPose = null
let motionScore = 0
let previousPixels = null

const currentStage = computed(() => stages.find((stage) => stage.key === selectedStage.value) || stages[1])
const displayedCheckins = computed(() => showAllRecords.value ? checkins.value : checkins.value.slice(0, 3))
const latestCheckin = computed(() => checkins.value[0] || null)
const latestMood = computed(() => moods.find((mood) => mood.key === latestCheckin.value?.mood) || moods[1])

const stageCopy = computed(() => ({
  小学阶段: {
    eyebrow: '给小小的心，一点被听见的空间',
    title: '先接住情绪，再一起想办法',
    body: '孩子的“我不要”背后，常常藏着一句还没说出口的“我有点难”。',
    prompt: '今天有没有哪一刻，让你觉得特别棒？'
  },
  青春期: {
    eyebrow: '给正在长大的心，一点不被打断的空间',
    title: '今天，先听见他',
    body: '不急着纠正，也不急着给答案。一次真正的倾听，就是关系重新靠近的开始。',
    prompt: '最近有没有一件事，让你觉得有点累？'
  },
  成年早期: {
    eyebrow: '给独立又柔软的心，一点可以靠近的空间',
    title: '不替他决定，但一直在身边',
    body: '成年后的亲子关系，需要从“管理”慢慢走向“并肩”。',
    prompt: '最近有什么事，是你想自己慢慢处理的？'
  }
}[selectedStage.value]))

const cameraMood = computed(() => moods.find((mood) => mood.key === analysis.value.label) || moods[1])

const cameraStatusText = computed(() => ({
  idle: '镜头未开启',
  starting: '正在连接镜头',
  live: '正在观察中',
  error: '镜头暂不可用'
}[cameraStatus.value]))

const languageOptions = [
  { key: 'zh-CN', label: '中文' },
  { key: 'en', label: 'English' },
  { key: 'ja', label: '日本語' },
  { key: 'ko', label: '한국어' },
  { key: 'es', label: 'Español' }
]

const quickPhrases = [
  { label: '先休息一下', text: '你看起来有点累了，我们先休息一下，等你想说的时候我在这里。' },
  { label: '我在听', text: '我在听，不急着给答案，你可以慢慢说。' },
  { label: '谢谢你告诉我', text: '谢谢你愿意告诉我，这对我来说很重要。' },
  { label: '一起想办法', text: '这件事我们可以一起想办法，你不用一个人扛着。' }
]

const languageSourceLabel = computed(() => languageOptions.find((item) => item.key === languageDetected.value)?.label || '自动识别')
const languageTargetLabel = computed(() => languageOptions.find((item) => item.key === languageTarget.value)?.label || languageTarget.value)
const languageToneLabel = computed(() => ({
  warm: '温和自然',
  concise: '简洁清晰',
  child: '孩子听得懂'
}[languageTone.value]))

function authHeaders() {
  const token = localStorage.getItem('guardian_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// API 地址解析：
// 1) 构建期显式配置 VITE_API_BASE 时优先使用；
// 2) 本地开发（localhost）走相对路径，由 Vite 代理到本地后端；
// 3) 线上（Vercel 等独立前端域名）直连 Render 后端，避免 Vercel 外部重写触发 307 重定向——
//    微信 X5 内核会把跨域 307 提升为整页跳转，导致页面跳到 Render；
// 4) 页面本身就在 Render 上时，直连地址等价同源，无跨域问题。
const RENDER_API = 'https://five55-df41.onrender.com'
const API_BASE = import.meta.env.VITE_API_BASE
  ?? (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '' : RENDER_API)

async function authFetch(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  })
  if (response.status === 401) {
    isAuthenticated.value = false
    authUser.value = null
    localStorage.removeItem('guardian_token')
  }
  return response
}

async function submitLogin() {
  if (authLoading.value) return
  if (authMode.value === 'register' && !authForm.value.password) return
  if (authMode.value === 'login' && !authForm.value.password) return
  authLoading.value = true
  authError.value = ''
  try {
    const url = authMode.value === 'register' ? '/api/auth/register' : '/api/auth/login'
    const response = await fetch(`${API_BASE}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authForm.value)
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '操作失败')
    localStorage.setItem('guardian_token', data.token)
    authUser.value = data.user
    isAuthenticated.value = true
    await fetchDashboard()
  } catch (error) {
    authError.value = error.message || '操作失败，请稍后再试'
  } finally {
    authLoading.value = false
  }
}

async function requestCode() {
  if (codeSending.value || codeCountdown.value > 0) return
  authError.value = ''
  codeMessage.value = ''
  codeSending.value = true
  try {
    const response = await fetch(`${API_BASE}/api/auth/request-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: authForm.value.email })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '验证码发送失败')
    codeSent.value = true
    codeMessage.value = data.development ? `开发模式验证码：${data.devCode}` : data.message
    codeCountdown.value = 60
    const timer = window.setInterval(() => {
      codeCountdown.value -= 1
      if (codeCountdown.value <= 0) window.clearInterval(timer)
    }, 1000)
  } catch (error) {
    authError.value = error.message || '验证码发送失败，请稍后再试'
  } finally {
    codeSending.value = false
  }
}

async function logout() {
  try {
    await authFetch('/api/auth/logout', { method: 'POST' })
  } finally {
    localStorage.removeItem('guardian_token')
    authUser.value = null
    isAuthenticated.value = false
    stopCamera()
  }
}

async function fetchDashboard() {
  loading.value = true
  try {
    const response = await authFetch(`/api/dashboard?stage=${encodeURIComponent(selectedStage.value)}`)
    if (!response.ok) return
    const data = await response.json()
    child.value = data.child
    checkins.value = data.checkins
    conversations.value = data.conversations
  } catch (error) {
    showToast('暂时无法连接服务，请稍后重试')
  } finally {
    loading.value = false
  }
}

async function switchStage(stage) {
  selectedStage.value = stage
  await fetchDashboard()
}

async function saveCheckin() {
  if (!selectedMood.value || saving.value) return
  saving.value = true
  try {
    const response = await authFetch('/api/checkins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage: selectedStage.value,
        mood: selectedMood.value,
        energy: energy.value,
        note: note.value.trim()
      })
    })
    if (!response.ok) throw new Error('save failed')
    note.value = ''
    await fetchDashboard()
    showToast('今天的观察已保存')
  } catch (error) {
    showToast('保存失败，请稍后再试')
  } finally {
    saving.value = false
  }
}

async function saveConversation() {
  try {
    const response = await authFetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage: selectedStage.value,
        topic: '今天的状态',
        message: stageCopy.value.prompt
      })
    })
    if (!response.ok) throw new Error('save failed')
    await fetchDashboard()
    showToast('已加入对话记录')
  } catch (error) {
    showToast('记录失败，请稍后再试')
  }
}

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(stageCopy.value.prompt)
    showToast('开场白已复制')
  } catch (error) {
    showToast('复制失败，请直接使用这句话')
  }
}

async function translateLanguage() {
  if (languageLoading.value || !languageText.value.trim()) return
  languageLoading.value = true
  languageError.value = ''
  try {
    const response = await authFetch('/api/language/assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: languageText.value.trim(),
        source: languageSource.value,
        target: languageTarget.value,
        tone: languageTone.value
      })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '翻译失败')
    languageResult.value = data.reply
    languageDetected.value = data.source
    languageHistory.value.unshift({
      id: `${Date.now()}-${Math.random()}`,
      source: languageText.value.trim(),
      result: data.reply,
      sourceLabel: languageOptions.find((item) => item.key === data.source)?.label || data.source,
      targetLabel: languageTargetLabel.value
    })
    languageHistory.value = languageHistory.value.slice(0, 4)
  } catch (error) {
    languageError.value = error.message || '暂时无法连接免费翻译服务'
  } finally {
    languageLoading.value = false
  }
}

function swapLanguage() {
  if (languageSource.value === 'auto') {
    languageSource.value = languageTarget.value
    languageTarget.value = 'zh-CN'
  } else {
    const source = languageSource.value
    languageSource.value = languageTarget.value
    languageTarget.value = source
  }
  const text = languageText.value
  languageText.value = languageResult.value
  languageResult.value = text
  languageDetected.value = languageSource.value
}

async function copyLanguageResult() {
  if (!languageResult.value) return
  try {
    await navigator.clipboard.writeText(languageResult.value)
    showToast('译文已复制')
  } catch (error) {
    showToast('复制失败，请手动选择文字')
  }
}

function clearLanguage() {
  languageText.value = ''
  languageResult.value = ''
  languageDetected.value = ''
  languageError.value = ''
}

function useQuickPhrase(text) {
  languageText.value = text
  languageSource.value = 'zh-CN'
  languageTarget.value = 'en'
  languageResult.value = ''
  languageError.value = ''
}

async function startCamera() {
  if (cameraOpen.value || cameraStatus.value === 'starting') return
  cameraError.value = ''
  cameraStatus.value = 'starting'
  modelStatus.value = 'loading'
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera unsupported')
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
    })
    cameraOpen.value = true
    cameraStatus.value = 'live'
    await new Promise((resolve) => requestAnimationFrame(resolve))
    videoRef.value.srcObject = mediaStream
    await videoRef.value.play()
    await loadVisionModels()
    analysisFrame = requestAnimationFrame(analyzeCameraFrame)
  } catch (error) {
    cameraStatus.value = 'error'
    cameraError.value = error.name === 'NotAllowedError'
      ? '浏览器没有授予摄像头权限，请允许后再次开启。'
      : '当前设备无法访问摄像头，请检查设备连接。'
    stopCamera()
  }
}

async function loadVisionModels() {
  try {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm'
    )
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        delegate: 'GPU',
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
      },
      outputFaceBlendshapes: true,
      runningMode: 'VIDEO',
      numFaces: 1
    })
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        delegate: 'GPU',
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
      },
      runningMode: 'VIDEO',
      numPoses: 1
    })
    modelStatus.value = 'ready'
  } catch (error) {
    modelStatus.value = 'fallback'
    analysis.value = {
      label: '平静',
      confidence: 0.42,
      summary: '表情模型暂未加载，先根据镜头中的动作变化做辅助观察。',
      signals: ['动作变化分析已启用', '表情结果将在模型加载后出现']
    }
  }
}

function getBlendshapeScore(categories, name) {
  return categories.find((category) => category.categoryName === name)?.score || 0
}

function calculateMotion(landmarks) {
  const indexes = [11, 12, 15, 16, 23, 24]
  const points = indexes.map((index) => landmarks[index]).filter(Boolean)
  if (!previousPose || !points.length) {
    previousPose = points
    return 0
  }
  const movement = points.reduce((total, point, index) => {
    const previous = previousPose[index]
    if (!previous) return total
    return total + Math.hypot(point.x - previous.x, point.y - previous.y)
  }, 0) / points.length
  previousPose = points
  return Math.min(1, movement * 9)
}

function calculatePixelMotion() {
  const video = videoRef.value
  const canvas = cameraCanvasRef.value
  if (!video || !canvas || video.readyState < 2) return 0
  canvas.width = 96
  canvas.height = 72
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  if (!previousPixels) {
    previousPixels = pixels
    return 0
  }
  let difference = 0
  for (let index = 0; index < pixels.length; index += 16) difference += Math.abs(pixels[index] - previousPixels[index])
  previousPixels = pixels
  return Math.min(1, difference / (pixels.length / 16) / 255 / 3)
}

function inferMood(faceCategories, bodyLandmarks) {
  const smile = (getBlendshapeScore(faceCategories, 'mouthSmileLeft') + getBlendshapeScore(faceCategories, 'mouthSmileRight')) / 2
  const frown = (getBlendshapeScore(faceCategories, 'mouthFrownLeft') + getBlendshapeScore(faceCategories, 'mouthFrownRight')) / 2
  const browDown = (getBlendshapeScore(faceCategories, 'browDownLeft') + getBlendshapeScore(faceCategories, 'browDownRight')) / 2
  const eyeSquint = (getBlendshapeScore(faceCategories, 'eyeSquintLeft') + getBlendshapeScore(faceCategories, 'eyeSquintRight')) / 2
  const blink = (getBlendshapeScore(faceCategories, 'eyeBlinkLeft') + getBlendshapeScore(faceCategories, 'eyeBlinkRight')) / 2
  const jawOpen = getBlendshapeScore(faceCategories, 'jawOpen')
  const hasFace = faceCategories.length > 0
  const poseMotion = bodyLandmarks?.length ? calculateMotion(bodyLandmarks) : 0
  const pixelMotion = calculatePixelMotion()
  motionScore = motionScore * 0.72 + Math.max(poseMotion, pixelMotion) * 0.28

  if (!hasFace) {
    return {
      label: motionScore > 0.18 ? '烦躁' : '平静',
      confidence: Math.min(0.78, 0.42 + motionScore * 0.7),
      summary: motionScore > 0.18 ? '镜头捕捉到较明显的动作变化。' : '暂时没有捕捉到明显的表情变化。',
      signals: motionScore > 0.18 ? ['身体动作较频繁', '建议先问问发生了什么'] : ['表情暂不清晰', '可以调整光线或镜头距离']
    }
  }
  if (smile > 0.22) return { label: '开心', confidence: Math.min(0.92, 0.5 + smile * 0.45), summary: '面部表情较舒展，像是有一些轻松的时刻。', signals: ['嘴角上扬', motionScore > 0.12 ? '动作较活跃' : '身体状态平稳'] }
  if (browDown > 0.28 && eyeSquint > 0.18 && motionScore > 0.06) return { label: '紧张', confidence: Math.min(0.86, 0.45 + browDown * 0.4), summary: '眉眼和动作都比较用力，可能正处在压力中。', signals: ['眉眼收紧', '动作变化较明显'] }
  if (frown > 0.18) return { label: '低落', confidence: Math.min(0.82, 0.42 + frown * 0.55), summary: '表情偏收拢，可以给他一点安静的陪伴。', signals: ['嘴角下压', motionScore < 0.1 ? '动作幅度较小' : '有些小动作'] }
  if ((blink > 0.35 || jawOpen > 0.22) && motionScore < 0.08) return { label: '疲惫', confidence: 0.6, summary: '眼部活动和动作都比较少，可能需要先休息一下。', signals: ['眼部活动较多', '身体动作偏少'] }
  if (motionScore > 0.15) return { label: '烦躁', confidence: Math.min(0.78, 0.45 + motionScore * 0.6), summary: '捕捉到较明显的动作变化，可能有些坐不住。', signals: ['身体动作较频繁', '建议先问问发生了什么'] }
  return { label: '平静', confidence: Math.min(0.72, 0.45 + (1 - motionScore) * 0.15), summary: '当前状态比较平稳，可以从轻松的话题开始。', signals: ['没有明显的极端表情', '身体状态相对稳定'] }
}

function analyzeCameraFrame(timestamp) {
  if (!cameraOpen.value || !videoRef.value) return
  if (timestamp - lastAnalysisAt > 260 && videoRef.value.readyState >= 2) {
    lastAnalysisAt = timestamp
    const faceResult = faceLandmarker?.detectForVideo(videoRef.value, timestamp)
    const poseResult = poseLandmarker?.detectForVideo(videoRef.value, timestamp)
    const categories = faceResult?.faceBlendshapes?.[0]?.categories || []
    const landmarks = poseResult?.landmarks?.[0] || []
    analysis.value = inferMood(categories, landmarks)
  }
  analysisFrame = requestAnimationFrame(analyzeCameraFrame)
}

function stopCamera() {
  if (analysisFrame) cancelAnimationFrame(analysisFrame)
  mediaStream?.getTracks().forEach((track) => track.stop())
  mediaStream = null
  if (videoRef.value) videoRef.value.srcObject = null
  cameraOpen.value = false
  previousPose = null
  previousPixels = null
  motionScore = 0
  aiAnalysis.value = null
  aiError.value = ''
  if (cameraStatus.value !== 'error') cameraStatus.value = 'idle'
}

async function analyzeWithAI() {
  if (aiLoading.value || !cameraOpen.value) return
  aiLoading.value = true
  aiError.value = ''
  try {
    const response = await authFetch('/api/camera/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage: selectedStage.value,
        mood: analysis.value.label,
        confidence: analysis.value.confidence,
        summary: analysis.value.summary,
        signals: analysis.value.signals
      })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || 'AI 分析失败')
    aiAnalysis.value = {
      interpretation: data.interpretation,
      suggestions: data.suggestions,
      opener: data.opener
    }
  } catch (error) {
    aiError.value = error.message || 'AI 分析暂时不可用，请稍后再试'
    aiAnalysis.value = null
  } finally {
    aiLoading.value = false
  }
}

async function copyAIResult(text) {
  try {
    await navigator.clipboard.writeText(text)
    showToast('已复制到剪贴板')
  } catch (error) {
    showToast('复制失败，请手动选择文字')
  }
}

async function sendChatMessage() {
  const text = chatInput.value.trim()
  if (!text || chatLoading.value) return
  chatError.value = ''
  chatMessages.value.push({ role: 'user', content: text })
  chatInput.value = ''
  chatLoading.value = true
  // 发送历史记录（不含当前这条，因为已 push）
  const history = chatMessages.value.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))
  try {
    const response = await authFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || 'AI 回复失败')
    chatMessages.value.push({ role: 'assistant', content: data.reply })
  } catch (error) {
    chatError.value = error.message || 'AI 暂时无法回复，请稍后再试'
  } finally {
    chatLoading.value = false
  }
}

function clearChat() {
  chatMessages.value = [
    { role: 'assistant', content: '你好呀，我是童心小守护的 AI 助手。无论是关于孩子的情绪、沟通，还是你自己的困扰，都可以和我聊聊。' }
  ]
  chatError.value = ''
}

function scrollChatToBottom() {
  if (chatScrollRef.value) {
    chatScrollRef.value.scrollTop = chatScrollRef.value.scrollHeight
  }
}

watch(
  () => chatMessages.value.length,
  async () => {
    await nextTick()
    scrollChatToBottom()
  }
)

async function saveCameraObservation() {
  const observation = `镜头辅助观察：${analysis.value.summary}（${analysis.value.signals.join('、')}）`
  try {
    const response = await fetch(`${API_BASE}/api/checkins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: selectedStage.value, mood: analysis.value.label, energy: Math.max(1, Math.min(5, Math.round(analysis.value.confidence * 5))), note: observation })
    })
    if (!response.ok) throw new Error('save failed')
    await fetchDashboard()
    showToast('镜头观察已保存，请结合对话继续确认')
  } catch (error) {
    showToast('保存失败，请稍后再试')
  }
}

function showToast(message) {
  toast.value = message
  window.clearTimeout(showToast.timer)
  showToast.timer = window.setTimeout(() => {
    toast.value = ''
  }, 2600)
}

function formatDate(dateString) {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

function formatTime(dateString) {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date)
}

onMounted(async () => {
  if (!isAuthenticated.value) {
    loading.value = false
    return
  }
  try {
    const response = await authFetch('/api/auth/me')
    if (!response.ok) return
    authUser.value = (await response.json()).user
    await fetchDashboard()
  } catch (error) {
    loading.value = false
  }
})
</script>

<template>
  <div v-if="!isAuthenticated" class="login-shell">
    <section class="login-story">
      <div class="login-brand">
        <div class="brand-mark"><HeartHandshake :size="20" stroke-width="2.2" /></div>
        <div><strong>童心小守护</strong><span>亲子关系助手</span></div>
      </div>
      <div class="login-story-copy">
        <p class="eyebrow">WELCOME BACK</p>
        <h1>让每一次靠近，<br /><em>都有回应。</em></h1>
        <p>从看见一个表情开始，慢慢走进孩子的世界，也让他知道，你一直都在。</p>
      </div>
      <div class="login-story-footer">
        <div class="story-mark"><MessageCircleHeart :size="18" /></div>
        <span>今天也给彼此，留一点被听见的空间。</span>
      </div>
    </section>
    <section class="login-form-side">
      <div class="login-form-wrap">
        <div class="mobile-login-brand">
          <div class="brand-mark"><HeartHandshake :size="20" /></div>
          <strong>童心小守护</strong>
        </div>
        <p class="eyebrow">家庭空间</p>
        <h2>{{ authMode === 'register' ? '创建账号' : '欢迎回来' }}</h2>
        <p class="login-subtitle">{{ authMode === 'register' ? '注册后即可使用童心小守护的全部功能。' : '登录后继续记录你们正在发生的故事。' }}</p>
        <form class="login-form" @submit.prevent="submitLogin">
          <label for="login-email">邮箱</label>
          <div class="input-wrap">
            <Mail :size="17" />
            <input id="login-email" v-model="authForm.email" type="email" autocomplete="email" placeholder="请输入邮箱" required />
          </div>
          <template v-if="authMode === 'register'">
            <label for="login-name">昵称（可选）</label>
            <div class="input-wrap">
              <User :size="17" />
              <input id="login-name" v-model="authForm.name" type="text" autocomplete="name" placeholder="昵称，不填则用邮箱前缀" />
            </div>
          </template>
          <label for="login-password">密码</label>
          <div class="input-wrap">
            <LockKeyhole :size="17" />
            <input id="login-password" v-model="authForm.password" type="password" :autocomplete="authMode === 'register' ? 'new-password' : 'current-password'" placeholder="请输入密码（至少 6 位）" required minlength="6" />
          </div>
          <div v-if="authError" class="auth-error">{{ authError }}</div>
          <button class="login-button" type="submit" :disabled="authLoading">
            <LogIn :size="17" />
            {{ authLoading ? '正在进入…' : (authMode === 'register' ? '注册并进入' : '进入家庭空间') }}
          </button>
          <div class="auth-switch">
            <span v-if="authMode === 'login'">还没有账号？<button type="button" @click="authMode = 'register'; authError = ''">立即注册</button></span>
            <span v-else>已有账号？<button type="button" @click="authMode = 'login'; authError = ''">去登录</button></span>
          </div>
        </form>
        <div class="login-hint"><LockKeyhole :size="14" /><span>密码使用 scrypt 加盐哈希存储，安全可靠。</span></div>
        <div class="login-privacy"><ShieldCheck :size="15" /> 你的记录只属于你和家人</div>
      </div>
    </section>
  </div>

  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark"><HeartHandshake :size="20" stroke-width="2.2" /></div>
        <div>
          <strong>童心小守护</strong>
          <span>亲子关系助手</span>
        </div>
      </div>

      <nav class="main-nav" aria-label="主导航">
        <button :class="{ active: activeSection === 'overview' }" @click="activeSection = 'overview'">
          <LayoutDashboard :size="18" />
          <span>今日概览</span>
        </button>
        <button :class="{ active: activeSection === 'records' }" @click="activeSection = 'records'; showAllRecords = true">
          <NotebookPen :size="18" />
          <span>成长记录</span>
          <span class="nav-count">{{ checkins.length }}</span>
        </button>
        <button :class="{ active: activeSection === 'conversations' }" @click="activeSection = 'conversations'">
          <MessageCircleHeart :size="18" />
          <span>对话记录</span>
        </button>
        <button :class="{ active: activeSection === 'language' }" @click="activeSection = 'language'">
          <Languages :size="18" />
          <span>语言助手</span>
        </button>
        <button :class="{ active: activeSection === 'chat' }" @click="activeSection = 'chat'">
          <MessageCircle :size="18" />
          <span>AI 对话</span>
        </button>
        <button :class="{ active: activeSection === 'camera' }" @click="activeSection = 'camera'">
          <Camera :size="18" />
          <span>情绪镜头</span>
        </button>
      </nav>

      <div class="sidebar-bottom">
        <div class="privacy-note">
          <ShieldCheck :size="17" />
          <div>
            <strong>只属于你们的空间</strong>
            <span>记录保存在本地</span>
          </div>
        </div>
        <button class="settings-button"><Settings2 :size="17" /> 设置</button>
      </div>
    </aside>

    <main class="main-content">
      <header class="topbar">
        <div class="breadcrumbs">
          <span>家庭空间</span>
          <span>/</span>
          <strong>{{ child?.name || '孩子' }}</strong>
        </div>
        <div class="topbar-actions">
          <button class="icon-button" title="帮助"><CircleHelp :size="18" /></button>
          <div class="avatar">{{ authUser?.name?.slice(0, 1) || child?.name?.slice(0, 1) || '林' }}</div>
          <button class="icon-button" title="退出登录" @click="logout"><LogOut :size="18" /></button>
        </div>
      </header>

      <div v-if="loading" class="loading-state">
        <div class="loading-dot"></div>
        正在准备今天的空间
      </div>

      <template v-else>
        <section v-if="activeSection === 'overview'" class="dashboard">
          <div class="welcome-row">
            <div>
              <p class="eyebrow">{{ stageCopy.eyebrow }}</p>
              <h1>{{ stageCopy.title }}</h1>
              <p class="hero-body">{{ stageCopy.body }}</p>
            </div>
            <div class="stage-switcher">
              <span>当前观察阶段</span>
              <div class="select-wrap">
                <select v-model="selectedStage" @change="switchStage(selectedStage)">
                  <option v-for="stage in stages" :key="stage.key" :value="stage.key">
                    {{ stage.label }} · {{ stage.age }}
                  </option>
                </select>
                <ChevronDown :size="16" />
              </div>
            </div>
          </div>

          <div class="insight-band">
            <div class="insight-icon"><Sparkles :size="22" /></div>
            <div class="insight-content">
              <span class="section-kicker">今日理解提示</span>
              <h2>{{ latestCheckin ? `他今天看起来有些${latestCheckin.mood === '平静' ? '安静' : latestCheckin.mood}` : '先从一个轻松的问题开始' }}</h2>
              <p>{{ latestCheckin?.note || '比起问“今天怎么样”，不如从一件具体的小事开始。具体，才更容易让孩子打开话题。' }}</p>
            </div>
            <button class="text-button" @click="activeSection = 'records'">查看记录 <ArrowUpRight :size="16" /></button>
          </div>

          <button class="camera-entry-band" @click="activeSection = 'camera'">
            <div class="camera-entry-icon"><ScanFace :size="21" /></div>
            <div><span class="section-kicker">新增观察方式</span><strong>用镜头看看当下的他</strong><span>捕捉表情和动作变化，得到一份温和的辅助提示</span></div>
            <ArrowUpRight :size="18" />
          </button>

          <div class="section-heading">
            <div>
              <span class="section-kicker">现在这一刻</span>
              <h2>你观察到的他</h2>
            </div>
            <span class="date-label"><CalendarDays :size="15" /> {{ new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date()) }}</span>
          </div>

          <div class="content-grid">
            <section class="checkin-panel">
              <div class="panel-heading">
                <div>
                  <h3>记下今天的状态</h3>
                  <p>不需要准确，真实就好。</p>
                </div>
                <div class="step-label">01 <span>/ 02</span></div>
              </div>

              <div class="field-group">
                <label>如果用一个词形容，他今天更接近</label>
                <div class="mood-grid">
                  <button
                    v-for="mood in moods"
                    :key="mood.key"
                    class="mood-option"
                    :class="[`mood-${mood.color}`, { selected: selectedMood === mood.key }]"
                    @click="selectedMood = mood.key"
                  >
                    <component :is="mood.icon" :size="19" />
                    <span>{{ mood.label }}</span>
                    <Check v-if="selectedMood === mood.key" class="mood-check" :size="14" />
                  </button>
                </div>
              </div>

              <div class="field-group">
                <div class="label-row">
                  <label>能量感</label>
                  <span>{{ ['很低', '偏低', '一般', '不错', '充沛'][energy - 1] }}</span>
                </div>
                <div class="energy-slider">
                  <div class="energy-track"><div class="energy-progress" :style="{ width: `${energy * 20}%` }"></div></div>
                  <input v-model.number="energy" type="range" min="1" max="5" step="1" aria-label="能量感" />
                  <div class="energy-labels"><span>需要休息</span><span>状态很好</span></div>
                </div>
              </div>

              <div class="field-group">
                <label for="note">你注意到的细节</label>
                <textarea id="note" v-model="note" rows="3" :placeholder="stageCopy.prompt"></textarea>
              </div>

              <button class="primary-button" :disabled="saving" @click="saveCheckin">
                <BookOpen :size="17" />
                {{ saving ? '保存中...' : '保存今天的观察' }}
              </button>
            </section>

            <aside class="conversation-panel">
              <div class="panel-heading">
                <div>
                  <span class="section-kicker">下一步</span>
                  <h3>让对话自然发生</h3>
                </div>
                <MessageCircleHeart :size="21" class="panel-icon" />
              </div>
              <div class="prompt-card">
                <span class="prompt-label">可以这样开始</span>
                <p>“{{ stageCopy.prompt }}”</p>
                <div class="prompt-actions">
                  <button class="copy-button" @click="copyPrompt"><Check :size="15" />复制这句话</button>
                  <button class="round-button" title="加入对话记录" @click="saveConversation"><Plus :size="18" /></button>
                </div>
              </div>
              <div class="conversation-footer">
                <div class="mini-avatar">你</div>
                <div>
                  <strong>先放下“为什么”</strong>
                  <span>用具体的、没有压力的问题，给他一个愿意回答的入口。</span>
                </div>
              </div>
            </aside>
          </div>

          <div class="section-heading records-heading">
            <div>
              <span class="section-kicker">最近的脚印</span>
              <h2>你们正在慢慢靠近</h2>
            </div>
            <button class="text-button" @click="activeSection = 'records'; showAllRecords = true">全部记录 <ArrowUpRight :size="16" /></button>
          </div>

          <div class="timeline">
            <article v-for="record in displayedCheckins" :key="record.id" class="timeline-item">
              <div class="timeline-date">
                <strong>{{ formatDate(record.created_at).split('/')[1] }}</strong>
                <span>{{ formatDate(record.created_at).split('/')[0] }}月</span>
              </div>
              <div class="timeline-line"><span></span></div>
              <div class="timeline-card">
                <div class="timeline-card-top">
                  <div class="record-mood"><component :is="moods.find((mood) => mood.key === record.mood)?.icon || Meh" :size="16" /> {{ record.mood }}</div>
                  <span>{{ formatTime(record.created_at) }}</span>
                </div>
                <p>{{ record.note || '今天没有写下具体的细节，但你留意到了他的状态。' }}</p>
                <span class="energy-chip">能量 {{ record.energy }}/5</span>
              </div>
            </article>
            <div v-if="!displayedCheckins.length" class="empty-state">还没有记录，从今天开始留下第一笔观察。</div>
          </div>
        </section>

        <section v-else-if="activeSection === 'records'" class="page-section">
          <div class="page-title-row">
            <div>
              <p class="eyebrow">把看见变成习惯</p>
              <h1>成长记录</h1>
            </div>
            <button class="primary-button compact" @click="activeSection = 'overview'"><Plus :size="17" /> 新增观察</button>
          </div>
          <div class="records-list">
            <article v-for="record in checkins" :key="record.id" class="record-row">
              <div class="record-calendar"><strong>{{ formatDate(record.created_at).split('/')[1] }}</strong><span>{{ formatDate(record.created_at).split('/')[0] }}月</span></div>
              <div class="record-row-main"><div class="record-mood"><component :is="moods.find((mood) => mood.key === record.mood)?.icon || Meh" :size="17" /> {{ record.mood }} <span>· 能量 {{ record.energy }}/5</span></div><p>{{ record.note || '今天没有写下具体细节。' }}</p></div>
              <span class="record-time"><Clock3 :size="14" /> {{ formatTime(record.created_at) }}</span>
            </article>
          </div>
        </section>

        <section v-else-if="activeSection === 'language'" class="page-section language-page">
          <div class="page-title-row">
            <div>
              <p class="eyebrow">让 AI 帮你找到更自然、更有温度的表达</p>
              <h1>语言助手</h1>
            </div>
            <div class="language-powered"><Sparkles :size="16" /> 文心 ERNIE 免费 AI</div>
          </div>

          <div class="language-layout">
            <section class="language-workspace">
              <div class="language-toolbar">
                <div class="language-select-group">
                  <label for="language-source">原文</label>
                  <select id="language-source" v-model="languageSource">
                    <option value="auto">自动识别</option>
                    <option v-for="language in languageOptions" :key="`source-${language.key}`" :value="language.key">{{ language.label }}</option>
                  </select>
                </div>
                <button class="language-swap" title="交换语言" @click="swapLanguage"><ArrowLeftRight :size="17" /></button>
                <div class="language-select-group">
                    <label for="language-target">希望用</label>
                  <select id="language-target" v-model="languageTarget">
                    <option v-for="language in languageOptions" :key="`target-${language.key}`" :value="language.key">{{ language.label }}</option>
                  </select>
                </div>
                <button class="icon-button language-clear" title="清空内容" @click="clearLanguage"><Trash2 :size="17" /></button>
              </div>

              <div class="language-panels">
                <div class="language-panel">
                  <div class="language-panel-head">
                    <span>{{ languageSource === 'auto' ? '自动识别' : languageOptions.find((language) => language.key === languageSource)?.label }}</span>
                    <span v-if="languageDetected">识别为 {{ languageSourceLabel }}</span>
                  </div>
                  <textarea v-model="languageText" rows="8" placeholder="输入你想翻译的话，例如：我知道你现在有点难，但你不用一个人面对。"></textarea>
                  <div class="language-panel-foot"><span>{{ languageText.length }} / 1000</span><button class="inline-action" :disabled="!languageText.trim()" @click="languageText = ''">清空</button></div>
                </div>

                <div class="language-panel result-panel">
                  <div class="language-panel-head"><span>AI 建议 · {{ languageTargetLabel }}</span><span>语气：{{ languageToneLabel }}</span></div>
                  <div v-if="languageLoading" class="language-result loading-result"><div class="loading-dot"></div><span>正在寻找更自然的表达</span></div>
                  <div v-else-if="languageResult" class="language-result">{{ languageResult }}</div>
                  <div v-else class="language-result result-placeholder">AI 的表达建议会出现在这里</div>
                  <div class="language-panel-foot"><span v-if="languageResult">由文心 ERNIE-Speed-128K 生成</span><span v-else>支持亲子日常表达</span><button class="inline-action" :disabled="!languageResult" @click="copyLanguageResult"><Copy :size="14" />复制</button></div>
                </div>
              </div>

              <div v-if="languageError" class="language-error">{{ languageError }}</div>
              <button class="primary-button language-submit" :disabled="languageLoading || !languageText.trim()" @click="translateLanguage">
                <Languages :size="17" />
                {{ languageLoading ? 'AI 思考中...' : '让 AI 帮我表达' }}
              </button>
            </section>

            <aside class="language-side-panel">
              <div class="language-side-heading">
                <div><span class="section-kicker">表达偏好</span><h2>让语气更像你</h2></div>
                <Sparkles :size="20" class="panel-icon" />
              </div>
              <div class="tone-options">
                <button :class="{ selected: languageTone === 'warm' }" @click="languageTone = 'warm'"><strong>温和自然</strong><span>适合日常关心</span></button>
                <button :class="{ selected: languageTone === 'concise' }" @click="languageTone = 'concise'"><strong>简洁清晰</strong><span>适合说明和确认</span></button>
                <button :class="{ selected: languageTone === 'child' }" @click="languageTone = 'child'"><strong>孩子听得懂</strong><span>少一点压力和距离</span></button>
              </div>
              <div class="language-tip"><HeartHandshake :size="18" /><span>翻译只是辅助。真正重要的是保留你的语气，以及愿意认真听对方说完。</span></div>
            </aside>
          </div>

          <div class="language-quick-section">
            <div class="section-heading">
              <div><span class="section-kicker">亲子表达库</span><h2>不知道怎么开口时</h2></div>
              <span class="language-hint">点击一句，直接开始翻译</span>
            </div>
            <div class="quick-phrase-grid">
              <button v-for="phrase in quickPhrases" :key="phrase.label" class="quick-phrase" @click="useQuickPhrase(phrase.text)">
                <span>{{ phrase.label }}</span><ArrowUpRight :size="15" />
                <small>{{ phrase.text }}</small>
              </button>
            </div>
          </div>

          <div v-if="languageHistory.length" class="language-history">
            <div class="section-heading"><div><span class="section-kicker">刚刚使用</span><h2>最近的表达</h2></div></div>
            <div class="history-list">
              <button v-for="item in languageHistory" :key="item.id" class="history-item" @click="languageText = item.source; languageResult = item.result">
                <span>{{ item.sourceLabel }} → {{ item.targetLabel }}</span>
                <strong>{{ item.source }}</strong>
                <small>{{ item.result }}</small>
              </button>
            </div>
          </div>
        </section>

        <section v-else-if="activeSection === 'camera'" class="page-section camera-page">
          <div class="page-title-row">
            <div>
              <p class="eyebrow">一份辅助观察，不是答案</p>
              <h1>情绪镜头</h1>
            </div>
            <button v-if="cameraOpen" class="secondary-button compact" @click="stopCamera"><VideoOff :size="17" /> 关闭镜头</button>
          </div>
          <div class="camera-layout">
            <section class="camera-view-panel">
              <div class="camera-view" :class="{ live: cameraOpen }">
                <video ref="videoRef" autoplay muted playsinline></video>
                <canvas ref="cameraCanvasRef" class="analysis-canvas"></canvas>
                <div v-if="!cameraOpen" class="camera-placeholder">
                  <div class="camera-placeholder-icon"><Camera :size="28" /></div>
                  <strong>开启镜头，看看当下的状态</strong>
                  <span>视频仅在当前页面分析，不会上传或保存画面。</span>
                </div>
                <div v-if="cameraOpen" class="camera-live-label"><span></span>{{ cameraStatusText }}</div>
              </div>
              <div v-if="cameraError" class="camera-error">{{ cameraError }}</div>
              <button v-if="!cameraOpen" class="primary-button camera-button" @click="startCamera"><Video :size="17" /> 开启摄像头</button>
              <p class="camera-footnote"><ShieldCheck :size="14" /> 只分析动作和表情特征，不保存视频画面</p>
            </section>
            <aside class="analysis-panel">
              <div class="analysis-header"><div><span class="section-kicker">实时辅助结果</span><h2>{{ analysis.label }}</h2></div><component :is="cameraMood.icon" :size="28" :class="`analysis-mood-${cameraMood.color}`" /></div>
              <div class="confidence-row"><span>当前置信度</span><strong>{{ Math.round(analysis.confidence * 100) }}%</strong></div>
              <div class="confidence-track"><span :style="{ width: `${analysis.confidence * 100}%` }"></span></div>
              <p class="analysis-summary">{{ analysis.summary }}</p>
              <div class="signal-list"><div v-for="signal in analysis.signals" :key="signal"><Check :size="15" /> {{ signal }}</div></div>
              <div class="analysis-divider"></div>
              <div class="analysis-note"><BrainCircuit :size="17" /><span>{{ modelStatus === 'ready' ? '表情 + 姿态模型已就绪' : modelStatus === 'loading' ? '正在加载观察模型…' : '动作观察模式' }}</span></div>
              <button class="primary-button save-analysis-button" :disabled="!cameraOpen || analysis.confidence === 0" @click="saveCameraObservation"><NotebookPen :size="16" /> 保存这次观察</button>

              <div class="ai-analysis-block">
                <div class="analysis-divider"></div>
                <div class="ai-analysis-header">
                  <div><span class="section-kicker">AI 深度分析</span><h3>让 AI 帮你读懂这一刻</h3></div>
                  <Sparkles :size="18" class="ai-sparkle" />
                </div>
                <button class="secondary-button ai-analyze-button" :disabled="!cameraOpen || aiLoading" @click="analyzeWithAI">
                  <Sparkles :size="16" />
                  {{ aiLoading ? 'AI 正在分析…' : '调用 AI 深度分析' }}
                </button>

                <div v-if="aiError" class="ai-error">{{ aiError }}</div>

                <div v-if="aiAnalysis" class="ai-result">
                  <div class="ai-interpretation">
                    <HeartHandshake :size="16" />
                    <p>{{ aiAnalysis.interpretation }}</p>
                  </div>
                  <div class="ai-suggestions">
                    <span class="ai-suggestions-label">沟通建议</span>
                    <div v-for="(sug, idx) in aiAnalysis.suggestions" :key="idx" class="ai-suggestion">
                      <span class="ai-suggestion-dot">{{ idx + 1 }}</span>
                      <span>{{ sug }}</span>
                    </div>
                  </div>
                  <div class="ai-opener">
                    <span class="ai-opener-label">可以这样开口</span>
                    <p class="ai-opener-text">“{{ aiAnalysis.opener }}”</p>
                    <button class="copy-button ai-copy" @click="copyAIResult(aiAnalysis.opener)"><Copy :size="13" />复制这句话</button>
                  </div>
                </div>
              </div>
            </aside>
          </div>
          <div class="camera-guidance"><div><span class="section-kicker">下一步</span><h2>把推测变成交流</h2></div><p>“我刚刚注意到你今天好像有点{{ analysis.label === '平静' ? '安静' : analysis.label }}，你想让我陪你坐一会儿吗？”</p><button class="text-button" @click="activeSection = 'overview'">去选一句开场白 <ArrowUpRight :size="16" /></button></div>
        </section>

        <section v-else-if="activeSection === 'chat'" class="page-section chat-page">
          <div class="page-title-row">
            <div>
              <p class="eyebrow">随时聊聊，关于孩子，也关于你自己</p>
              <h1>AI 对话</h1>
            </div>
            <button class="secondary-button compact" @click="clearChat"><Trash2 :size="15" /> 清空对话</button>
          </div>
          <div class="chat-window">
            <div ref="chatScrollRef" class="chat-messages">
              <div
                v-for="(msg, idx) in chatMessages"
                :key="idx"
                class="chat-bubble-wrap"
                :class="msg.role === 'user' ? 'is-user' : 'is-ai'"
              >
                <div class="chat-avatar">
                  <component :is="msg.role === 'user' ? User : Sparkles" :size="16" />
                </div>
                <div class="chat-bubble">
                  <span class="chat-bubble-text">{{ msg.content }}</span>
                </div>
              </div>
              <div v-if="chatLoading" class="chat-bubble-wrap is-ai">
                <div class="chat-avatar"><Sparkles :size="16" /></div>
                <div class="chat-bubble chat-typing">
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
            <div v-if="chatError" class="chat-error">{{ chatError }}</div>
            <form class="chat-input-bar" @submit.prevent="sendChatMessage">
              <input
                v-model="chatInput"
                type="text"
                placeholder="说说你现在的感受或想问的问题…"
                :disabled="chatLoading"
              />
              <button type="submit" class="primary-button chat-send" :disabled="!chatInput.trim() || chatLoading">
                <Send :size="16" />
              </button>
            </form>
          </div>
        </section>

        <section v-else class="page-section">
          <div class="page-title-row">
            <div>
              <p class="eyebrow">把想说的话，留在这里</p>
              <h1>对话记录</h1>
            </div>
            <button class="primary-button compact" @click="activeSection = 'overview'"><Send :size="17" /> 开始一次对话</button>
          </div>
          <div class="conversation-list">
            <article v-for="conversation in conversations" :key="conversation.id" class="conversation-row">
              <div class="conversation-symbol"><MessageCircleHeart :size="19" /></div>
              <div><span class="conversation-topic">{{ conversation.topic }} · {{ formatDate(conversation.created_at) }}</span><p>“{{ conversation.message }}”</p></div>
              <Check :size="17" class="saved-check" />
            </article>
            <div v-if="!conversations.length" class="empty-state">还没有对话记录。选择一句开场白，让交流从今天开始。</div>
          </div>
        </section>
      </template>
    </main>

    <transition name="toast">
      <div v-if="toast" class="toast-message"><Check :size="16" />{{ toast }}</div>
    </transition>
  </div>
</template>
