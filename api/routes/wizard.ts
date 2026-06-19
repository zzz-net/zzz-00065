import { Router, type Request, type Response } from 'express';
import {
  queryAll,
  queryOne,
  addAuditLog,
  getDataDirectory,
  getDatabasePath,
} from '../db.js';
import { requireAuth } from './operators.js';
import * as fs from 'fs';
import * as path from 'path';
import initSqlJs from 'sql.js';

const router = Router();

router.use(requireAuth);

router.get('/wizard/db-info', (req: Request, res: Response): void => {
  const dataDir = getDataDirectory();
  const dbPath = getDatabasePath();
  let dbExists = false;
  let dbSize = 0;
  let dbModified: string | null = null;
  let tableCount = 0;
  let tables: string[] = [];

  try {
    if (fs.existsSync(dbPath)) {
      dbExists = true;
      const stat = fs.statSync(dbPath);
      dbSize = stat.size;
      dbModified = stat.mtime.toISOString();

      const tablesResult = queryAll(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      );
      tableCount = tablesResult.length;
      tables = tablesResult.map((t: any) => t.name);
    }
  } catch (e) {
    // ignore
  }

  const counts = {
    sessions: 0,
    students: 0,
    rooms: 0,
    auditLogs: 0,
  };

  if (dbExists) {
    try {
      counts.sessions = queryAll('SELECT COUNT(*) as c FROM sessions')[0]?.c || 0;
      counts.students = queryAll('SELECT COUNT(*) as c FROM students')[0]?.c || 0;
      counts.rooms = queryAll('SELECT COUNT(*) as c FROM rooms')[0]?.c || 0;
      counts.auditLogs = queryAll('SELECT COUNT(*) as c FROM audit_logs')[0]?.c || 0;
    } catch (e) {
      // ignore
    }
  }

  const recentSessions: any[] = [];
  if (dbExists && counts.sessions > 0) {
    try {
      recentSessions.push(
        ...queryAll(
          'SELECT id, name, exam_date, status, created_at FROM sessions ORDER BY id DESC LIMIT 5'
        )
      );
    } catch (e) {
      // ignore
    }
  }

  res.json({
    success: true,
    data: {
      dataDir,
      dbPath,
      dbExists,
      dbSize,
      dbModified,
      tableCount,
      tables,
      counts,
      recentSessions,
    },
  });
});

router.post('/wizard/verify-db', async (req: Request, res: Response): Promise<void> => {
  const { dbPath } = req.body || {};
  if (!dbPath || typeof dbPath !== 'string') {
    res.status(400).json({ success: false, error: 'dbPath 必填' });
    return;
  }

  if (!fs.existsSync(dbPath)) {
    res.status(400).json({ success: false, error: '数据库文件不存在' });
    return;
  }

  try {
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    const tablesResult = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    const tables = tablesResult.length > 0
      ? tablesResult[0].values.map((row) => String(row[0]))
      : [];

    const requiredTables = [
      'operators', 'rooms', 'sessions', 'students',
      'seat_assignments', 'check_ins', 'anomalies',
      'seat_changes', 'audit_logs'
    ];
    const missingTables = requiredTables.filter((t) => !tables.includes(t));

    const tableCounts: Record<string, number> = {};
    for (const table of tables) {
      try {
        const countResult = db.exec(`SELECT COUNT(*) as c FROM "${table}"`);
        tableCounts[table] = countResult.length > 0 ? Number(countResult[0].values[0][0]) : 0;
      } catch {
        tableCounts[table] = 0;
      }
    }

    db.close();

    res.json({
      success: true,
      data: {
        valid: missingTables.length === 0,
        tables,
        missingTables,
        tableCounts,
        totalRecords: Object.values(tableCounts).reduce((a, b) => a + b, 0),
      },
    });
  } catch (e: any) {
    res.status(500).json({
      success: false,
      error: '数据库验证失败',
      detail: e?.message || '未知错误',
    });
  }
});

router.post('/wizard/migrate-verify', async (req: Request, res: Response): Promise<void> => {
  const operator = (req as any).operator;
  const { sourceDb, targetDb } = req.body || {};

  if (!sourceDb || typeof sourceDb !== 'string') {
    res.status(400).json({ success: false, error: 'sourceDb 必填' });
    return;
  }
  if (!targetDb || typeof targetDb !== 'string') {
    res.status(400).json({ success: false, error: 'targetDb 必填' });
    return;
  }

  if (!fs.existsSync(sourceDb)) {
    res.status(400).json({ success: false, error: '源数据库不存在' });
    return;
  }

  try {
    const targetDir = path.dirname(targetDb);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    if (fs.existsSync(targetDb)) {
      const backupPath = targetDb + `.backup-${Date.now()}.db`;
      fs.copyFileSync(targetDb, backupPath);
    }

    fs.copyFileSync(sourceDb, targetDb);

    addAuditLog(
      null,
      operator.id,
      'wizard_migrate_db',
      `通过向导迁移数据库：从 ${sourceDb} 到 ${targetDb}`
    );

    res.json({
      success: true,
      data: {
        migrated: true,
        sourceDb,
        targetDb,
        size: fs.statSync(targetDb).size,
      },
    });
  } catch (e: any) {
    res.status(500).json({
      success: false,
      error: '迁移失败',
      detail: e?.message || '未知错误',
    });
  }
});

router.get('/wizard/recent-sessions', (req: Request, res: Response): void => {
  try {
    const sessions = queryAll(
      `SELECT s.id, s.name, s.exam_date, s.start_time, s.status, s.created_at,
              r.name as room_name,
              (SELECT COUNT(*) FROM students st WHERE st.session_id = s.id) as student_count
       FROM sessions s
       LEFT JOIN rooms r ON s.room_id = r.id
       ORDER BY s.id DESC
       LIMIT 10`
    );

    res.json({
      success: true,
      data: sessions,
    });
  } catch (e: any) {
    res.status(500).json({
      success: false,
      error: '获取最近场次失败',
      detail: e?.message || '未知错误',
    });
  }
});

router.post('/wizard/complete', (req: Request, res: Response): void => {
  const operator = (req as any).operator;
  const { dataDir, action, migrateFrom } = req.body || {};

  addAuditLog(
    null,
    operator.id,
    'wizard_complete',
    `首启向导完成。数据目录: ${dataDir}, 操作: ${action}${migrateFrom ? `, 迁移源: ${migrateFrom}` : ''}`
  );

  res.json({ success: true });
});

export default router;
