import { Router, type Request, type Response } from 'express';
import { queryAll, queryOne } from '../db.js';
import { requireAuth } from './operators.js';

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
    },
  });
});

export default router;
