import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { normalizeConfig } from '../src/config.js'
import { createGenerateImageTool } from '../src/tools/generate.js'
import { createListImageModelsTool } from '../src/tools/models.js'

const EXEC = { callId: 'call-1', signal: new AbortController().signal, agent: { id: 'agent-1' } }

/** Minimal PNG header carrying real dimensions. */
function pngBuffer(width = 640, height = 480, totalBytes = 2048) {
  const buffer = Buffer.alloc(Math.max(24, totalBytes))
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

/** One successful fetch answer. */
function ok(buffer = pngBuffer()) {
  return { ok: true, status: 200, contentType: 'image/png', buffer }
}

/** One rate-limit answer. */
function limited(body = '{"error":{"message":"Retry after 2s"}}') {
  return { ok: false, status: 402, contentType: 'application/json', body }
}

async function setup(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'free-image-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { config, warnings } = normalizeConfig({
    providers: [{
      id: 'test',
      label: 'Test endpoint',
      baseUrl: 'https://img.test/prompt',
      model: '',
      maxWidth: 1024,
      maxHeight: 1024,
      rateLimitMs: 1000,
      timeoutMs: 5000,
    }],
    defaults: { provider: 'test', width: 512, height: 512 },
    output: { dir, maxBytes: 1048576 },
    retry: { budgetMs: 10000, maxAttempts: 3 },
    ...overrides,
  })
  return { dir, config, warnings }
}

test('generate_image saves the returned bytes and reports dimensions', async t => {
  const { dir, config } = await setup(t)
  const tool = createGenerateImageTool({ config, fetchImage: async () => ok() })
  const value = await tool.execute({ prompt: 'A red sports car' }, EXEC)
  assert.match(value.text, /Generated 640x480 image \(2\.0 KiB\) with test/)
  const match = /Saved to (.+)$/m.exec(value.text)
  assert.ok(match, 'path line missing')
  assert.ok(match[1].startsWith(dir), `unexpected path ${match[1]}`)
  const saved = await readFile(match[1])
  assert.equal(saved.length, 2048)
})

test('generate_image retries a rate limit and then succeeds', async t => {
  const { config } = await setup(t)
  const waits = []
  let calls = 0
  const tool = createGenerateImageTool({
    config,
    fetchImage: async () => {
      calls += 1
      return calls === 1 ? limited() : ok()
    },
    sleep: async ms => { waits.push(ms) },
  })
  const value = await tool.execute({ prompt: 'cat' }, EXEC)
  assert.equal(calls, 2)
  assert.deepEqual(waits, [2000])
  assert.match(value.text, /Generated/)
})

test('generate_image reports a wait that exceeds the retry budget', async t => {
  const { config } = await setup(t, { retry: { budgetMs: 500, maxAttempts: 3 } })
  const tool = createGenerateImageTool({ config, fetchImage: async () => limited('Retry after 30s') })
  await assert.rejects(tool.execute({ prompt: 'cat' }, EXEC), /rate limited.*30 s.*retry budget/s)
})

test('generate_image fails on a non-retryable answer', async t => {
  const { config } = await setup(t)
  const tool = createGenerateImageTool({
    config,
    fetchImage: async () => ({ ok: false, status: 400, contentType: 'text/plain', body: 'bad prompt' }),
  })
  await assert.rejects(tool.execute({ prompt: 'cat' }, EXEC), /did not return an image: bad prompt/)
})

test('generate_image refuses an oversized image without writing it', async t => {
  const { dir, config } = await setup(t, { output: { dir: '', maxBytes: 1024 } })
  const tool = createGenerateImageTool({ config, fetchImage: async () => ok(pngBuffer(640, 480, 4096)) })
  await assert.rejects(tool.execute({ prompt: 'cat' }, EXEC), /above the 1\.0 KiB limit/)
  assert.deepEqual(await readFileOrEmpty(dir), '')
})

async function readFileOrEmpty(dir) {
  try {
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(dir)
    return files.length === 0 ? '' : 'unexpected files'
  } catch {
    return ''
  }
}

test('generate_image rejects an unknown provider', async t => {
  const { config } = await setup(t)
  const tool = createGenerateImageTool({ config, fetchImage: async () => ok() })
  await assert.rejects(tool.execute({ prompt: 'cat', provider: 'nope' }, EXEC), /Unknown image provider "nope"/)
})

test('generate_image serializes concurrent calls', async t => {
  const { config } = await setup(t)
  let active = 0
  let maxActive = 0
  const tool = createGenerateImageTool({
    config,
    fetchImage: async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 10))
      active -= 1
      return ok()
    },
  })
  await Promise.all([
    tool.execute({ prompt: 'one' }, EXEC),
    tool.execute({ prompt: 'two' }, EXEC),
  ])
  assert.equal(maxActive, 1)
})

test('list_image_models describes the configured provider', async t => {
  const { dir, config } = await setup(t)
  const tool = createListImageModelsTool({ config })
  const value = await tool.execute({}, EXEC)
  assert.match(value.text, /Configured image providers \(default: test\)/)
  assert.match(value.text, /endpoint: https:\/\/img\.test\/prompt/)
  assert.match(value.text, /max size: 1024x1024/)
  assert.match(value.text, /about one image every 1 s/)
  assert.ok(value.text.includes(`Output directory: ${dir}`))
})

test('list_image_models rejects an unknown provider', async t => {
  const { config } = await setup(t)
  const tool = createListImageModelsTool({ config })
  await assert.rejects(tool.execute({ provider: 'nope' }, EXEC), /Unknown provider/)
})

test('normalizeConfig drops a provider with a non-http baseUrl', () => {
  const { config, warnings } = normalizeConfig({
    providers: [{ id: 'bad', baseUrl: 'ftp://example.test' }, { id: 'good', baseUrl: 'https://ok.test/p' }],
    defaults: {},
    output: {},
    retry: {},
  })
  assert.deepEqual(config.providers.map(provider => provider.id), ['good'])
  assert.equal(warnings.length, 1)
})

test('generate_image waits out a pacing status and then succeeds', async t => {
  const { config } = await setup(t)
  const waits = []
  let calls = 0
  const tool = createGenerateImageTool({
    config,
    fetchImage: async () => {
      calls += 1
      return calls === 1
        ? { ok: false, status: 402, contentType: 'image/jpeg', body: 'the endpoint returned its rate-limit notice image (33000 bytes)', retryAfter: 5, imageBody: true }
        : ok()
    },
    sleep: async ms => { waits.push(ms) },
  })
  const value = await tool.execute({ prompt: 'cat' }, EXEC)
  assert.equal(calls, 2)
  assert.deepEqual(waits, [5000])
  assert.match(value.text, /Generated/)
})

test('generate_image never saves a rate-limit notice image', async t => {
  const { config } = await setup(t, { retry: { budgetMs: 1000, maxAttempts: 2 } })
  const tool = createGenerateImageTool({
    config,
    fetchImage: async () => ({ ok: false, status: 402, contentType: 'image/jpeg', body: 'the endpoint returned its rate-limit notice image (33000 bytes)', retryAfter: 30, imageBody: true }),
  })
  await assert.rejects(tool.execute({ prompt: 'cat' }, EXEC), /rate-limit notice image.*30 s/s)
})
