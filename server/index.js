const express = require('express')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())

function isValidPayload(p) {
  if (!p || typeof p.adjudicator !== 'string' || p.adjudicator.trim() === '') return false
  if (typeof p.score !== 'number' || p.score < 0 || p.score > 5) return false
  if (typeof p.agreed !== 'boolean') return false
  // comments are optional
  return true
}

// API: Submit feedback
app.post('/api/feedback', (req, res) => {
  const payload = req.body
  if (!isValidPayload(payload)) {
    return res.status(400).json({ error: 'Invalid payload' })
  }

  // Simple in-memory log (persistent storage recommended for real deployments)
  if (!global._feedbackLog) global._feedbackLog = []
  const rec = { ...payload, timestamp: new Date().toISOString() }
  global._feedbackLog.push(rec)
  console.log('Feedback received:', rec)
  res.json({ status: 'ok', id: global._feedbackLog.length, received: rec })
})

// Serve the portal front-end files from project root
app.use('/', express.static(path.resolve(__dirname, '..')))

app.listen(PORT, () => {
  console.log(`Portal API listening at http://localhost:${PORT}`)
})
