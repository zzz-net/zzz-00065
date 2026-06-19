import { Router, type Request, type Response } from 'express';
import { queryAll, queryRun, queryOne, addAuditLog } from '../db.js';
import { requireAuth } from './operators.js';

const router = Router();

router.use(requireAuth);

const VALID_TYPES = ['absence', 'cheating', 'device', 'other'];

router.get('/:sessionId/anomalies', (req: Request, res: Response): void => {
  const { sessionId } = req.params;
  const rows = queryAll(
    `SELECT a.*, s.reg_no, s.name as student_name,
     rb.display_name as reporter_name, cb.display_name as closer_name
     FROM anomalies a
     LEFT JOIN students s ON a.student_id = s.id
     JOIN operators rb ON a.reported_by = rb.id
     LEFT JOIN operators cb ON a.closed_by = cb.id
     WHERE a.session_id = ?
     ORDER BY a.id DESC`,
    [Number(sessionId)]
  );
  res.json({ success: true, data: rows });
});

router.post('/:sessionId/anomalies', (req: Request, res: Response): void => {
  const { sessionId } = req.params;
  const { studentId, type, description } = req.body;
  if (!type || !VALID_TYPES.includes(type)) {
    res.status(400).json({ success: false, error: `type 必须为: ${VALID_TYPES.join(', ')}` });
    return;
  }
  const operatorId = (req as any).operator.id;
  const info = queryRun(
    'INSERT INTO anomalies (session_id, student_id, type, description, reported_by) VALUES (?, ?, ?, ?, ?)',
    [Number(sessionId), studentId || null, type, description || '', operatorId]
  );
  addAuditLog(Number(sessionId), operatorId, 'report_anomaly', `报告异常: ${type} - ${description || ''}`);
  const anomaly = queryOne('SELECT * FROM anomalies WHERE id = ?', [info.lastInsertRowid]);
  res.status(201).json({ success: true, data: anomaly });
});

router.patch('/:sessionId/anomalies/:id/close', (req: Request, res: Response): void => {
  const { sessionId, id } = req.params;
  const { closeReason } = req.body;
  const operator = (req as any).operator;

  if (operator.role !== 'admin') {
    res.status(403).json({ success: false, error: '仅管理员可关闭异常' });
    return;
  }

  const anomaly = queryOne('SELECT * FROM anomalies WHERE id = ? AND session_id = ?', [Number(id), Number(sessionId)]);
  if (!anomaly) {
    res.status(404).json({ success: false, error: '异常记录不存在' });
    return;
  }
  if ((anomaly as any).status === 'closed') {
    res.status(400).json({ success: false, error: '该异常已关闭' });
    return;
  }

  queryRun(
    'UPDATE anomalies SET status = \'closed\', closed_by = ?, closed_at = datetime(\'now\'), close_reason = ? WHERE id = ?',
    [operator.id, closeReason || '', Number(id)]
  );
  addAuditLog(Number(sessionId), operator.id, 'close_anomaly', `关闭异常 #${id}: ${closeReason || ''}`);

  const updated = queryOne('SELECT * FROM anomalies WHERE id = ?', [Number(id)]);
  res.json({ success: true, data: updated });
});

export default router;
