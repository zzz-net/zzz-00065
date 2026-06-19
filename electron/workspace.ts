import * as fs from 'fs'
import * as path from 'path'

export const DB_FILENAME = 'exam-manager.db'
export const META_FILENAME = 'workspace-meta.json'
export const LOGS_DIRNAME = 'logs'
export const WRITE_TEST_PREFIX = '.write-test'

export const META_VERSION = 1

export interface WorkspaceMeta {
  version: number
  createdAt: string
  lastAccessedAt: string
  recentSessionId: number | null
  wizardComplete: boolean
  description?: string
}

export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'success' | 'debug'
  category: string
  message: string
  detail?: string
}

export type LogCategory = 'app' | 'wizard' | 'server' | 'backend'

export function defaultMeta(): WorkspaceMeta {
  const now = new Date().toISOString()
  return {
    version: META_VERSION,
    createdAt: now,
    lastAccessedAt: now,
    recentSessionId: null,
    wizardComplete: false,
  }
}

export function getDbPath(dataDir: string): string {
  return path.join(dataDir, DB_FILENAME)
}

export function getMetaPath(dataDir: string): string {
  return path.join(dataDir, META_FILENAME)
}

export function getLogsDir(dataDir: string): string {
  return path.join(dataDir, LOGS_DIRNAME)
}

export function getLogFile(dataDir: string, category: LogCategory): string {
  const dateStr = new Date().toISOString().slice(0, 10)
  return path.join(getLogsDir(dataDir), `${category}-${dateStr}.log`)
}

export function ensureDataDir(dir: string): { ok: boolean; error?: string; errorCode?: string } {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const testFile = path.join(
      dir,
      `${WRITE_TEST_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`
    )
    fs.writeFileSync(testFile, 'workspace-write-test', 'utf-8')
    fs.unlinkSync(testFile)
    return { ok: true }
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || String(e) || '未知错误',
      errorCode: e?.code || 'UNKNOWN',
    }
  }
}

export function ensureWorkspaceStructure(dir: string): {
  ok: boolean
  error?: string
  errorCode?: string
  createdMeta: boolean
  createdLogs: boolean
} {
  const dirCheck = ensureDataDir(dir)
  if (!dirCheck.ok) {
    return { ok: false, error: dirCheck.error, errorCode: dirCheck.errorCode, createdMeta: false, createdLogs: false }
  }

  let createdMeta = false
  let createdLogs = false

  const metaPath = getMetaPath(dir)
  if (!fs.existsSync(metaPath)) {
    try {
      fs.writeFileSync(metaPath, JSON.stringify(defaultMeta(), null, 2), 'utf-8')
      createdMeta = true
    } catch (e: any) {
      return {
        ok: false,
        error: `无法创建工作区元数据：${e?.message || String(e)}`,
        errorCode: e?.code || 'META_WRITE_FAILED',
        createdMeta: false,
        createdLogs: false,
      }
    }
  }

  const logsDir = getLogsDir(dir)
  if (!fs.existsSync(logsDir)) {
    try {
      fs.mkdirSync(logsDir, { recursive: true })
      createdLogs = true
    } catch (e: any) {
      return {
        ok: false,
        error: `无法创建日志目录：${e?.message || String(e)}`,
        errorCode: e?.code || 'LOGS_DIR_FAILED',
        createdMeta,
        createdLogs: false,
      }
    }
  }

  return { ok: true, createdMeta, createdLogs }
}

export function loadMeta(dir: string): { ok: boolean; meta: WorkspaceMeta; error?: string; corrupted?: boolean } {
  const ensure = ensureWorkspaceStructure(dir)
  if (!ensure.ok) {
    return { ok: false, meta: defaultMeta(), error: ensure.error, corrupted: false }
  }

  const metaPath = getMetaPath(dir)
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8')
    const parsed = JSON.parse(raw)
    const meta: WorkspaceMeta = {
      ...defaultMeta(),
      ...parsed,
      lastAccessedAt: new Date().toISOString(),
      version: parsed?.version ?? META_VERSION,
    }
    return { ok: true, meta }
  } catch (e: any) {
    const meta = defaultMeta()
    try {
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    } catch {}
    return { ok: false, meta, error: e?.message || String(e), corrupted: true }
  }
}

