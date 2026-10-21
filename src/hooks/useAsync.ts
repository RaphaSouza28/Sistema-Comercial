import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '@/services/api'

/** Carrega dados assíncronos com estados de carregamento/erro e recarga manual. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const requestId = useRef(0)

  const reload = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const result = await loaderRef.current()
      if (id === requestId.current) setData(result)
    } catch (e) {
      if (id === requestId.current) setError(errorMessage(e))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, loading, reload, setData }
}
