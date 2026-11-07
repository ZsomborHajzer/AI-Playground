<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDownTrayIcon, StarIcon } from '@heroicons/vue/24/solid'
import PluginIcon from '@/components/marketplace/PluginIcon.vue'
import TrustBadge from '@/components/marketplace/TrustBadge.vue'
import PluginActions from '@/components/marketplace/PluginActions.vue'
import { useMarketplace } from '@/assets/js/store/marketplace'
import { useI18N } from '@/assets/js/store/i18n'
import { formatCount } from '@/assets/js/marketplace/catalog'
import type { PluginListing } from '@/assets/js/marketplace/types'

const props = defineProps<{ listing: PluginListing; selected: boolean }>()
const emit = defineEmits<{ (e: 'select'): void }>()

const marketplace = useMarketplace()
const i18n = useI18N()

const installed = computed(() => marketplace.installed[props.listing.id])
const updatable = computed(() => marketplace.updateAvailable(props.listing.id))
</script>

<template>
  <li
    role="option"
    tabindex="0"
    :aria-selected="selected"
    :aria-label="listing.name"
    class="flex cursor-pointer gap-3 border-l-2 px-3 py-3 hover:bg-muted/60 focus:outline-none focus-visible:bg-muted"
    :class="selected ? 'border-primary bg-muted' : 'border-transparent'"
    @click="emit('select')"
    @keydown.enter.prevent="emit('select')"
    @keydown.space.prevent="emit('select')"
  >
    <PluginIcon :listing="listing" />
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <div class="flex items-center gap-2">
        <span class="truncate text-sm font-semibold">{{ listing.name }}</span>
        <span
          v-if="installed?.revoked"
          class="shrink-0 rounded bg-red-500/15 px-1.5 text-[10px] uppercase text-red-400"
        >
          {{ languages.MARKETPLACE_REVOKED }}
        </span>
        <span
          v-else-if="installed && !installed.enabled"
          class="shrink-0 rounded bg-muted px-1.5 text-[10px] uppercase text-muted-foreground"
        >
          {{ languages.MARKETPLACE_DISABLED }}
        </span>
        <span
          v-else-if="updatable"
          class="shrink-0 rounded bg-primary/15 px-1.5 text-[10px] uppercase text-primary"
        >
          {{ languages.MARKETPLACE_UPDATE_AVAILABLE }}
        </span>
        <span
          v-else-if="installed"
          class="shrink-0 rounded bg-emerald-600/15 px-1.5 text-[10px] uppercase text-emerald-500"
        >
          {{ languages.MARKETPLACE_INSTALLED_BADGE }}
        </span>
      </div>
      <p class="line-clamp-2 text-xs text-muted-foreground">{{ listing.description }}</p>
      <div class="mt-1 flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
          <span class="flex min-w-0 items-center gap-1">
            <span class="truncate">{{ listing.publisher.name }}</span>
            <TrustBadge :trust="listing.trust" />
          </span>
          <span class="flex shrink-0 items-center gap-0.5">
            <ArrowDownTrayIcon class="size-3" />
            {{ formatCount(listing.downloads, i18n.langName) }}
          </span>
          <span v-if="listing.rating !== undefined" class="flex shrink-0 items-center gap-0.5">
            <StarIcon class="size-3 text-amber-400" />
            {{ listing.rating.toFixed(1) }}
          </span>
        </div>
        <PluginActions v-if="!installed || updatable" :listing="listing" compact />
      </div>
    </div>
  </li>
</template>
