import initSqlJs, { type Database } from 'sql.js';
import fs from 'fs';
import path from 'path';

let dbDir: string = process.env.DB_DIR || process.cwd();
let dbPath: string = path.resolve(dbDir, 'exam-manager.db');
let db: Database;

const TABLES = [
  `CREATE TABLE IF NOT EXISTS operators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    seat_rows INTEGER NOT NULL,
    seat_cols INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id),
    name TEXT NOT NULL,
    exam_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    reg_no TEXT NOT NULL,
    name TEXT NOT NULL,
    org TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(session_id, reg_no)
  )`,
  `CREATE TABLE IF NOT EXISTS seat_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    seat_row INTEGER NOT NULL,
    seat_col INTEGER NOT NULL,
    assigned_at TEXT DEFAULT (datetime('now')),
    UNIQUE(session_id, seat_row, seat_col)
  )`,
  `CREATE TABLE IF NOT EXISTS check_ins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    status TEXT NOT NULL DEFAULT 'checked_in',
    operator_id INTEGER NOT NULL REFERENCES operators(id),
    checked_at TEXT DEFAULT (datetime('now')),
    UNIQUE(session_id, student_id)
  )`,
  `CREATE TABLE IF NOT EXISTS anomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    student_id INTEGER REFERENCES students(id),
    type TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'open',
    reported_by INTEGER NOT NULL REFERENCES operators(id),
    reported_at TEXT DEFAULT (datetime('now')),
    closed_by INTEGER REFERENCES operators(id),
    closed_at TEXT,
    close_reason TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS seat_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    from_row INTEGER,
    from_col INTEGER,
    to_row INTEGER NOT NULL,
    to_col INTEGER NOT NULL,
    reason TEXT NOT NULL,
    operator_id INTEGER NOT NULL REFERENCES operators(id),
    changed_at TEXT DEFAULT (datetime('now')),
    undone INTEGER DEFAULT 0,
    undone_by INTEGER REFERENCES operators(id),
    undone_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    operator_id INTEGER NOT NULL REFERENCES operators(id),
    action TEXT NOT NULL,
    detail TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
];

export function ensureDirectoryWritable(dirPath: string): { ok: boolean; error?: string } {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    const testFile = path.join(dirPath, `.write-test-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    fs.writeFileSync(testFile, 'test', 'utf-8');
    fs.unlinkSync(testFile);
    return { ok: true };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.code || e?.message || '未知错误',
    };
  }
}

export function setDataDirectory(newDir: string): { ok: boolean; error?: string } {
  const check = ensureDirectoryWritable(newDir);
  if (!check.ok) {
    return check;
  }
  dbDir = newDir;
  dbPath = path.resolve(dbDir, 'exam-manager.db');
  return { ok: true };
}

let dbReady = false;

export function isDBReady(): boolean {
  return dbReady;
}

export async function reinitDB(): Promise<{ ok: boolean; error?: string }> {
  try {
    const dirCheck = ensureDirectoryWritable(dbDir);
    if (!dirCheck.ok) {
      return { ok: false, error: `数据目录不可写 (${dbDir}): ${dirCheck.error}` };
    }

    const SQL = await initSqlJs();
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }

    for (const sql of TABLES) {
      db.run(sql);
    }

    db.run(
      `INSERT OR IGNORE INTO operators (username, display_name, role) VALUES ('admin', '管理员', 'admin')`
    );
    db.run(
      `INSERT OR IGNORE INTO operators (username, display_name, role) VALUES ('operator1', '操作员1', 'operator')`
    );

    saveDB();
    dbReady = true;
    return { ok: true };
  } catch (e: any) {
    dbReady = false;
    return { ok: false, error: e?.message || '数据库重新初始化失败' };
  }
}

export function getDataDirectory(): string {
  return dbDir;
}

export function getDatabasePath(): string {
  return dbPath;
}

export async function initDB() {
  const dirCheck = ensureDirectoryWritable(dbDir);
  if (!dirCheck.ok) {
    dbReady = false;
    throw new Error(`数据目录不可写 (${dbDir}): ${dirCheck.error}`);
  }

  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  for (const sql of TABLES) {
    db.run(sql);
  }

  db.run(
    `INSERT OR IGNORE INTO operators (username, display_name, role) VALUES ('admin', '管理员', 'admin')`
  );
  db.run(
    `INSERT OR IGNORE INTO operators (username, display_name, role) VALUES ('operator1', '操作员1', 'operator')`
  );

  saveDB();
  dbReady = true;
}

export function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

export function getDB(): Database {
  return db;
}

export function queryAll(sql: string, params?: any[]): any[] {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

export function queryRun(sql: string, params?: any[]): { lastInsertRowid: number; changes: number } {
  const beforeId = getLastInsertRowid();
  db.run(sql, params);
  const afterId = getLastInsertRowid();
  const changes = getRowsModifiedCount(sql);
  saveDB();
  return {
    lastInsertRowid: afterId > beforeId ? afterId : 0,
    changes,
  };
}

function getLastInsertRowid(): number {
  const res = db.exec('SELECT last_insert_rowid() as id');
  if (res.length > 0 && res[0].values.length > 0) {
    return Number(res[0].values[0][0]);
  }
  return 0;
}

function getRowsModifiedCount(sql: string): number {
  const lower = sql.trim().toLowerCase();
  if (lower.startsWith('update') || lower.startsWith('delete')) {
    const res = db.exec('SELECT changes() as c');
    if (res.length > 0 && res[0].values.length > 0) {
      return Number(res[0].values[0][0]);
    }
  }
  if (lower.startsWith('insert')) return 1;
  return 0;
}

export function queryOne(sql: string, params?: any[]): any | undefined {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : undefined;
}

export function addAuditLog(sessionId: number | null, operatorId: number, action: string, detail: string) {
  db.run(
    `INSERT INTO audit_logs (session_id, operator_id, action, detail) VALUES (?, ?, ?, ?)`,
    [sessionId, operatorId, action, detail]
  );
  saveDB();
}
