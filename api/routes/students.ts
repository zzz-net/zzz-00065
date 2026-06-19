import { Router, type Request, type Response } from 'express';
import { queryAll, queryRun, queryOne, addAuditLog } from '../db.js';
import { requireAuth } from './operators.js';

const router = Router();

router.use(requireAuth);

router.get('/:sessionId/students', (req: Request, res: Response): void => {
  const { sessionId } = req.params;
  const rows = queryAll(
    'SELECT * FROM students WHERE session_id = ? ORDER BY id',
    [Number(sessionId)]
  );
  res.json({ success: true, data: rows });
});

router.post('/:sessionId/students/import', (req: Request, res: Response): void => {
  const { sessionId } = req.params;
  const { students } = req.body;
  if (!Array.isArray(students) || students.length === 0) {
    res.status(400).json({ success: false, error: 'students 数组不能为空' });
    return;
  }

  const session = queryOne('SELECT id FROM sessions WHERE id = ?', [Number(sessionId)]);
  if (!session) {
    res.status(404).json({ success: false, error: '场次不存在' });
    return;
  }

  const batchRegNos = students.map((s: any) => s.regNo);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const regNo of batchRegNos) {
    if (seen.has(regNo)) {
      if (!duplicates.includes(regNo)) duplicates.push(regNo);
    }
    seen.add(regNo);
  }

  const existingStudents = queryAll(
    'SELECT reg_no FROM students WHERE session_id = ?',
    [Number(sessionId)]
  );
  const existingRegNos = new Set(existingStudents.map((s: any) => s.reg_no));
  for (const regNo of batchRegNos) {
    if (existingRegNos.has(regNo) && !duplicates.includes(regNo)) {
      duplicates.push(regNo);
    }
  }

  if (duplicates.length > 0) {
    res.status(409).json({
      success: false,
      error: `报名号重复: ${duplicates.join(', ')}`,
    });
    return;
  }

  for (const s of students) {
    queryRun(
      'INSERT INTO students (session_id, reg_no, name, org) VALUES (?, ?, ?, ?)',
      [Number(sessionId), s.regNo, s.name, s.org || '']
    );
  }

  addAuditLog(
    Number(sessionId),
    (req as any).operator.id,
    'import_students',
    `导入 ${students.length} 名学生`
  );
  const rows = queryAll(
    'SELECT * FROM students WHERE session_id = ? ORDER BY id',
    [Number(sessionId)]
  );
  res.status(201).json({ success: true, data: rows });
});

router.delete('/:sessionId/students/:id', (req: Request, res: Response): void => {
  const { sessionId, id } = req.params;
  const student = queryOne('SELECT * FROM students WHERE id = ? AND session_id = ?', [Number(id), Number(sessionId)]);
  if (!student) {
    res.status(404).json({ success: false, error: '学生不存在' });
    return;
  }
  const assignment = queryOne(
    'SELECT id FROM seat_assignments WHERE session_id = ? AND student_id = ?',
    [Number(sessionId), Number(id)]
  );
  if (assignment) {
    res.status(409).json({ success: false, error: '该学生已有座位分配，无法删除' });
    return;
  }
  queryRun('DELETE FROM students WHERE id = ?', [Number(id)]);
  addAuditLog(Number(sessionId), (req as any).operator.id, 'delete_student', `删除学生: ${(student as any).reg_no}`);
  res.json({ success: true });
});

export default router;
