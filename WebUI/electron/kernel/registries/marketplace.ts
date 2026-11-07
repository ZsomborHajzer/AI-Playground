import type { InvokeHandlerMap, MarketplaceInvokeName } from '../ipcRegistries'
import { issuesOf, type PluginHost } from '../../plugins/pluginHost'

const fail = (e: unknown) => ({
  success: false as const,
  error: e instanceof Error ? e.message : String(e),
  issues: issuesOf(e),
})

export function buildMarketplaceRegistry(host: PluginHost) {
  return {
    'marketplace:getCatalog': () => host.getCatalog(),

    'marketplace:listInstalled': () => host.listInstalled(),

    'marketplace:install': async (_event, id) => {
      try {
        return { success: true as const, installed: await host.install(id) }
      } catch (e) {
        return fail(e)
      }
    },

    'marketplace:installFromPath': async (_event, target) => {
      try {
        return { success: true as const, installed: await host.installFromPath(target) }
      } catch (e) {
        return fail(e)
      }
    },

    'marketplace:uninstall': async (_event, id) => {
      try {
        await host.uninstall(id)
        return { success: true as const }
      } catch (e) {
        return fail(e)
      }
    },

    'marketplace:setEnabled': async (_event, id, enabled) => {
      try {
        await host.setEnabled(id, enabled)
        return { success: true as const }
      } catch (e) {
        return fail(e)
      }
    },

    'marketplace:inspectPackage': (_event, target) => host.inspect(target),

    'marketplace:publish': async (_event, target) => {
      try {
        return { success: true as const, submission: await host.publish(target) }
      } catch (e) {
        return fail(e)
      }
    },

    'marketplace:mySubmissions': async () => {
      try {
        return { success: true as const, submissions: await host.mySubmissions() }
      } catch (e) {
        return fail(e)
      }
    },

    'marketplace:setPublisherToken': async (_event, token) => {
      try {
        return { success: true as const, publisher: await host.setPublisherToken(token) }
      } catch (e) {
        return fail(e)
      }
    },

    'marketplace:getPublisher': () => host.getPublisher(),
  } satisfies InvokeHandlerMap<MarketplaceInvokeName>
}
