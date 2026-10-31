/**
 * Writing generated image bytes to disk.
 * @module dsh-free-image/lib/save
 */

import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Find a free path in a directory, adding `-2`, `-3`, … when the name is taken.
 * @param {string} dir - target directory.
 * @param {string} fileName - desired file name.
 * @returns {Promise<string>} absolute path that does not exist yet.
 */
async function uniquePath(dir, fileName) {
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const extension = dot > 0 ? fileName.slice(dot) : ''
  for (let index = 1; index <= 50; index += 1) {
    const candidate = index === 1 ? fileName : `${stem}-${index}${extension}`
    const path = join(dir, candidate)
    try {
      await access(path)
    } catch {
      return path
    }
  }
  throw new Error(`Could not find a free file name for ${fileName}`)
}

/**
 * Write one image and return its absolute path.
 * @param {string} dir - target directory.
 * @param {string} fileName - desired file name.
 * @param {Buffer} buffer - image bytes.
 * @returns {Promise<string>} absolute path written.
 */
export async function saveImage(dir, fileName, buffer) {
  await mkdir(dir, { recursive: true, mode: 0o755 })
  const path = await uniquePath(dir, fileName)
  await writeFile(path, buffer, { mode: 0o644 })
  return path
}
