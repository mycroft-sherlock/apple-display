/**
 * Host half of dsh-apple-display.
 *
 * Four read/write tools call a small Python bridge with argv arrays only.
 * No shell, no user-provided executable, no environment leakage.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const name = 'dsh-apple-display'
export const inject = ['tools']

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SCRIPT = path.join(ROOT, 'python', 'appledisplay.py')
const MAX_OUTPUT = 64 * 1024
const TIMEOUT_MS = 15000

const stringOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
}

function pythonCandidates() {
  const configured = process.env.APPLE_DISPLAY_PYTHON
  return configured ? [configured] : ['python', 'py']
}

function runBridge(args) {
  return new Promise((resolve, reject) => {
    const candidates = pythonCandidates()
    let index = 0
    let settled = false
    let child

    const finish = (fn) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      try { child?.kill() } catch {}
      finish(() => reject(new Error('Apple display bridge timed out after 15s')))
    }, TIMEOUT_MS)

    const attempt = () => {
      if (index >= candidates.length) {
        finish(() => reject(new Error(
          `Python not found. Set APPLE_DISPLAY_PYTHON or install Python 3.9+. Tried: ${candidates.join(', ')}`
        )))
        return
      }
      const python = candidates[index++]
      let stdout = ''
      let stderr = ''
      let done = false

      child = spawn(python, [SCRIPT, ...args], {
        cwd: ROOT,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        if (stdout.length < MAX_OUTPUT) stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        if (stderr.length < MAX_OUTPUT) stderr += chunk
      })

      child.on('error', (error) => {
        if (done) return
        done = true
        if (error.code === 'ENOENT') {
          attempt()
          return
        }
        finish(() => reject(new Error(`Failed to start Apple display bridge: ${error.message}`)))
      })

      child.on('close', (code) => {
        if (done) return
        done = true
        const text = stdout.trim()
        if (!text) {
          finish(() => reject(new Error(
            stderr.trim() || `Apple display bridge exited with code ${code}`
          )))
          return
        }
        let payload
        try {
          payload = JSON.parse(text)
        } catch {
          finish(() => reject(new Error(`Apple display bridge returned invalid JSON: ${text.slice(0, 500)}`)))
          return
        }
        if (!payload.ok) {
          finish(() => reject(new Error(String(payload.error || 'Apple display bridge failed'))))
          return
        }
        finish(() => resolve(payload))
      })
    }

    attempt()
  })
}

function format(payload) {
  return JSON.stringify(payload, null, 2)
}

function assertPercent(value, label) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    throw new Error(`${label} must be an integer between 0 and 100`)
  }
  return n
}

export function apply(ctx) {
  const registrations = [
    {
      name: 'apple_display_list',
      description: 'List Apple USB HID devices and whether each exposes a Monitor Control interface. Read-only.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: stringOutput,
      async execute() {
        return format(await runBridge(['list']))
      },
    },
    {
      name: 'apple_display_get',
      description: 'Read the current brightness percentage of the connected Apple Studio Display or Pro Display XDR. Read-only.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: stringOutput,
      async execute() {
        return format(await runBridge(['get']))
      },
    },
    {
      name: 'apple_display_set',
      description: 'Set Apple display brightness to an exact percentage (0-100). Mutates hardware state.',
      parameters: {
        type: 'object',
        properties: {
          percent: { type: 'integer', minimum: 0, maximum: 100, description: 'Target brightness percentage' },
        },
        required: ['percent'],
        additionalProperties: false,
      },
      output: stringOutput,
      async execute(args) {
        const percent = assertPercent(args?.percent, 'percent')
        return format(await runBridge(['set', String(percent)]))
      },
    },
    {
      name: 'apple_display_step',
      description: 'Increase or decrease Apple display brightness by a delta (-100 to 100, not zero). Mutates hardware state.',
      parameters: {
        type: 'object',
        properties: {
          delta: { type: 'integer', minimum: -100, maximum: 100, description: 'Signed brightness delta' },
        },
        required: ['delta'],
        additionalProperties: false,
      },
      output: stringOutput,
      async execute(args) {
        const delta = Number(args?.delta)
        if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100) {
          throw new Error('delta must be a non-zero integer between -100 and 100')
        }
        return format(await runBridge(['step', String(delta)]))
      },
    },
  ]

  for (const definition of registrations) {
    ctx.effect(
      () => ctx.tools.register(definition),
      `dsh-apple-display: ${definition.name}`,
    )
  }
}
