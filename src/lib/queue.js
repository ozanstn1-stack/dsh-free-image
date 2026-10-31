/**
 * Single-flight queue.
 *
 * The keyless endpoints are rate limited per IP, so two parallel calls would
 * only make each other fail. Every `generate_image` call therefore waits for
 * the previous one to finish.
 * @module dsh-free-image/lib/queue
 */

/**
 * Create a serializer for async tasks.
 * @returns {<T>(task: () => Promise<T>) => Promise<T>} enqueue function.
 */
export function createQueue() {
  let tail = Promise.resolve()
  return function enqueue(task) {
    const run = tail.then(task, task)
    tail = run.then(() => undefined, () => undefined)
    return run
  }
}
