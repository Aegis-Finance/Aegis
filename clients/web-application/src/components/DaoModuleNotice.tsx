import { type ReactNode } from 'react'

type Props = {
  /** One short honest paragraph for this module (what the contracts do / do not guarantee). */
  children: ReactNode
}

export default function DaoModuleNotice({ children }: Props) {
  return (
    <div className="rounded-lg border border-terminal-border/50 bg-terminal-bg px-4 py-3 text-sm text-terminal-text-dim leading-relaxed">
      {children}
    </div>
  )
}
