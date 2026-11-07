<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowDownTrayIcon, ShieldCheckIcon, StarIcon } from '@heroicons/vue/24/solid'
import PluginIcon from '@/components/marketplace/PluginIcon.vue'
import TrustBadge from '@/components/marketplace/TrustBadge.vue'
import PluginActions from '@/components/marketplace/PluginActions.vue'
import PermissionList from '@/components/marketplace/PermissionList.vue'
import { useMarketplace } from '@/assets/js/store/marketplace'
import { useI18N } from '@/assets/js/store/i18n'
import { formatCount } from '@/assets/js/marketplace/catalog'
import { CATEGORY_LABEL_KEYS } from '@/assets/js/marketplace/labels'
import type { PluginListing } from '@/assets/js/marketplace/types'

type DetailTab = 'overview' | 'permissions' | 'changelog'

const props = defineProps<{ listing: PluginListing }>()

const marketplace = useMarketplace()
const i18n = useI18N()
const i18nState = i18n.state

const tab = ref<DetailTab>('overview')
watch(
  () => props.listing.id,
  () => (tab.value = 'overview'),
)

const tabs = computed<{ id: DetailTab; label: string }[]>(() => [
  { id: 'overview', label: i18nState.MARKETPLACE_TAB_OVERVIEW },
  {
    id: 'permissions',
    label: `${i18nState.MARKETPLACE_TAB_PERMISSIONS} (${props.listing.permissions.length})`,
  },
  { id: 'changelog', label: i18nState.MARKETPLACE_TAB_CHANGELOG },
])

const installed = computed(() => marketplace.installed[props.listing.id])

const downloadsLabel = computed(() =>
  (i18nState.MARKETPLACE_DOWNLOADS ?? '').replace(
    '{count}',
    formatCount(props.listing.downloads, i18n.langName),
  ),
)

const ratingLabel = computed(() =>
  props.listing.rating === undefined
    ? ''
    : (i18nState.MARKETPLACE_RATING ?? '')
        .replace('{rating}', props.listing.rating.toFixed(1))
        .replace('{count}', formatCount(props.listing.ratingCount ?? 0, i18n.langName)),
)

