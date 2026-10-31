/**
 * Pure helpers: request URL building, size clamping, rate-limit parsing, file
 * naming, and image header sniffing. No I/O, so everything here is unit tested.
 * @module dsh-free-image/lib/image
 */

/** Smallest accepted image edge. */
export const MIN_EDGE = 64
/** Largest accepted image edge, independent of provider limits. */
export const MAX_EDGE = 4096
/** Longest accepted prompt, in characters. */
export const MAX_PROMPT_CHARS = 2000

/**
 * Clamp a requested edge into the accepted range.
 * @param {unknown} value - requested edge.
 * @param {number} fallback - value used when the request is not a number.
 * @param {number} limit - provider limit.
 * @returns {number} clamped edge.
 */
export function clampEdge(value, fallback, limit) {
  const number = Number(value)
  const base = Number.isFinite(number) ? Math.round(number) : fallback
  return Math.min(MAX_EDGE, Math.max(MIN_EDGE, Math.min(limit, base)))
}

/**
 * Validate a prompt.
 * @param {unknown} prompt - requested prompt.
 * @returns {string} trimmed prompt.
 * @throws {Error} when the prompt is empty or too long.
 */
export function validatePrompt(prompt) {
  const text = String(prompt ?? '').trim()
  if (text === '') throw new Error('generate_image needs a non-empty prompt')
  if (text.length > MAX_PROMPT_CHARS) {
    throw new Error(`Prompt is too long (${text.length} characters, limit ${MAX_PROMPT_CHARS})`)
  }
  return text
}

/**
 * Build the image request URL for a provider.
 * @param {{ baseUrl: string, model: string }} provider - normalized provider.
 * @param {string} prompt - validated prompt.
 * @param {{ width: number, height: number, seed?: number, nologo?: boolean }} options - request options.
 * @returns {string} absolute request URL.
 */
export function buildImageUrl(provider, prompt, options) {
  const url = new URL(`${provider.baseUrl}/${encodeURIComponent(prompt)}`)
  url.searchParams.set('width', String(options.width))
  url.searchParams.set('height', String(options.height))
  if (options.nologo !== false) url.searchParams.set('nologo', 'true')
  if (provider.model !== '') url.searchParams.set('model', provider.model)
  if (Number.isFinite(options.seed)) url.searchParams.set('seed', String(Math.trunc(options.seed)))
  return url.toString()
}

/**
 * Read the "retry after Ns" hint from a rate-limit body.
 * @param {string} body - response body text.
 * @returns {number | null} seconds to wait, or null when the body has no hint.
 */
export function parseRetryAfterSeconds(body) {
  const text = String(body ?? '')
  const match = /retry\s+after\s+(\d+(?:\.\d+)?)\s*s/i.exec(text)
  if (match !== null) return Math.max(0, Math.ceil(Number(match[1])))
  const plain = /(\d+(?:\.\d+)?)\s*seconds?/i.exec(text)
  if (plain !== null) return Math.max(0, Math.ceil(Number(plain[1])))
  return null
}

/**
 * Whether an HTTP status is worth another attempt.
 * @param {number} status - HTTP status code.
 * @returns {boolean} true for rate limits and transient server errors.
 */
export function isRetryableStatus(status) {
  return status === 402 || status === 429 || status === 503 || status === 502 || status === 504
}

/**
 * Pick a file extension for a response content type.
 * @param {string} contentType - `Content-Type` header value.
 * @returns {string} extension without the dot.
 */
export function extensionForContentType(contentType) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase()
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  if (type === 'image/gif') return 'gif'
  return 'jpg'
}

/**
 * Build a filesystem-safe slug from a prompt.
 * @param {string} prompt - validated prompt.
 * @param {number} [maxLength] - maximum slug length.
 * @returns {string} slug such as `a-red-sports-car`.
 */
export function slugifyPrompt(prompt, maxLength = 40) {
  const ascii = String(prompt ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const trimmed = ascii.slice(0, maxLength).replace(/-+$/g, '')
  return trimmed === '' ? 'image' : trimmed
}

/**
 * Build a timestamped file name.
 * @param {Date} now - clock.
 * @param {string} slug - prompt slug.
 * @param {string} extension - file extension.
 * @returns {string} file name.
 */
export function buildFileName(now, slug, extension) {
  const pad = value => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${stamp}-${slug}.${extension}`
}

/**
 * Read the pixel dimensions from a PNG or JPEG header.
 * @param {Buffer} buffer - image bytes.
 * @returns {{ width: number, height: number } | null} dimensions, or null when unknown.
 */
export function readImageSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null
  // PNG: 89 50 4E 47 0D 0A 1A 0A, then IHDR width/height as big-endian u32.
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    if (buffer.length < 24) return null
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  // JPEG: walk markers until a start-of-frame marker.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = buffer[offset + 1]
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2
        continue
      }
      const length = buffer.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      }
      offset += 2 + length
    }
  }
  return null
}
