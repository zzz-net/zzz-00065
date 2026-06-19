import { Router, type Request, type Response } from 'express';
import { queryAll, queryRun, queryOne, addAuditLog, getDB } from '../db.js';
import { requireAuth } from './operators.js';

const router = Router();

router.use(requireAuth);

router.get('/:sessionId/seats', (req: Request, res: Response): void => {
  const { sessionId } = req.params;
  const rows = queryAll(
    `SELECT sa.*, s.reg_no, s.name as student_name, s.org
     FROM seat_assignments sa
     JOIN students s ON sa.student_id = s.id
     WHERE sa.session_id = ?
     ORDER BY sa.seat_row, sa.seat_col`,
    [Number(sessionId)]
  );
  res.json({ success: true, data: rows });
});

router.post('/:sessionId/seats/auto', (req: Request, res: Response): void => {
  const { sessionId } = req.params;
  const session = queryOne(
    `SELECT s.*, r.seat_rows, r.seat_cols FROM sessions s JOIN rooms r ON s.room_id = r.id WHERE s.id = ?`,
    [Number(sessionId)]
  );
  if (!session) {
    res.status(404).json({ success: false, error: '场次不存在' });
    return;
  }

  const students = queryAll(
    'SELECT id FROM students WHERE session_id = ?',
    [Number(sessionId)]
  );

  const totalSeats = (session as any).seat_rows * (session as any).seat_cols;
  if (students.length > totalSeats) {
    res.status(400).json({ success: false, error: `学生数(${students.length})超过座位数(${totalSeats})` });
    return;
  }

  queryRun('DELETE FROM seat_assignments WHERE session_id = ?', [Number(sessionId)]);

  const shuffled = [...students].sort(() => Math.random() - 0.5);
  const db = getDB();
  let seatIdx = 0;
  for (let row = 0; row < (session as any).seat_rows && seatIdx < shuffled.length; row++) {
    for (let col = 0; col < (session as any).seat_cols && seatIdx < shuffled.length; col++) {
      db.run(
        'INSERT INTO seat_assignments (session_id, student_id, seat_row, seat_col) VALUES (?, ?, ?, ?)',
        [Number(sessionId), (shuffled[seatIdx] as any).id, row, col]
      );
      seatIdx++;
    }
  }

  queryRun('SELECT 1');

  addAuditLog(Number(sessionId), (req as any).operator.id, 'auto_assign_seats', `自动分配 ${shuffled.length} 个座位`);

  const rows = queryAll(
    `SELECT sa.*, s.reg_no, s.name as student_name, s.org
     FROM seat_assignments sa
     JOIN students s ON sa.student_id = s.id
     WHERE sa.session_id = ?
     ORDER BY sa.seat_row, sa.seat_col`,
    [Number(sessionId)]
  );
  res.json({ success: true, data: rows });
});

