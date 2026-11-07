import { acceptHMRUpdate, defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { usePresets } from '@/assets/js/store/presets'
import { useErrors } from '@/assets/js/store/errors'
import { useI18N } from '@/assets/js/store/i18n'
import { createAppError } from '@/assets/js/errors/appError'
import { filterCatalog, hasUpdate } from '@/assets/js/marketplace/catalog'
import { SAMPLE_CATALOG, SAMPLE_INSTALLED } from '@/assets/js/marketplace/sampleCatalog'
import {
  installedFromWire,
  listingFromInstalled,
  listingFromWire,
} from '@/assets/js/marketplace/remote'
import type {
  InstalledPlugin,
  MarketplaceFilters,
  MarketplaceView,
  PluginListing,
} from '@/assets/js/marketplace/types'
import type {
  InstalledPluginWire,
  PackageInspection,
  PublisherInfo,
  SubmissionWire,
} from '@/types/marketplaceIpc'
import * as toast from '@/assets/js/toast'

// Without configured servers (external/marketplace.json) the marketplace shows
// sample listings and simulates installs, so the UI can still be explored.
const SIMULATED_INSTALL_MS = 1200

type Mode = 'loading' | 'sample' | 'remote'

export const useMarketplace = defineStore('marketplace', () => {
  const presets = usePresets()
  const errors = useErrors()
  const i18nState = useI18N().state

  const mode = ref<Mode>('loading')
  const catalogError = ref<string | null>(null)
  const catalog = ref<PluginListing[]>([])
  const installedWire = ref<InstalledPluginWire[]>([])
  const installed = ref<Record<string, InstalledPlugin>>({})

  const view = ref<MarketplaceView>('discover')
  const filters = ref<MarketplaceFilters>({
    search: '',
    category: 'all',
    trust: 'all',
    sort: 'popular',
  })
  const selectedId = ref<string | null>(null)
  /** Install progress per plugin id: 0–1 for simulated installs, -1 while a real one runs. */
  const busy = ref<Record<string, number>>({})
  const pendingConsentId = ref<string | null>(null)

  const publisher = ref<PublisherInfo | null>(null)
  const submissions = ref<SubmissionWire[]>([])
  const publishing = ref(false)

  const api = () => window.electronAPI?.marketplace

  /** Catalog entries plus installed plugins the catalog does not list (local or revoked). */
  const listings = computed(() => {
    const known = new Set(catalog.value.map((l) => l.id))
    return [
      ...catalog.value,
      ...installedWire.value.filter((w) => !known.has(w.id)).map(listingFromInstalled),
    ]
  })

  const visible = computed(() =>
    filterCatalog(listings.value, installed.value, view.value, filters.value),
  )

  const selected = computed(
    () => listings.value.find((listing) => listing.id === selectedId.value) ?? null,
  )

  const pendingConsent = computed(
    () => listings.value.find((listing) => listing.id === pendingConsentId.value) ?? null,
  )

  const installedCount = computed(() => Object.keys(installed.value).length)

  const updateCount = computed(
    () => catalog.value.filter((listing) => hasUpdate(listing, installed.value[listing.id])).length,
  )

  function report(code: string, userMessage: string, cause?: unknown) {
    errors.report(
      createAppError({ code, category: 'setup', severity: 'error', userMessage, cause }),
    )
  }

  function useSamples() {
    mode.value = 'sample'
    catalog.value = SAMPLE_CATALOG
    installed.value = Object.fromEntries(SAMPLE_INSTALLED.map((p) => [p.id, { ...p }]))
    installedWire.value = []
  }

  async function refreshInstalled() {
    const list = (await api()?.listInstalled()) ?? []
    installedWire.value = list
    installed.value = Object.fromEntries(list.map((w) => [w.id, installedFromWire(w)]))
  }

  async function refresh() {
    const marketplace = api()
    if (!marketplace) return useSamples()
    try {
      const result = await marketplace.getCatalog()
      if (!result.configured) return useSamples()
      mode.value = 'remote'
      catalogError.value = result.error ?? null
      catalog.value = result.listings.map(listingFromWire)
      await refreshInstalled()
      if (!selectedId.value) selectedId.value = visible.value[0]?.id ?? null
    } catch (e) {
      report('marketplace/catalog', i18nState.MARKETPLACE_ERROR_CATALOG, e)
    }
  }

  function setView(next: MarketplaceView) {
    view.value = next
    if (next !== 'publish') selectedId.value = visible.value[0]?.id ?? null
    if (next === 'publish' && mode.value === 'remote') void loadPublisher()
  }

  function setFilters(patch: Partial<MarketplaceFilters>) {
    filters.value = { ...filters.value, ...patch }
  }

  function select(id: string | null) {
    selectedId.value = id
  }

  function updateAvailable(id: string) {
    const listing = catalog.value.find((l) => l.id === id)
    return !!listing && hasUpdate(listing, installed.value[id])
  }

  // Community plugins and anything asking for permissions go through consent, so a
  // one-click install never grants more than a theme would.
  function requestInstall(id: string) {
    const listing = listings.value.find((l) => l.id === id)
    if (!listing) return
    if (listing.trust !== 'verified' || listing.permissions.length > 0) {
      pendingConsentId.value = id
      return
    }
    void runInstall(listing)
  }

  function confirmInstall() {
    const listing = pendingConsent.value
    pendingConsentId.value = null
    if (listing) void runInstall(listing)
  }

  function cancelInstall() {
    pendingConsentId.value = null
  }

  const setBusy = (id: string, value: number | undefined) => {
    const { [id]: _previous, ...rest } = busy.value
    busy.value = value === undefined ? rest : { ...rest, [id]: value }
  }

  async function simulateInstall(listing: PluginListing) {
    const steps = 10
    for (let step = 1; step <= steps; step++) {
      await new Promise((resolve) => setTimeout(resolve, SIMULATED_INSTALL_MS / steps))
      setBusy(listing.id, step / steps)
    }
    const previous = installed.value[listing.id]
    installed.value = {
      ...installed.value,
      [listing.id]: {
        id: listing.id,
        version: listing.version,
        enabled: previous?.enabled ?? true,
      },
    }
  }

  /** Presets of installed plugins are part of the preset list, so it reloads after any change. */
  async function afterPluginChange() {
    await refreshInstalled()
    await presets.reloadAfterProductModeChange()
  }

  async function runInstall(listing: PluginListing) {
    if (busy.value[listing.id] !== undefined) return
    setBusy(listing.id, mode.value === 'remote' ? -1 : 0)
    try {
      if (mode.value !== 'remote') return await simulateInstall(listing)
      const result = await api()!.install(listing.id)
      if (!result.success) {
        report('marketplace/install-failed', `${listing.name}: ${result.error}`)
        return
      }
      await afterPluginChange()
      toast.success(
        (i18nState.MARKETPLACE_INSTALLED_TOAST ?? '').replace('{name}', result.installed.name),
      )
    } catch (e) {
      report('marketplace/install-failed', `${listing.name}: ${String(e)}`, e)
    } finally {
      setBusy(listing.id, undefined)
    }
  }

  function update(id: string) {
    const listing = catalog.value.find((l) => l.id === id)
    if (listing) void runInstall(listing)
  }

  function updateAll() {
    catalog.value
      .filter((listing) => hasUpdate(listing, installed.value[listing.id]))
      .forEach((listing) => void runInstall(listing))
  }

  async function uninstall(id: string) {
    if (mode.value !== 'remote') {
      const { [id]: _removed, ...rest } = installed.value
      installed.value = rest
      return
    }
    const result = await api()!.uninstall(id)
    if (!result.success) return report('marketplace/uninstall-failed', result.error)
    await afterPluginChange()
  }

  async function setEnabled(id: string, enabled: boolean) {
    const plugin = installed.value[id]
    if (!plugin) return
    if (mode.value !== 'remote') {
      installed.value = { ...installed.value, [id]: { ...plugin, enabled } }
      return
    }
    const result = await api()!.setEnabled(id, enabled)
    if (!result.success) return report('marketplace/enable-failed', result.error)
    await afterPluginChange()
  }

  /** For plugin authors: install a package or folder from disk without publishing it. */
  async function installFromPath(target: string) {
    const result = await api()?.installFromPath(target)
    if (!result) return
    if (!result.success) {
      const details = result.issues
        ?.filter((i) => i.level === 'error')
        .map((i) => i.message)
        .join('; ')
      return report(
        'marketplace/local-install-failed',
        details ? `${result.error}: ${details}` : result.error,
      )
    }
    await afterPluginChange()
    selectedId.value = result.installed.id
    toast.success(
      (i18nState.MARKETPLACE_INSTALLED_TOAST ?? '').replace('{name}', result.installed.name),
    )
  }

  // ── publishing ───────────────────────────────────────────────────────────

  async function loadPublisher() {
    publisher.value = (await api()?.getPublisher()) ?? null
    if (publisher.value) await loadSubmissions()
  }

  async function setPublisherToken(token: string): Promise<boolean> {
    const result = await api()?.setPublisherToken(token)
    if (!result) return false
    if (!result.success) {
      report('marketplace/token-rejected', `${i18nState.MARKETPLACE_ERROR_TOKEN} ${result.error}`)
      return false
    }
    publisher.value = result.publisher
    submissions.value = []
    if (publisher.value) await loadSubmissions()
    return true
  }

  async function loadSubmissions() {
    const result = await api()?.mySubmissions()
    if (result?.success) submissions.value = result.submissions
  }

  async function inspect(target: string): Promise<PackageInspection | undefined> {
    return api()?.inspectPackage(target)
  }

  async function publish(target: string): Promise<SubmissionWire | undefined> {
    publishing.value = true
    try {
      const result = await api()?.publish(target)
      if (!result) return undefined
      if (!result.success) {
        const details = result.issues
          ?.filter((i) => i.level === 'error')
          .map((i) => i.message)
          .join('; ')
        report('marketplace/publish-failed', details ? `${result.error}: ${details}` : result.error)
        return undefined
      }
      await loadSubmissions()
      return result.submission
    } finally {
      publishing.value = false
    }
  }

  return {
    mode,
    catalogError,
    catalog,
    listings,
    installed,
    view,
    filters,
    selectedId,
    selected,
    busy,
    visible,
    pendingConsent,
    installedCount,
    updateCount,
    publisher,
    submissions,
    publishing,
    refresh,
    setView,
    setFilters,
    select,
    updateAvailable,
    requestInstall,
    confirmInstall,
    cancelInstall,
    update,
    updateAll,
    uninstall,
    setEnabled,
    installFromPath,
    loadPublisher,
    setPublisherToken,
    loadSubmissions,
    inspect,
    publish,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useMarketplace, import.meta.hot))
}
