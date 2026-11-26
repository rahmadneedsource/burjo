export async function request<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/'+path, body === undefined ? {cache:'no-store',signal} : {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal,
  })
  return read<T>(response)
}

export async function read<T>(response: Response): Promise<T> {
  const result = await response.json<{error?:string}>().catch(()=>null)
  if (!response.ok) throw new Error(result?.error || 'Layanan sedang bermasalah. Coba lagi sebentar.')
  return result as T
}

export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Terjadi kesalahan.'
