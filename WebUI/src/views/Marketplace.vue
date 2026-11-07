<script setup lang="ts">
// Full-screen like the Model Manager: a list plus a detail pane needs the width.
import { computed, onMounted, ref, watch, type Component } from 'vue'
import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/vue/24/solid'
import { DocumentArrowUpIcon, FolderOpenIcon, Squares2X2Icon } from '@heroicons/vue/24/outline'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import DropDownNew from '@/components/DropDownNew.vue'
import PluginListItem from '@/components/marketplace/PluginListItem.vue'
import PluginDetail from '@/components/marketplace/PluginDetail.vue'
import PublishPanel from '@/components/marketplace/PublishPanel.vue'
import InstallConsentDialog from '@/components/marketplace/InstallConsentDialog.vue'
import { useMarketplace } from '@/assets/js/store/marketplace'
import { useI18N } from '@/assets/js/store/i18n'
import {
  CATEGORY_ICONS,
  CATEGORY_LABEL_KEYS,
  SORT_LABEL_KEYS,
} from '@/assets/js/marketplace/labels'
import {
  PLUGIN_CATEGORIES,
  type MarketplaceSort,
  type MarketplaceView,
  type PluginCategory,
  type PluginTrust,
} from '@/assets/js/marketplace/types'

const emit = defineEmits<{ (e: 'close'): void }>()

const marketplace = useMarketplace()
const i18nState = useI18N().state

const root = ref<HTMLElement | null>(null)

const views = computed<{ id: MarketplaceView; label: string; icon: Component; count?: number }[]>(
  () => [
    { id: 'discover', label: i18nState.MARKETPLACE_VIEW_DISCOVER, icon: SparklesIcon },
    {
      id: 'installed',
      label: i18nState.MARKETPLACE_VIEW_INSTALLED,
      icon: CheckCircleIcon,
      count: marketplace.installedCount,
    },
    {
      id: 'updates',
      label: i18nState.MARKETPLACE_VIEW_UPDATES,
      icon: ArrowPathIcon,
      count: marketplace.updateCount,
    },
    { id: 'publish', label: i18nState.MARKETPLACE_VIEW_PUBLISH, icon: ArrowUpTrayIcon },
  ],
)

const categoryCount = (category: PluginCategory | 'all') =>
  marketplace.listings.filter((l) => category === 'all' || l.category === category).length

const trustOptions = computed<{ id: PluginTrust | 'all'; label: string }[]>(() => [
  { id: 'all', label: i18nState.MARKETPLACE_TRUST_ALL },
  { id: 'verified', label: i18nState.MARKETPLACE_TRUST_VERIFIED },
  { id: 'community', label: i18nState.MARKETPLACE_TRUST_COMMUNITY },
])

const sortItems = computed(() =>
  (Object.keys(SORT_LABEL_KEYS) as MarketplaceSort[]).map((sort) => ({
    label: i18nState[SORT_LABEL_KEYS[sort]],
    value: sort,
    active: true,
  })),
)

const emptyMessage = computed(() => {
  const anyFilter =
    marketplace.filters.search ||
    marketplace.filters.category !== 'all' ||
    marketplace.filters.trust !== 'all'
  if (anyFilter) return i18nState.MARKETPLACE_NO_RESULTS
  if (marketplace.view === 'installed') return i18nState.MARKETPLACE_NO_INSTALLED
  if (marketplace.view === 'updates') return i18nState.MARKETPLACE_NO_UPDATES
  return i18nState.MARKETPLACE_NO_RESULTS
})

// The detail pane follows the list, so filtering never leaves it describing a
// plugin that is no longer shown.
watch(
  () => marketplace.visible,
  (rows) => {
    if (!rows.some((row) => row.id === marketplace.selectedId)) {
      marketplace.select(rows[0]?.id ?? null)
    }
  },
  { immediate: true },
)

