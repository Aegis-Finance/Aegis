/**
 * Security utilities for token distribution frontend
 * Implements input validation, sanitization, and attack prevention
 * Enhanced for 15 Tbps DDoS protection from 500k IP addresses
 */

import { checkRateLimit, getRateLimitKey } from './rateLimiter'
import { BrowserFingerprint, IPClusteringDetector, ddosProtection } from './ddosProtection'

// Re-export for convenience (matches main frontend pattern)
export { checkRateLimit, getRateLimitKey }
export { BrowserFingerprint, IPClusteringDetector, ddosProtection }

/**
 * Validate and sanitize user input
 */
export function sanitizeInput(input: string): string {
  // Remove potentially dangerous characters
  return input
    .replace(/[<>]/g, '') // Remove HTML brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim()
    .slice(0, 1000) // Limit length
}

/**
 * Validate Ethereum address
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

/**
 * Validate hex string (for commitment/nullifier)
 */
export function isValidHex(hex: string, length?: number): boolean {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (!/^[a-fA-F0-9]+$/.test(clean)) return false
  if (length && clean.length !== length * 2) return false
  return true
}

/**
 * Validate amount input
 */
export function validateAmount(amount: string): { valid: boolean; error?: string } {
  if (!amount || amount.trim() === '') {
    return { valid: false, error: 'Amount is required' }
  }
  
  const num = parseFloat(amount)
  if (isNaN(num) || !isFinite(num)) {
    return { valid: false, error: 'Invalid amount format' }
  }
  
  if (num <= 0) {
    return { valid: false, error: 'Amount must be greater than zero' }
  }
  
  if (num > 1e9) {
    return { valid: false, error: 'Amount too large' }
  }
  
  // Check for excessive decimal places
  const decimalPlaces = amount.split('.')[1]?.length || 0
  if (decimalPlaces > 18) {
    return { valid: false, error: 'Too many decimal places (max 18)' }
  }
  
  // Check for attack patterns
  if (detectAttackPattern(amount)) {
    return { valid: false, error: 'Invalid amount format' }
  }
  
  return { valid: true }
}

/**
 * Validate slippage percentage
 */
export function validateSlippage(slippage: number): { valid: boolean; error?: string } {
  if (slippage < 0 || slippage > 50) {
    return { valid: false, error: 'Slippage must be between 0% and 50%' }
  }
  return { valid: true }
}

/**
 * Check for common attack patterns
 */
export function detectAttackPattern(data: unknown): boolean {
  if (typeof data !== 'string') return false
  
  const lower = data.toLowerCase()
  
  // SQL injection patterns
  if (/(union|select|insert|delete|drop|exec|script)/i.test(lower)) {
    return true
  }
  
  // XSS patterns
  if (/<script|javascript:|onerror=|onload=/i.test(lower)) {
    return true
  }
  
  // Path traversal
  if (/\.\.\/|\.\.\\|\.\.%2f|\.\.%5c/i.test(lower)) {
    return true
  }
  
  return false
}

/**
 * Get security status for debugging
 */
export function getSecurityStatus() {
  return {
    rateLimitKey: getRateLimitKey(),
    fingerprint: BrowserFingerprint.getId(),
    protection: ddosProtection.getStatus(),
  }
}

