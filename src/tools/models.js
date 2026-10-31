/**
 * `list_image_models`: read-only inventory of the configured providers.
 * @module dsh-free-image/tools/models
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { textOutput, textResult } from '../lib/tooling.js'

/**
 * Build the `list_image_models` tool.
 * @param {object} deps - dependencies.
 * @param {object} deps.config - normalized config.
 * @returns {object} tool definition.
 */
export function createListImageModelsTool({ config }) {
  const ids = config.providers.map(provider => provider.id)

  return defineTool({
    name: 'list_image_models',
    description: `Read-only list of the configured keyless image providers: endpoint, model, size limits and pacing. Configured: ${ids.join(', ') || '(none)'}.`,
    parameters: {
      provider: { type: 'string', description: `Only describe this provider id. Configured: ${ids.join(', ') || '(none)'}.` },
    },
    output: textOutput(),
    timeoutMs: 5000,
    isConcurrencySafe: () => true,
    async execute(args) {
      if (config.providers.length === 0) {
        return textResult('No image providers are configured. Add at least one `providers` entry to the dsh-free-image plugin config.')
      }
      const wanted = String(args.provider ?? '').trim()
      const selected = wanted === ''
        ? config.providers
        : config.providers.filter(provider => provider.id === wanted)
      if (selected.length === 0) {
        throw new Error(`Unknown provider ${JSON.stringify(wanted)}. Configured providers: ${ids.join(', ')}.`)
      }

      const blocks = [`Configured image providers (default: ${config.defaults.provider}):`]
      for (const provider of selected) {
        const label = provider.label !== '' && provider.label !== provider.id ? ` · ${provider.label}` : ''
        const pacing = provider.rateLimitMs > 0
          ? `about one image every ${Math.round(provider.rateLimitMs / 1000)} s`
          : 'no advertised pacing'
        blocks.push([
          `  ${provider.id}${label}`,
          `    endpoint: ${provider.baseUrl}`,
          `    model: ${provider.model === '' ? '(endpoint default)' : provider.model}`,
          `    max size: ${provider.maxWidth}x${provider.maxHeight}`,
          `    pacing: ${pacing}`,
          `    request timeout: ${Math.round(provider.timeoutMs / 1000)} s`,
        ].join('\n'))
      }
      blocks.push(`Output directory: ${config.output.dir}`)
      return textResult(blocks.join('\n'))
    },
  })
}