router.post('/:sessionId/seats/force-change', (req: Request, res: Response): void => {
  const { sessionId } = req.params;
  const { studentId, toRow, toCol, reason } = req.body;
  if (!studentId || toRow == null || toCol == null || !reason) {
    res.status(400).json({ success: false, error: 'studentId, toRow, toCol, reason 必填' });
    return;
  }

  const currentSeat = queryOne(
    'SELECT * FROM seat_assignments WHERE session_id = ? AND student_id = ?',
    [Number(sessionId), studentId]
  );
  if (!currentSeat) {
    res.status(404).json({ success: false, error: '该学生没有座位分配' });
    return;
  }

  const targetSeat = queryOne(
    'SELECT * FROM seat_assignments WHERE session_id = ? AND seat_row = ? AND seat_col = ?',
    [Number(sessionId), toRow, toCol]
  );

  const fromRow = (currentSeat as any).seat_row;
  const fromCol = (currentSeat as any).seat_col;
  const operatorId = (req as any).operator.id;

  if (targetSeat) {
    const targetStudentId = (targetSeat as any).student_id;
    queryRun(
      'UPDATE seat_assignments SET student_id = ? WHERE session_id = ? AND seat_row = ? AND seat_col = ?',
      [targetStudentId, Number(sessionId), fromRow, fromCol]
    );
    queryRun(
      'UPDATE seat_assignments SET student_id = ? WHERE session_id = ? AND seat_row = ? AND seat_col = ?',
      [studentId, Number(sessionId), toRow, toCol]
    );
    queryRun(
      `INSERT INTO seat_changes (session_id, student_id, from_row, from_col, to_row, to_col, reason, operator_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [Number(sessionId), targetStudentId, toRow, toCol, fromRow, fromCol, `与${studentId}交换座位: ${reason}`, operatorId]
    );
  } else {
    queryRun(
      'UPDATE seat_assignments SET seat_row = ?, seat_col = ? WHERE session_id = ? AND student_id = ?',
      [toRow, toCol, Number(sessionId), studentId]
    );
  }

  queryRun(
    `INSERT INTO seat_changes (session_id, student_id, from_row, from_col, to_row, to_col, reason, operator_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [Number(sessionId), studentId, fromRow, fromCol, toRow, toCol, reason, operatorId]
  );

  addAuditLog(Number(sessionId), operatorId, 'force_change_seat', `学生${studentId}从(${fromRow},${fromCol})换到(${toRow},${toCol})`);

  const rows = queryAll(
    `SELECT sa.*, s.reg_no, s.name as student_name, s.org
     FROM seat_assignments sa
     JOIN students s ON sa.student_id = s.id
     WHERE sa.session_id = ?
     ORDER BY sa.seat_row, sa.seat_col`,
    [Number(sessionId)]
  );
  res.json({ success: true, data: rows });
});

router.post('/:sessionId/seats/undo-change', (req: Request, res: Response): void => {
  const { sessionId } = req.params;
  const { changeId } = req.body;
  if (!changeId) {
    res.status(400).json({ success: false, error: 'changeId 必填' });
    return;
  }

  const change = queryOne('SELECT * FROM seat_changes WHERE id = ? AND session_id = ?', [changeId, Number(sessionId)]);
  if (!change) {
    res.status(404).json({ success: false, error: '座位变更记录不存在' });
    return;
  }
  if ((change as any).undone) {
    res.status(400).json({ success: false, error: '该变更已撤销' });
    return;
  }

  const { student_id, from_row, from_col, to_row, to_col } = change as any;
  const operatorId = (req as any).operator.id;

  if (from_row != null && from_col != null) {
    const occupiedAtOriginal = queryOne(
      'SELECT * FROM seat_assignments WHERE session_id = ? AND seat_row = ? AND seat_col = ?',
      [Number(sessionId), from_row, from_col]
    );
    if (occupiedAtOriginal) {
      const occStudentId = (occupiedAtOriginal as any).student_id;
      queryRun(
        'UPDATE seat_assignments SET student_id = ? WHERE session_id = ? AND seat_row = ? AND seat_col = ?',
        [occStudentId, Number(sessionId), to_row, to_col]
      );
      queryRun(
        'UPDATE seat_assignments SET student_id = ? WHERE session_id = ? AND seat_row = ? AND seat_col = ?',
        [student_id, Number(sessionId), from_row, from_col]
      );
    } else {
      queryRun(
        'UPDATE seat_assignments SET seat_row = ?, seat_col = ? WHERE session_id = ? AND student_id = ?',
        [from_row, from_col, Number(sessionId), student_id]
      );
    }
  }

  queryRun(
    "UPDATE seat_changes SET undone = 1, undone_by = ?, undone_at = datetime('now') WHERE id = ?",
    [operatorId, changeId]
  );

  addAuditLog(Number(sessionId), operatorId, 'undo_seat_change', `撤销座位变更 #${changeId}`);

  const rows = queryAll(
    `SELECT sa.*, s.reg_no, s.name as student_name, s.org
     FROM seat_assignments sa
     JOIN students s ON sa.student_id = s.id
     WHERE sa.session_id = ?
     ORDER BY sa.seat_row, sa.seat_col`,
    [Number(sessionId)]
  );
  res.json({ success: true, data: rows });
});

router.get('/:sessionId/seats/changes', (req: Request, res: Response): void => {
  const { sessionId } = req.params;
  const rows = queryAll(
    `SELECT sc.*, s.reg_no, s.name as student_name, o.display_name as operator_name
     FROM seat_changes sc
     JOIN students s ON sc.student_id = s.id
     JOIN operators o ON sc.operator_id = o.id
     WHERE sc.session_id = ?
     ORDER BY sc.id DESC`,
    [Number(sessionId)]
  );
  res.json({ success: true, data: rows });
});

export default router;
