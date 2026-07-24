import { createContext } from 'react'

export type DirtyRegistration = (id: symbol, dirty: boolean) => void

export const UnsavedChangesContext = createContext<DirtyRegistration | null>(null)