const incompatibleHint = computed(() =>
  (i18nState.MARKETPLACE_INCOMPATIBLE ?? '').replace('{range}', props.listing.compatibility),
)

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(i18n.langName, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

const details = computed(() =>
  [
    {
      label: i18nState.MARKETPLACE_DETAILS_VERSION,
      value: installed.value
        ? `${installed.value.version}${installed.value.version !== props.listing.version ? ` → ${props.listing.version}` : ''}`
        : props.listing.version,
    },
    { label: i18nState.MARKETPLACE_DETAILS_UPDATED, value: formatDate(props.listing.updatedAt) },
    {
      label: i18nState.MARKETPLACE_DETAILS_SIZE,
      value:
        props.listing.sizeKb >= 1024
          ? `${(props.listing.sizeKb / 1024).toFixed(1)} MB`
          : `${props.listing.sizeKb} KB`,
    },
    { label: i18nState.MARKETPLACE_DETAILS_LICENSE, value: props.listing.license },
    { label: i18nState.MARKETPLACE_DETAILS_COMPATIBILITY, value: props.listing.compatibility },
    { label: i18nState.MARKETPLACE_DETAILS_ID, value: props.listing.id },
  ].filter(
    (row) =>
      row.value && !(row.label === i18nState.MARKETPLACE_DETAILS_SIZE && !props.listing.sizeKb),
  ),
)
</script>

<template>
  <article class="flex min-h-0 flex-1 flex-col" :aria-label="listing.name">
    <header class="flex gap-5 border-b border-border px-6 py-5">
      <PluginIcon :listing="listing" size="lg" />
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <h2 class="text-xl font-semibold">{{ listing.name }}</h2>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span class="flex items-center gap-1.5">
            {{ listing.publisher.name }}
            <TrustBadge :trust="listing.trust" show-label />
          </span>
          <span class="flex items-center gap-1">
            <ArrowDownTrayIcon class="size-4" /> {{ downloadsLabel }}
          </span>
          <span v-if="ratingLabel" class="flex items-center gap-1">
            <StarIcon class="size-4 text-amber-400" /> {{ ratingLabel }}
          </span>
        </div>
        <p class="text-sm">{{ listing.description }}</p>
        <p
          v-if="installed?.revoked"
          role="alert"
          class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400"
        >
          {{ languages.MARKETPLACE_REVOKED_NOTICE }} {{ installed.revoked.reason }}
        </p>
        <p
          v-else-if="listing.compatible === false"
          class="rounded-md border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-sm text-amber-500"
        >
          {{ incompatibleHint }}
        </p>
        <div class="mt-1">
          <PluginActions :listing="listing" />
        </div>
      </div>
    </header>

    <div role="tablist" class="flex gap-1 border-b border-border px-6">
      <button
        v-for="item in tabs"
        :key="item.id"
        role="tab"
        :aria-selected="tab === item.id"
        class="-mb-px border-b-2 px-3 py-2 text-sm"
        :class="
          tab === item.id
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
        @click="tab = item.id"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="flex min-h-0 flex-1 overflow-y-auto">
      <div role="tabpanel" class="min-w-0 flex-1 px-6 py-5">
        <template v-if="tab === 'overview'">
          <p class="whitespace-pre-line text-sm leading-relaxed">{{ listing.overview }}</p>
          <div v-if="installed?.presetNames?.length" class="mt-5 text-sm">
            <p class="mb-1 font-medium">{{ languages.MARKETPLACE_PRESETS_INCLUDED }}</p>
            <ul class="list-inside list-disc text-muted-foreground">
              <li v-for="name in installed.presetNames" :key="name">{{ name }}</li>
            </ul>
          </div>
          <div
            v-if="listing.models?.length"
            class="mt-5 rounded-lg border border-border bg-muted/30 p-4 text-sm"
          >
            <p class="mb-2 font-medium">{{ languages.MARKETPLACE_MODELS_HEADING }}</p>
            <ul class="mb-2 flex flex-col gap-1">
              <li
                v-for="model in listing.models"
                :key="model.label"
                class="flex justify-between text-muted-foreground"
              >
                <span>{{ model.label }}</span>
                <span>{{ model.sizeGb.toFixed(2) }} GB</span>
              </li>
            </ul>
            <p class="text-xs text-muted-foreground">
              {{ languages.MARKETPLACE_MODELS_ON_DEMAND }}
            </p>
          </div>
          <div class="mt-5 flex flex-wrap gap-1.5">
            <button
              v-for="tag in listing.tags"
              :key="tag"
              class="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              @click="marketplace.setFilters({ search: tag })"
            >
              {{ tag }}
            </button>
          </div>
        </template>

        <template v-else-if="tab === 'permissions'">
          <p
            v-if="listing.trust !== 'verified'"
            class="mb-4 rounded-md border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-sm text-amber-500"
          >
            {{
              listing.trust === 'local'
                ? languages.MARKETPLACE_LOCAL_HINT
                : languages.MARKETPLACE_COMMUNITY_HINT
            }}
          </p>
          <p
            v-else
            class="mb-4 flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm"
          >
            <ShieldCheckIcon class="size-5 shrink-0 text-primary" />
            {{ languages.MARKETPLACE_VERIFIED_HINT }}
          </p>
          <PermissionList :permissions="listing.permissions" />
        </template>

        <ol v-else class="flex flex-col gap-4">
          <li v-for="entry in listing.changelog" :key="entry.version">
            <p class="text-sm font-medium">
              {{ entry.version }}
              <span v-if="entry.date" class="ml-2 text-xs font-normal text-muted-foreground">{{
                formatDate(entry.date)
              }}</span>
            </p>
            <p class="whitespace-pre-line text-sm text-muted-foreground">{{ entry.notes }}</p>
          </li>
        </ol>
      </div>

      <aside class="w-60 shrink-0 border-l border-border px-5 py-5 text-sm">
        <h3 class="mb-3 text-xs font-semibold uppercase text-muted-foreground">
          {{ languages.MARKETPLACE_DETAILS }}
        </h3>
        <dl class="flex flex-col gap-3">
          <div v-for="row in details" :key="row.label">
            <dt class="text-xs text-muted-foreground">{{ row.label }}</dt>
            <dd class="break-all">{{ row.value }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">{{ languages.MARKETPLACE_CATEGORY }}</dt>
            <dd>
              <button
                class="text-primary hover:underline"
                @click="marketplace.setFilters({ category: listing.category })"
              >
                {{ languages[CATEGORY_LABEL_KEYS[listing.category]] }}
              </button>
            </dd>
          </div>
          <div v-if="listing.repository">
            <dt class="text-xs text-muted-foreground">
              {{ languages.MARKETPLACE_DETAILS_REPOSITORY }}
            </dt>
            <dd>
              <a
                :href="listing.repository"
                target="_blank"
                rel="noopener"
                class="break-all text-primary hover:underline"
                >{{ listing.repository.replace('https://', '') }}</a
              >
            </dd>
          </div>
        </dl>
      </aside>
    </div>
  </article>
</template>
