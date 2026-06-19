import { Router, type Request, type Response } from 'express';
import { queryAll, queryRun, queryOne, addAuditLog } from '../db.js';
import { requireAuth } from './operators.js';

const router = Router();

router.use(requireAuth);

const VALID_STATUSES = ['draft', 'seating', 'checkin', 'active', 'completed'];

router.get('/', (_req: Request, res: Response): void => {
  const rows = queryAll(
    `SELECT s.*, r.name as room_name, r.seat_rows, r.seat_cols
     FROM sessions s JOIN rooms r ON s.room_id = r.id
     ORDER BY s.id DESC`
  );
  res.json({ success: true, data: rows });
});

router.post('/', (req: Request, res: Response): void => {
  const { roomId, name, examDate, startTime } = req.body;
  if (!roomId || !name || !examDate || !startTime) {
    res.status(400).json({ success: false, error: 'roomId, name, examDate, startTime 必填' });
    return;
  }
  const room = queryOne('SELECT * FROM rooms WHERE id = ?', [roomId]);
  if (!room) {
    res.status(404).json({ success: false, error: '考场不存在' });
    return;
  }
  const duplicate = queryOne(
    'SELECT id FROM sessions WHERE name = ? AND exam_date = ? AND start_time = ?',
    [name, examDate, startTime]
  );
  if (duplicate) {
    res.status(409).json({
      success: false,
      error: `已存在同名场次：名称「${name}」、考试日期「${examDate}」、开始时间「${startTime}」完全一致，请修改后重试。`,
      conflict: {
        type: 'duplicate_session',
        existingId: duplicate.id,
        fields: { name, examDate, startTime },
      },
    });
    return;
  }
  const info = queryRun(
    'INSERT INTO sessions (room_id, name, exam_date, start_time) VALUES (?, ?, ?, ?)',
    [roomId, name, examDate, startTime]
  );
  addAuditLog(info.lastInsertRowid, (req as any).operator.id, 'create_session', `创建场次: ${name}`);
  const session = queryOne(
    `SELECT s.*, r.name as room_name, r.seat_rows, r.seat_cols
     FROM sessions s JOIN rooms r ON s.room_id = r.id
     WHERE s.id = ?`,
    [info.lastInsertRowid]
  );
  res.status(201).json({ success: true, data: session });
});

router.get('/:id', (req: Request, res: Response): void => {
  const session = queryOne(
    `SELECT s.*, r.name as room_name, r.seat_rows, r.seat_cols
     FROM sessions s JOIN rooms r ON s.room_id = r.id
     WHERE s.id = ?`,
    [Number(req.params.id)]
  );
  if (!session) {
    res.status(404).json({ success: false, error: '场次不存在' });
    return;
  }
  res.json({ success: true, data: session });
});

router.patch('/:id/status', (req: Request, res: Response): void => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status || !VALID_STATUSES.includes(status)) {
    res.status(400).json({ success: false, error: `status 必须为: ${VALID_STATUSES.join(', ')}` });
    return;
  }
  const session = queryOne('SELECT * FROM sessions WHERE id = ?', [Number(id)]);
  if (!session) {
    res.status(404).json({ success: false, error: '场次不存在' });
    return;
  }
  queryRun('UPDATE sessions SET status = ? WHERE id = ?', [status, Number(id)]);
  addAuditLog(Number(id), (req as any).operator.id, 'update_session_status', `场次状态变更为: ${status}`);
  const updated = queryOne(
    `SELECT s.*, r.name as room_name, r.seat_rows, r.seat_cols
     FROM sessions s JOIN rooms r ON s.room_id = r.id
     WHERE s.id = ?`,
    [Number(id)]
  );
  res.json({ success: true, data: updated });
});

export default router;
