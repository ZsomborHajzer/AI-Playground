<script setup lang="ts">
import { computed } from 'vue'
import { CATEGORY_ICONS } from '@/assets/js/marketplace/labels'
import type { PluginListing } from '@/assets/js/marketplace/types'

const props = defineProps<{ listing: PluginListing; size?: 'sm' | 'lg' }>()

// Listings carry no artwork yet, so the tile is coloured from the id: stable per
// plugin and distinct between neighbours.
const hue = computed(() => {
  let hash = 0
  for (const char of props.listing.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % 360
})

const icon = computed(() => CATEGORY_ICONS[props.listing.category])
</script>

<template>
  <div
    aria-hidden="true"
    class="flex shrink-0 items-center justify-center rounded-lg text-white"
    :class="size === 'lg' ? 'size-20 rounded-xl' : 'size-11'"
    :style="{
      background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 40) % 360} 70% 35%))`,
    }"
  >
    <component :is="icon" :class="size === 'lg' ? 'size-10' : 'size-6'" />
  </div>
</template>
