/**
 * HTTP fetch for one image request.
 * @module dsh-free-image/lib/http
 */

/**
 * Whether bytes start like a known raster image.
 * @param {Buffer} buffer - response bytes.
 * @returns {boolean} true for PNG, JPEG, GIF and WebP signatures.
 */
export function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true
  const head = buffer.subarray(0, 6).toString('latin1')
  if (head === 'GIF87a' || head === 'GIF89a') return true
  return buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP'
}

/**
 * Render a body for an error message without dumping binary garbage.
 * @param {Buffer} buffer - response bytes.
 * @param {string} contentType - response content type.
 * @returns {string} short human-readable description.
 */
export function describeBody(buffer, contentType) {
  const text = buffer.toString('utf8')
  const printable = !text.includes('\uFFFD') && /^[\x09\x0A\x0D\x20-\x7E]*$/.test(text.slice(0, 200))
  if (printable && text.trim() !== '') return text.trim().replace(/\s+/g, ' ').slice(0, 300)
  return `unexpected ${contentType || 'unknown'} body (${buffer.length} bytes)`
}

/**
 * Read the `Retry-After` header as seconds.
 * @param {Headers} headers - response headers.
 * @returns {number | null} seconds to wait, or null when absent/unparsable.
 */
function retryAfterSeconds(headers) {
  const raw = headers.get('retry-after')
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null
}

/**
 * Fetch image bytes with a timeout and a caller cancellation signal.
 *
 * Some endpoints answer a successful request with a generic content type, so the
 * body's magic bytes decide whether the payload is an image.
 * @param {string} url - absolute request URL.
 * @param {object} options - request options.
 * @param {number} options.timeoutMs - wall-clock cap for the request.
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @returns {Promise<{ ok: true, status: number, contentType: string, buffer: Buffer }
 *   | { ok: false, status: number, contentType: string, body: string, retryAfter: number | null }>} response
 * @throws {Error} when the request cannot be made at all.
 */
export async function fetchImage(url, { timeoutMs, signal }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const fused = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
  try {
    const response = await fetch(url, {
      signal: fused,
      redirect: 'follow',
      headers: { accept: 'image/*', 'user-agent': 'dsh-free-image/0.1' },
    })
    const contentType = response.headers.get('content-type') ?? ''
    const retryAfter = retryAfterSeconds(response.headers)

    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer())
      if (contentType.toLowerCase().startsWith('image/') || sniffImage(buffer)) {
        return { ok: true, status: response.status, contentType, buffer, retryAfter }
      }
      return { ok: false, status: response.status, contentType, body: describeBody(buffer, contentType), retryAfter }
    }

    const buffer = Buffer.from(await response.arrayBuffer().catch(() => new ArrayBuffer(0)))
    // A pacing status can still carry a *notice graphic* rather than a generated
    // image (the public endpoint answers 402 with a "free limit reached" card).
    // Such a body is reported as a rate limit, never saved as the result.
    const imageBody = sniffImage(buffer)
    return {
      ok: false,
      status: response.status,
      contentType,
      body: imageBody ? `the endpoint returned its rate-limit notice image (${buffer.length} bytes)` : describeBody(buffer, contentType),
      retryAfter,
      imageBody,
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (signal?.aborted === true) throw error
      throw new Error(`The image request timed out after ${timeoutMs} ms`)
    }
    throw new Error(`The image request failed: ${error?.message ?? String(error)}`)
  } finally {
    clearTimeout(timer)
  }
}
