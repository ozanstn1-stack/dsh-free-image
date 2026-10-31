# dsh-free-image

Keyless image generation for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

`dsh-free-image` gives your DSH agent a `generate_image` tool that needs **no API
key and no paid account**. A provider is just an HTTP GET endpoint that returns
image bytes for a prompt, so the plugin works out of the box against a free
public endpoint and can be pointed at a self-hosted one by changing config.

Free endpoints are rate limited per IP. The plugin therefore runs one call at a
time, honours the endpoint's "retry after N s" answer within a bounded budget,
and tells you the remaining wait instead of failing blindly.

## Tools

| Tool | Kind | What it does |
| --- | --- | --- |
| `generate_image` | writes one file | Generates one image from a prompt, saves it under the configured directory, returns the absolute path, real pixel size and byte size. |
| `list_image_models` | read-only | Lists the configured providers: endpoint, model, size limits, pacing, timeout, output directory. |

## How it works

```
prompt ──▶ GET <baseUrl>/<url-encoded prompt>?width=…&height=…&nologo=true
         ◀── image bytes
            saved to <output.dir>/<YYYYMMDD-HHMMSS>-<slug>.<ext>
```

- No key is stored or sent; the request carries only the prompt and size.
- The response is validated as `image/*` before anything is written.
- Images larger than `output.maxBytes` are refused, not written.
- A `402`/`429`/`503` answer is retried after the wait it asks for, as long as
  the wait fits in `retry.budgetMs`; otherwise the tool reports the wait.

## Install

```bash
dsh plugin --profile web add dsh-free-image
systemctl restart dsh-web   # or restart your DSH process
```

No configuration is required: the default provider is the keyless public
endpoint. To change the endpoint, size limits or output directory:

```yaml
- id: free-image
  config:
    providers:
      - id: pollinations
        label: Pollinations (keyless)
        baseUrl: https://image.pollinations.ai/prompt
        model: ''
        maxWidth: 1024
        maxHeight: 1024
        rateLimitMs: 45000
        timeoutMs: 120000
    defaults:
      provider: pollinations
      width: 512
      height: 512
    output:
      dir: /root/work/generated/images
      maxBytes: 10485760
    retry:
      budgetMs: 90000
      maxAttempts: 3
```

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `providers[].id` | — | Provider id used by the tools. |
| `providers[].baseUrl` | `https://image.pollinations.ai/prompt` | Prompt endpoint; the encoded prompt is appended as the last path segment. |
| `providers[].model` | `''` | Optional `model` query parameter. |
| `providers[].maxWidth` / `maxHeight` | `1024` | Largest size the tool may request from this provider. |
| `providers[].rateLimitMs` | `45000` | Advertised pacing, reported to the model. |
| `providers[].timeoutMs` | `120000` | Per-request HTTP timeout. |
| `defaults.provider` | first provider | Provider used when a call omits one. |
| `defaults.width` / `height` | `512` | Default image size. |
| `output.dir` | `<DSH_HOME>/generated/images` | Where images are written. |
| `output.maxBytes` | `10485760` | Largest image the plugin will write. |
| `retry.budgetMs` | `90000` | How long one call may wait for a rate limit to clear. |
| `retry.maxAttempts` | `3` | Total HTTP attempts per call. |

## Self-hosted endpoints

The same plugin works against a local generation server that accepts a prompt in
the URL path and returns image bytes — for example an Automatic1111/ComfyUI front
end you put in front of it. Point `baseUrl` at it and the plugin needs no key
there either. This is the private alternative to a public free endpoint: prompts
never leave your machine, and there is no 45-second pacing.

## Honest limits

- Public free endpoints are rate limited (about one image per 45 s per IP at the
  time of writing), sometimes answer `503`, and may change their terms.
- Image quality is whatever the endpoint's default model produces.
- The prompt is sent to the endpoint; do not use a public endpoint for anything
  private.

## Requirements

- DSH `>= 0.2.1-rc.4` (Node `^22.19.0 || >=24.0.0`).
- Outbound HTTPS to the configured endpoint.

## Development

```bash
npm run link-peers   # link @deepseek-ai peer packages from the local dsh install
node --test
```

## License

MIT
