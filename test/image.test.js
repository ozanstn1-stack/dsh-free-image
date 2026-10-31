import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_EDGE,
  MIN_EDGE,
  buildFileName,
  buildImageUrl,
  clampEdge,
  extensionForContentType,
  isRetryableStatus,
  parseRetryAfterSeconds,
  readImageSize,
  slugifyPrompt,
  validatePrompt,
} from '../src/lib/image.js'

const provider = { id: 'p', baseUrl: 'https://image.example.test/prompt', model: '' }

test('clampEdge keeps values inside the provider range', () => {
  assert.equal(clampEdge(512, 256, 1024), 512)
  assert.equal(clampEdge(10, 256, 1024), MIN_EDGE)
  assert.equal(clampEdge(5000, 256, 1024), 1024)
  assert.equal(clampEdge(99999, 256, 99999), MAX_EDGE)
  assert.equal(clampEdge(undefined, 300, 1024), 300)
  assert.equal(clampEdge('640', 300, 1024), 640)
  assert.equal(clampEdge(Number.NaN, 300, 1024), 300)
})

test('validatePrompt trims and rejects empty or oversized prompts', () => {
  assert.equal(validatePrompt('  a cat  '), 'a cat')
  assert.throws(() => validatePrompt(''), /non-empty prompt/)
  assert.throws(() => validatePrompt('   '), /non-empty prompt/)
  assert.throws(() => validatePrompt('x'.repeat(2001)), /too long/)
})

test('buildImageUrl encodes the prompt and query parameters', () => {
  const url = new URL(buildImageUrl(provider, 'a red car & a dog', { width: 512, height: 768 }))
  assert.equal(url.origin, 'https://image.example.test')
  assert.equal(decodeURIComponent(url.pathname), '/prompt/a red car & a dog')
  assert.equal(url.searchParams.get('width'), '512')
  assert.equal(url.searchParams.get('height'), '768')
  assert.equal(url.searchParams.get('nologo'), 'true')
  assert.equal(url.searchParams.get('model'), null)
})

test('buildImageUrl adds model and seed when configured', () => {
  const url = new URL(buildImageUrl({ ...provider, model: 'flux' }, 'cat', { width: 256, height: 256, seed: 42.9 }))
  assert.equal(url.searchParams.get('model'), 'flux')
  assert.equal(url.searchParams.get('seed'), '42')
})

test('parseRetryAfterSeconds reads the rate-limit hint', () => {
  assert.equal(parseRetryAfterSeconds('{"error":{"message":"Retry after 28s, or get unlimited"}}'), 28)
  assert.equal(parseRetryAfterSeconds('Free limit reached: 1 image every 45 seconds per IP'), 45)
  assert.equal(parseRetryAfterSeconds('nope'), null)
  assert.equal(parseRetryAfterSeconds(''), null)
})

test('isRetryableStatus only retries transient answers', () => {
  for (const status of [402, 429, 502, 503, 504]) assert.equal(isRetryableStatus(status), true, `status ${status}`)
  for (const status of [200, 400, 401, 403, 404]) assert.equal(isRetryableStatus(status), false, `status ${status}`)
})

test('extensionForContentType maps image types', () => {
  assert.equal(extensionForContentType('image/png'), 'png')
  assert.equal(extensionForContentType('image/webp; charset=binary'), 'webp')
  assert.equal(extensionForContentType('image/gif'), 'gif')
  assert.equal(extensionForContentType('image/jpeg'), 'jpg')
  assert.equal(extensionForContentType('text/html'), 'jpg')
  assert.equal(extensionForContentType(undefined), 'jpg')
})

test('slugifyPrompt produces a safe short slug', () => {
  assert.equal(slugifyPrompt('A Red Sports Car'), 'a-red-sports-car')
  assert.equal(slugifyPrompt('Türk kahvesi, ahşap masada'), 'turk-kahvesi-ahsap-masada')
  assert.equal(slugifyPrompt('!!!'), 'image')
  assert.equal(slugifyPrompt('x'.repeat(100)).length, 40)
})

test('buildFileName is deterministic', () => {
  const now = new Date(2026, 9, 31, 13, 5, 9)
  assert.equal(buildFileName(now, 'a-cat', 'jpg'), '20261031-130509-a-cat.jpg')
})

test('readImageSize reads PNG dimensions', () => {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(640, 16)
  buffer.writeUInt32BE(480, 20)
  assert.deepEqual(readImageSize(buffer), { width: 640, height: 480 })
})

test('readImageSize reads JPEG dimensions', () => {
  const buffer = Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ])
  assert.deepEqual(readImageSize(buffer), { width: 400, height: 300 })
})

test('readImageSize returns null for unknown data', () => {
  assert.equal(readImageSize(Buffer.from('not an image')), null)
  assert.equal(readImageSize(Buffer.alloc(0)), null)
})
