export function countContentLines(content: string): number {
  if (content.length === 0) return 0
  let lines = 1
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) lines += 1
  }
  return lines
}
