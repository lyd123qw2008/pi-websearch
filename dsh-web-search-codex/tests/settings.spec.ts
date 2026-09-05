import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import WebRuntime from '@deepseek-ai/dsh-web'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as codexPlugin from '../src/index.js'
import { WEB_SEARCH_CODEX_SETTINGS_NAMESPACE } from '../src/index.js'

class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function boot(): Promise<{ ctx: Context; settingsFiber: Fiber; pluginFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, { searchProvider: 'codex-local' })
  await ctx.plugin(AgentRegistry)
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(codexPlugin, {
    apiKey: 'search-key',
    baseURL: 'https://search.entry.test/v1',
    model: 'search-model',
    stream: false,
  })
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber }
}

async function searchOnce(ctx: Context): Promise<string> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(jsonResponse({ output_text: 'ok' })))
  fetchSpy.mockClear()
  await ctx.web.search({ query: 'anything' })
  return String((fetchSpy.mock.calls.at(-1)?.[0] as URL | string | undefined) ?? '')
}

afterEach(() => vi.restoreAllMocks())

describe('web-search-codex settings section', () => {
  it('serves a stored endpoint to the next search without re-registering', async () => {
    const bench = await boot()
    expect(await searchOnce(bench.ctx)).toContain('https://search.entry.test/v1')

    await bench.ctx.settings.update(WEB_SEARCH_CODEX_SETTINGS_NAMESPACE, {
      baseURL: 'https://search.stored.test/v1',
    })

    expect(await searchOnce(bench.ctx)).toContain('https://search.stored.test/v1')
    await bench.ctx.fiber.dispose()
  })

  it('keeps the literal key out of described settings', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(WEB_SEARCH_CODEX_SETTINGS_NAMESPACE, { apiKey: 'stored-secret' })

    const [descriptor] = bench.ctx.settings.describe({ redactSecrets: true })
      .filter(row => String(row.ns) === 'web-search-codex')

    expect(JSON.stringify(descriptor)).not.toContain('stored-secret')
    expect(descriptor?.secrets).toEqual([{ path: ['apiKey'], set: true }])
    await bench.ctx.fiber.dispose()
  })

  it('reads the latest user request from the current Session snapshot', async () => {
    const bench = await boot()
    const agent = {
      id: 'initiator-session',
      session: {
        snapshotEvents: () => [{
          type: 'user/message',
          data: { content: [{ type: 'text', text: 'preserve this original request' }] },
        }],
      },
    } as unknown as Agent
    let input: unknown
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_request, init) => {
      const body = JSON.parse(String(init?.body)) as { input?: unknown }
      input = body.input
      return jsonResponse({ output_text: 'ok' })
    })

    await bench.ctx.agents.withInitiator(agent, () => bench.ctx.web.search({ query: 'latest news' }))

    expect(input).toContain('Original user request:\npreserve this original request')
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when settings detach', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(WEB_SEARCH_CODEX_SETTINGS_NAMESPACE, {
      baseURL: 'https://search.stored.test/v1',
    })
    expect(await searchOnce(bench.ctx)).toContain('https://search.stored.test/v1')

    await bench.settingsFiber.dispose()
    expect(await searchOnce(bench.ctx)).toContain('https://search.entry.test/v1')
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace and provider when the plugin unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('web-search-codex')

    await bench.pluginFiber.dispose()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('web-search-codex')
    await expect(bench.ctx.web.search({ query: 'after-dispose' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_CONFIGURED_MISSING',
    })
    await bench.ctx.fiber.dispose()
  })
})