export function saveMeta(dir: string, patch: Partial<WorkspaceMeta>): { ok: boolean; meta?: WorkspaceMeta; error?: string } {
  const loaded = loadMeta(dir)
  const meta: WorkspaceMeta = {
    ...loaded.meta,
    ...patch,
    lastAccessedAt: new Date().toISOString(),
    version: patch?.version ?? loaded.meta.version ?? META_VERSION,
  }

  const metaPath = getMetaPath(dir)
  try {
    const dirCheck = ensureDataDir(dir)
    if (!dirCheck.ok) {
      return { ok: false, error: dirCheck.error }
    }
    const tmpPath = metaPath + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(meta, null, 2), 'utf-8')
    fs.renameSync(tmpPath, metaPath)
    return { ok: true, meta }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

export function detectLibraryState(dir: string): {
  exists: boolean
  isEmpty: boolean
  hasValidSchema: boolean
  dbPath: string
  dbSize?: number
  dbModified?: string
} {
  const dbPath = getDbPath(dir)
  const result = {
    exists: false,
    isEmpty: true,
    hasValidSchema: false,
    dbPath,
    dbSize: undefined as number | undefined,
    dbModified: undefined as string | undefined,
  }

  if (!fs.existsSync(dbPath)) {
    return result
  }

  result.exists = true
  try {
    const stat = fs.statSync(dbPath)
    result.dbSize = stat.size
    result.dbModified = stat.mtime.toISOString()
    if (stat.size > 0) {
      result.isEmpty = false
    }
  } catch {}

  if (result.isEmpty) {
    return result
  }

  try {
    const buffer = fs.readFileSync(dbPath)
    const header = buffer.slice(0, 16).toString('utf-8')
    result.hasValidSchema = header.includes('SQLite')
  } catch {
    result.hasValidSchema = false
  }

  return result
}

export function writeLog(
  dir: string,
  category: LogCategory,
  level: LogEntry['level'],
  message: string,
  detail?: string
): { ok: boolean; error?: string } {
  const ensure = ensureWorkspaceStructure(dir)
  if (!ensure.ok) {
    return { ok: false, error: ensure.error }
  }

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    detail,
  }

  const logLine = JSON.stringify(entry) + '\n'
  const logFile = getLogFile(dir, category)

  try {
    fs.appendFileSync(logFile, logLine, 'utf-8')
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

export function writeLogs(
  dir: string,
  entries: Array<{ category: LogCategory; level: LogEntry['level']; message: string; detail?: string }>
): void {
  for (const e of entries) {
    writeLog(dir, e.category, e.level, e.message, e.detail)
  }
}

export function getRecentSessionId(dir: string): number | null {
  const loaded = loadMeta(dir)
  return loaded.meta.recentSessionId ?? null
}

export function setRecentSessionId(dir: string, sessionId: number | null): { ok: boolean; error?: string } {
  return saveMeta(dir, { recentSessionId: sessionId })
}

export function isWizardComplete(dir: string): boolean {
  const loaded = loadMeta(dir)
  return loaded.meta.wizardComplete ?? false
}

export function markWizardComplete(dir: string): { ok: boolean; error?: string } {
  return saveMeta(dir, { wizardComplete: true })
}

export function listRecentLogFiles(dir: string, limit: number = 5): string[] {
  const logsDir = getLogsDir(dir)
  if (!fs.existsSync(logsDir)) {
    return []
  }
  try {
    const files = fs.readdirSync(logsDir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => ({ name: f, path: path.join(logsDir, f) }))
      .map((f) => {
        try {
          const stat = fs.statSync(f.path)
          return { ...f, mtime: stat.mtimeMs }
        } catch {
          return { ...f, mtime: 0 }
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((f) => f.path)
    return files
  } catch {
    return []
  }
}

export function readLogTail(filePath: string, maxLines: number = 200): { ok: boolean; lines: LogEntry[]; error?: string } {
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, lines: [], error: '日志文件不存在' }
    }
    const stat = fs.statSync(filePath)
    const CHUNK = 8192
    let bytesRead = 0
    const chunks: Buffer[] = []
    const fd = fs.openSync(filePath, 'r')
    try {
      let pos = Math.max(0, stat.size - CHUNK * 5)
      const buf = Buffer.alloc(CHUNK)
      while (pos < stat.size) {
        const toRead = Math.min(CHUNK, stat.size - pos)
        const n = fs.readSync(fd, buf, 0, toRead, pos)
        if (n === 0) break
        chunks.push(Buffer.from(buf.slice(0, n)))
        pos += n
        bytesRead += n
      }
    } finally {
      fs.closeSync(fd)
    }

    const content = Buffer.concat(chunks).toString('utf-8')
    const allLines = content.split('\n').filter((l) => l.trim().length > 0)
    const tail = allLines.slice(-maxLines)
    const entries: LogEntry[] = []
    for (const line of tail) {
      try {
        entries.push(JSON.parse(line))
      } catch {}
    }
    return { ok: true, lines: entries }
  } catch (e: any) {
    return { ok: false, lines: [], error: e?.message || String(e) }
  }
}
