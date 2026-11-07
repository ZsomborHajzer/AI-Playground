// JSON Schema for aipg-plugin.json, for editors and AI agents. validateManifest() in
// manifest.ts is the enforcing implementation; test/schema.test.ts keeps the two in step.
import {
  MANIFEST_VERSION,
  PLUGIN_CATEGORIES,
  PLUGIN_ID_PATTERN,
  PLUGIN_PERMISSIONS,
  SUPPORTED_CONTRIBUTIONS,
} from './manifest.ts'

export const MANIFEST_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/ZsomborHajzer/AI-Playground/marketplace-server/shared/aipg-plugin.schema.json',
  title: 'AI Playground plugin manifest (aipg-plugin.json)',
  type: 'object',
  required: [
    'manifestVersion',
    'id',
    'name',
    'version',
    'description',
    'license',
    'engines',
    'category',
    'permissions',
    'contributes',
  ],
  properties: {
    manifestVersion: { const: MANIFEST_VERSION },
    id: {
      type: 'string',
      pattern: PLUGIN_ID_PATTERN.source,
      description: 'publisher.plugin-name; the part before the dot must be your publisher id',
    },
    name: { type: 'string', minLength: 1, maxLength: 60 },
    version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$',
      description: 'Semver; every upload must be greater than the last published version',
    },
    description: { type: 'string', minLength: 1, maxLength: 160 },
    license: { type: 'string', minLength: 1, maxLength: 64, description: 'SPDX id, e.g. MIT' },
    repository: { type: 'string', pattern: '^https://\\S+$' },
    homepage: { type: 'string', pattern: '^https://\\S+$' },
    engines: {
      type: 'object',
      required: ['aipg'],
      properties: {
        aipg: {
          type: 'string',
          description: 'AI Playground versions the plugin supports, e.g. ">=3.2.0" or "^3.2.0"',
        },
      },
    },
    category: {
      enum: [...PLUGIN_CATEGORIES],
      description: 'Only "presets" and "workflows" are accepted for publishing today',
    },
    tags: {
      type: 'array',
      maxItems: 10,
      items: { type: 'string', minLength: 1, maxLength: 24 },
    },
    permissions: {
      type: 'array',
      uniqueItems: true,
      items: { enum: [...PLUGIN_PERMISSIONS] },
      description:
        '"models" when a preset lists requiredModels; "shell" when a preset installs custom nodes or Python packages',
    },
    icon: { type: 'string', pattern: '\\.(png|jpg|jpeg|webp)$' },
    contributes: {
      type: 'object',
      additionalProperties: false,
      required: ['presets'],
      properties: {
        presets: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
          description: 'Paths or single-* patterns of preset files, e.g. "presets/*.json"',
        },
      },
    },
  },
} as const

export const SUPPORTED_CONTRIBUTION_KEYS: readonly string[] = SUPPORTED_CONTRIBUTIONS
