// Ed25519 signatures over canonical JSON, and HMAC for server-to-server calls.
// Only node:crypto, so the app's main process can import this unchanged.
import {
  createHash,
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto'

/** JSON with object keys sorted at every level, so a signature does not depend on key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = sortKeys(v)
    }
    return out
  }
  return value
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export function generateSigningKeys(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

/** Short, stable identifier of a public key, shown in admin pages and carried in signed data. */
export function keyId(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })
  return sha256Hex(der).slice(0, 16)
}

export function signObject(value: unknown, privateKeyPem: string): string {
  return sign(null, Buffer.from(canonicalJson(value)), privateKeyPem).toString('base64')
}

export function verifyObject(value: unknown, signature: string, publicKeyPem: string): boolean {
  try {
    return verify(
      null,
      Buffer.from(canonicalJson(value)),
      publicKeyPem,
      Buffer.from(signature, 'base64'),
    )
  } catch {
    return false
  }
}

export const HMAC_HEADERS = {
  mirror: 'x-aipg-mirror',
  timestamp: 'x-aipg-timestamp',
  signature: 'x-aipg-signature',
} as const

const HMAC_MAX_SKEW_MS = 5 * 60 * 1000

function hmacPayload(method: string, path: string, timestamp: string, body: Uint8Array | string) {
  return `${timestamp}\n${method.toUpperCase()}\n${path}\n${sha256Hex(body)}`
}

/** Headers for a request between master and a mirror, both holding the mirror's secret. */
export function hmacHeaders(
  mirrorId: string,
  secret: string,
  method: string,
  path: string,
  body: Uint8Array | string = '',
  now = Date.now(),
): Record<string, string> {
  const timestamp = String(now)
  const signature = createHmac('sha256', secret)
    .update(hmacPayload(method, path, timestamp, body))
    .digest('hex')
  return {
    [HMAC_HEADERS.mirror]: mirrorId,
    [HMAC_HEADERS.timestamp]: timestamp,
    [HMAC_HEADERS.signature]: signature,
  }
}

export function verifyHmac(
  secret: string,
  method: string,
  path: string,
  body: Uint8Array | string,
  timestamp: string | undefined,
  signature: string | undefined,
  now = Date.now(),
): boolean {
  if (!timestamp || !signature) return false
  if (Math.abs(now - Number(timestamp)) > HMAC_MAX_SKEW_MS) return false
  const expected = createHmac('sha256', secret)
    .update(hmacPayload(method, path, timestamp, body))
    .digest()
  const given = Buffer.from(signature, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}
