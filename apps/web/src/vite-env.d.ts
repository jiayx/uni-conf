declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {
  const css: string
  export default css
}

interface ImportMeta {
  readonly env: {
    readonly VITE_API_URL?: string
    readonly [key: string]: string | undefined
  }
}
