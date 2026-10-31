/**
 * `generate_image`: keyless image generation through a configured GET endpoint.
 * @module dsh-free-image/tools/generate
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { fetchImage } from '../lib/http.js'
import {
  buildFileName,
  buildImageUrl,
  clampEdge,
  extensionForContentType,
  isRetryableStatus,
  parseRetryAfterSeconds,
  readImageSize,
  slugifyPrompt,
  validatePrompt,
} from '../lib/image.js'
import { createQueue } from '../lib/queue.js'
import { saveImage } from '../lib/save.js'
import { textOutput, textResult } from '../lib/tooling.js'

/** Default wait when a retryable status carries no hint. */
const FALLBACK_WAIT_MS = 10000

/**
 * Describe a provider's free-tier pacing.
 * @param {{ rateLimitMs: number }} provider - normalized provider.
 * @returns {string} short description.
 */
function pacing(provider) {
  if (!Number.isFinite(provider.rateLimitMs) || provider.rateLimitMs <= 0) return 'no advertised pacing'
  return `about one image every ${Math.round(provider.rateLimitMs / 1000)} s`
}

/**
 * Format a byte count.
 * @param {number} bytes - byte count.
 * @returns {string} human-readable size.
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/**
 * Wait for a promise-returning delay.
 * @param {number} ms - milliseconds.
 * @returns {Promise<void>} resolves after the delay.
 */
function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Build the `generate_image` tool.
 * @param {object} deps - dependencies.
 * @param {object} deps.config - normalized config.
 * @param {Function} [deps.fetchImage] - HTTP fetch (injectable for tests).
 * @param {() => Date} [deps.now] - clock (injectable for tests).
 * @param {(ms: number) => Promise<void>} [deps.sleep] - delay (injectable for tests).
 * @returns {object} tool definition.
 */
export function createGenerateImageTool({ config, fetchImage: fetchImageImpl = fetchImage, now = () => new Date(), sleep = defaultSleep }) {
  const enqueue = createQueue()
  const providerList = config.providers.map(provider => provider.id)

  return defineTool({
    name: 'generate_image',
    description: `Generate one image from a text prompt and save it to disk, without an API key. Providers: ${providerList.join(', ') || '(none configured)'}. Calls are serialized because free endpoints are rate limited (${config.providers.map(pacing).join('; ') || 'unknown'}); when the endpoint asks to wait, the tool waits up to ${Math.round(config.retry.budgetMs / 1000)} s and then reports the remaining wait instead of failing blindly.`,
    parameters: {
      prompt: { type: 'string', required: true, description: 'What to draw; UTF-8, at most 2000 characters.' },
      width: { type: 'integer', description: `Image width in pixels (default ${config.defaults.width}).` },
      height: { type: 'integer', description: `Image height in pixels (default ${config.defaults.height}).` },
      provider: { type: 'string', description: `Provider id (default ${config.defaults.provider}). Configured: ${providerList.join(', ') || '(none)'}.` },
      seed: { type: 'integer', description: 'Optional seed for a reproducible result.' },
    },
    output: textOutput(),
    timeoutMs: 300000,
    isConcurrencySafe: () => false,
    execute(args, exec) {
      // Free endpoints are rate limited per IP: one call at a time.
      return enqueue(() => generateOne(args, exec))
    },
  })

  async function generateOne(args, exec) {
      const prompt = validatePrompt(args.prompt)

      const requestedProvider = String(args.provider ?? '').trim()
      const provider = requestedProvider === ''
        ? config.providers.find(candidate => candidate.id === config.defaults.provider)
        : config.providers.find(candidate => candidate.id === requestedProvider)
      if (provider === undefined) {
        if (requestedProvider !== '') {
          throw new Error(`Unknown image provider ${JSON.stringify(requestedProvider)}. Configured providers: ${providerList.join(', ') || '(none)'}. Nothing was generated.`)
        }
        throw new Error(`No image provider is configured. Configured providers: ${providerList.join(', ') || '(none)'}.`)
      }

      const width = clampEdge(args.width, config.defaults.width, provider.maxWidth)
      const height = clampEdge(args.height, config.defaults.height, provider.maxHeight)
      const url = buildImageUrl(provider, prompt, { width, height, seed: args.seed })
      const startedAt = Date.now()
      const deadline = startedAt + config.retry.budgetMs
      let lastProblem = ''

      for (let attempt = 1; attempt <= config.retry.maxAttempts; attempt += 1) {
        if (exec.signal?.aborted === true) throw new Error('Image generation was cancelled.')
        const response = await fetchImageImpl(url, { timeoutMs: provider.timeoutMs, signal: exec.signal })

        if (response.ok) {
          if (response.buffer.length > config.output.maxBytes) {
            throw new Error(`The provider returned ${formatBytes(response.buffer.length)}, above the ${formatBytes(config.output.maxBytes)} limit. Nothing was saved.`)
          }
          const extension = extensionForContentType(response.contentType)
          const fileName = buildFileName(now(), slugifyPrompt(prompt), extension)
          const path = await saveImage(config.output.dir, fileName, response.buffer)
          const size = readImageSize(response.buffer)
          const dimensions = size === null ? `${width}x${height} (requested)` : `${size.width}x${size.height}`
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
          return textResult([
            `Generated ${dimensions} image (${formatBytes(response.buffer.length)}) with ${provider.id} in ${elapsed} s.`,
            `Saved to ${path}`,
          ].join('\n'))
        }

        lastProblem = response.body.trim() !== ''
          ? response.body.trim().replace(/\s+/g, ' ').slice(0, 300)
          : `HTTP ${response.status}`

        if (!isRetryableStatus(response.status) || attempt === config.retry.maxAttempts) break

        const hinted = Number.isFinite(response.retryAfter) && response.retryAfter !== null
          ? response.retryAfter
          : parseRetryAfterSeconds(response.body)
          ?? (response.status === 402 || response.status === 429 ? Math.ceil(provider.rateLimitMs / 1000) : null)
        const waitMs = hinted === null ? FALLBACK_WAIT_MS : hinted * 1000
        if (Date.now() + waitMs > deadline) {
          const seconds = Math.max(1, Math.round(waitMs / 1000))
          throw new Error(`${provider.id} is rate limited: ${lastProblem}. It asked to wait about ${seconds} s, which exceeds this call's ${Math.round(config.retry.budgetMs / 1000)} s retry budget. Nothing was saved; try again later.`)
        }
        await sleep(waitMs)
      }

      throw new Error(`${provider.id} did not return an image: ${lastProblem || 'unknown error'}. Nothing was saved.`)
  }
}
