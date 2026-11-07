// Installed plugins: install (verified marketplace packages, or a local package for
// authors), update with the previous version kept for rollback, enable/disable,
// uninstall, revocation, and the preset files enabled plugins contribute.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  PLUGIN_ID_PATTERN,
  isRevoked,
  satisfiesRange,
  sha256Hex,
  validatePackage,
  type CatalogIndex,
  type PackageEntry,
  type PackageReport,
  type TrustTier,
} from '@marketplace-shared'
import type {
  InstalledPluginWire,
  MarketplaceCatalog,
  MarketplaceListingWire,
  PackageInspection,
  PublisherInfo,
  SubmissionWire,
} from '@/types/marketplaceIpc'
import {
  downloadVerifiedPackage,
  fetchPublisher,
  fetchSubmissions,
  fetchVerifiedCatalog,
  uploadPackage,
  type MarketplaceServers,
} from '../adapters/marketplace/registryClient'
import { readPresetsFromDir, type PresetFile } from '../artifact/catalog'
import {
  pluginVersionDir,
  readPluginState,
  writePluginState,
  type InstalledRecord,
  type PluginState,
} from '../persist/pluginFiles'
import { entriesFromPath, entriesFromZip, writeEntries, zipEntries } from './packageIO'

export type PublisherTokenStore = { read(): string | null; write(token: string | null): void }

export type PluginHostDeps = {
  root: string
  appVersion: string
  servers: () => MarketplaceServers | null
  tokens: PublisherTokenStore
  log: { info(message: string): void; warn(message: string): void }
  fetchImpl?: typeof fetch
}

export type PluginHost = ReturnType<typeof createPluginHost>

type PluginError = Error & { issues?: PackageReport['issues'] }

function failure(message: string, issues?: PackageReport['issues']): PluginError {
  return Object.assign(new Error(message), { issues })
}

/** Ids arrive over IPC and become folder names, so anything else is refused before touching disk. */
function assertPluginId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !PLUGIN_ID_PATTERN.test(id)) throw failure('Invalid plugin id')
}

