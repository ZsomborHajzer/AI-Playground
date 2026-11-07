import fs from 'node:fs'
import path from 'node:path'
import { generateSigningKeys, keyId } from '../shared/index.ts'

export type SigningKeys = { privateKeyPem: string; publicKeyPem: string; keyId: string }

/** Loads the master signing key, creating it on first start. Back up data/keys/. */
export function loadOrCreateKeys(dataDir: string): SigningKeys {
  const dir = path.join(dataDir, 'keys')
  const privatePath = path.join(dir, 'master-ed25519.pem')
  const publicPath = path.join(dir, 'master-ed25519.pub.pem')
  if (!fs.existsSync(privatePath)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const keys = generateSigningKeys()
    fs.writeFileSync(privatePath, keys.privateKeyPem, { mode: 0o600 })
    fs.writeFileSync(publicPath, keys.publicKeyPem)
  }
  const privateKeyPem = fs.readFileSync(privatePath, 'utf8')
  const publicKeyPem = fs.readFileSync(publicPath, 'utf8')
  return { privateKeyPem, publicKeyPem, keyId: keyId(publicKeyPem) }
}
