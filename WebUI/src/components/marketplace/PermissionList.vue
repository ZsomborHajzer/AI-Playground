<script setup lang="ts">
import {
  PERMISSION_DESC_KEYS,
  PERMISSION_ICONS,
  PERMISSION_LABEL_KEYS,
} from '@/assets/js/marketplace/labels'
import type { PluginPermission } from '@/assets/js/marketplace/types'

defineProps<{ permissions: PluginPermission[] }>()
</script>

<template>
  <p v-if="permissions.length === 0" class="text-sm text-muted-foreground">
    {{ languages.MARKETPLACE_NO_PERMISSIONS }}
  </p>
  <ul v-else class="flex flex-col gap-3">
    <li v-for="permission in permissions" :key="permission" class="flex gap-3">
      <component
        :is="PERMISSION_ICONS[permission]"
        class="mt-0.5 size-5 shrink-0"
        :class="permission === 'shell' ? 'text-amber-500' : 'text-muted-foreground'"
      />
      <div>
        <p class="text-sm font-medium">{{ languages[PERMISSION_LABEL_KEYS[permission]] }}</p>
        <p class="text-xs text-muted-foreground">
          {{ languages[PERMISSION_DESC_KEYS[permission]] }}
        </p>
      </div>
    </li>
  </ul>
</template>
