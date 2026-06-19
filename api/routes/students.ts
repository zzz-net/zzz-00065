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

  const session = queryOne('SELECT id, name FROM sessions WHERE id = ?', [Number(sessionId)]);
  if (!session) {
    res.status(404).json({ success: false, error: '场次不存在' });
    return;
  }

  const batchRegNos = students.map((s: any) => s.regNo);
  const seen = new Map<string, number[]>();
  const duplicatesInBatch: string[] = [];
  batchRegNos.forEach((regNo, idx) => {
    if (!seen.has(regNo)) {
      seen.set(regNo, []);
    }
    seen.get(regNo)!.push(idx + 1);
    if (seen.get(regNo)!.length === 2) {
      duplicatesInBatch.push(regNo);
    }
  });

  const existingStudents = queryAll(
    'SELECT reg_no, name FROM students WHERE session_id = ?',
    [Number(sessionId)]
  );
  const existingMap = new Map(existingStudents.map((s: any) => [s.reg_no, s.name]));
  const duplicatesWithExisting: string[] = [];
  for (const regNo of batchRegNos) {
    if (existingMap.has(regNo) && !duplicatesWithExisting.includes(regNo)) {
      duplicatesWithExisting.push(regNo);
    }
  }

  if (duplicatesInBatch.length > 0 || duplicatesWithExisting.length > 0) {
    const reasons: string[] = [];
    if (duplicatesInBatch.length > 0) {
      const detail = duplicatesInBatch.map((r) => {
        const lines = seen.get(r)!;
        return `「${r}」出现在第 ${lines.join('、')} 行`;
      }).join('；');
      reasons.push(`本批内报名号重复：${detail}`);
    }
    if (duplicatesWithExisting.length > 0) {
      const detail = duplicatesWithExisting.map((r) => {
        return `「${r}（${existingMap.get(r) || '已存在学员'}）」`;
      }).join('、');
      reasons.push(`与场次「${(session as any).name}」现有学员报名号重复：${detail}`);
    }
    res.status(409).json({
      success: false,
      error: `报名号冲突：${reasons.join('。')}。为避免污染数据，已全部拒绝，请修正后重新导入。`,
      conflict: {
        type: 'duplicate_reg_no',
        sessionId: Number(sessionId),
        inBatch: duplicatesInBatch,
        inExisting: duplicatesWithExisting,
      },
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