export function createPluginHost(deps: PluginHostDeps) {
  const listeners = new Set<() => void>()
  let lastCatalog: { mirror: string; index: CatalogIndex } | undefined
  let writes: Promise<unknown> = Promise.resolve()

  /** One state mutation at a time, so two installs never lose each other's record. */
  function mutate<T>(work: (state: PluginState) => Promise<T>): Promise<T> {
    const run = writes.then(async () => {
      const state = await readPluginState(deps.root)
      const result = await work(state)
      await writePluginState(deps.root, state)
      return result
    })
    writes = run.catch(() => undefined)
    return run
  }

  const notify = () => listeners.forEach((listener) => listener())

  const toWire = (r: InstalledRecord): InstalledPluginWire => ({
    id: r.id,
    version: r.version,
    name: r.name,
    enabled: r.enabled,
    trust: r.trust,
    permissions: r.permissions,
    presetNames: r.presetNames,
    installedAt: r.installedAt,
    revoked: r.revoked,
  })

  // ── catalog ──────────────────────────────────────────────────────────────

  async function getCatalog(): Promise<MarketplaceCatalog> {
    const servers = deps.servers()
    if (!servers) return { configured: false, listings: [] }
    const state = await readPluginState(deps.root)
    let catalog
    try {
      catalog = await fetchVerifiedCatalog(servers, state.lastSeq, deps.fetchImpl)
    } catch (e) {
      deps.log.warn(`marketplace catalog unavailable: ${(e as Error).message}`)
      return {
        configured: true,
        masterUrl: servers.masterUrl,
        listings: [],
        error: (e as Error).message,
      }
    }
    lastCatalog = catalog
    await applyRevocations(catalog.index)
    const listings: MarketplaceListingWire[] = catalog.index.plugins.map(({ latest, versions }) => {
      const r = latest.release
      return {
        id: r.id,
        name: r.manifest.name,
        version: r.version,
        description: r.manifest.description,
        publisher: r.publisher,
        trust: r.trust,
        category: r.manifest.category,
        tags: r.manifest.tags ?? [],
        permissions: r.manifest.permissions,
        license: r.manifest.license,
        repository: r.manifest.repository,
        readme: r.readme,
        changelog: r.changelog,
        sizeBytes: r.size,
        publishedAt: r.publishedAt,
        engines: r.manifest.engines.aipg,
        compatible: satisfiesRange(deps.appVersion, r.manifest.engines.aipg),
        versions,
        downloads: catalog.downloads[r.id] ?? 0,
      }
    })
    return {
      configured: true,
      mirror: catalog.mirror,
      masterUrl: servers.masterUrl,
      seq: catalog.index.seq,
      listings,
    }
  }

  async function applyRevocations(index: CatalogIndex) {
    let changed = false
    await mutate(async (state) => {
      state.lastSeq = Math.max(state.lastSeq, index.seq)
      for (const record of Object.values(state.plugins)) {
        if (record.trust === 'local' || record.revoked) continue
        const revocation = isRevoked(index, record.id, record.version)
        if (revocation) {
          record.revoked = { reason: revocation.reason }
          record.enabled = false
          changed = true
          deps.log.warn(`plugin ${record.id}@${record.version} was revoked: ${revocation.reason}`)
        }
      }
    })
    if (changed) notify()
  }

  // ── install ──────────────────────────────────────────────────────────────

  async function installEntries(
    entries: PackageEntry[],
    source: {
      trust: TrustTier | 'local'
      sha256?: string
      expect?: { id: string; version: string }
    },
  ): Promise<InstalledPluginWire> {
    const report = validatePackage(entries)
    if (!report.ok || !report.manifest) {
      throw failure('This package does not pass validation', report.issues)
    }
    const manifest = report.manifest
    if (
      source.expect &&
      (manifest.id !== source.expect.id || manifest.version !== source.expect.version)
    ) {
      throw failure('The package contents do not match the signed release')
    }
    if (!satisfiesRange(deps.appVersion, manifest.engines.aipg)) {
      throw failure(
        `${manifest.name} needs AI Playground ${manifest.engines.aipg}; this is ${deps.appVersion}`,
      )
    }

    const record = await mutate(async (state) => {
      const staging = path.join(deps.root, `.staging-${randomBytes(6).toString('hex')}`)
      const target = pluginVersionDir(deps.root, manifest.id, manifest.version)
      try {
        writeEntries(entries, staging)
        fs.rmSync(target, { recursive: true, force: true })
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.renameSync(staging, target)
      } finally {
        fs.rmSync(staging, { recursive: true, force: true })
      }
      const previous = state.plugins[manifest.id]
      const previousVersion =
        previous && previous.version !== manifest.version
          ? previous.version
          : previous?.previousVersion
      const next: InstalledRecord = {
        id: manifest.id,
        version: manifest.version,
        name: manifest.name,
        enabled: previous?.enabled ?? true,
        trust: source.trust,
        permissions: manifest.permissions,
        presetFiles: report.presets.map((p) => p.path),
        presetNames: report.presets.map((p) => p.name),
        installedAt: new Date().toISOString(),
        sha256: source.sha256,
        previousVersion,
      }
      if (previous?.revoked && previous.version !== manifest.version) next.enabled = true
      state.plugins[manifest.id] = next
      pruneVersions(manifest.id, [next.version, next.previousVersion])
      return next
    })
    deps.log.info(`installed plugin ${record.id}@${record.version} (${record.trust})`)
    notify()
    return toWire(record)
  }

  function pruneVersions(id: string, keep: (string | undefined)[]) {
    const dir = path.join(deps.root, id)
    if (!fs.existsSync(dir)) return
    for (const version of fs.readdirSync(dir)) {
      if (!keep.includes(version))
        fs.rmSync(path.join(dir, version), { recursive: true, force: true })
    }
  }

  async function install(id: string): Promise<InstalledPluginWire> {
    assertPluginId(id)
    const servers = deps.servers()
    if (!servers) throw failure('No marketplace server is configured')
    if (!lastCatalog?.index.plugins.some((p) => p.latest.release.id === id)) await getCatalog()
    const entry = lastCatalog?.index.plugins.find((p) => p.latest.release.id === id)
    if (!entry) throw failure(`${id} is not in the marketplace catalog`)
    const release = entry.latest
    const bytes = await downloadVerifiedPackage(
      servers,
      release,
      lastCatalog?.mirror,
      deps.fetchImpl,
    )
    return installEntries(entriesFromZip(bytes), {
      trust: release.release.trust,
      sha256: release.release.sha256,
      expect: { id, version: release.release.version },
    })
  }

  function installFromPath(target: string): Promise<InstalledPluginWire> {
    return installEntries(entriesFromPath(target), { trust: 'local' })
  }

  async function uninstall(id: string) {
    assertPluginId(id)
    await mutate(async (state) => {
      delete state.plugins[id]
      fs.rmSync(path.join(deps.root, id), { recursive: true, force: true })
    })
    notify()
  }

  async function setEnabled(id: string, enabled: boolean) {
    assertPluginId(id)
    await mutate(async (state) => {
      const record = state.plugins[id]
      if (!record) throw failure(`${id} is not installed`)
      if (enabled && record.revoked) throw failure(`${id} was revoked: ${record.revoked.reason}`)
      record.enabled = enabled
    })
    notify()
  }

  async function listInstalled(): Promise<InstalledPluginWire[]> {
    const state = await readPluginState(deps.root)
    return Object.values(state.plugins).map(toWire)
  }

  // ── presets contributed by enabled plugins ───────────────────────────────

  /**
   * Preset files of every enabled, unrevoked plugin. A preset whose name is already
   * taken (built-in, the user's own, or an earlier plugin) is skipped, not shadowed.
   */
  async function presetFiles(reservedNames: Set<string>): Promise<PresetFile[]> {
    const state = await readPluginState(deps.root)
    const taken = new Set(reservedNames)
    const result: PresetFile[] = []
    for (const record of Object.values(state.plugins).sort((a, b) => a.id.localeCompare(b.id))) {
      if (!record.enabled || record.revoked) continue
      const base = pluginVersionDir(deps.root, record.id, record.version)
      const byDir = new Map<string, Set<string>>()
      for (const rel of record.presetFiles) {
        const file = path.join(base, ...rel.split('/'))
        const dir = path.dirname(file)
        byDir.set(dir, (byDir.get(dir) ?? new Set()).add(path.basename(file, '.json')))
      }
      for (const [dir, names] of byDir) {
        const files = await readPresetsFromDir(dir)
        for (const [baseName, file] of files) {
          if (!names.has(baseName)) continue
          let name = ''
          try {
            name = (JSON.parse(file.content) as { name?: string }).name ?? ''
          } catch {
            continue
          }
          if (taken.has(name)) {
            deps.log.warn(
              `plugin ${record.id}: preset "${name}" skipped, the name is already in use`,
            )
            continue
          }
          taken.add(name)
          result.push(file)
        }
      }
    }
    return result
  }

  // ── publishing ───────────────────────────────────────────────────────────

  function inspect(target: string): PackageInspection {
    try {
      const report = validatePackage(entriesFromPath(target), { enforcePolicy: true })
      return {
        ok: report.ok,
        manifest: report.manifest && {
          id: report.manifest.id,
          name: report.manifest.name,
          version: report.manifest.version,
          category: report.manifest.category,
        },
        presets: report.presets.map((p) => ({ name: p.name, type: p.type })),
        issues: report.issues,
      }
    } catch (e) {
      return {
        ok: false,
        presets: [],
        issues: [{ level: 'error', code: 'package/unreadable', message: (e as Error).message }],
      }
    }
  }

  function requireToken(): { servers: MarketplaceServers; token: string } {
    const servers = deps.servers()
    if (!servers?.masterUrl) throw failure('No master server is configured for publishing')
    const token = deps.tokens.read()
    if (!token) throw failure('Add your publisher token first')
    return { servers, token }
  }

  async function publish(target: string): Promise<SubmissionWire> {
    const { servers, token } = requireToken()
    const isFolder = fs.statSync(target).isDirectory()
    const bytes = isFolder
      ? zipEntries(entriesFromPath(target))
      : new Uint8Array(fs.readFileSync(target))
    const fileName = isFolder ? `${path.basename(target)}.aipgx` : path.basename(target)
    const result = await uploadPackage(servers, token, bytes, fileName, deps.fetchImpl)
    if (!result.ok)
      throw failure(
        result.body.error ?? `Upload failed (HTTP ${result.status})`,
        result.body.issues,
      )
    deps.log.info(`published ${fileName} (${sha256Hex(bytes).slice(0, 12)}) for review`)
    return result.body
  }

  async function mySubmissions(): Promise<SubmissionWire[]> {
    const { servers, token } = requireToken()
    return fetchSubmissions(servers, token, deps.fetchImpl)
  }

  async function setPublisherToken(token: string): Promise<PublisherInfo | null> {
    const trimmed = token.trim()
    if (!trimmed) {
      deps.tokens.write(null)
      return null
    }
    const servers = deps.servers()
    if (!servers?.masterUrl) throw failure('No master server is configured for publishing')
    const publisher = await fetchPublisher(servers, trimmed, deps.fetchImpl)
    deps.tokens.write(trimmed)
    return publisher
  }

  async function getPublisher(): Promise<PublisherInfo | null> {
    const servers = deps.servers()
    const token = deps.tokens.read()
    if (!servers?.masterUrl || !token) return null
    try {
      return await fetchPublisher(servers, token, deps.fetchImpl)
    } catch {
      return null
    }
  }

  return {
    getCatalog,
    listInstalled,
    install,
    installFromPath,
    uninstall,
    setEnabled,
    presetFiles,
    inspect,
    publish,
    mySubmissions,
    setPublisherToken,
    getPublisher,
    onChange: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function issuesOf(error: unknown): PackageReport['issues'] | undefined {
  return (error as PluginError | undefined)?.issues
}
