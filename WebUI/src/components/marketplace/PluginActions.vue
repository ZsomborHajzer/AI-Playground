<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { useMarketplace } from '@/assets/js/store/marketplace'
import { useI18N } from '@/assets/js/store/i18n'
import type { PluginListing } from '@/assets/js/marketplace/types'

const props = defineProps<{ listing: PluginListing; compact?: boolean }>()

const marketplace = useMarketplace()
const i18nState = useI18N().state

const installed = computed(() => marketplace.installed[props.listing.id])
const progress = computed(() => marketplace.busy[props.listing.id])
const updatable = computed(() => marketplace.updateAvailable(props.listing.id))
const incompatible = computed(() => props.listing.compatible === false)
const size = computed(() => (props.compact ? 'xs' : 'sm'))

const updateLabel = computed(() =>
  (i18nState.MARKETPLACE_UPDATE ?? '').replace('{version}', props.listing.version),
)
const incompatibleHint = computed(() =>
  (i18nState.MARKETPLACE_INCOMPATIBLE ?? '').replace('{range}', props.listing.compatibility),
)
</script>

<template>
  <!-- `.stop` throughout: in the list these sit inside a selectable row. -->
  <div class="flex items-center gap-2">
    <Button v-if="progress !== undefined" :size="size" disabled class="min-w-24" aria-live="polite">
      {{ languages.MARKETPLACE_INSTALLING }}
      <template v-if="progress >= 0">{{ Math.round(progress * 100) }}%</template>
    </Button>
    <template v-else-if="!installed">
      <Button
        :size="size"
        :disabled="incompatible"
        :title="incompatible ? incompatibleHint : undefined"
        :aria-label="`${languages.COM_INSTALL} ${listing.name}`"
        @click.stop="marketplace.requestInstall(listing.id)"
      >
        {{ languages.COM_INSTALL }}
      </Button>
    </template>
    <template v-else>
      <Button
        v-if="updatable"
        :size="size"
        :disabled="incompatible"
        :aria-label="`${updateLabel} – ${listing.name}`"
        @click.stop="marketplace.update(listing.id)"
      >
        {{ compact ? languages.MARKETPLACE_UPDATE_SHORT : updateLabel }}
      </Button>
      <template v-if="!compact">
        <Button
          v-if="!installed.revoked"
          variant="secondary"
          :size="size"
          @click.stop="marketplace.setEnabled(listing.id, !installed.enabled)"
        >
          {{ installed.enabled ? languages.MARKETPLACE_DISABLE : languages.MARKETPLACE_ENABLE }}
        </Button>
        <Button
          variant="secondary"
          :size="size"
          class="text-red-400 hover:text-red-300"
          @click.stop="marketplace.uninstall(listing.id)"
        >
          {{ languages.MARKETPLACE_UNINSTALL }}
        </Button>
      </template>
    </template>
  </div>
</template>
