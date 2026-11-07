<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ExclamationTriangleIcon } from '@heroicons/vue/24/solid'
import { Button } from '@/components/ui/button'
import PermissionList from '@/components/marketplace/PermissionList.vue'
import { useI18N } from '@/assets/js/store/i18n'
import type { PluginListing } from '@/assets/js/marketplace/types'

const props = defineProps<{ listing: PluginListing }>()
const emit = defineEmits<{ (e: 'cancel'): void; (e: 'confirm'): void }>()

const i18nState = useI18N().state
const cancelButton = ref<{ $el: HTMLButtonElement } | null>(null)

// Focus starts on Cancel so a stray Enter does not grant permissions.
onMounted(() => cancelButton.value?.$el.focus())

const title = computed(() =>
  (i18nState.MARKETPLACE_CONSENT_TITLE ?? '').replace('{name}', props.listing.name),
)
</script>

<template>
  <div
    class="absolute inset-0 z-20 flex items-center justify-center bg-background/70"
    @click.self="emit('cancel')"
  >
    <div
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      class="flex max-h-[80vh] w-[480px] flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-7 text-foreground shadow-2xl"
      @keydown.esc.stop="emit('cancel')"
    >
      <h2 class="text-lg font-semibold">{{ title }}</h2>
      <p class="text-sm text-muted-foreground">
        {{ listing.publisher.name }} · {{ listing.version }}
      </p>

      <p
        v-if="listing.trust === 'community'"
        class="flex gap-2 rounded-md border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-sm text-amber-500"
      >
        <ExclamationTriangleIcon class="mt-0.5 size-4 shrink-0" />
        {{ languages.MARKETPLACE_CONSENT_COMMUNITY }}
      </p>

      <div class="flex flex-col gap-3">
        <p v-if="listing.permissions.length" class="text-sm">
          {{ languages.MARKETPLACE_CONSENT_INTRO }}
        </p>
        <PermissionList :permissions="listing.permissions" />
      </div>

      <p v-if="listing.models?.length" class="text-xs text-muted-foreground">
        {{ languages.MARKETPLACE_MODELS_ON_DEMAND }}
      </p>

      <div class="mt-2 flex justify-end gap-2">
        <Button ref="cancelButton" variant="secondary" @click="emit('cancel')">
          {{ languages.COM_CANCEL }}
        </Button>
        <Button @click="emit('confirm')">{{ languages.COM_INSTALL }}</Button>
      </div>
    </div>
  </div>
</template>
