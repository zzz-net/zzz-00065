import { Router, type Request, type Response } from 'express';
import { queryAll } from '../db.js';
import { requireAuth } from './operators.js';

const router = Router();

router.use(requireAuth);

router.get('/', (req: Request, res: Response): void => {
  const { sessionId, limit, offset } = req.query;

  let sql = `SELECT al.*, o.display_name as operator_name
    FROM audit_logs al
    JOIN operators o ON al.operator_id = o.id`;
  const params: any[] = [];

  if (sessionId) {
    sql += ' WHERE al.session_id = ?';
    params.push(Number(sessionId));
  }

  sql += ' ORDER BY al.id DESC';

  if (limit) {
    sql += ' LIMIT ?';
    params.push(Number(limit));
  }
  if (offset) {
    sql += ' OFFSET ?';
    params.push(Number(offset));
  }

  const rows = queryAll(sql, params.length > 0 ? params : undefined);
  res.json({ success: true, data: rows });
});

export default router;
