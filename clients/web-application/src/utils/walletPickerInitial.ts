/** First display character for wallet picker rows (no remote icon images). */
export function walletPickerInitial(name: string): string {
  const t = (name || '').trim()
  if (!t) return '?'
  const m = t.match(/[A-Za-z0-9]/)
  return m ? m[0].toUpperCase() : '?'
}
