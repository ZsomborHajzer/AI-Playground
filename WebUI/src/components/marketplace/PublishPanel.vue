<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUpTrayIcon } from '@heroicons/vue/24/solid'
import { Button } from '@/components/ui/button'
import DropDownNew from '@/components/DropDownNew.vue'
import { useMarketplace } from '@/assets/js/store/marketplace'
import { useI18N } from '@/assets/js/store/i18n'
import * as toast from '@/assets/js/toast'
import {
  CATEGORY_LABEL_KEYS,
  PERMISSION_ICONS,
  PERMISSION_LABEL_KEYS,
  STATUS_LABEL_KEYS,
} from '@/assets/js/marketplace/labels'
import {
  PLUGIN_CATEGORIES,
  PLUGIN_ID_PATTERN,
  PLUGIN_PERMISSIONS,
  SEMVER_PATTERN,
  type PluginCategory,
  type PluginPermission,
  type PluginSubmissionDraft,
  type SubmissionStatus,
} from '@/assets/js/marketplace/types'

const marketplace = useMarketplace()
const i18nState = useI18N().state

const emptyDraft = (): PluginSubmissionDraft => ({
  fileName: '',
  id: '',
  name: '',
  category: 'presets',
  version: '1.0.0',
  description: '',
  repository: '',
  permissions: [],
  requestVerified: false,
})

const draft = ref<PluginSubmissionDraft>(emptyDraft())
const showErrors = ref(false)
const dragging = ref(false)

const steps = computed(() => [
  i18nState.MARKETPLACE_PUBLISH_STEP_PACKAGE,
  i18nState.MARKETPLACE_PUBLISH_STEP_SCAN,
  i18nState.MARKETPLACE_PUBLISH_STEP_LIST,
  i18nState.MARKETPLACE_PUBLISH_STEP_VERIFY,
])

const categoryItems = computed(() =>
  PLUGIN_CATEGORIES.map((category) => ({
    label: i18nState[CATEGORY_LABEL_KEYS[category]],
    value: category,
    active: true,
  })),
)

const invalid = computed(() => ({
  fileName: !draft.value.fileName,
  name: !draft.value.name.trim(),
  id: !PLUGIN_ID_PATTERN.test(draft.value.id),
  version: !SEMVER_PATTERN.test(draft.value.version),
  description: !draft.value.description.trim(),
  repository: !!draft.value.repository && !/^https:\/\/\S+$/.test(draft.value.repository),
}))

const valid = computed(() => !Object.values(invalid.value).some(Boolean))

function takeFile(file: File | undefined) {
  if (!file) return
  draft.value.fileName = file.name
  if (!draft.value.name) {
    draft.value.name = file.name
      .replace(/\.(aipgx|zip)$/i, '')
      .replace(/-\d+\.\d+\.\d+.*$/, '')
      .replace(/[-_]+/g, ' ')
  }
}

function onDrop(event: DragEvent) {
  dragging.value = false
  takeFile(event.dataTransfer?.files[0])
}

function togglePermission(permission: PluginPermission) {
  const current = draft.value.permissions
  draft.value.permissions = current.includes(permission)
    ? current.filter((p) => p !== permission)
    : [...current, permission]
}

function submit() {
  showErrors.value = true
  if (!valid.value) return
  marketplace.submit({ ...draft.value, name: draft.value.name.trim() })
  toast.success((i18nState.MARKETPLACE_PUBLISH_SUBMITTED ?? '').replace('{name}', draft.value.name))
  draft.value = emptyDraft()
  showErrors.value = false
}

const fieldClass = (bad: boolean) =>
  `w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${
    showErrors.value && bad ? 'border-red-500' : 'border-border'
  }`

const statusClass: Record<SubmissionStatus, string> = {
  'in-review': 'bg-amber-600/15 text-amber-500',
  published: 'bg-emerald-600/15 text-emerald-500',
  'changes-requested': 'bg-red-500/15 text-red-400',
}
</script>

