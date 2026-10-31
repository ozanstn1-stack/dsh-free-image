import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { describeBody, fetchImage, sniffImage } from '../src/lib/http.js'

/** PNG header with real dimensions. */
function pngBytes() {
  const buffer = Buffer.alloc(32)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(640, 16)
  buffer.writeUInt32BE(480, 20)
  return buffer
}

/**
 * Start a throwaway HTTP server for one test.
 * @param {(request, response) => void} handler - request handler.
 * @returns {Promise<{ url: string, close: () => Promise<void> }>} server handle.
 */
async function serve(handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

test('sniffImage recognises raster signatures', () => {
  assert.equal(sniffImage(pngBytes()), true)
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), true)
  assert.equal(sniffImage(Buffer.from('GIF89a--------', 'latin1')), true)
  assert.equal(sniffImage(Buffer.from('RIFF----WEBP----', 'latin1')), true)
  assert.equal(sniffImage(Buffer.from('<html>nope</html>', 'latin1')), false)
  assert.equal(sniffImage(Buffer.alloc(4)), false)
})

test('describeBody keeps text and hides binary payloads', () => {
  assert.equal(describeBody(Buffer.from('{"error":"slow down"}'), 'application/json'), '{"error":"slow down"}')
  const binary = describeBody(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]), 'application/octet-stream')
  assert.match(binary, /unexpected application\/octet-stream body \(5 bytes\)/)
})

test('fetchImage accepts an image sent with a generic content type', async () => {
  const server = await serve((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream' })
    response.end(pngBytes())
  })
  try {
    const result = await fetchImage(`${server.url}/prompt/cat`, { timeoutMs: 5000 })
    assert.equal(result.ok, true)
    assert.equal(result.buffer.length, 32)
  } finally {
    await server.close()
  }
})

test('fetchImage reports the Retry-After header on a rate limit', async () => {
  const server = await serve((_request, response) => {
    response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '7' })
    response.end('{"error":"slow down"}')
  })
  try {
    const result = await fetchImage(`${server.url}/prompt/cat`, { timeoutMs: 5000 })
    assert.equal(result.ok, false)
    assert.equal(result.status, 429)
    assert.equal(result.retryAfter, 7)
    assert.match(result.body, /slow down/)
  } finally {
    await server.close()
  }
})

test('fetchImage rejects a successful non-image body', async () => {
  const server = await serve((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<html>not an image</html>')
  })
  try {
    const result = await fetchImage(`${server.url}/prompt/cat`, { timeoutMs: 5000 })
    assert.equal(result.ok, false)
    assert.match(result.body, /not an image/)
  } finally {
    await server.close()
  }
})

test('fetchImage times out instead of hanging', async () => {
  const server = await serve(() => {
    // Never respond.
  })
  try {
    await assert.rejects(
      fetchImage(`${server.url}/prompt/cat`, { timeoutMs: 200 }),
      /timed out after 200 ms/,
    )
  } finally {
    await server.close()
  }
})

test('fetchImage reports a pacing notice image instead of saving it', async () => {
  const server = await serve((_request, response) => {
    response.writeHead(402, { 'content-type': 'image/jpeg', 'retry-after': '23' })
    response.end(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]))
  })
  try {
    const result = await fetchImage(`${server.url}/prompt/cat`, { timeoutMs: 5000 })
    assert.equal(result.ok, false)
    assert.equal(result.status, 402)
    assert.equal(result.retryAfter, 23)
    assert.equal(result.imageBody, true)
    assert.match(result.body, /rate-limit notice image \(68 bytes\)/)
  } finally {
    await server.close()
  }
})
