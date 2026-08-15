// Tenta fn() de novo em caso de falha transitória (ex.: GoTrue de satélite
// respondendo instável — ver comentário em provision-module-user sobre o
// Propostas). Só propaga o erro depois da última tentativa.
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delaysMs?: number[] } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3
  const delaysMs = opts.delaysMs ?? [500, 1500, 4000]

  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delaysMs[i] ?? delaysMs[delaysMs.length - 1]))
      }
    }
  }
  throw lastErr
}
