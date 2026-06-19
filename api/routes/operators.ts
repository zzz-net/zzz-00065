import { Router, type Request, type Response, type NextFunction } from 'express';
import { queryAll, queryRun, queryOne, addAuditLog } from '../db.js';

const router = Router();

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const operatorId = req.headers['x-operator-id'];
  if (!operatorId) {
    res.status(401).json({ success: false, error: '缺少 X-Operator-Id 头' });
    return;
  }
  const op = queryOne('SELECT * FROM operators WHERE id = ?', [Number(operatorId)]);
  if (!op) {
    res.status(401).json({ success: false, error: '操作员不存在' });
    return;
  }
  (req as any).operator = op;
  next();
}

router.get('/', (_req: Request, res: Response): void => {
  const rows = queryAll('SELECT id, username, display_name, role FROM operators ORDER BY id');
  res.json({ success: true, data: rows });
});

router.post('/', requireAuth, (req: Request, res: Response): void => {
  const { username, displayName, role } = req.body;
  if (!username || !displayName) {
    res.status(400).json({ success: false, error: 'username 和 displayName 必填' });
    return;
  }
  if (role && role !== 'admin' && role !== 'operator') {
    res.status(400).json({ success: false, error: 'role 必须为 admin 或 operator' });
    return;
  }
  const existing = queryOne('SELECT id FROM operators WHERE username = ?', [username]);
  if (existing) {
    res.status(409).json({ success: false, error: '用户名已存在' });
    return;
  }
  const info = queryRun(
    'INSERT INTO operators (username, display_name, role) VALUES (?, ?, ?)',
    [username, displayName, role || 'operator']
  );
  addAuditLog(null, (req as any).operator.id, 'create_operator', `创建操作员: ${username}`);
  const op = queryOne('SELECT * FROM operators WHERE id = ?', [info.lastInsertRowid]);
  res.status(201).json({ success: true, data: op });
});

router.post('/login', (req: Request, res: Response): void => {
  const { username } = req.body;
  if (!username) {
    res.status(400).json({ success: false, error: 'username 必填' });
    return;
  }
  const op = queryOne('SELECT * FROM operators WHERE username = ?', [username]);
  if (!op) {
    res.status(404).json({ success: false, error: '用户不存在' });
    return;
  }
  res.json({ success: true, data: op });
});

export default router;
