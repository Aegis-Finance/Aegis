import { Link } from 'react-router-dom'

interface LogoProps {
  /** `full` = primary header wordmark (text only, no images). `text` = compact link. `icon` = tiny monogram for footer. */
  variant?: 'full' | 'icon' | 'text'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

export default function Logo({ variant = 'full', size = 'md', className = '' }: LogoProps) {
  const textSizes = {
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-2xl',
    xl: 'text-3xl',
  }

  const monoSizes = {
    sm: 'text-[8px]',
    md: 'text-[9px]',
    lg: 'text-[10px]',
    xl: 'text-[11px]',
  }

  const zkSizes = {
    sm: 'text-[6px]',
    md: 'text-[7px]',
    lg: 'text-[8px]',
    xl: 'text-[9px]',
  }

  const iconBox = {
    sm: 'h-8 w-8 text-[10px]',
    md: 'h-10 w-10 text-xs',
    lg: 'h-12 w-12 text-sm',
    xl: 'h-14 w-14 text-base',
  }

  if (variant === 'icon') {
    return (
      <Link
        to="/"
        className={`inline-flex items-center justify-center rounded-lg border border-terminal-border bg-terminal-bg font-display font-bold text-terminal-text ${iconBox[size]} ${className}`}
        aria-label="Aegis home"
      >
        A
      </Link>
    )
  }

  const wordmark = (
    <div className="flex min-w-0 items-center gap-x-2.5">
      <span
        className={`font-display ${textSizes[size]} font-bold uppercase tracking-[0.28em] text-terminal-text transition-colors group-hover:text-terminal-accent`}
      >
        AEGIS
      </span>
      <div className="flex flex-col items-start leading-none gap-0.5 shrink-0">
        <span className={`font-mono uppercase tracking-[0.2em] text-terminal-text-dim/80 ${zkSizes[size]}`}>
          ZK
        </span>
        <span className={`font-mono uppercase tracking-[0.22em] text-terminal-text-dim ${monoSizes[size]}`}>DAO</span>
      </div>
    </div>
  )

  if (variant === 'text') {
    return (
      <Link to="/" className={`group flex items-center ${className}`}>
        {wordmark}
      </Link>
    )
  }

  return (
    <Link to="/" className={`group flex min-w-0 items-center gap-0 ${className}`}>
      {wordmark}
    </Link>
  )
}
