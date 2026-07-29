/**
 * Enhanced Query Client with rate limiting and security
 */

import { QueryClient, QueryFunctionContext } from '@tanstack/react-query'
import { checkRateLimit } from './rateLimiter'

/**
 * Create a secure query function wrapper
 */
export function createSecureQueryFn<T>(
  queryFn: (context: QueryFunctionContext) => Promise<T>,
  rateLimitType: 'api' | 'critical' | 'rpc' | 'gateway' = 'api'
) {
  return async (context: QueryFunctionContext): Promise<T> => {
    try {
      // Apply rate limiting
      checkRateLimit(rateLimitType)
      return await queryFn(context)
    } catch (error) {
      if (error instanceof Error && error.message.includes('Rate limit exceeded')) {
        // Re-throw rate limit errors
        throw error
      }
      // For other errors, let React Query handle retries
      throw error
    }
  }
}

/**
 * Enhanced query client with security features
 */
export const secureQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Don't retry on rate limit errors
        if (error instanceof Error && error.message.includes('Rate limit exceeded')) {
          return false
        }
        // Retry up to 1 time for other errors
        return failureCount < 1
      },
      staleTime: 30000,
    },
    mutations: {
      retry: 0, // Don't retry mutations
    },
  },
})

