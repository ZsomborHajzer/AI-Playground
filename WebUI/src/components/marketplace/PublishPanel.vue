<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowPathIcon, ArrowUpTrayIcon, CheckBadgeIcon } from '@heroicons/vue/24/solid'
import { DocumentArrowUpIcon, FolderOpenIcon } from '@heroicons/vue/24/outline'
import { Button } from '@/components/ui/button'
import { useMarketplace } from '@/assets/js/store/marketplace'
import { useI18N } from '@/assets/js/store/i18n'
import * as toast from '@/assets/js/toast'
import { STATUS_LABEL_KEYS } from '@/assets/js/marketplace/labels'
import type { PackageInspection, SubmissionWire } from '@/types/marketplaceIpc'

const marketplace = useMarketplace()
const i18nState = useI18N().state

const tokenInput = ref('')
const savingToken = ref(false)
const packagePath = ref<string | null>(null)
const inspection = ref<PackageInspection | null>(null)
const dragging = ref(false)

const steps = computed(() => [
  i18nState.MARKETPLACE_PUBLISH_STEP_PACKAGE,
  i18nState.MARKETPLACE_PUBLISH_STEP_SCAN,
  i18nState.MARKETPLACE_PUBLISH_STEP_LIST,
  i18nState.MARKETPLACE_PUBLISH_STEP_VERIFY,
])

const signedInAs = computed(() =>
  marketplace.publisher
    ? (i18nState.MARKETPLACE_SIGNED_IN_AS ?? '')
        .replace('{name}', marketplace.publisher.name)
        .replace('{id}', marketplace.publisher.id)
    : '',
)

const errors = computed(() => inspection.value?.issues.filter((i) => i.level === 'error') ?? [])
const warnings = computed(() => inspection.value?.issues.filter((i) => i.level === 'warning') ?? [])
const readyLabel = computed(() =>
  inspection.value?.manifest
    ? (i18nState.MARKETPLACE_PUBLISH_CHECKS_PASSED ?? '')
        .replace('{id}', inspection.value.manifest.id)
        .replace('{version}', inspection.value.manifest.version)
    : '',
)
const canSubmit = computed(
  () => !!marketplace.publisher && !!inspection.value?.ok && !marketplace.publishing,
)

async function saveToken() {
  savingToken.value = true
  try {
    if (await marketplace.setPublisherToken(tokenInput.value)) tokenInput.value = ''
  } finally {
    savingToken.value = false
  }
}

async function choose(path: string | null | undefined) {
  if (!path) return
  packagePath.value = path
  inspection.value = (await marketplace.inspect(path)) ?? null
}

async function pick(kind: 'file' | 'folder') {
  const result = await window.electronAPI.showOpenDialog(
    kind === 'file'
      ? {
          properties: ['openFile'],
          filters: [{ name: i18nState.MARKETPLACE_PACKAGE_FILES, extensions: ['aipgx', 'zip'] }],
        }
      : { properties: ['openDirectory'] },
  )
  if (result && !result.canceled) await choose(result.filePaths[0])
}

async function onDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files[0]
  if (file) await choose(window.electronAPI.getFilePath(file))
}

async function submit() {
  if (!packagePath.value) return
  const submission = await marketplace.publish(packagePath.value)
  if (!submission) return
  toast.success(
    (i18nState.MARKETPLACE_PUBLISH_SUBMITTED ?? '').replace(
      '{name}',
      `${submission.pluginId}@${submission.version}`,
    ),
  )
  packagePath.value = null
  inspection.value = null
}

const statusClass: Record<SubmissionWire['status'], string> = {
  'in-review': 'bg-amber-600/15 text-amber-500',
  published: 'bg-emerald-600/15 text-emerald-500',
  'changes-requested': 'bg-red-500/15 text-red-400',
  rejected: 'bg-red-500/15 text-red-400',
}
</script>

