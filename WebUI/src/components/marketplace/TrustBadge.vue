<script setup lang="ts">
import { computed } from 'vue'
import { CheckBadgeIcon, ComputerDesktopIcon, UserGroupIcon } from '@heroicons/vue/24/solid'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18N } from '@/assets/js/store/i18n'
import type { PluginTrust } from '@/assets/js/marketplace/types'

const props = defineProps<{ trust: PluginTrust; showLabel?: boolean }>()
const i18nState = useI18N().state

const look = computed(() => {
  switch (props.trust) {
    case 'verified':
      return {
        icon: CheckBadgeIcon,
        color: 'text-primary',
        label: i18nState.MARKETPLACE_TRUST_VERIFIED,
        hint: i18nState.MARKETPLACE_VERIFIED_HINT,
      }
    case 'local':
      return {
        icon: ComputerDesktopIcon,
        color: 'text-amber-500',
        label: i18nState.MARKETPLACE_TRUST_LOCAL,
        hint: i18nState.MARKETPLACE_LOCAL_HINT,
      }
    default:
      return {
        icon: UserGroupIcon,
        color: 'text-muted-foreground',
        label: i18nState.MARKETPLACE_TRUST_COMMUNITY,
        hint: i18nState.MARKETPLACE_COMMUNITY_HINT,
      }
  }
})
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <span
        tabindex="0"
        class="inline-flex items-center gap-1 text-xs"
        :class="look.color"
        :aria-label="look.label"
      >
        <component :is="look.icon" class="size-4" />
        <span v-if="showLabel">{{ look.label }}</span>
      </span>
    </TooltipTrigger>
    <TooltipContent class="max-w-64 border border-border bg-card p-2 text-foreground z-[200]">
      <p class="text-xs">{{ look.hint }}</p>
    </TooltipContent>
  </Tooltip>
</template>
