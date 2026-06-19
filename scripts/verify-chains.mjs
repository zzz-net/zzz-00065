import { spawn } from 'child_process'
import { createWriteStream, existsSync, unlinkSync, statSync, mkdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { createServer } from 'net'

function findFreePort() {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

let BASE = ''
let operatorId = 1
let roomId = 0
let sessionId = 0
let studentIds = []
let changeId = 0
let passed = 0
let failed = 0
let serverProc = null
let testExportPath = ''

function log(emoji, msg) {
  console.log(`${emoji} ${msg}`)
}

function pass(msg) {
  passed++
  log('✅', msg)
}

function fail(msg) {
  failed++
  log('❌', msg)
}

async function api(path, opts = {}) {
  const url = `${BASE}${path}`
  const headers = { 'Content-Type': 'application/json', 'X-Operator-Id': String(operatorId) }
  const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) } })
  const json = await res.json()
  return { status: res.status, body: json }
}

async function assertOk(label, res, expectStatus = 200) {
  if (res.status === expectStatus && res.body.success !== false) {
    pass(label)
    return true
  }
  fail(`${label} — status=${res.status}, body=${JSON.stringify(res.body).slice(0, 200)}`)
  return false
}

async function assertFail(label, res, expectStatus) {
  if (res.status === expectStatus && res.body.success === false) {
    pass(label)
    return true
  }
  fail(`${label} — expected ${expectStatus} failure, got status=${res.status}`)
  return false
}