<template>
  <div class="flex min-h-0 flex-1 overflow-y-auto">
    <div
      v-if="marketplace.mode !== 'remote'"
      class="mx-auto my-10 max-w-xl rounded-lg border border-border bg-muted/30 p-6 text-sm"
    >
      <h2 class="mb-2 text-lg font-semibold">{{ languages.MARKETPLACE_PUBLISH_TITLE }}</h2>
      <p class="text-muted-foreground">{{ languages.MARKETPLACE_PUBLISH_NOT_CONFIGURED }}</p>
    </div>

    <div v-else class="mx-auto flex w-full max-w-5xl gap-8 px-8 py-6">
      <div class="flex min-w-0 flex-1 flex-col gap-4">
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

        <section class="rounded-lg border border-border p-4">
          <template v-if="marketplace.publisher">
            <div class="flex items-center justify-between gap-3 text-sm">
              <span class="flex items-center gap-1.5">
                {{ signedInAs }}
                <CheckBadgeIcon
                  v-if="marketplace.publisher.verified"
                  class="size-4 text-primary"
                  :aria-label="languages.MARKETPLACE_TRUST_VERIFIED"
                />
              </span>
              <Button size="xs" variant="secondary" @click="marketplace.setPublisherToken('')">
                {{ languages.MARKETPLACE_SIGN_OUT }}
              </Button>
            </div>
          </template>
          <form v-else class="flex flex-col gap-2" @submit.prevent="saveToken">
            <label class="flex flex-col gap-1 text-sm">
              {{ languages.MARKETPLACE_PUBLISHER_TOKEN }}
              <input
                v-model="tokenInput"
                type="password"
                autocomplete="off"
                class="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
            <p class="text-xs text-muted-foreground">
              {{ languages.MARKETPLACE_PUBLISHER_TOKEN_HINT }}
            </p>
            <div>
              <Button type="submit" size="sm" :disabled="!tokenInput.trim() || savingToken">
                {{ languages.MARKETPLACE_SAVE_TOKEN }}
              </Button>
            </div>
          </form>
        </section>

        <div
          class="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition-colors"
          :class="dragging ? 'border-primary bg-primary/10' : 'border-border'"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <ArrowUpTrayIcon class="size-7 text-muted-foreground" />
          <span class="font-medium">{{ languages.MARKETPLACE_PUBLISH_PACKAGE }}</span>
          <span class="max-w-full break-all text-xs text-muted-foreground">
            {{ packagePath ?? languages.MARKETPLACE_PUBLISH_DROP }}
          </span>
          <div class="flex gap-2">
            <Button size="sm" variant="secondary" @click="pick('file')">
              <DocumentArrowUpIcon />
              {{ languages.MARKETPLACE_CHOOSE_FILE }}
            </Button>
            <Button size="sm" variant="secondary" @click="pick('folder')">
              <FolderOpenIcon />
              {{ languages.MARKETPLACE_CHOOSE_FOLDER }}
            </Button>
          </div>
        </div>

        <section v-if="inspection" class="flex flex-col gap-2 text-sm" aria-live="polite">
          <p v-if="inspection.ok" class="font-medium text-emerald-500">{{ readyLabel }}</p>
          <p v-else role="alert" class="font-medium text-red-400">
            {{ languages.MARKETPLACE_PUBLISH_CHECKS_FAILED }}
          </p>
          <p v-if="inspection.presets.length" class="text-muted-foreground">
            {{ languages.MARKETPLACE_PRESETS_INCLUDED }}:
            {{ inspection.presets.map((p) => p.name).join(', ') }}
          </p>
          <ul class="flex flex-col gap-1">
            <li v-for="(issue, i) in errors" :key="`e${i}`" class="text-red-400">
              <code class="text-xs">{{ issue.path ?? issue.code }}</code> — {{ issue.message }}
            </li>
            <li v-for="(issue, i) in warnings" :key="`w${i}`" class="text-amber-500">
              <code class="text-xs">{{ issue.path ?? issue.code }}</code> — {{ issue.message }}
            </li>
          </ul>
        </section>

        <div>
          <Button :disabled="!canSubmit" @click="submit">
            <ArrowUpTrayIcon />
            {{ languages.MARKETPLACE_PUBLISH_SUBMIT }}
          </Button>
        </div>
      </div>

      <section class="w-80 shrink-0" :aria-label="languages.MARKETPLACE_SUBMISSIONS">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-semibold">{{ languages.MARKETPLACE_SUBMISSIONS }}</h3>
          <Button
            v-if="marketplace.publisher"
            size="xs"
            variant="ghost"
            :aria-label="languages.MARKETPLACE_REFRESH"
            @click="marketplace.loadSubmissions()"
          >
            <ArrowPathIcon />
          </Button>
        </div>
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
                <p class="truncate text-sm font-medium">{{ submission.pluginId }}</p>
                <p class="text-xs text-muted-foreground">
                  {{ submission.version }} · {{ submission.createdAt.slice(0, 10) }}
                </p>
              </div>
              <span
                class="shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase"
                :class="statusClass[submission.status]"
              >
                {{ languages[STATUS_LABEL_KEYS[submission.status]] }}
              </span>
            </div>
            <p
              v-if="submission.reviewNote"
              class="mt-2 whitespace-pre-line text-xs text-muted-foreground"
            >
              {{ submission.reviewNote }}
            </p>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
