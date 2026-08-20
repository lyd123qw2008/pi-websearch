import { describe, expect, it } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as codexPlugin from '../src/index.js'

describe('web-search-codex Loader composition', () => {
  it('keeps the function-plugin namespace and inject declaration', () => {
    expect('default' in codexPlugin).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(codexPlugin) as Record<string, unknown>
    expect(unwrapped).toBe(codexPlugin)
    expect(unwrapped.name).toBe('web-search-codex')
    expect(unwrapped.inject).toEqual(['web'])
    expect(['function', 'object']).toContain(typeof unwrapped.Config)
    expect(typeof unwrapped.apply).toBe('function')
  })
})