async function installFromDisk(kind: 'file' | 'folder') {
  const result = await window.electronAPI.showOpenDialog(
    kind === 'file'
      ? {
          properties: ['openFile'],
          filters: [{ name: i18nState.MARKETPLACE_PACKAGE_FILES, extensions: ['aipgx', 'zip'] }],
        }
      : { properties: ['openDirectory'] },
  )
  if (!result || result.canceled || !result.filePaths[0]) return
  await marketplace.installFromPath(result.filePaths[0])
}

function onClose() {
  if (marketplace.pendingConsent) marketplace.cancelInstall()
  else emit('close')
}

onMounted(() => {
  root.value?.focus()
  void marketplace.refresh()
})
</script>

<template>
  <div
    ref="root"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    :aria-label="languages.MARKETPLACE_TITLE"
    class="absolute inset-0 z-10 flex flex-col bg-background text-foreground focus:outline-none"
    @keydown.esc="onClose"
  >
    <TooltipProvider :delay-duration="200">
      <header class="flex items-center justify-between border-b border-border px-4 py-3">
        <div class="flex items-center gap-3">
          <h1 class="text-lg font-semibold">{{ languages.MARKETPLACE_TITLE }}</h1>
          <span
            v-if="marketplace.mode === 'sample'"
            class="rounded-full border border-amber-600/50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-500"
          >
            {{ languages.MARKETPLACE_PREVIEW }}
          </span>
        </div>
        <button
          :aria-label="languages.MARKETPLACE_CLOSE"
          class="flex size-7 items-center justify-center rounded hover:bg-muted"
          @click="emit('close')"
        >
          <XMarkIcon class="size-5" />
        </button>
      </header>

      <p
        v-if="marketplace.mode === 'sample'"
        class="border-b border-border bg-amber-600/10 px-4 py-2 text-sm text-amber-500"
      >
        {{ languages.MARKETPLACE_PREVIEW_NOTICE }}
      </p>
      <div
        v-else-if="marketplace.catalogError"
        role="alert"
        class="flex items-center justify-between gap-4 border-b border-border bg-red-500/10 px-4 py-2 text-sm text-red-400"
      >
        <span>{{ languages.MARKETPLACE_ERROR_CATALOG }}</span>
        <Button size="xs" variant="secondary" @click="marketplace.refresh()">
          {{ languages.MARKETPLACE_RETRY }}
        </Button>
      </div>

      <div class="flex min-h-0 flex-1">
        <nav
          class="flex w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border p-3"
          :aria-label="languages.MARKETPLACE_NAV"
        >
          <ul class="flex flex-col gap-1">
            <li v-for="item in views" :key="item.id">
              <button
                class="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-muted"
                :class="
                  marketplace.view === item.id ? 'bg-muted font-medium' : 'text-muted-foreground'
                "
                :aria-current="marketplace.view === item.id ? 'page' : undefined"
                @click="marketplace.setView(item.id)"
              >
                <component :is="item.icon" class="size-4" />
                <span class="flex-1 text-left">{{ item.label }}</span>
                <span
                  v-if="item.count"
                  class="rounded-full px-1.5 text-xs"
                  :class="
                    item.id === 'updates'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground'
                  "
                  >{{ item.count }}</span
                >
              </button>
            </li>
          </ul>

          <div v-if="marketplace.view !== 'publish'">
            <h2 class="mb-1 px-3 text-xs font-semibold uppercase text-muted-foreground">
              {{ languages.MARKETPLACE_CATEGORIES }}
            </h2>
            <ul class="flex flex-col gap-0.5">
              <li v-for="category in ['all', ...PLUGIN_CATEGORIES] as const" :key="category">
                <button
                  class="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-muted"
                  :class="
                    marketplace.filters.category === category
                      ? 'bg-muted font-medium'
                      : 'text-muted-foreground'
                  "
                  :aria-current="marketplace.filters.category === category ? 'true' : undefined"
                  @click="marketplace.setFilters({ category })"
                >
                  <component
                    :is="category === 'all' ? Squares2X2Icon : CATEGORY_ICONS[category]"
                    class="size-4"
                  />
                  <span class="flex-1 text-left">{{
                    category === 'all'
                      ? languages.MARKETPLACE_CATEGORY_ALL
                      : languages[CATEGORY_LABEL_KEYS[category]]
                  }}</span>
                  <span class="text-xs text-muted-foreground">{{ categoryCount(category) }}</span>
                </button>
              </li>
            </ul>
          </div>
        </nav>

        <PublishPanel v-if="marketplace.view === 'publish'" />

        <div v-else class="flex min-w-0 flex-1 flex-col">
          <div class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <div
              class="flex min-w-[220px] flex-1 items-center gap-2 rounded-md border border-border bg-background px-2"
            >
              <MagnifyingGlassIcon class="size-4 shrink-0 text-muted-foreground" />
              <input
                type="search"
                :aria-label="languages.MARKETPLACE_SEARCH"
                :placeholder="languages.MARKETPLACE_SEARCH"
                class="w-full bg-transparent py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                :value="marketplace.filters.search"
                @input="
                  marketplace.setFilters({ search: ($event.target as HTMLInputElement).value })
                "
              />
            </div>
            <div
              role="radiogroup"
              :aria-label="languages.MARKETPLACE_FILTER_TRUST"
              class="flex rounded-md border border-border p-0.5"
            >
              <button
                v-for="option in trustOptions"
                :key="option.id"
                role="radio"
                :aria-checked="marketplace.filters.trust === option.id"
                class="rounded px-3 py-1 text-xs"
                :class="
                  marketplace.filters.trust === option.id
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                "
                @click="marketplace.setFilters({ trust: option.id })"
              >
                {{ option.label }}
              </button>
            </div>
            <div role="group" :aria-label="languages.MARKETPLACE_SORT" class="w-[170px]">
              <DropDownNew
                :title="languages.MARKETPLACE_SORT"
                :items="sortItems"
                :value="marketplace.filters.sort"
                @change="
                  (value: string) => marketplace.setFilters({ sort: value as MarketplaceSort })
                "
              />
            </div>
            <template v-if="marketplace.mode === 'remote' && marketplace.view === 'installed'">
              <Button size="sm" variant="secondary" @click="installFromDisk('file')">
                <DocumentArrowUpIcon />
                {{ languages.MARKETPLACE_INSTALL_FROM_FILE }}
              </Button>
              <Button size="sm" variant="secondary" @click="installFromDisk('folder')">
                <FolderOpenIcon />
                {{ languages.MARKETPLACE_INSTALL_FROM_FOLDER }}
              </Button>
            </template>
            <Button
              v-if="marketplace.view === 'updates' && marketplace.updateCount > 0"
              size="sm"
              @click="marketplace.updateAll()"
            >
              <ArrowPathIcon />
              {{ languages.MARKETPLACE_UPDATE_ALL }}
            </Button>
          </div>

          <div class="flex min-h-0 flex-1">
            <ul
              role="listbox"
              :aria-label="languages.MARKETPLACE_TITLE"
              class="w-[400px] shrink-0 overflow-y-auto border-r border-border"
            >
              <PluginListItem
                v-for="listing in marketplace.visible"
                :key="listing.id"
                :listing="listing"
                :selected="listing.id === marketplace.selectedId"
                @select="marketplace.select(listing.id)"
              />
              <li
                v-if="marketplace.mode === 'loading'"
                class="px-4 py-10 text-center text-sm text-muted-foreground"
              >
                {{ languages.MARKETPLACE_LOADING }}
              </li>
              <li
                v-else-if="marketplace.visible.length === 0"
                class="px-4 py-10 text-center text-sm text-muted-foreground"
              >
                {{ emptyMessage }}
              </li>
            </ul>

            <PluginDetail v-if="marketplace.selected" :listing="marketplace.selected" />
            <div
              v-else
              class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
            >
              {{ languages.MARKETPLACE_SELECT_HINT }}
            </div>
          </div>
        </div>
      </div>

      <InstallConsentDialog
        v-if="marketplace.pendingConsent"
        :listing="marketplace.pendingConsent"
        @cancel="marketplace.cancelInstall()"
        @confirm="marketplace.confirmInstall()"
      />
    </TooltipProvider>
  </div>
</template>
