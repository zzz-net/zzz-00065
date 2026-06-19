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
  const operator = (req as any).operator;

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
    addAuditLog(
      Number(sessionId),
      operator.id,
      'export_session_file_failed',
      `导出失败：场次不存在`
    );
    res.status(404).json({ success: false, error: '场次不存在' });
    return;
  }

  const dir = path.dirname(filePath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const testFile = path.join(dir, `.export-write-test-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    fs.writeFileSync(testFile, 'test', 'utf-8');
    fs.unlinkSync(testFile);
  } catch (e: any) {
    const errorMsg = `导出目录不可写 (${dir})：${e?.code || e?.message || '未知错误'}`;
    addAuditLog(
      Number(sessionId),
      operator.id,
      'export_session_file_failed',
      `${errorMsg}，目标文件：${filePath}`
    );
    res.status(500).json({
      success: false,
      error: errorMsg,
      errorCode: 'EXPORT_DIR_NOT_WRITABLE',
    });
    return;
  }

  if (!overwrite && fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    addAuditLog(
      Number(sessionId),
      operator.id,
      'export_session_file_blocked',
      `导出被拦截：目标文件已存在，等待用户确认覆盖。文件：${filePath}，大小：${stat.size} 字节，修改时间：${stat.mtime.toISOString()}`
    );
    res.status(409).json({
      success: false,
      error: `导出目标文件已存在：${filePath}。请选择「覆盖写入」确认覆盖，或选择其他路径。`,
      errorCode: 'EXPORT_FILE_EXISTS',
      conflict: {
        type: 'file_exists',
        filePath,
        fileSize: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      },
    });
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
  const seatChanges = queryAll(
    `SELECT sc.*, s.reg_no, s.name as student_name, o.display_name as operator_name
     FROM seat_changes sc
     JOIN students s ON sc.student_id = s.id
     JOIN operators o ON sc.operator_id = o.id
     WHERE sc.session_id = ?
     ORDER BY sc.id`,
    [Number(sessionId)]
  );
  const checkIns = queryAll(
    `SELECT ci.*, s.reg_no, s.name as student_name, o.display_name as operator_name
     FROM check_ins ci
     JOIN students s ON ci.student_id = s.id
     JOIN operators o ON ci.operator_id = o.id
     WHERE ci.session_id = ?
     ORDER BY ci.id`,
    [Number(sessionId)]
  );

  const payload = {
    session,
    room,
    students,
    seatAssignments: students.map((s: any) => ({
      student_id: s.id,
      reg_no: s.reg_no,
      name: s.name,
      seat_row: s.seat_row,
      seat_col: s.seat_col,
    })).filter((s: any) => s.seat_row != null),
    seatChanges,
    checkIns,
    anomalies,
    exportedAt: new Date().toISOString(),
    exportedBy: {
      id: operator.id,
      username: operator.username,
      displayName: operator.display_name,
      role: operator.role,
    },
    chainVerification: {
      importCount: students.length,
      seatCount: students.filter((s: any) => s.seat_row != null).length,
      changeCount: seatChanges.filter((c: any) => !c.undone).length,
      checkInCount: checkIns.length,
      anomalyCount: anomalies.length,
    },
  };

  let originalFileContent: string | null = null;
  if (overwrite && fs.existsSync(filePath)) {
    try {
      originalFileContent = fs.readFileSync(filePath, 'utf-8');
    } catch {}
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (e: any) {
    const errorMsg = `写入文件失败：${e?.code || e?.message || '未知错误'}`;
    addAuditLog(
      Number(sessionId),
      operator.id,
      'export_session_file_failed',
      `${errorMsg}，目标文件：${filePath}`
    );
    res.status(500).json({
      success: false,
      error: errorMsg,
      errorCode: 'EXPORT_WRITE_FAILED',
    });
    return;
  }

  const finalStat = fs.statSync(filePath);
  const auditDetail = `导出场次数据到文件：${filePath}${overwrite ? '（覆盖原文件）' : ''}，文件大小：${finalStat.size} 字节，学员数：${students.length}，异常数：${anomalies.length}`;

  if (overwrite && originalFileContent) {
    const backupDir = path.join(path.dirname(filePath), '.export-backups');
    try {
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const backupPath = path.join(backupDir, `${path.basename(filePath)}.backup-${Date.now()}.json`);
      fs.writeFileSync(backupPath, originalFileContent, 'utf-8');
      addAuditLog(
        Number(sessionId),
        operator.id,
        'export_session_file_backup',
        `导出覆盖前已备份原文件到：${backupPath}`
      );
    } catch (e) {
      console.warn('Failed to create export backup:', e);
    }
  }

  addAuditLog(
    Number(sessionId),
    operator.id,
    'export_session_file',
    auditDetail
  );

  res.json({
    success: true,
    data: {
      filePath,
      bytes: finalStat.size,
      studentsCount: students.length,
      anomaliesCount: anomalies.length,
      seatChangesCount: seatChanges.length,
      checkInsCount: checkIns.length,
      overwritten: overwrite,
      exportedAt: payload.exportedAt,
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
