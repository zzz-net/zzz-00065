import { Router, type Request, type Response } from 'express';
import {
  queryAll,
  getDataDirectory,
  getDatabasePath,
  ensureDirectoryWritable,
  setDataDirectory,
  addAuditLog,
  reinitDB,
  isDBReady,
} from '../db.js';
import { requireAuth } from './operators.js';
import * as fs from 'fs';

const router = Router();

router.get('/system/health', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    data: {
      ok: true,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      electron: process.env.ELECTRON_RUN === '1',
    },
  });
});

router.get('/system/info', requireAuth, (_req: Request, res: Response): void => {
  const dataDir = getDataDirectory();
  const dbPath = getDatabasePath();
  let dbSize = 0;
  let dbModified: string | null = null;
  try {
    if (fs.existsSync(dbPath)) {
      const stat = fs.statSync(dbPath);
      dbSize = stat.size;
      dbModified = stat.mtime.toISOString();
    }
  } catch {}

  const sessionCount = queryAll('SELECT COUNT(*) as c FROM sessions')[0]?.c || 0;
  const studentCount = queryAll('SELECT COUNT(*) as c FROM students')[0]?.c || 0;
  const roomCount = queryAll('SELECT COUNT(*) as c FROM rooms')[0]?.c || 0;
  const auditCount = queryAll('SELECT COUNT(*) as c FROM audit_logs')[0]?.c || 0;

  res.json({
    success: true,
    data: {
      dataDir,
      dbPath,
      dbSize,
      dbModified,
      counts: {
        sessions: sessionCount,
        students: studentCount,
        rooms: roomCount,
        auditLogs: auditCount,
      },
      env: {
        node: process.version,
        platform: process.platform,
        electron: process.env.ELECTRON_RUN === '1',
      },
    },
  });
});

router.post('/system/data-directory/check', requireAuth, (req: Request, res: Response): void => {
  const { directory } = req.body || {};
  if (!directory || typeof directory !== 'string') {
    res.status(400).json({ success: false, error: 'directory 必填' });
    return;
  }
  const check = ensureDirectoryWritable(directory);
  res.json({
    success: true,
    data: {
      directory,
      writable: check.ok,
      error: check.error,
    },
  });
});

router.post('/system/data-directory/switch', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const operator = (req as any).operator;
  if (operator.role !== 'admin') {
    res.status(403).json({ success: false, error: '仅管理员可切换数据目录' });
    return;
  }
  const { directory } = req.body || {};
  if (!directory || typeof directory !== 'string') {
    res.status(400).json({ success: false, error: 'directory 必填' });
    return;
  }
  const result = setDataDirectory(directory);
  if (!result.ok) {
    res.status(400).json({
      success: false,
      error: `目录不可用：${result.error}`,
      errorCode: 'DATA_DIR_NOT_WRITABLE',
    });
    return;
  }

  const reinitResult = await reinitDB();
  if (!reinitResult.ok) {
    res.status(500).json({
      success: false,
      error: `切换目录后数据库初始化失败：${reinitResult.error}`,
      errorCode: 'DB_INIT_FAILED',
    });
    return;
  }

  addAuditLog(null, operator.id, 'switch_data_dir', `切换数据目录到：${directory}`);
  res.json({
    success: true,
    data: {
      newDirectory: directory,
      dbPath: getDatabasePath(),
      dbReady: isDBReady(),
      notice: '数据目录已切换，数据库连接已重新初始化。',
    },
  });
});

export default router;
