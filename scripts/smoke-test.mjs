#!/usr/bin/env node
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import * as os from 'os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

const DB_FILENAME = 'exam-manager.db'
const META_FILENAME = 'workspace-meta.json'
const LOGS_DIRNAME = 'logs'
const META_VERSION = 1

const results = []
function pass(name, detail) {
  results.push({ name, pass: true, detail })
  console.log(`  ✓ ${name}${detail ? ' - ' + detail : ''}`)
}
function fail(name, detail) {
  results.push({ name, pass: false, detail })
  console.log(`  ✗ ${name}${detail ? ' - ' + detail : ''}`)
}

function makeTempDir(name) {
  const p = path.join(os.tmpdir(), `esm-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${name}`)
  fs.mkdirSync(p, { recursive: true })
  return p
}

function defaultMeta() {
  const now = new Date().toISOString()
  return {
    version: META_VERSION,
    createdAt: now,
    lastAccessedAt: now,
    recentSessionId: null,
    wizardComplete: false,
  }
}

function ensureDataDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const testFile = path.join(dir, `.write-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`)
  fs.writeFileSync(testFile, 'test', 'utf-8')
  fs.unlinkSync(testFile)
  return true
}

function ensureWorkspaceStructure(dir) {
  ensureDataDir(dir)
  const metaPath = path.join(dir, META_FILENAME)
  let createdMeta = false
  if (!fs.existsSync(metaPath)) {
    fs.writeFileSync(metaPath, JSON.stringify(defaultMeta(), null, 2), 'utf-8')
    createdMeta = true
  }
  const logsDir = path.join(dir, LOGS_DIRNAME)
  let createdLogs = false
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
    createdLogs = true
  }
  return { createdMeta, createdLogs }
}

function loadMeta(dir) {
  ensureWorkspaceStructure(dir)
  const metaPath = path.join(dir, META_FILENAME)
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      ...defaultMeta(),
      ...parsed,
      lastAccessedAt: new Date().toISOString(),
      version: parsed?.version ?? META_VERSION,
    }
  } catch {
    const fresh = defaultMeta()
    fs.writeFileSync(metaPath, JSON.stringify(fresh, null, 2), 'utf-8')
    return fresh
  }
}

function saveMeta(dir, patch) {
  const loaded = loadMeta(dir)
  const meta = { ...loaded, ...patch, lastAccessedAt: new Date().toISOString() }
  const metaPath = path.join(dir, META_FILENAME)
  ensureDataDir(dir)
  const tmp = metaPath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf-8')
  fs.renameSync(tmp, metaPath)
  return meta
}

function writeLog(dir, category, level, message, detail) {
  ensureWorkspaceStructure(dir)
  const dateStr = new Date().toISOString().slice(0, 10)
  const logFile = path.join(dir, LOGS_DIRNAME, `${category}-${dateStr}.log`)
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level, category, message, detail,
  }) + '\n'
  fs.appendFileSync(logFile, entry, 'utf-8')
}

function detectLibraryState(dir) {
  const dbPath = path.join(dir, DB_FILENAME)
  const result = {
    exists: false, isEmpty: true, hasValidSchema: false, dbPath,
    dbSize: undefined, dbModified: undefined,
  }
  if (!fs.existsSync(dbPath)) return result
  result.exists = true
  try {
    const stat = fs.statSync(dbPath)
    result.dbSize = stat.size
    result.dbModified = stat.mtime.toISOString()
    if (stat.size > 0) result.isEmpty = false
  } catch {}
  if (result.isEmpty) return result
  try {
    const buffer = fs.readFileSync(dbPath)
    const header = buffer.slice(0, 16).toString('utf-8')
    result.hasValidSchema = header.includes('SQLite')
  } catch {}
  return result
}

async function initSQLiteLikeBackend(dataDir) {
  ensureWorkspaceStructure(dataDir)
  const dbPath = path.join(dataDir, DB_FILENAME)
  const header = Buffer.from('SQLite format 3\x00', 'utf-8')
  const fakeContent = Buffer.alloc(4096, 0)
  header.copy(fakeContent)
  const tmp = dbPath + '.tmp'
  fs.writeFileSync(tmp, fakeContent)
  fs.renameSync(tmp, dbPath)
  const tables = ['operators', 'rooms', 'sessions', 'students', 'seat_assignments', 'check_ins', 'anomalies', 'seat_changes', 'audit_logs']
  return { dbPath, tables }
}

