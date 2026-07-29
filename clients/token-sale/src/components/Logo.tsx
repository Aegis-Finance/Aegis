type LogoProps = {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export default function Logo({ size = 'md', className = '' }: LogoProps) {
  const textSizes = { sm: 'text-lg', md: 'text-xl', lg: 'text-2xl' }
  const monoSizes = { sm: 'text-[8px]', md: 'text-[9px]', lg: 'text-[10px]' }
  const zkSizes = { sm: 'text-[6px]', md: 'text-[7px]', lg: 'text-[8px]' }

  return (
    <div className={`flex min-w-0 items-center gap-x-2.5 ${className}`}>
      <span
        className={`font-display ${textSizes[size]} font-bold uppercase tracking-[0.28em] text-terminal-text`}
      >
        AEGIS
      </span>
      <div className="flex flex-col items-start leading-none gap-0.5 shrink-0">
        <span className={`font-mono uppercase tracking-[0.2em] text-terminal-text-dim/80 ${zkSizes[size]}`}>
          TGE
        </span>
        <span className={`font-mono uppercase tracking-[0.22em] text-terminal-text-dim ${monoSizes[size]}`}>
          SALE
        </span>
      </div>
    </div>
  )
}