<template>
  <div class="flex min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto flex w-full max-w-5xl gap-8 px-8 py-6">
      <form class="flex min-w-0 flex-1 flex-col gap-4" novalidate @submit.prevent="submit">
        <div>
          <h2 class="text-xl font-semibold">{{ languages.MARKETPLACE_PUBLISH_TITLE }}</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {{ languages.MARKETPLACE_PUBLISH_INTRO }}
          </p>
        </div>

        <ol class="grid grid-cols-4 gap-2">
          <li
            v-for="(step, index) in steps"
            :key="index"
            class="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
          >
            <span
              class="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
              >{{ index + 1 }}</span
            >
            {{ step }}
          </li>
        </ol>

        <label
          class="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition-colors"
          :class="
            dragging
              ? 'border-primary bg-primary/10'
              : showErrors && invalid.fileName
                ? 'border-red-500 hover:bg-muted/40'
                : 'border-border hover:bg-muted/40'
          "
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <ArrowUpTrayIcon class="size-7 text-muted-foreground" />
          <span class="font-medium">{{ languages.MARKETPLACE_PUBLISH_PACKAGE }}</span>
          <span class="text-xs text-muted-foreground">
            {{ draft.fileName || languages.MARKETPLACE_PUBLISH_DROP }}
          </span>
          <input
            type="file"
            accept=".aipgx,.zip"
            class="sr-only"
            :aria-label="languages.MARKETPLACE_PUBLISH_PACKAGE"
            @change="takeFile(($event.target as HTMLInputElement).files?.[0])"
          />
        </label>

        <div class="grid grid-cols-2 gap-4">
          <label class="flex flex-col gap-1 text-sm">
            {{ languages.MARKETPLACE_PUBLISH_NAME }}
            <input v-model="draft.name" :class="fieldClass(invalid.name)" />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            {{ languages.MARKETPLACE_PUBLISH_ID }}
            <input
              v-model="draft.id"
              placeholder="publisher.plugin-name"
              :class="fieldClass(invalid.id)"
            />
          </label>
          <div class="flex flex-col gap-1 text-sm">
            <span>{{ languages.MARKETPLACE_CATEGORY }}</span>
            <div role="group" :aria-label="languages.MARKETPLACE_CATEGORY">
              <DropDownNew
                :items="categoryItems"
                :value="draft.category"
                @change="(value: string) => (draft.category = value as PluginCategory)"
              />
            </div>
          </div>
          <label class="flex flex-col gap-1 text-sm">
            {{ languages.MARKETPLACE_DETAILS_VERSION }}
            <input
              v-model="draft.version"
              placeholder="1.0.0"
              :class="fieldClass(invalid.version)"
            />
          </label>
        </div>

        <label class="flex flex-col gap-1 text-sm">
          {{ languages.MARKETPLACE_PUBLISH_DESCRIPTION }}
          <textarea
            v-model="draft.description"
            rows="2"
            maxlength="160"
            :class="fieldClass(invalid.description)"
          />
        </label>

        <label class="flex flex-col gap-1 text-sm">
          {{ languages.MARKETPLACE_DETAILS_REPOSITORY }}
          <input
            v-model="draft.repository"
            placeholder="https://github.com/…"
            :class="fieldClass(invalid.repository)"
          />
        </label>

        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1 text-sm">{{ languages.MARKETPLACE_PUBLISH_PERMISSIONS }}</legend>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="permission in PLUGIN_PERMISSIONS"
              :key="permission"
              type="button"
              :aria-pressed="draft.permissions.includes(permission)"
              class="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs"
              :class="
                draft.permissions.includes(permission)
                  ? 'border-primary bg-primary/15 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted'
              "
              @click="togglePermission(permission)"
            >
              <component :is="PERMISSION_ICONS[permission]" class="size-4" />
              {{ languages[PERMISSION_LABEL_KEYS[permission]] }}
            </button>
          </div>
        </fieldset>

        <label class="flex items-center gap-2 text-sm">
          <input v-model="draft.requestVerified" type="checkbox" class="accent-primary" />
          {{ languages.MARKETPLACE_PUBLISH_REQUEST_VERIFIED }}
        </label>

        <p v-if="showErrors && !valid" role="alert" class="text-sm text-red-400">
          {{ languages.MARKETPLACE_PUBLISH_INVALID }}
        </p>

        <div>
          <Button type="submit">
            <ArrowUpTrayIcon />
            {{ languages.MARKETPLACE_PUBLISH_SUBMIT }}
          </Button>
        </div>
      </form>

      <section class="w-80 shrink-0" :aria-label="languages.MARKETPLACE_SUBMISSIONS">
        <h3 class="mb-3 text-sm font-semibold">{{ languages.MARKETPLACE_SUBMISSIONS }}</h3>
        <p v-if="marketplace.submissions.length === 0" class="text-sm text-muted-foreground">
          {{ languages.MARKETPLACE_NO_SUBMISSIONS }}
        </p>
        <ul class="flex flex-col gap-2">
          <li
            v-for="submission in marketplace.submissions"
            :key="submission.id"
            class="rounded-lg border border-border p-3"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium">{{ submission.name }}</p>
                <p class="truncate text-xs text-muted-foreground">
                  {{ submission.id }} · {{ submission.version }}
                </p>
              </div>
              <span
                class="shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase"
                :class="statusClass[submission.status]"
              >
                {{ languages[STATUS_LABEL_KEYS[submission.status]] }}
              </span>
            </div>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ languages[CATEGORY_LABEL_KEYS[submission.category]] }} ·
              {{ submission.submittedAt }}
            </p>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
