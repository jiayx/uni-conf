import { createContext, useContext } from 'react'

export interface ConfirmDialogOptions {
  title?: string
  description: string
  confirmLabel?: string
  danger?: boolean
}

export type ConfirmDialogHandler = (options: ConfirmDialogOptions) => Promise<boolean>

export const ConfirmDialogContext = createContext<ConfirmDialogHandler | null>(null)

export function useConfirmDialog(): ConfirmDialogHandler {
  const handler = useContext(ConfirmDialogContext)
  return handler ?? (async ({ description }) => window.confirm(description))
}