async function waitServer(maxMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${BASE}/api/system/health`)
      if (res.ok) return true
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

async function testHealth() {
  log('\n📡', '--- 健康检查 ---')
  const res = await api('/api/system/health')
  await assertOk('系统健康检查', res)
}

async function testLogin() {
  log('\n🔑', '--- 登录 ---')
  const res = await api('/api/operators/login', { method: 'POST', body: JSON.stringify({ username: 'admin' }) })
  if (await assertOk('管理员登录', res)) {
    operatorId = res.body.data.id
  }
}

async function testCreateRoom() {
  log('\n🏫', '--- 创建考场 ---')
  const res = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: '验证考场A', seatRows: 3, seatCols: 4 }) })
  if (await assertOk('创建 3×4 考场', res, 201)) {
    roomId = res.body.data.id
  }
}

async function testDuplicateSession() {
  log('\n📋', '--- 同名场次冲突 ---')
  const payload = { roomId, name: 'Q1考试', examDate: '2026-06-19', startTime: '09:00' }
  const res1 = await api('/api/sessions', { method: 'POST', body: JSON.stringify(payload) })
  if (await assertOk('创建场次 Q1考试', res1, 201)) {
    sessionId = res1.body.data.id
  }
  const res2 = await api('/api/sessions', { method: 'POST', body: JSON.stringify(payload) })
  await assertFail('同名场次 409 拒绝', res2, 409)
  if (res2.body.conflict?.type === 'duplicate_session' && res2.body.conflict.existingId === sessionId) {
    pass('冲突信息包含 existingId')
  } else {
    fail('冲突信息缺少 existingId')
  }
}

async function testImportStudents() {
  log('\n👥', '--- 导入学员 ---')
  const students = [
    { regNo: 'V001', name: '验证张三', org: '测试单位' },
    { regNo: 'V002', name: '验证李四', org: '测试单位' },
    { regNo: 'V003', name: '验证王五', org: '测试单位' },
    { regNo: 'V004', name: '验证赵六', org: '测试单位' },
    { regNo: 'V005', name: '验证钱七', org: '测试单位' },
  ]
  const res = await api(`/api/sessions/${sessionId}/students/import`, { method: 'POST', body: JSON.stringify({ students }) })
  if (await assertOk('导入 5 名学员', res, 201)) {
    studentIds = res.body.data.map(s => s.id)
  }
}

async function testDuplicateImport() {
  log('\n🚫', '--- 重复导入拒绝 ---')
  const students = [
    { regNo: 'V001', name: '验证张三', org: '测试单位' },
    { regNo: 'V001', name: '本批重复', org: '单位C' },
    { regNo: 'V006', name: '新人', org: '单位D' },
  ]
  const res = await api(`/api/sessions/${sessionId}/students/import`, { method: 'POST', body: JSON.stringify({ students }) })
  await assertFail('重复导入 409 拒绝', res, 409)
  if (res.body.conflict?.inBatch?.includes('V001')) {
    pass('冲突信息包含本批重复 V001')
  } else {
    fail('冲突信息缺少本批重复详情')
  }
  if (res.body.conflict?.inExisting?.includes('V001')) {
    pass('冲突信息包含与现有重复 V001')
  } else {
    fail('冲突信息缺少与现有重复详情')
  }
  const checkRes = await api(`/api/sessions/${sessionId}/students`)
  if (checkRes.body.data?.length === 5) {
    pass('零写入验证：学员数仍为 5')
  } else {
    fail(`零写入验证失败：学员数为 ${checkRes.body.data?.length}`)
  }
}

async function testAutoSeat() {
  log('\n💺', '--- 自动排座 ---')
  const res = await api(`/api/sessions/${sessionId}/seats/auto`, { method: 'POST' })
  if (await assertOk('自动排座', res)) {
    const seats = res.body.data
    const allCoordsValid = seats.every(s => s.seat_row >= 1 && s.seat_col >= 1 && s.seat_row <= 3 && s.seat_col <= 4)
    if (allCoordsValid) {
      pass('所有座位坐标为 1 基（row>=1, col>=1）')
    } else {
      fail('存在 0 基坐标！')
      seats.forEach(s => {
        if (s.seat_row < 1 || s.seat_col < 1) {
          log('  ⚠️', `学生 ${s.student_name} 坐标异常: row=${s.seat_row}, col=${s.seat_col}`)
        }
      })
    }
    const uniqueCoords = new Set(seats.map(s => `${s.seat_row}-${s.seat_col}`))
    if (uniqueCoords.size === seats.length) {
      pass('座位坐标无重复')
    } else {
      fail('座位坐标有重复')
    }
  }
}

async function testForceChangeAndUndo() {
  log('\n🔄', '--- 强制换座 + 撤销 ---')
  const seatsRes = await api(`/api/sessions/${sessionId}/seats`)
  const seats = seatsRes.body.data || []
  if (seats.length < 2) {
    fail('座位不足，跳过换座测试')
    return
  }
  const studentId = seats[0].student_id
  const targetRow = seats[1].seat_row
  const targetCol = seats[1].seat_col

  const res = await api(`/api/sessions/${sessionId}/seats/force-change`, {
    method: 'POST',
    body: JSON.stringify({ studentId, toRow: targetRow, toCol: targetCol, reason: '验证换座原因' }),
  })
  if (await assertOk('强制换座（交换）', res)) {
    const changesRes = await api(`/api/sessions/${sessionId}/seats/changes`)
    const changes = changesRes.body.data || []
    const activeChange = changes.find(c => c.student_id === studentId && !c.undone)
    if (activeChange) {
      changeId = activeChange.id
      pass('找到活跃换座记录')
    } else {
      fail('未找到活跃换座记录')
    }
  }

  if (changeId) {
    const undoRes = await api(`/api/sessions/${sessionId}/seats/undo-change`, {
      method: 'POST',
      body: JSON.stringify({ changeId }),
    })
    await assertOk('撤销换座', undoRes)

    const reUndoRes = await api(`/api/sessions/${sessionId}/seats/undo-change`, {
      method: 'POST',
      body: JSON.stringify({ changeId }),
    })
    await assertFail('重复撤销 400 拒绝', reUndoRes, 400)
  }
}

async function testForceChangeBoundary() {
  log('\n📏', '--- 换座边界验证 ---')
  const seatsRes = await api(`/api/sessions/${sessionId}/seats`)
  const seats = seatsRes.body.data || []
  if (seats.length === 0) { fail('无座位，跳过'); return }
  const studentId = seats[0].student_id
  const res = await api(`/api/sessions/${sessionId}/seats/force-change`, {
    method: 'POST',
    body: JSON.stringify({ studentId, toRow: 0, toCol: 1, reason: '越界测试' }),
  })
  await assertFail('row=0 越界 400 拒绝', res, 400)

  const res2 = await api(`/api/sessions/${sessionId}/seats/force-change`, {
    method: 'POST',
    body: JSON.stringify({ studentId, toRow: 99, toCol: 99, reason: '越界测试' }),
  })
  await assertFail('row=99 col=99 越界 400 拒绝', res2, 400)
}

async function testCheckin() {
  log('\n✋', '--- 签到 ---')
  if (studentIds.length < 3) { fail('学员不足'); return }
  const res1 = await api(`/api/sessions/${sessionId}/checkins`, { method: 'POST', body: JSON.stringify({ studentId: studentIds[0], status: 'checked_in' }) })
  await assertOk('学员1签到', res1)
  const res2 = await api(`/api/sessions/${sessionId}/checkins`, { method: 'POST', body: JSON.stringify({ studentId: studentIds[1], status: 'checked_in' }) })
  await assertOk('学员2签到', res2)
  const res3 = await api(`/api/sessions/${sessionId}/checkins`, { method: 'POST', body: JSON.stringify({ studentId: studentIds[2], status: 'absent' }) })
  await assertOk('学员3缺勤', res3)
}

async function testAnomaly() {
  log('\n⚠️', '--- 异常处理 ---')
  const res = await api(`/api/sessions/${sessionId}/anomalies`, { method: 'POST', body: JSON.stringify({ type: 'device', studentId: studentIds[0], description: '验证异常' }) })
  await assertOk('报告异常', res, 201)
}

async function testExportAndOverwrite() {
  log('\n📤', '--- 导出 + 文件已存在冲突 ---')
  testExportPath = resolve(join(process.env.TEMP || '/tmp', `verify-export-${Date.now()}.json`))

  const res = await api(`/api/sessions/${sessionId}/export/save`, {
    method: 'POST',
    body: JSON.stringify({ filePath: testExportPath, overwrite: false }),
  })
  if (await assertOk('首次导出', res)) {
    const data = res.body.data
    if (data.studentsCount === 5) {
      pass(`导出学员数正确: ${data.studentsCount}`)
    } else {
      fail(`导出学员数错误: ${data.studentsCount}, 期望 5`)
    }
    if (existsSync(testExportPath)) {
      const stat = statSync(testExportPath)
      pass(`导出文件存在, ${stat.size} bytes`)
    } else {
      fail('导出文件不存在')
    }
  }

  const res2 = await api(`/api/sessions/${sessionId}/export/save`, {
    method: 'POST',
    body: JSON.stringify({ filePath: testExportPath, overwrite: false }),
  })
  await assertFail('文件已存在 409 拒绝', res2, 409)
  if (res2.body.conflict?.type === 'file_exists') {
    pass('冲突信息包含 file_exists')
  } else {
    fail('冲突信息缺少 file_exists')
  }

  const res3 = await api(`/api/sessions/${sessionId}/export/save`, {
    method: 'POST',
    body: JSON.stringify({ filePath: testExportPath, overwrite: true }),
  })
  await assertOk('覆盖导出', res3)
}

async function testExportDataConsistency() {
  log('\n🔍', '--- 导出数据一致性 ---')
  if (!testExportPath || !existsSync(testExportPath)) { fail('无导出文件'); return }
  const content = await import('fs').then(fs => fs.readFileSync(testExportPath, 'utf-8'))
  const data = JSON.parse(content)
  const students = data.students || []
  const allCoordsValid = students.every(s => {
    if (s.seat_row == null) return true
    return s.seat_row >= 1 && s.seat_col >= 1
  })
  if (allCoordsValid) {
    pass('导出 JSON 座位坐标全部为 1 基')
  } else {
    fail('导出 JSON 存在 0 基坐标')
    students.forEach(s => {
      if (s.seat_row != null && (s.seat_row < 1 || s.seat_col < 1)) {
        log('  ⚠️', `${s.name}: row=${s.seat_row}, col=${s.seat_col}`)
      }
    })
  }
  const hasNoZeroZero = students.every(s => !(s.seat_row === 0 && s.seat_col === 0))
  if (hasNoZeroZero) {
    pass('导出 JSON 无 (0,0) 坐标')
  } else {
    fail('导出 JSON 存在 (0,0) 坐标！')
  }
}

async function testAuditLog() {
  log('\n📜', '--- 审计日志 ---')
  const res = await api(`/api/audit-logs?sessionId=${sessionId}&limit=100`)
  if (await assertOk('获取审计日志', res)) {
    const logs = res.body.data || []
    const actions = logs.map(l => l.action)
    const expected = ['create_session', 'import_students', 'auto_assign_seats', 'force_change_seat', 'undo_seat_change', 'check_in', 'check_in', 'check_in', 'report_anomaly', 'export_session_file', 'export_session_file']
    const critical = ['create_session', 'import_students', 'auto_assign_seats', 'force_change_seat', 'undo_seat_change', 'export_session_file']
    const missing = critical.filter(a => !actions.includes(a))
    if (missing.length === 0) {
      pass('关键审计日志齐全')
    } else {
      fail(`缺少审计日志: ${missing.join(', ')}`)
    }
  }
}

async function testDataDirSwitch() {
  log('\n📂', '--- 数据目录切换 ---')
  const infoBefore = await api('/api/system/info')
  const originalDataDir = infoBefore.body.data?.dataDir

  const tempDir = resolve(join(process.env.TEMP || '/tmp', `exam-data-test-${Date.now()}`))
  const switchRes = await api('/api/system/data-directory/switch', {
    method: 'POST',
    body: JSON.stringify({ directory: tempDir }),
  })
  if (await assertOk('切换到临时目录', switchRes)) {
    const infoRes = await api('/api/system/info')
    if (infoRes.body.data?.dataDir === tempDir) {
      pass('系统信息显示新数据目录')
    } else {
      fail(`数据目录未切换: ${infoRes.body.data?.dataDir}`)
    }
    if (existsSync(join(tempDir, 'exam-manager.db'))) {
      pass('新目录下数据库文件已创建')
    } else {
      fail('新目录下数据库文件未创建')
    }
  }

  const switchBackRes = await api('/api/system/data-directory/switch', {
    method: 'POST',
    body: JSON.stringify({ directory: originalDataDir }),
  })
  await assertOk('切换回原数据目录', switchBackRes)

  try { rmSync(tempDir, { recursive: true }) } catch {}
}

async function testSystemInfo() {
  log('\nℹ️', '--- 系统信息 ---')
  const res = await api('/api/system/info')
  if (await assertOk('获取系统信息', res)) {
    const data = res.body.data
    if (data.counts && typeof data.counts.sessions === 'number') {
      pass(`系统信息包含统计: ${data.counts.sessions} 场次`)
    } else {
      fail('系统信息缺少统计数据')
    }
  }
}

async function cleanup() {
  if (testExportPath && existsSync(testExportPath)) {
    try { unlinkSync(testExportPath) } catch {}
  }
}

async function run() {
  console.log('\n🧪 培训考场管理系统 — 链路验证脚本\n')
  console.log('=' .repeat(60))

  log('🚀', '启动后端服务...')
  const rootDir = resolve(import.meta.dirname || process.cwd())
  const port = await findFreePort()
  BASE = `http://localhost:${port}`
  const verifyDataDir = join(tmpdir(), `exam-verify-${Date.now()}`)
  mkdirSync(verifyDataDir, { recursive: true })
  serverProc = spawn('npx', ['tsx', 'api/server.ts'], {
    cwd: rootDir,
    env: { ...process.env, PORT: String(port), DB_DIR: verifyDataDir },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
  })

  if (!await waitServer()) {
    fail('后端启动超时 (15s)')
    process.exit(1)
  }
  pass('后端启动成功')

  try {
    await testHealth()
    await testLogin()
    await testCreateRoom()
    await testDuplicateSession()
    await testImportStudents()
    await testDuplicateImport()
    await testAutoSeat()
    await testForceChangeBoundary()
    await testForceChangeAndUndo()
    await testCheckin()
    await testAnomaly()
    await testExportAndOverwrite()
    await testExportDataConsistency()
    await testAuditLog()
    await testDataDirSwitch()
    await testSystemInfo()
  } catch (e) {
    fail(`测试异常: ${e.message}`)
    console.error(e)
  }

  console.log('\n' + '='.repeat(60))
  console.log(`\n🧪 验证结果: ${passed} 通过, ${failed} 失败\n`)

  await cleanup()

  try { rmSync(verifyDataDir, { recursive: true }) } catch {}

  if (serverProc) {
    serverProc.kill('SIGTERM')
  }

  process.exit(failed > 0 ? 1 : 0)
}

run()
