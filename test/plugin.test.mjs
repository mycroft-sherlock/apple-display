import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, inject } from '../lib/index.js'

function mount() {
  const tools = new Map()
  const ctx = {
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    effect(factory) {
      factory()
      return () => {}
    },
  }
  apply(ctx)
  return tools
}

test('declares the tools service', () => {
  assert.deepEqual(inject, ['tools'])
})

test('registers exactly four tools', () => {
  const tools = mount()
  assert.deepEqual([...tools.keys()].sort(), [
    'apple_display_get',
    'apple_display_list',
    'apple_display_set',
    'apple_display_step',
  ])
})

test('set rejects out-of-range percent before spawning Python', async () => {
  const tools = mount()
  await assert.rejects(() => tools.get('apple_display_set').execute({ percent: 101 }), /between 0 and 100/)
  await assert.rejects(() => tools.get('apple_display_set').execute({ percent: 1.5 }), /between 0 and 100/)
})

test('step rejects zero and out-of-range delta', async () => {
  const tools = mount()
  await assert.rejects(() => tools.get('apple_display_step').execute({ delta: 0 }), /non-zero/)
  await assert.rejects(() => tools.get('apple_display_step').execute({ delta: 101 }), /non-zero/)
})

test('list fails closed with a readable error when hidapi is absent', async () => {
  const tools = mount()
  await assert.rejects(() => tools.get('apple_display_list').execute({}), /hidapi|Python not found/)
})
