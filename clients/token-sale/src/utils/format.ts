import { formatEther, formatUnits } from 'ethers'

export function formatAddress(address: string, length = 6): string {
  if (!address) return ''
  if (address.length <= length * 2) return address
  return `${address.slice(0, length)}...${address.slice(-length)}`
}

export function formatToken(value: bigint, decimals = 18, precision = 2): string {
  const formatted = Number(formatUnits(value, decimals))
  return formatted.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: precision,
  })
}

export function formatPriceWei(value: bigint, precision = 4): string {
  const ethValue = Number(formatEther(value))
  return ethValue.toLocaleString(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  })
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'Sale ended'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  return [
    days > 0 ? `${days}d` : null,
    hours > 0 ? `${hours}h` : null,
    minutes > 0 ? `${minutes}m` : null,
    `${secs}s`,
  ]
    .filter(Boolean)
    .join(' ')
}
