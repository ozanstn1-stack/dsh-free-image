/**
 * dsh-free-image — keyless image generation for DeepSeek Harness.
 *
 * A provider is a plain HTTP GET endpoint that returns image bytes for a
 * prompt, so the plugin needs no API key and no paid account. Free endpoints
 * are rate limited per IP, so calls are serialized and rate-limit answers are
 * retried within a bounded budget.
 * @module dsh-free-image
 */

import { Config, normalizeConfig } from './config.js'
import { createGenerateImageTool } from './tools/generate.js'
import { createListImageModelsTool } from './tools/models.js'

export { Config }

/** Plugin name used by the bundle patch and diagnostics. */
export const name = 'dsh-free-image'

/** Services this plugin needs before it can register tools. */
export const inject = ['tools', 'systemPrompt']

/** Placement of this plugin's system-prompt section. */
const PROMPT_ORDER = 500

/**
 * Build the system-prompt section text from the effective config.
 * @param {object} config - normalized config.
 * @returns {string} prompt text.
 */
export function buildPromptText(config) {
  const providers = config.providers.map(provider => provider.id).join(', ') || '(none configured)'
  const pacing = config.providers
    .filter(provider => provider.rateLimitMs > 0)
    .map(provider => `about one image every ${Math.round(provider.rateLimitMs / 1000)} s`)
  return [
    `Keyless image generation (dsh-free-image). Providers: ${providers}.`,
    'Use `generate_image` only when the user asks for an image. It writes one file and returns its absolute path.',
    `Free endpoints are rate limited (${pacing.join('; ') || 'unknown pacing'}), so calls run one at a time and one call produces one image. Do not loop or retry aggressively; if the tool reports a wait, tell the user the wait and stop.`,
    'Never claim an image exists without the path the tool returned, and never invent a file path.',
    'Images are saved under the configured output directory; the plugin stores no credentials and sends only the prompt to the endpoint.',
  ].join('\n')
}

/**
 * Plugin entry point.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} rawConfig - validated config from {@link Config}.
 * @returns {Promise<void>} resolves once tools and the prompt section are registered.
 */
export async function apply(ctx, rawConfig) {
  const { config, warnings } = normalizeConfig(rawConfig)
  for (const warning of warnings) {
    ctx.logger?.('dsh-free-image')?.warn?.(warning)
  }

  const env = { ctx, config }
  ctx.effect(() => ctx.tools.register(createGenerateImageTool(env)))
  ctx.effect(() => ctx.tools.register(createListImageModelsTool(env)))
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'free-image',
    order: PROMPT_ORDER,
    text: buildPromptText(config),
    interpolate: false,
  }))
}
