import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDB } from './db.js'
import operatorRoutes from './routes/operators.js'
import roomRoutes from './routes/rooms.js'
import sessionRoutes from './routes/sessions.js'
import studentRoutes from './routes/students.js'
import seatRoutes from './routes/seats.js'
import checkinRoutes from './routes/checkins.js'
import anomalyRoutes from './routes/anomalies.js'
import auditRoutes from './routes/audit.js'
import exportRoutes from './routes/export.js'

dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

let dbReady = false

app.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (!dbReady) {
    try {
      await initDB()
      dbReady = true
    } catch (err) {
      next(err)
      return
    }
  }
  next()
})

app.use('/api/operators', operatorRoutes)
app.use('/api/rooms', roomRoutes)
app.use('/api/sessions', sessionRoutes)
app.use('/api/sessions', studentRoutes)
app.use('/api/sessions', seatRoutes)
app.use('/api/sessions', checkinRoutes)
app.use('/api/sessions', anomalyRoutes)
app.use('/api/sessions', exportRoutes)
app.use('/api/audit-logs', auditRoutes)

app.use(
  '/api/health',
  (_req: Request, res: Response): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

if (process.env.ELECTRON_RUN === '1') {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const clientDist = path.resolve(__dirname, '..', 'dist')
  app.use(express.static(clientDist))
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error)
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
