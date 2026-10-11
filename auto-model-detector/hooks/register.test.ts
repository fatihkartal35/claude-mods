import { expect, test } from 'claude-code/testing'
import { atLeast, clip, parseRoute } from './register'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('parseRoute', () => {
  expect(parseRoute('{"model":"opus","effort":"high"}')).toEqual({ model: 'opus', effort: 'high' })
  expect(parseRoute('```json\n{"model":"fable","effort":"max"}\n```')?.model).toBe('fable')
  expect(parseRoute('{"model":"gpt","effort":"high"}')).toBeUndefined()
  expect(parseRoute('{"model":"constructor","effort":"high"}')).toBeUndefined()
  expect(parseRoute('nope')).toBeUndefined()
})

test('atLeast and clip', () => {
  expect(atLeast('haiku', 'opus')).toBe('opus')
  expect(atLeast('fable', 'opus')).toBe('fable')
  expect(atLeast('sonnet', undefined)).toBe('sonnet')
  const long = `HEAD${'x'.repeat(5000)}QUESTION?`
  expect(clip(long)).toContain('HEAD')
  expect(clip(long)).toContain('QUESTION?')
  expect(clip('short')).toBe('short')
})

// Stands in for the engine beneath the plugin: store, session, classifier, model steps.
const engine = (on: any, sessionModel: string, replies: string[], pick = (labels: string[]) => labels[0]) => {
  const m = new Map<string, unknown>()
  const sent: { model: string; effort?: unknown }[] = []
  const asked: string[] = []
  const questions: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_: unknown, e: any) => {
    const q = e.questions[0]
    questions.push(q.question)
    return { result: { questions: e.questions, answers: { [q.question]: pick(q.options.map((o: any) => o.label)) } } } as never
  })
  on('store.get', (_: unknown, e: any) => ({ value: m.get(e.key) }))
  on('store.set', (_: unknown, e: any) => (m.set(e.key, e.value), { value: undefined }))
  on('session.model', () => ({ value: sessionModel }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 50000, window: 1e6 }, rateLimits: [] } }))
  on('model.complete', (_: unknown, e: any) => {
    asked.push(e.prompt)
    return { value: { isAnswered: true, text: replies.shift() ?? 'garbage', usage } } as never
  })
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('turn.step', async function* (_: unknown, e: any) {
    sent.push({ model: e.model, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...usage, model: e.model } }
  })
  return { sent, asked, questions, store: m }
}

const turn = async ($: any, text: string) => {
  await $.prompt.submit({ text })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-5-5', effort: 'medium', messageCount: 1 })) void _
}

test('routes haiku session to classified model', async ($: any, on) => {
  const { sent } = engine(on, 'claude-haiku-5-5', ['{"model":"opus","effort":"xhigh"}'])
  await turn($, 'refactor the auth layer')
  expect(sent).toEqual([{ model: 'claude-opus-5-5', effort: 'xhigh' }])
})

test('never classifies or routes a non-haiku session', async ($: any, on) => {
  const { sent, asked } = engine(on, 'claude-sonnet-5-5', ['{"model":"opus","effort":"xhigh"}'])
  await $.prompt.submit({ text: 'x' })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1 })) void _
  expect(asked).toHaveLength(0)
  expect(sent).toEqual([{ model: 'claude-sonnet-5-5', effort: 'medium' }])
})

test('only moves up: opus stays opus, effort still follows the route', async ($: any, on) => {
  const { sent } = engine(on, 'claude-haiku-5-5', [
    '{"model":"opus","effort":"high"}',
    '{"model":"haiku","effort":"low"}',
    'garbage',
    '{"model":"fable","effort":"max"}',
  ])
  await turn($, 'ödemelerde fiyatlar tutmuyor')
  await turn($, 'buton rengini değiştir')
  await turn($, 'bozuk cevap')
  await turn($, 'mikroservis planı')
  expect(sent).toEqual([
    { model: 'claude-opus-5-5', effort: 'high' },
    { model: 'claude-opus-5-5', effort: 'low' },
    { model: 'claude-opus-5-5', effort: 'medium' },
    { model: 'claude-fable-5-1', effort: 'max' },
  ])
})

test('follow-up sees previous route', async ($: any, on) => {
  const { asked } = engine(on, 'claude-haiku-5-5', ['{"model":"opus","effort":"high"}'])
  await turn($, 'ödemelerde fiyatlar tutmuyor')
  await turn($, 'devam et')
  expect(asked[0]).not.toContain('<previous>')
  expect(asked[1]).toContain('<previous>{"model":"opus","effort":"high"}</previous>')
})

test('/router off stops classifying; stats records usage', async ($: any, on) => {
  const { asked } = engine(on, 'claude-haiku-5-5', [])
  expect((await $.command.run({ command: 'router', args: 'off' })).text).toBe('router: off')
  await $.prompt.submit({ text: 'x' })
  expect(asked).toHaveLength(0)
  await $.command.run({ command: 'router', args: 'on' })
  await turn($, 'x')
  expect(asked).toHaveLength(1)
  expect((await $.command.run({ command: 'router', args: 'stats' })).text).toContain('claude-haiku-5-5: 1 steps')
})

test('asks before xhigh/max, not when the user named it', async ($: any, on) => {
  const { sent, questions } = engine(on, 'claude-haiku-5-5', [
    '{"model":"opus","effort":"max"}',
    '{"model":"opus","effort":"max"}',
  ], () => 'high')
  await turn($, 'mimariyi baştan tasarla')
  await turn($, 'max effort ile düşün')
  expect(questions).toHaveLength(1)
  expect(sent.map(s => s.effort)).toEqual(['high', 'max'])
})

test('does not ask again for a follow-up of a confirmed max', async ($: any, on) => {
  const { sent, questions } = engine(on, 'claude-haiku-5-5', [
    '{"model":"fable","effort":"max"}',
    '{"model":"fable","effort":"max"}',
  ])
  await turn($, 'mikroservis planı')
  await turn($, 'devam')
  expect(questions).toHaveLength(2) // fable, then max — once each
  expect(sent.map(s => s.effort)).toEqual(['max', 'max'])
})

test('fable confirmation: declined → opus; off in settings → not asked', async ($: any, on) => {
  const { sent, questions, store } = engine(on, 'claude-haiku-5-5', [
    '{"model":"fable","effort":"high"}',
    '{"model":"fable","effort":"high"}',
  ], labels => (labels.includes('opus') ? 'opus' : labels.find(l => l.startsWith('Yüksek'))!))
  await turn($, 'mikroservis planı')
  expect(sent[0]).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  store.set('confirm', ['effort']) // as the /router menu saves it
  await turn($, 'mikroservis planı')
  expect(questions).toHaveLength(1)
  expect(sent[1]).toEqual({ model: 'claude-fable-5-1', effort: 'high' })
})

test('/router menu toggles and saves confirmations', async ($: any, on) => {
  const answers = ['Kapat / Turn off', 'Aç / Turn on', 'Onay ayarları / Confirmations', "Fable'a geçiş / Switch to Fable"]
  const { store } = engine(on, 'claude-haiku-5-5', [], () => answers.shift()!)
  expect((await $.command.run({ command: 'router', args: '' })).text).toBe('router: off')
  expect((await $.command.run({ command: 'router', args: '' })).text).toBe('router: on')
  expect((await $.command.run({ command: 'router', args: '' })).text).toContain('Switch to Fable')
  expect(store.get('confirm')).toEqual(['fable'])
})
