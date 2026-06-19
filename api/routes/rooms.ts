import { Router, type Request, type Response } from 'express';
import { queryAll, queryRun, queryOne, addAuditLog } from '../db.js';
import { requireAuth } from './operators.js';

const router = Router();

router.use(requireAuth);

router.get('/', (_req: Request, res: Response): void => {
  const rows = queryAll('SELECT * FROM rooms ORDER BY id');
  res.json({ success: true, data: rows });
});

router.post('/', (req: Request, res: Response): void => {
  const { name, seatRows, seatCols } = req.body;
  if (!name || seatRows == null || seatCols == null) {
    res.status(400).json({ success: false, error: 'name, seatRows, seatCols 必填' });
    return;
  }
  const info = queryRun(
    'INSERT INTO rooms (name, seat_rows, seat_cols) VALUES (?, ?, ?)',
    [name, seatRows, seatCols]
  );
  addAuditLog(null, (req as any).operator.id, 'create_room', `创建考场: ${name}`);
  const room = queryOne('SELECT * FROM rooms WHERE id = ?', [info.lastInsertRowid]);
  res.status(201).json({ success: true, data: room });
});

router.put('/:id', (req: Request, res: Response): void => {
  const { id } = req.params;
  const existing = queryOne('SELECT * FROM rooms WHERE id = ?', [Number(id)]);
  if (!existing) {
    res.status(404).json({ success: false, error: '考场不存在' });
    return;
  }
  const { name, seatRows, seatCols } = req.body;
  queryRun(
    'UPDATE rooms SET name = ?, seat_rows = ?, seat_cols = ? WHERE id = ?',
    [name ?? existing.name, seatRows ?? existing.seat_rows, seatCols ?? existing.seat_cols, Number(id)]
  );
  addAuditLog(null, (req as any).operator.id, 'update_room', `更新考场: ${id}`);
  const room = queryOne('SELECT * FROM rooms WHERE id = ?', [Number(id)]);
  res.json({ success: true, data: room });
});

router.delete('/:id', (req: Request, res: Response): void => {
  const { id } = req.params;
  const existing = queryOne('SELECT * FROM rooms WHERE id = ?', [Number(id)]);
  if (!existing) {
    res.status(404).json({ success: false, error: '考场不存在' });
    return;
  }
  const session = queryOne('SELECT id FROM sessions WHERE room_id = ?', [Number(id)]);
  if (session) {
    res.status(409).json({ success: false, error: '该考场已被场次使用，无法删除' });
    return;
  }
  queryRun('DELETE FROM rooms WHERE id = ?', [Number(id)]);
  addAuditLog(null, (req as any).operator.id, 'delete_room', `删除考场: ${id}`);
  res.json({ success: true });
});

export default router;
