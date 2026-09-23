/** The `web-search-codex` settings section layered over the composition entry. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, resolveConfig, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as codexPlugin from '../src/index.js'
import { Config } from '../src/index.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function merge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const before = result[key]
    result[key] = before && typeof before === 'object' && !Array.isArray(before)
      && value && typeof value === 'object' && !Array.isArray(value)
      ? merge(before as Record<string, unknown>, value as Record<string, unknown>) : value
  }
  return result
}

/**
 * Mount a consumer behind Loader and edit its raw configuration, the same path
 * profile reconciliation uses. Inlined from the Harness `liveConfig` fixture
 * because this package lives outside the Harness source tree.
 * @param ctx - context the entry is created in.
 * @param plugin - the plugin module to mount as a Loader builtin.
 * @param initial - the composition entry's initial raw config.
 * @returns the entry, its fiber, and the patch/replace helpers.
 */
async function liveConfig(ctx: Context, plugin: Plugin, initial: object = {}) {
  if (ctx.get('loader') === undefined) {
    await ctx.plugin(Loader)
  }
  const name = `live-${Object.keys(ctx.loader.builtins).length}`
  ctx.loader.builtins[name] = plugin
  const options = { id: plugin.name ?? name, name: `cordis:${name}`, config: initial }
  const id = await ctx.loader.create(options)
  const entry = ctx.loader.resolve(id)
  await entry.fiber!.await()
  const replace = async (next: Record<string, unknown>) => {
    const fiber = entry.fiber!
    resolveConfig(fiber.runtime!, fiber.ctx.waterfall(fiber, 'internal/config', next, () => next))
    await entry.update({ config: next })
    await entry.fiber!.await()
    ctx.emit('app-boot/config-reload')
  }
  return {
    entry,
    fiber: entry.fiber!,
    update: (patch: Record<string, unknown>) => replace(merge(entry.options.config as Record<string, unknown>, patch)),
    replace,
  }
}

async function boot(): Promise<{ ctx: Context; live: Awaited<ReturnType<typeof liveConfig>> }> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, { searchProvider: 'codex-local' })
  await ctx.plugin(AgentRegistry)
  const live = await liveConfig(ctx, codexPlugin, {
    apiKey: 'search-key',
    baseURL: 'https://search.entry.test/v1',
    model: 'search-model',
    stream: false,
  })
  return { ctx, live }
}

/**
 * Run one search and answer the endpoint it reached. A fresh `Response` per call
 * because a body can only be read once, and the call history is cleared because
 * repeated `spyOn` returns the same spy.
 * @param ctx - context whose `ctx.web` serves the search.
 * @returns the URL the provider fetched.
 */
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

    await bench.live.update({ baseURL: 'https://search.stored.test/v1' })

    expect(await searchOnce(bench.ctx)).toContain('https://search.stored.test/v1')
    await bench.ctx.fiber.dispose()
  })

  it('declares every Config field volatile so the entry is a settings namespace', () => {
    // The whole reason this package needs no registration call: a volatile field
    // is what makes the entry describable by `ctx.settings`. A non-volatile field
    // makes the entry invisible there, so a stored section can never be imported.
    const fields = Object.entries(Config.dict ?? {})
    expect(fields.map(([key]) => key)).toEqual([
      'apiKey', 'apiKeyEnv', 'baseURL', 'model', 'searchContextSize', 'stream', 'maxOutputTokens',
    ])
    for (const [key, child] of fields) {
      expect(`${key}:${String(child.meta.volatile)}`).toBe(`${key}:true`)
    }
  })

  it('marks the literal credential as a settings secret', () => {
    expect(Config.dict?.apiKey?.meta.role).toBe('secret')
    expect(Config.dict?.apiKeyEnv?.meta.role).toBe('credential-ref')
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

  it('releases the provider when the plugin unloads', async () => {
    const bench = await boot()
    expect(await searchOnce(bench.ctx)).toContain('https://search.entry.test/v1')

    await (bench.live.fiber as Fiber).dispose()
    await expect(bench.ctx.web.search({ query: 'after-dispose' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_CONFIGURED_MISSING',
    })
    await bench.ctx.fiber.dispose()
  })
})
