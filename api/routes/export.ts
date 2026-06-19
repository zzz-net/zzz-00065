import { Router, type Request, type Response } from 'express';
import { queryAll, queryOne, addAuditLog } from '../db.js';
import { requireAuth } from './operators.js';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

router.use(requireAuth);

router.get('/:sessionId/export', (req: Request, res: Response): void => {
  const { sessionId } = req.params;

  const session = queryOne(
    `SELECT s.*, r.name as room_name, r.seat_rows, r.seat_cols
     FROM sessions s JOIN rooms r ON s.room_id = r.id
     WHERE s.id = ?`,
    [Number(sessionId)]
  );
  if (!session) {
    res.status(404).json({ success: false, error: '场次不存在' });
    return;
  }

  const room = queryOne('SELECT * FROM rooms WHERE id = ?', [(session as any).room_id]);

  const students = queryAll(
    `SELECT s.*, sa.seat_row, sa.seat_col, ci.status as check_in_status
     FROM students s
     LEFT JOIN seat_assignments sa ON sa.session_id = s.session_id AND sa.student_id = s.id
     LEFT JOIN check_ins ci ON ci.session_id = s.session_id AND ci.student_id = s.id
     WHERE s.session_id = ?
     ORDER BY s.id`,
    [Number(sessionId)]
  );

  const anomalies = queryAll(
    `SELECT a.*, s.reg_no, s.name as student_name
     FROM anomalies a
     LEFT JOIN students s ON a.student_id = s.id
     WHERE a.session_id = ?
     ORDER BY a.id`,
    [Number(sessionId)]
  );

  res.json({
    success: true,
    data: {
      session,
      room,
      students,
      anomalies,
      exportedAt: new Date().toISOString(),
    },
  });
});

router.post('/:sessionId/export/save', (req: Request, res: Response): void => {
  const { sessionId } = req.params;
  const { filePath, overwrite = false } = req.body || {};

  if (!filePath || typeof filePath !== 'string') {
    res.status(400).json({ success: false, error: 'filePath 必填' });
    return;
  }

  const session = queryOne(
    `SELECT s.*, r.name as room_name, r.seat_rows, r.seat_cols
     FROM sessions s JOIN rooms r ON s.room_id = r.id
     WHERE s.id = ?`,
    [Number(sessionId)]
  );
  if (!session) {
    res.status(404).json({ success: false, error: '场次不存在' });
    return;
  }

  if (!overwrite && fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    res.status(409).json({
      success: false,
      error: `导出目标文件已存在：${filePath}。请选择「覆盖写入」确认覆盖，或选择其他路径。`,
      conflict: {
        type: 'file_exists',
        filePath,
        fileSize: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      },
    });
    return;
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e: any) {
      res.status(500).json({
        success: false,
        error: `无法创建导出目录 (${dir})：${e?.message || '未知错误'}`,
      });
      return;
    }
  }

  const room = queryOne('SELECT * FROM rooms WHERE id = ?', [(session as any).room_id]);
  const students = queryAll(
    `SELECT s.*, sa.seat_row, sa.seat_col, ci.status as check_in_status
     FROM students s
     LEFT JOIN seat_assignments sa ON sa.session_id = s.session_id AND sa.student_id = s.id
     LEFT JOIN check_ins ci ON ci.session_id = s.session_id AND ci.student_id = s.id
     WHERE s.session_id = ?
     ORDER BY s.id`,
    [Number(sessionId)]
  );
  const anomalies = queryAll(
    `SELECT a.*, s.reg_no, s.name as student_name
     FROM anomalies a
     LEFT JOIN students s ON a.student_id = s.id
     WHERE a.session_id = ?
     ORDER BY a.id`,
    [Number(sessionId)]
  );

  const payload = {
    session,
    room,
    students,
    anomalies,
    exportedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (e: any) {
    res.status(500).json({
      success: false,
      error: `写入文件失败：${e?.message || '未知错误'}`,
    });
    return;
  }

  addAuditLog(
    Number(sessionId),
    (req as any).operator.id,
    'export_session_file',
    `导出场次数据到文件：${filePath}${overwrite ? '（覆盖）' : ''}`
  );

  res.json({
    success: true,
    data: {
      filePath,
      bytes: fs.statSync(filePath).size,
      studentsCount: students.length,
      anomaliesCount: anomalies.length,
      overwritten: overwrite,
    },
  });
});

router.post('/export/check-path', (req: Request, res: Response): void => {
  const { filePath } = req.body || {};
  if (!filePath || typeof filePath !== 'string') {
    res.status(400).json({ success: false, error: 'filePath 必填' });
    return;
  }

  const exists = fs.existsSync(filePath);
  const result: any = { exists };
  if (exists) {
    try {
      const stat = fs.statSync(filePath);
      result.isFile = stat.isFile();
      result.size = stat.size;
      result.modifiedAt = stat.mtime.toISOString();
    } catch {
      result.isFile = false;
    }
  }

  const dir = path.dirname(filePath);
  const dirExists = fs.existsSync(dir);
  let dirWritable = false;
  if (dirExists) {
    try {
      const testFile = path.join(dir, `.export-test-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
      fs.writeFileSync(testFile, 'test', 'utf-8');
      fs.unlinkSync(testFile);
      dirWritable = true;
    } catch {
      dirWritable = false;
    }
  }
  result.dirExists = dirExists;
  result.dirWritable = dirWritable;

  res.json({ success: true, data: result });
});

export default router;
