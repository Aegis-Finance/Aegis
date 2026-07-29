import { formatUnits, parseUnits } from 'ethers'

export function formatAddress(address: string, length = 6): string {
  if (!address) return ''
  if (address.length <= length * 2) return address
  return `${address.slice(0, length)}...${address.slice(-length)}`
}

export function formatBalance(balance: bigint, decimals = 18, precision = 4): string {
  try {
    const formatted = formatUnits(balance, decimals)
    const num = parseFloat(formatted)
    return num.toFixed(precision)
  } catch {
    return '0'
  }
}

export function parseBalance(amount: string, decimals = 18): bigint {
  try {
    return parseUnits(amount, decimals)
  } catch {
    return 0n
  }
}

export function formatNumber(num: number | string, decimals = 2): string {
  const n = typeof num === 'string' ? parseFloat(num) : num
  if (isNaN(n)) return '0'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function formatDate(timestamp: number | bigint): string {
  const date = new Date(Number(timestamp) * 1000)
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDuration(seconds: number | bigint): string {
  const s = Number(seconds)
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

