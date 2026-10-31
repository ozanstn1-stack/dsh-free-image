/**
 * Plugin configuration schema and normalization.
 *
 * The plugin stores no credentials: a provider is just a URL that returns an
 * image for a prompt. That keeps the "keyless" promise honest — and means the
 * operator can point the plugin at a self-hosted endpoint without a code change.
 * @module dsh-free-image/config
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'

/** The keyless public endpoint used when nothing is configured. */
export const DEFAULT_BASE_URL = 'https://image.pollinations.ai/prompt'

const providerSchema = z.object({
  id: z.string().required().description('Stable provider id used by the tools.'),
  label: z.string().default('').description('Human-readable provider label.'),
  baseUrl: z.string().default(DEFAULT_BASE_URL)
    .description('Prompt endpoint. The encoded prompt is appended as the last path segment.'),
  model: z.string().default('').description('Optional model query parameter; empty uses the endpoint default.'),
  maxWidth: z.number().min(64).max(4096).default(1024).description('Largest width the tool may request.'),
  maxHeight: z.number().min(64).max(4096).default(1024).description('Largest height the tool may request.'),
  rateLimitMs: z.number().min(0).max(600000).default(45000)
    .description('Advertised minimum gap between requests; reported to the model.'),
  timeoutMs: z.number().min(5000).max(600000).default(120000).description('Per-request HTTP timeout.'),
})

/** Config schema shown to operators and used to validate `apply()`. */
export const Config = z.object({
  providers: z.array(providerSchema).default([{
    id: 'pollinations',
    label: 'Pollinations (keyless)',
    baseUrl: DEFAULT_BASE_URL,
    model: '',
    maxWidth: 1024,
    maxHeight: 1024,
    rateLimitMs: 45000,
    timeoutMs: 120000,
  }]).description('Image providers. Each one is an HTTP GET endpoint that returns image bytes.'),

  defaults: z.object({
    provider: z.string().default('pollinations').description('Provider id used when the tool call omits one.'),
    width: z.number().min(64).max(4096).default(512).description('Default image width.'),
    height: z.number().min(64).max(4096).default(512).description('Default image height.'),
  }).default({}).description('Defaults for tool calls that omit size or provider.'),

  output: z.object({
    dir: z.string().default('').description('Directory for generated images; empty uses `<DSH_HOME>/generated/images`.'),
    maxBytes: z.number().min(1024).max(67108864).default(10485760).description('Largest image the plugin will write.'),
  }).default({}).description('Where and how large generated images may be.'),

  retry: z.object({
    budgetMs: z.number().min(0).max(600000).default(90000)
      .description('How long one call may wait for a rate limit to clear before giving up.'),
    maxAttempts: z.number().min(1).max(5).default(3).description('Total HTTP attempts per call.'),
  }).default({}).description('Rate-limit retry policy.'),
})

/**
 * Resolve the Harness home directory the same way the runtime does.
 * @returns {string} absolute DSH home path.
 */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  return join(homedir(), '.dsh')
}

/**
 * Validate operator config into a shape the tools can trust.
 * @param {object} config - validated config from the schema.
 * @returns {{ config: object, warnings: string[] }} normalized config plus warnings.
 */
export function normalizeConfig(config) {
  const warnings = []
  const value = config ?? {}

  const providers = []
  for (const entry of value.providers ?? []) {
    const id = String(entry.id ?? '').trim()
    const baseUrl = String(entry.baseUrl ?? '').trim()
    if (id === '') {
      warnings.push('dsh-free-image: ignoring provider without an id')
      continue
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
      warnings.push(`dsh-free-image: ignoring provider ${JSON.stringify(id)}: baseUrl must be an http(s) URL`)
      continue
    }
    providers.push({
      id,
      label: String(entry.label ?? ''),
      baseUrl: baseUrl.replace(/\/+$/, ''),
      model: String(entry.model ?? ''),
      maxWidth: Number(entry.maxWidth ?? 1024),
      maxHeight: Number(entry.maxHeight ?? 1024),
      rateLimitMs: Number(entry.rateLimitMs ?? 45000),
      timeoutMs: Number(entry.timeoutMs ?? 120000),
    })
  }

  const requestedDefault = String(value.defaults?.provider ?? '').trim()
  const defaultProvider = providers.find(provider => provider.id === requestedDefault)?.id
    ?? providers[0]?.id
    ?? ''
  if (requestedDefault !== '' && defaultProvider !== requestedDefault) {
    warnings.push(`dsh-free-image: default provider ${JSON.stringify(requestedDefault)} is not configured; using ${JSON.stringify(defaultProvider)}`)
  }

  const outputDir = String(value.output?.dir ?? '').trim() || join(resolveDshHome(), 'generated', 'images')

  return {
    config: {
      providers,
      defaults: {
        provider: defaultProvider,
        width: Number(value.defaults?.width ?? 512),
        height: Number(value.defaults?.height ?? 512),
      },
      output: { dir: outputDir, maxBytes: Number(value.output?.maxBytes ?? 10485760) },
      retry: {
        budgetMs: Number(value.retry?.budgetMs ?? 90000),
        maxAttempts: Number(value.retry?.maxAttempts ?? 3),
      },
    },
    warnings,
  }
}
