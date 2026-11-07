import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import {
  MANIFEST_JSON_SCHEMA,
  PLUGIN_PERMISSIONS,
  canonicalJson,
  compareVersions,
  generateSigningKeys,
  hmacHeaders,
  isSafeEntryPath,
  satisfiesRange,
  signObject,
  validateManifest,
  validatePackage,
  verifyHmac,
  verifyIndex,
  verifyObject,
  keyId,
  type PackageEntry,
  type SignedIndex,
} from '../shared/index.ts'
import { readFolder } from '../lib/folder.ts'
import { readZip, writeZip } from '../lib/zip.ts'
import { examplePath, manifestFor } from './helpers.ts'

const enc = new TextEncoder()
const entry = (path: string, content: string | object): PackageEntry => {
  const bytes = enc.encode(typeof content === 'string' ? content : JSON.stringify(content))
  return { path, size: bytes.length, read: () => bytes }
}
const chatPreset = { type: 'chat', name: 'Coach', backends: ['llamaCPP'] }

describe('semver', () => {
  it('orders numerically and puts pre-releases first', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0)
  })

  it('evaluates engine ranges', () => {
    expect(satisfiesRange('3.2.1', '>=3.2.0')).toBe(true)
    expect(satisfiesRange('4.0.0', '^3.2.0')).toBe(false)
    expect(satisfiesRange('3.2.9', '~3.2.0')).toBe(true)
    expect(satisfiesRange('3.3.0', '~3.2.0')).toBe(false)
    expect(satisfiesRange('2.0.0', '>=3.0.0 || 2.0.0')).toBe(true)
  })
})

describe('signing', () => {
  const keys = generateSigningKeys()

  it('signs canonical JSON regardless of key order', () => {
    const signature = signObject({ b: 1, a: [2, { d: 1, c: 2 }] }, keys.privateKeyPem)
    expect(verifyObject({ a: [2, { c: 2, d: 1 }], b: 1 }, signature, keys.publicKeyPem)).toBe(true)
    expect(canonicalJson({ b: 1, a: 1 })).toBe('{"a":1,"b":1}')
  })

  it('detects tampering and wrong keys', () => {
    const signature = signObject({ version: '1.0.0' }, keys.privateKeyPem)
    expect(verifyObject({ version: '1.0.1' }, signature, keys.publicKeyPem)).toBe(false)
    expect(verifyObject({ version: '1.0.0' }, signature, generateSigningKeys().publicKeyPem)).toBe(
      false,
    )
    expect(verifyObject({ version: '1.0.0' }, 'not-base64!', keys.publicKeyPem)).toBe(false)
  })

  it('verifies an index and refuses one older than already seen', () => {
    const index = {
      formatVersion: 1 as const,
      generatedAt: 'x',
      seq: 5,
      keyId: keyId(keys.publicKeyPem),
      plugins: [],
      revoked: [],
    }
    const signed: SignedIndex = { index, signature: signObject(index, keys.privateKeyPem) }
    expect(verifyIndex(signed, keys.publicKeyPem)).toEqual({ ok: true })
    expect(verifyIndex(signed, keys.publicKeyPem, 6).ok).toBe(false)
    expect(verifyIndex({ ...signed, index: { ...index, seq: 9 } }, keys.publicKeyPem).ok).toBe(
      false,
    )
  })

  it('checks HMAC body, path and clock skew', () => {
    const headers = hmacHeaders('m1', 'secret', 'POST', '/v1/replicate', 'body', 1_000_000)
    const ts = headers['x-aipg-timestamp']
    const sig = headers['x-aipg-signature']
    expect(verifyHmac('secret', 'POST', '/v1/replicate', 'body', ts, sig, 1_000_000)).toBe(true)
    expect(verifyHmac('secret', 'POST', '/v1/replicate', 'BODY', ts, sig, 1_000_000)).toBe(false)
    expect(verifyHmac('secret', 'POST', '/v1/other', 'body', ts, sig, 1_000_000)).toBe(false)
    expect(verifyHmac('wrong', 'POST', '/v1/replicate', 'body', ts, sig, 1_000_000)).toBe(false)
    expect(
      verifyHmac('secret', 'POST', '/v1/replicate', 'body', ts, sig, 1_000_000 + 6 * 60_000),
    ).toBe(false)
  })
})

describe('validateManifest', () => {
  it('accepts the example manifests', () => {
    expect(validateManifest(manifestFor('writing-coach')).ok).toBe(true)
    expect(validateManifest(manifestFor('upscale-workflow')).ok).toBe(true)
  })

  it('reports every broken field with its path', () => {
    const result = validateManifest({
      manifestVersion: 2,
      id: 'Bad Id',
      version: '1',
      engines: {},
      permissions: ['root'],
      contributes: { mcpServers: [] },
    })
    expect(result.ok).toBe(false)
    const paths = result.issues.map((i) => i.path)
    for (const p of [
      'manifestVersion',
      'id',
      'name',
      'version',
      'engines.aipg',
      'category',
      'permissions',
      'contributes.mcpServers',
      'contributes.presets',
    ]) {
      expect(paths).toContain(p)
    }
  })
})

