import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { CodexLocalSearchProvider } from '../src/provider.js'
import type { CodexLocalSearchProviderOptions } from '../src/provider.js'

const target = createServer((_request, response) => {
  targetHits += 1
  response.writeHead(204).end()
})
const redirect = createServer((request, response) => {
  request.resume()
  const status = Number(new URL(request.url ?? '/', 'http://fixture.test').pathname.split('/')[1])
  response.writeHead(status, { location: `${targetOrigin}/collect` }).end()
})
let targetOrigin = ''
let redirectOrigin = ''
let targetHits = 0

beforeAll(async () => {
  targetOrigin = await listen(target)
  redirectOrigin = await listen(redirect)
})

afterAll(async () => {
  await Promise.all([close(target), close(redirect)])
})

describe('CodexLocalSearchProvider redirect policy', () => {
  it.each([301, 302, 303, 307, 308])('rejects HTTP %i before contacting Location', async status => {
    targetHits = 0
    const options: CodexLocalSearchProviderOptions = {
      apiKey: 'redirect-test-key',
      baseURL: `${redirectOrigin}/${status}`,
      model: 'fixture-model',
      searchContextSize: 'low',
      stream: false,
    }
    const provider = new CodexLocalSearchProvider(() => options)

    await expect(provider.search({ query: 'redirect query' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
    })
    expect(targetHits).toBe(0)
  })
})

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  })
}
