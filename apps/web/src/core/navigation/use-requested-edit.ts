import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'

const NO_REQUEST_PARAMS: readonly string[] = []

export function useRequestedEdit<T extends { id: string }>(
  items: T[],
  openEdit: (item: T, requestParams: URLSearchParams) => void | Promise<void>,
  consumeParams: readonly string[] = NO_REQUEST_PARAMS,
) {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedId = searchParams.get('edit')
  const handledIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!requestedId) {
      handledIdRef.current = null
      return
    }
    if (handledIdRef.current === requestedId) return
    const item = items.find(candidate => candidate.id === requestedId)
    if (!item) return

    handledIdRef.current = requestedId
    void openEdit(item, searchParams)
    const next = new URLSearchParams(searchParams)
    next.delete('edit')
    for (const param of consumeParams) next.delete(param)
    setSearchParams(next, { replace: true })
  }, [consumeParams, items, openEdit, requestedId, searchParams, setSearchParams])
}
