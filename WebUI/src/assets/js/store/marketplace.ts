import { acceptHMRUpdate, defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { filterCatalog, hasUpdate } from '@/assets/js/marketplace/catalog'
import {
  SAMPLE_CATALOG,
  SAMPLE_INSTALLED,
  SAMPLE_SUBMISSIONS,
} from '@/assets/js/marketplace/sampleCatalog'
import type {
  InstalledPlugin,
  MarketplaceFilters,
  MarketplaceView,
  PluginListing,
  PluginSubmission,
  PluginSubmissionDraft,
} from '@/assets/js/marketplace/types'

// UI-only preview: installs, updates and uploads are simulated in memory until the
// registry and the main-process installer exist (docs/marketplace-plan.md).
const SIMULATED_INSTALL_MS = 1200

export const useMarketplace = defineStore('marketplace', () => {
  const catalog = ref<PluginListing[]>(SAMPLE_CATALOG)
  const installed = ref<Record<string, InstalledPlugin>>(
    Object.fromEntries(SAMPLE_INSTALLED.map((plugin) => [plugin.id, { ...plugin }])),
  )
  const submissions = ref<PluginSubmission[]>(SAMPLE_SUBMISSIONS.map((s) => ({ ...s })))

  const view = ref<MarketplaceView>('discover')
  const filters = ref<MarketplaceFilters>({
    search: '',
    category: 'all',
    trust: 'all',
    sort: 'popular',
  })
  const selectedId = ref<string | null>(null)
  /** Install/update progress per plugin id, 0–1. */
  const busy = ref<Record<string, number>>({})
  const pendingConsentId = ref<string | null>(null)

  const visible = computed(() =>
    filterCatalog(catalog.value, installed.value, view.value, filters.value),
  )

  const selected = computed(
    () => catalog.value.find((listing) => listing.id === selectedId.value) ?? null,
  )

  const pendingConsent = computed(
    () => catalog.value.find((listing) => listing.id === pendingConsentId.value) ?? null,
  )

  const installedCount = computed(() => Object.keys(installed.value).length)

  const updateCount = computed(
    () => catalog.value.filter((listing) => hasUpdate(listing, installed.value[listing.id])).length,
  )

  function setView(next: MarketplaceView) {
    view.value = next
    if (next !== 'publish') selectedId.value = visible.value[0]?.id ?? null
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
    const listing = catalog.value.find((l) => l.id === id)
    if (!listing) return
    if (listing.trust === 'community' || listing.permissions.length > 0) {
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

  async function runInstall(listing: PluginListing) {
    if (busy.value[listing.id] !== undefined) return
    busy.value = { ...busy.value, [listing.id]: 0 }
    const steps = 10
    for (let step = 1; step <= steps; step++) {
      await new Promise((resolve) => setTimeout(resolve, SIMULATED_INSTALL_MS / steps))
      busy.value = { ...busy.value, [listing.id]: step / steps }
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
    const { [listing.id]: _done, ...rest } = busy.value
    busy.value = rest
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

  function uninstall(id: string) {
    const { [id]: _removed, ...rest } = installed.value
    installed.value = rest
  }

  function setEnabled(id: string, enabled: boolean) {
    const plugin = installed.value[id]
    if (!plugin) return
    installed.value = { ...installed.value, [id]: { ...plugin, enabled } }
  }

  function submit(draft: PluginSubmissionDraft) {
    submissions.value = [
      { ...draft, submittedAt: new Date().toISOString().slice(0, 10), status: 'in-review' },
      ...submissions.value.filter((s) => s.id !== draft.id),
    ]
  }

  return {
    catalog,
    installed,
    submissions,
    view,
    filters,
    selectedId,
    selected,
    busy,
    visible,
    pendingConsent,
    installedCount,
    updateCount,
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
    submit,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useMarketplace, import.meta.hot))
}
