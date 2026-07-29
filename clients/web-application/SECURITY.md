# Frontend Security Implementation

This document describes the comprehensive security measures implemented in the Aegis Protocol frontend to protect against DDoS attacks, abuse, and other threats.

## Overview

Since the backend is on-chain (blockchain), attackers will target the frontend. We've implemented multiple layers of protection:

1. **Client-side rate limiting** - Prevents abuse and DDoS
2. **Arweave gateway fallback** - Multiple gateways for resilience
3. **Sovereign node integration** - Protected nodes for critical operations
4. **Request throttling** - Prevents rapid repeated calls
5. **Input validation** - Sanitizes user input
6. **Attack pattern detection** - Monitors for suspicious activity

## Security Features

### 1. Rate Limiting

**Location**: `src/utils/rateLimiter.ts`

Implements token bucket algorithm with sliding window:

- **API calls**: 100 requests/minute
- **Critical operations**: 10 requests/minute (governance, transactions)
- **RPC calls**: 200 requests/minute
- **Gateway requests**: 50 requests/minute

Rate limits are tracked per:
- Wallet address (if connected)
- Session ID (if not connected)

**Usage**:
```typescript
import { checkRateLimit } from '@/utils/rateLimiter'

// Before making a request
checkRateLimit('api') // or 'critical', 'rpc', 'gateway'
```

### 2. Arweave Gateway Fallback

**Location**: `src/utils/arweaveGateway.ts`

Automatically tries multiple Arweave gateways in order:
1. `arweave.net` (primary)
2. `ar-io.net`
3. `arweave.live`
4. `gateway.arweave.net`
5. `arweave.dev`

Features:
- Health monitoring (tracks gateway failures)
- Automatic failover
- Response time tracking
- Priority-based selection

**Usage**:
```typescript
import { fetchFromArweave, getArweaveContent } from '@/utils/arweaveGateway'

// Fetch with automatic fallback
const response = await fetchFromArweave(transactionId)
const content = await getArweaveContent(transactionId)
```

### 3. Sovereign Node Integration

**Location**: `src/utils/sovereignNode.ts`

Uses Aegis sovereign nodes for critical operations:
- Governance transactions
- Token transfers
- Contract interactions
- RPC calls

Features:
- Automatic failover between nodes
- Health monitoring
- Priority-based selection
- Local node support (127.0.0.1:8545)

**Configuration** (`.env`):
```env
VITE_SOVEREIGN_NODE_1=https://sovereign-node-1.example.com
VITE_SOVEREIGN_NODE_2=https://sovereign-node-2.example.com
VITE_SOVEREIGN_NODE_3=https://sovereign-node-3.example.com
```

**Usage**:
```typescript
import { useSovereignNode } from '@/hooks/useSovereignNode'

const { executeRpc, hasSovereignNodes } = useSovereignNode()

// Execute RPC call through sovereign node
const result = await executeRpc('eth_call', [params])
```

### 4. Security Utilities

**Location**: `src/utils/security.ts`

Provides:
- Request throttling
- Input sanitization
- Address/hash validation
- Attack pattern detection
- Secure fetch with retry logic

**Usage**:
```typescript
import { 
  withRateLimit, 
  sanitizeInput, 
  isValidAddress,
  secureFetch 
} from '@/utils/security'

// Wrap function with rate limiting
const secureFunction = withRateLimit(myFunction, 'critical')

// Sanitize user input
const safe = sanitizeInput(userInput)

// Validate addresses
if (isValidAddress(address)) { /* ... */ }

// Secure fetch with retry
const response = await secureFetch(url, options)
```

## Integration Points

### App-Level Security

**Location**: `src/components/SecurityProvider.tsx`

Wraps the entire app to:
- Track wallet address for rate limiting
- Monitor for errors
- Initialize security systems

### Query Client

**Location**: `src/App.tsx`

React Query is configured with:
- Rate limiting on all queries
- No retry on rate limit errors
- Secure mutation handling

### Contract Interactions

**Location**: `src/utils/contracts.ts`

All contract calls:
- Check rate limits
- Validate addresses
- Use secure providers

## Configuration

### Environment Variables

Add to `.env`:

```env
# Sovereign Nodes (optional but recommended)
VITE_SOVEREIGN_NODE_1=https://node1.aegis.example.com
VITE_SOVEREIGN_NODE_2=https://node2.aegis.example.com
VITE_SOVEREIGN_NODE_3=https://node3.aegis.example.com
```

### Rate Limit Tuning

Adjust in `src/utils/rateLimiter.ts`:

```typescript
export const rateLimiters = {
  api: new RateLimiter({
    maxRequests: 100,      // Adjust as needed
    windowMs: 60000,       // 1 minute
    blockDurationMs: 300000, // 5 minutes
  }),
  // ... other limiters
}
```

## Monitoring

### Security Status

Check security status in browser console:

```typescript
import { getSecurityStatus } from '@/utils/security'
console.log(getSecurityStatus())
```

### Gateway Health

Monitor gateway health:

```typescript
import { gatewayManager } from '@/utils/arweaveGateway'
const healthy = gatewayManager.getHealthyGateways()
```

### Node Status

Check sovereign node status:

```typescript
import { getSovereignNodeStatus } from '@/utils/sovereignNode'
const status = getSovereignNodeStatus()
```

## Best Practices

1. **Always use rate limiting** for user-initiated actions
2. **Use sovereign nodes** for critical operations (governance, transactions)
3. **Validate all inputs** before processing
4. **Use secure fetch** for external requests
5. **Monitor security status** in production

## Attack Mitigation

### DDoS Protection

- **Rate limiting** prevents individual attackers
- **Gateway fallback** ensures availability
- **Sovereign nodes** provide protected endpoints

### Abuse Prevention

- **Request throttling** prevents rapid repeated calls
- **Session tracking** identifies repeat offenders
- **Block duration** temporarily blocks abusers

### Input Validation

- **Sanitization** removes dangerous characters
- **Format validation** ensures correct data types
- **Attack detection** flags suspicious patterns

## Limitations

1. **Client-side only**: Rate limiting is enforced in the browser
2. **Can be bypassed**: Determined attackers can modify client code
3. **No server-side protection**: All protection is client-side
4. **Session-based**: Uses session storage, not persistent

## Recommendations

1. **Deploy sovereign nodes** with their own DDoS protection
2. **Monitor gateway health** and adjust priorities
3. **Tune rate limits** based on usage patterns
4. **Add server-side validation** for critical operations (if possible)
5. **Implement CAPTCHA** for sensitive operations (if needed)

## Testing

Test security features:

```typescript
// Test rate limiting
import { rateLimiters } from '@/utils/rateLimiter'
const key = 'test-key'
for (let i = 0; i < 150; i++) {
  const allowed = rateLimiters.api.isAllowed(key)
  console.log(`Request ${i}: ${allowed ? 'allowed' : 'blocked'}`)
}

// Test gateway fallback
import { fetchFromArweave } from '@/utils/arweaveGateway'
try {
  const response = await fetchFromArweave('test-tx-id')
  console.log('Gateway fallback working')
} catch (error) {
  console.error('All gateways failed:', error)
}
```

---

**Last Updated**: 2025-11-15  
**Status**: ✅ Active security measures implemented

