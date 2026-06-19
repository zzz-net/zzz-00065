import { Router, type Request, type Response } from 'express';
import { queryAll, queryRun, queryOne, addAuditLog } from '../db.js';
import { requireAuth } from './operators.js';

const router = Router();

router.use(requireAuth);

router.get('/:sessionId/checkins', (req: Request, res: Response): void => {
  const { sessionId } = req.params;
  const rows = queryAll(
    `SELECT ci.*, s.reg_no, s.name as student_name, s.org
     FROM check_ins ci
     JOIN students s ON ci.student_id = s.id
     WHERE ci.session_id = ?
     ORDER BY s.reg_no`,
    [Number(sessionId)]
  );
  res.json({ success: true, data: rows });
});

router.post('/:sessionId/checkins', (req: Request, res: Response): void => {
  const { sessionId } = req.params;
  const { studentId, status } = req.body;
  if (!studentId || !status) {
    res.status(400).json({ success: false, error: 'studentId 和 status 必填' });
    return;
  }
  if (status !== 'checked_in' && status !== 'absent') {
    res.status(400).json({ success: false, error: 'status 必须为 checked_in 或 absent' });
    return;
  }

  const student = queryOne('SELECT id FROM students WHERE id = ? AND session_id = ?', [studentId, Number(sessionId)]);
  if (!student) {
    res.status(404).json({ success: false, error: '学生不存在' });
    return;
  }

  const operatorId = (req as any).operator.id;
  const existing = queryOne(
    'SELECT * FROM check_ins WHERE session_id = ? AND student_id = ?',
    [Number(sessionId), studentId]
  );

  if (existing) {
    queryRun(
      'UPDATE check_ins SET status = ?, operator_id = ?, checked_at = datetime(\'now\') WHERE session_id = ? AND student_id = ?',
      [status, operatorId, Number(sessionId), studentId]
    );
  } else {
    queryRun(
      'INSERT INTO check_ins (session_id, student_id, status, operator_id) VALUES (?, ?, ?, ?)',
      [Number(sessionId), studentId, status, operatorId]
    );
  }

  addAuditLog(Number(sessionId), operatorId, 'check_in', `学生${studentId}签到状态: ${status}`);

  const row = queryOne(
    `SELECT ci.*, s.reg_no, s.name as student_name
     FROM check_ins ci
     JOIN students s ON ci.student_id = s.id
     WHERE ci.session_id = ? AND ci.student_id = ?`,
    [Number(sessionId), studentId]
  );
  res.json({ success: true, data: row });
});

export default router;