describe('validatePackage', () => {
  const manifest = { ...manifestFor('writing-coach'), id: 'acme.coach' }
  const base = () => [
    entry('aipg-plugin.json', manifest),
    entry('presets/coach.json', chatPreset),
    entry('README.md', '# Coach'),
  ]

  it('accepts a minimal valid package', () => {
    const report = validatePackage(base(), { publisherId: 'acme', enforcePolicy: true })
    expect(report.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(report.presets).toEqual([{ path: 'presets/coach.json', name: 'Coach', type: 'chat' }])
    expect(report.readme).toBe('# Coach')
  })

  it.each([
    ['../evil.json', 'package/unsafe-path'],
    ['/etc/passwd', 'package/unsafe-path'],
    ['presets\\win.json', 'package/unsafe-path'],
    ['model.safetensors', 'package/model-weights'],
    ['run.exe', 'package/file-type'],
    ['script.js', 'package/file-type'],
  ])('rejects %s', (path, code) => {
    const report = validatePackage([...base(), entry(path, 'x')])
    expect(report.ok).toBe(false)
    expect(report.issues.map((i) => i.code)).toContain(code)
  })

  it('enforces namespace, version order and category policy', () => {
    const codes = (
      opts: Parameters<typeof validatePackage>[1],
      m: Record<string, unknown> = manifest,
    ) =>
      validatePackage(
        [entry('aipg-plugin.json', m), entry('presets/coach.json', chatPreset)],
        opts,
      ).issues.map((i) => i.code)
    expect(codes({ publisherId: 'other' })).toContain('policy/namespace')
    expect(codes({ latestVersion: '1.0.0' })).toContain('policy/version')
    expect(codes({ enforcePolicy: true }, { ...manifest, category: 'themes' })).toContain(
      'policy/category',
    )
  })

  it('requires the permissions a preset actually needs', () => {
    const comfy = {
      type: 'comfy',
      name: 'Up',
      backend: 'comfyui',
      comfyUiApiWorkflow: { '1': { class_type: 'X', inputs: {} } },
      requiredModels: [{ type: 'upscale', model: 'a/b/c.safetensors' }],
      requiredCustomNodes: ['owner/repo@' + 'a'.repeat(40)],
    }
    const report = validatePackage([
      entry('aipg-plugin.json', manifest),
      entry('presets/up.json', comfy),
    ])
    const missing = report.issues
      .filter((i) => i.code === 'permissions/missing')
      .map((i) => i.message)
    expect(missing.join(' ')).toContain('"models"')
    expect(missing.join(' ')).toContain('"shell"')
  })

  it('rejects unpinned custom nodes and MCP capabilities', () => {
    const comfy = {
      type: 'comfy',
      name: 'Up',
      backend: 'comfyui',
      comfyUiApiWorkflow: { '1': {} },
      requiredCustomNodes: ['owner/repo'],
    }
    const agent = {
      ...chatPreset,
      name: 'Agent',
      agentPreset: true,
      agentCapabilities: ['mcp:github'],
    }
    const codes = validatePackage([
      entry('aipg-plugin.json', { ...manifest, permissions: ['shell'] }),
      entry('presets/up.json', comfy),
      entry('presets/agent.json', agent),
    ]).issues.map((i) => i.code)
    expect(codes).toContain('preset/custom-nodes')
    expect(codes).toContain('preset/mcp-capability')
  })

  it('accepts both example plugin folders under policy', () => {
    for (const name of ['writing-coach', 'upscale-workflow']) {
      const report = validatePackage(readFolder(examplePath(name)), {
        publisherId: 'aipg',
        enforcePolicy: true,
      })
      expect(report.ok, JSON.stringify(report.issues)).toBe(true)
    }
  })

  it('treats paths safely', () => {
    expect(isSafeEntryPath('presets/a.json')).toBe(true)
    for (const p of ['', 'a/../b', './a', 'a//b', 'C:/x', 'a\0b'])
      expect(isSafeEntryPath(p)).toBe(false)
  })
})

describe('zip', () => {
  it('round-trips and produces identical bytes for identical input', () => {
    const files = [
      { path: 'b.json', data: enc.encode('{}') },
      { path: 'a/x.md', data: enc.encode('# x') },
    ]
    const one = writeZip(files)
    expect(writeZip([...files].reverse())).toEqual(one)
    const read = readZip(one)
    if ('error' in read) throw new Error(read.error)
    expect(read.entries.map((e) => e.path).sort()).toEqual(['a/x.md', 'b.json'])
  })

  it('stops decompressing a zip bomb at the size limit', () => {
    const bomb = zipSync({ 'big.txt': [new Uint8Array(30 * 1024 * 1024), { level: 9 }] })
    expect(bomb.length).toBeLessThan(200_000)
    const read = readZip(bomb)
    expect('error' in read && read.error).toMatch(/more than/)
  })

  it('rejects garbage', () => {
    expect('error' in readZip(enc.encode('not a zip'))).toBe(true)
  })
})

describe('JSON Schema', () => {
  it('lists the same permissions and required keys the validator enforces', () => {
    expect(MANIFEST_JSON_SCHEMA.properties.permissions.items.enum).toEqual([...PLUGIN_PERMISSIONS])
    const result = validateManifest({})
    const requiredByValidator = new Set(result.issues.map((i) => i.path?.split('.')[0]))
    for (const key of MANIFEST_JSON_SCHEMA.required) expect(requiredByValidator.has(key)).toBe(true)
  })
})
