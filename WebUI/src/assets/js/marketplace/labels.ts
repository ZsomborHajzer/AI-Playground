import type { Component } from 'vue'
import {
  AdjustmentsHorizontalIcon,
  ChatBubbleLeftRightIcon,
  CommandLineIcon,
  CubeIcon,
  FolderOpenIcon,
  GlobeAltIcon,
  LanguageIcon,
  ShareIcon,
  SparklesIcon,
  SwatchIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/vue/24/outline'
import type { SubmissionWire } from '@/types/marketplaceIpc'
import type { MarketplaceSort, PluginCategory, PluginPermission } from './types'

export const CATEGORY_LABEL_KEYS: Record<PluginCategory, string> = {
  presets: 'MARKETPLACE_CATEGORY_PRESETS',
  workflows: 'MARKETPLACE_CATEGORY_WORKFLOWS',
  'agent-skills': 'MARKETPLACE_CATEGORY_AGENT_SKILLS',
  tools: 'MARKETPLACE_CATEGORY_TOOLS',
  themes: 'MARKETPLACE_CATEGORY_THEMES',
  channels: 'MARKETPLACE_CATEGORY_CHANNELS',
  languages: 'MARKETPLACE_CATEGORY_LANGUAGES',
}

export const CATEGORY_ICONS: Record<PluginCategory, Component> = {
  presets: AdjustmentsHorizontalIcon,
  workflows: ShareIcon,
  'agent-skills': SparklesIcon,
  tools: WrenchScrewdriverIcon,
  themes: SwatchIcon,
  channels: ChatBubbleLeftRightIcon,
  languages: LanguageIcon,
}

export const PERMISSION_LABEL_KEYS: Record<PluginPermission, string> = {
  network: 'MARKETPLACE_PERMISSION_NETWORK',
  filesystem: 'MARKETPLACE_PERMISSION_FILESYSTEM',
  models: 'MARKETPLACE_PERMISSION_MODELS',
  shell: 'MARKETPLACE_PERMISSION_SHELL',
  channels: 'MARKETPLACE_PERMISSION_CHANNELS',
}

export const PERMISSION_DESC_KEYS: Record<PluginPermission, string> = {
  network: 'MARKETPLACE_PERMISSION_NETWORK_DESC',
  filesystem: 'MARKETPLACE_PERMISSION_FILESYSTEM_DESC',
  models: 'MARKETPLACE_PERMISSION_MODELS_DESC',
  shell: 'MARKETPLACE_PERMISSION_SHELL_DESC',
  channels: 'MARKETPLACE_PERMISSION_CHANNELS_DESC',
}

export const PERMISSION_ICONS: Record<PluginPermission, Component> = {
  network: GlobeAltIcon,
  filesystem: FolderOpenIcon,
  models: CubeIcon,
  shell: CommandLineIcon,
  channels: ChatBubbleLeftRightIcon,
}

export const SORT_LABEL_KEYS: Record<MarketplaceSort, string> = {
  popular: 'MARKETPLACE_SORT_POPULAR',
  rating: 'MARKETPLACE_SORT_RATING',
  recent: 'MARKETPLACE_SORT_RECENT',
  name: 'MARKETPLACE_SORT_NAME',
}

export const STATUS_LABEL_KEYS: Record<SubmissionWire['status'], string> = {
  'in-review': 'MARKETPLACE_STATUS_IN_REVIEW',
  published: 'MARKETPLACE_STATUS_PUBLISHED',
  'changes-requested': 'MARKETPLACE_STATUS_CHANGES',
  rejected: 'MARKETPLACE_STATUS_REJECTED',
}
