import { useEffect, useState } from 'react'

type ManifestEntry = Record<string, string>

interface IntegrityManifest {
  generatedAt: string
  files: ManifestEntry
}

function shorten(hash: string, length = 10) {
  if (!hash) return ''
  return `${hash.slice(0, length)}…${hash.slice(-length)}`
}

export default function IntegrityBanner() {
  const [hash, setHash] = useState<string | null>(null)
  const [timestamp, setTimestamp] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let isMounted = true
    fetch(`${import.meta.env.BASE_URL ?? '/'}manifest.hash.json`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const manifest = (await response.json()) as IntegrityManifest
        if (isMounted && manifest && manifest.files) {
          const [, value] = Object.entries(manifest.files)[0] ?? []
          if (value) {
            setHash(value)
          }
          if (manifest.generatedAt) {
            setTimestamp(new Date(manifest.generatedAt).toISOString())
          }
        }
      })
      .catch(() => {
        if (isMounted) setErrored(true)
      })
    return () => {
      isMounted = false
    }
  }, [])

  return (
    <div className="bg-terminal-surface/80 border-b border-terminal-border/80 text-xs text-terminal-text-dim py-2 px-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
      <div className="flex items-center gap-2 text-terminal-text">
        <span className="font-semibold uppercase tracking-[0.25em] text-terminal-accent">
          Integrity
        </span>
        {hash ? (
          <span className="font-mono">
            bundle hash {shorten(hash)}
          </span>
        ) : errored ? (
          <span className="font-mono text-terminal-error">
            manifest unreachable — verify Arweave deployment hash manually
          </span>
        ) : (
          <span className="font-mono text-terminal-text-dim">resolving manifest…</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-[11px]">
        <span>
          {timestamp ? `generated ${new Date(timestamp).toUTCString()}` : 'pending manifest'}
        </span>
        <a
          href="https://arweave.org"
          target="_blank"
          rel="noreferrer"
          className="text-terminal-accent hover:text-terminal-accent-dim underline"
        >
          Verify on Arweave
        </a>
      </div>
    </div>
  )
}