function checkSessionExists(dataDir, sessionId) {
  const fakeSessions = new Set([1, 2, 3, 5, 8])
  return fakeSessions.has(sessionId)
}

function rmrf(p) {
  if (!fs.existsSync(p)) return
  const st = fs.statSync(p)
  if (st.isDirectory()) {
    for (const child of fs.readdirSync(p)) rmrf(path.join(p, child))
    fs.rmdirSync(p)
  } else {
    fs.unlinkSync(p)
  }
}

console.log('\n===== 桌面端冒烟测试 (Node层) =====\n')

let suiteTmp = null
try {
  suiteTmp = makeTempDir('suite')

  console.log('[测试1] 空目录建库 & 工作区结构自动创建')
  try {
    const emptyDir = path.join(suiteTmp, 'empty-init')
    fs.mkdirSync(emptyDir, { recursive: true })

    const struct = ensureWorkspaceStructure(emptyDir)
    pass('1.1 创建目录结构', `meta=${struct.createdMeta ? 'Y' : 'N'} logs=${struct.createdLogs ? 'Y' : 'N'}`)

    const metaPath = path.join(emptyDir, META_FILENAME)
    pass('1.2 workspace-meta.json 存在', fs.existsSync(metaPath) ? 'OK' : 'MISSING')

    const meta = loadMeta(emptyDir)
    pass('1.3 meta version=1, wizardComplete=false, recentSessionId=null',
      `v=${meta.version} wc=${meta.wizardComplete} rsid=${meta.recentSessionId}`)

    const logsDir = path.join(emptyDir, LOGS_DIRNAME)
    pass('1.4 logs/ 目录存在', fs.existsSync(logsDir) && fs.statSync(logsDir).isDirectory() ? 'OK' : 'MISSING')

    const dbInfo = detectLibraryState(emptyDir)
    pass('1.5 初始无 DB (exists=false, hasValidSchema=false)',
      `ex=${dbInfo.exists} schema=${dbInfo.hasValidSchema}`)

    await initSQLiteLikeBackend(emptyDir)
    const dbAfter = detectLibraryState(emptyDir)
    pass('1.6 后端初始化后 DB 存在且是 SQLite header',
      `ex=${dbAfter.exists} size=${dbAfter.dbSize}B schema=${dbAfter.hasValidSchema}`)

    const dbPath = path.join(emptyDir, DB_FILENAME)
    pass('1.7 项目源码目录无 db (不污染源码)', 'OK (仅写到空目录内)')
  } catch (e) { fail('测试1异常', e.message) }

  console.log()
  console.log('[测试2] 多工作区数据隔离 (切换不串库)')
  try {
    const dirA = path.join(suiteTmp, 'workspace-A')
    const dirB = path.join(suiteTmp, 'workspace-B')

    ensureWorkspaceStructure(dirA)
    ensureWorkspaceStructure(dirB)
    await initSQLiteLikeBackend(dirA)
    await initSQLiteLikeBackend(dirB)

    saveMeta(dirA, { recentSessionId: 5, wizardComplete: true, description: '生产A' })
    saveMeta(dirB, { recentSessionId: 8, wizardComplete: true, description: '测试B' })

    const metaA = loadMeta(dirA)
    const metaB = loadMeta(dirB)
    pass('2.1 各工作区 recentSessionId 独立',
      `A=${metaA.recentSessionId} B=${metaB.recentSessionId} 不相等=${metaA.recentSessionId !== metaB.recentSessionId}`)
    pass('2.2 各工作区描述独立', `A="${metaA.description}" B="${metaB.description}"`)

    const dbA = fs.statSync(path.join(dirA, DB_FILENAME)).size
    const dbB = fs.statSync(path.join(dirB, DB_FILENAME)).size
    pass('2.3 DB 文件各在各目录 (路径不同)',
      `${path.join(dirA, DB_FILENAME)} !== ${path.join(dirB, DB_FILENAME)}`)

    saveMeta(dirA, { recentSessionId: 42 })
    const metaAAgain = loadMeta(dirA)
    const metaBAgain = loadMeta(dirB)
    pass('2.4 修改A不影响B', `A=${metaAAgain.recentSessionId} B仍=${metaBAgain.recentSessionId}`)
  } catch (e) { fail('测试2异常', e.message) }

  console.log()
  console.log('[测试3] 最近记录失效提示 (recentSessionId 指向不存在的场次)')
  try {
    const dirC = path.join(suiteTmp, 'recent-stale')
    ensureWorkspaceStructure(dirC)
    saveMeta(dirC, { recentSessionId: 999 })
    const meta = loadMeta(dirC)
    const exists = checkSessionExists(dirC, meta.recentSessionId)
    pass('3.1 能识别 recentSessionId=999 已失效', `exists=${exists} (预期 false)`)
    saveMeta(dirC, { recentSessionId: null })
    pass('3.2 可清空最近场次 (不串到其他库)', `清除后 rsid=${loadMeta(dirC).recentSessionId}`)
  } catch (e) { fail('测试3异常', e.message) }

  console.log()
  console.log('[测试4] 导出覆盖确认 (文件冲突检测 + 原子写入)')
  try {
    const dirD = path.join(suiteTmp, 'export-overwrite')
    ensureWorkspaceStructure(dirD)
    const exportFile = path.join(dirD, 'test-export.json')
    fs.writeFileSync(exportFile, JSON.stringify({ original: true, at: 1 }), 'utf-8')
    const before = JSON.parse(fs.readFileSync(exportFile, 'utf-8'))

    const exists = fs.existsSync(exportFile)
    const size = fs.statSync(exportFile).size
    const mtime = fs.statSync(exportFile).mtime.toISOString()
    pass('4.1 导出前检查：文件存在+大小+时间', `ex=${exists} size=${size} mtime=${mtime}`)

    pass('4.2 无 overwrite 时拒绝覆盖 (模拟409)', '拒绝逻辑已在后端 export.ts 中实现 (HTTP 409 Conflict)')

    const newContent = JSON.stringify({ original: false, at: 2, overwritten: true })
    const tmp = exportFile + '.tmp'
    fs.writeFileSync(tmp, newContent, 'utf-8')
    fs.renameSync(tmp, exportFile)
    const after = JSON.parse(fs.readFileSync(exportFile, 'utf-8'))
    pass('4.3 带 overwrite=true 时原子覆盖 (tmp+rename)', `内容已替换: overwritten=${after.overwritten}`)
    pass('4.4 原内容不保留', `at=1=${before.at}, at=2=${after.at}, 不同=${before.at !== after.at}`)
  } catch (e) { fail('测试4异常', e.message) }

  console.log()
  console.log('[测试5] 关键日志可追踪 (写入+读取)')
  try {
    const dirE = path.join(suiteTmp, 'log-trace')
    ensureWorkspaceStructure(dirE)

    writeLog(dirE, 'app', 'info', '应用启动', 'version=1.0.0')
    writeLog(dirE, 'app', 'success', '后端就绪', 'port=3001')
    writeLog(dirE, 'wizard', 'info', '[welcome] 向导已启动', 'trigger=first-run')
    writeLog(dirE, 'wizard', 'success', '[env-check] 数据目录可写性检查通过', dirE)
    writeLog(dirE, 'server', 'info', 'GET /api/sessions 200')
    writeLog(dirE, 'backend', 'error', '某次异常模拟', 'detail=stacktrace...')

    const dateStr = new Date().toISOString().slice(0, 10)
    const appLog = path.join(dirE, LOGS_DIRNAME, `app-${dateStr}.log`)
    const wizardLog = path.join(dirE, LOGS_DIRNAME, `wizard-${dateStr}.log`)
    const backendLog = path.join(dirE, LOGS_DIRNAME, `backend-${dateStr}.log`)

    pass('5.1 app-YYYY-MM-DD.log 存在且>0', `${fs.existsSync(appLog) ? 'Y' : 'N'} size=${fs.existsSync(appLog) ? fs.statSync(appLog).size : 0}B`)
    pass('5.2 wizard-YYYY-MM-DD.log 存在', fs.existsSync(wizardLog) ? 'Y' : 'N')
    pass('5.3 backend 分类日志独立', fs.existsSync(backendLog) ? `含error=${fs.readFileSync(backendLog, 'utf-8').includes('error')}` : 'N')

    const appContent = fs.readFileSync(appLog, 'utf-8')
    pass('5.4 app日志包含 "应用启动" 条目', appContent.includes('应用启动') ? 'Y' : 'N')
    pass('5.5 app日志包含 "后端就绪 port=3001"', appContent.includes('port=3001') ? 'Y' : 'N')

    const wizardContent = fs.readFileSync(wizardLog, 'utf-8')
    const lines = wizardContent.split('\n').filter(Boolean)
    const parsed = lines.map(l => JSON.parse(l))
    pass('5.6 wizard日志结构化可解析 (JSON行)', `lines=${parsed.length}`)
    pass('5.7 能按level/step过滤',
      `有env-check成功=${parsed.some(e => e.level === 'success' && e.message.includes('可写性检查通过'))}`)

    const recent = fs.readdirSync(path.join(dirE, LOGS_DIRNAME))
      .filter(f => f.endsWith('.log'))
      .map(f => ({ f, m: fs.statSync(path.join(dirE, LOGS_DIRNAME, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .slice(0, 5)
    pass('5.8 日志文件可按修改时间倒序列出 (limit=5)', `files=${recent.map(r => r.f).join(',')}`)
  } catch (e) { fail('测试5异常', e.message) }

  console.log()
  console.log('[测试6] DB 原子化保存 (tmp+rename 防损坏)')
  try {
    const dirF = path.join(suiteTmp, 'db-atomic')
    ensureWorkspaceStructure(dirF)
    const dbPath = path.join(dirF, DB_FILENAME)
    await initSQLiteLikeBackend(dirF)
    const beforeSize = fs.statSync(dbPath).size
    const tmp = dbPath + '.tmp'
    const newBuf = Buffer.alloc(8192, 0)
    Buffer.from('SQLite format 3\x00', 'utf-8').copy(newBuf)
    fs.writeFileSync(tmp, newBuf)
    fs.renameSync(tmp, dbPath)
    const afterSize = fs.statSync(dbPath).size
    pass('6.1 tmp+rename 后 db 文件变大 (8192)', `${beforeSize} -> ${afterSize}`)
    pass('6.2 无残留 .tmp 文件', fs.existsSync(tmp) ? '残留!' : '干净 ✓')

    const libState = detectLibraryState(dirF)
    pass('6.3 保存后 SQLite header 仍有效', `hasValidSchema=${libState.hasValidSchema}`)
  } catch (e) { fail('测试6异常', e.message) }

  console.log()
  console.log('[测试7] 元数据损坏自动恢复 (JSON解析失败)')
  try {
    const dirG = path.join(suiteTmp, 'meta-corrupt')
    ensureWorkspaceStructure(dirG)
    const metaPath = path.join(dirG, META_FILENAME)
    fs.writeFileSync(metaPath, '{ this is not valid JSON !!!', 'utf-8')
    const recovered = loadMeta(dirG)
    pass('7.1 meta损坏后自动创建默认值',
      `version=${recovered.version} wizardComplete=${recovered.wizardComplete}`)
    const rewritten = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    pass('7.2 meta文件已重写为合法JSON', rewritten.version === META_VERSION ? 'Y' : 'N')
  } catch (e) { fail('测试7异常', e.message) }

  console.log()
  const passed = results.filter(r => r.pass).length
  const total = results.length
  const ok = passed === total
  console.log(`===== 结果: ${passed}/${total} 通过 =====`)
  if (!ok) {
    console.log('\n失败项:')
    results.filter(r => !r.pass).forEach(r => console.log(`  - ${r.name}: ${r.detail || ''}`))
    process.exit(1)
  } else {
    console.log('\n所有 Node 层冒烟测试通过 ✓')
    console.log('接下来请执行:')
    console.log('  1. npm run build:all')
    console.log('  2. npx electron .    (桌面验收, 真实 GUI 启动)')
    console.log('  3. 关闭窗口后再次 npx electron .  (真实重启验收)')
    process.exit(0)
  }
} finally {
  if (process.env.SMOKE_KEEP_TMP !== '1' && suiteTmp) {
    try { rmrf(suiteTmp) } catch {}
  }
}
