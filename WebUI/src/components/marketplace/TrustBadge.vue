<script setup lang="ts">
import { CheckBadgeIcon, UserGroupIcon } from '@heroicons/vue/24/solid'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { PluginTrust } from '@/assets/js/marketplace/types'

defineProps<{ trust: PluginTrust; showLabel?: boolean }>()
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <span
        tabindex="0"
        class="inline-flex items-center gap-1 text-xs"
        :class="trust === 'verified' ? 'text-primary' : 'text-muted-foreground'"
        :aria-label="
          trust === 'verified'
            ? languages.MARKETPLACE_TRUST_VERIFIED
            : languages.MARKETPLACE_TRUST_COMMUNITY
        "
      >
        <CheckBadgeIcon v-if="trust === 'verified'" class="size-4" />
        <UserGroupIcon v-else class="size-4" />
        <span v-if="showLabel">{{
          trust === 'verified'
            ? languages.MARKETPLACE_TRUST_VERIFIED
            : languages.MARKETPLACE_TRUST_COMMUNITY
        }}</span>
      </span>
    </TooltipTrigger>
    <TooltipContent class="max-w-64 border border-border bg-card p-2 text-foreground z-[200]">
      <p class="text-xs">
        {{
          trust === 'verified'
            ? languages.MARKETPLACE_VERIFIED_HINT
            : languages.MARKETPLACE_COMMUNITY_HINT
        }}
      </p>
    </TooltipContent>
  </Tooltip>
</template>
