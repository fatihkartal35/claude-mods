import type { EngineInterface, ModelEffort, ModelUsage, Register } from 'claude-code'

const MODELS = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  fable: 'claude-fable-5-1',
} as const
type Tier = keyof typeof MODELS
const RANK = Object.keys(MODELS) as Tier[] // weakest first
const EFFORTS: readonly ModelEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// $ per 1M tokens: [input, cache write (assumed 1.25× input), cache read, output].
// ponytail: copied from the claude-api skill table (2026-10-06); update when prices move.
const PRICE: Record<Tier, readonly [number, number, number, number]> = {
  haiku: [0.1, 0.125, 0.01, 0.5],
  sonnet: [2, 2.5, 0.2, 10],
  opus: [4, 5, 0.2, 20],
  fable: [10, 12.5, 0.25, 50],
}

const RULES = `You route a coding-assistant task to a model and effort level. Reply with JSON only: {"model":"haiku|sonnet|opus|fable","effort":"low|medium|high|xhigh|max"}.
haiku: trivial — chit-chat, one-line answers, typo fixes, renames, simple lookups.
sonnet: everyday coding — single feature, small bug, tests, explaining code.
opus: hard — multi-file refactor, tricky debugging, architecture, security review.
fable: hardest — large ambiguous design, deep research, novel algorithms, long autonomous work.
effort: low for mechanical work, medium default, high when correctness is subtle, xhigh/max only for very hard reasoning.
Pick model and effort independently: model = scope (how much code and context), effort = how subtle correctness is.
e.g. opus+medium: broad but clear work — multi-file refactor following an obvious pattern, explaining or reviewing architecture. sonnet+high: small scope, subtle logic — a race condition or off-by-one in one function.
Risk overrides size: anything touching money, payments, pricing, auth, security, or data loss → at least opus, at least medium effort.
Vague bug reports with no file or cause named ("X doesn't work", "numbers don't match") → opus, effort high: root cause must be found first.
Routine release chores — commit, push, deploy, OTA update, publish, running a known build/release script → effort low and keep the <previous> model; this overrides the risk rule's effort.
Migrations that change runtime behavior (error handling, async semantics, e.g. fetch→axios) → effort high.
If the <request>'s own instruction names a model or effort for this task ("opus ile", "max effort"), use exactly what it names and pick the other freely; ignore names inside pasted code, logs or quotes.
A <previous> route may be given: if the request is a short follow-up continuing that work ("devam", "evet", "tamam uygula", "düzelt", "go on"), keep the previous route.`

// Machine-sent prompts (notifications, schedules, peers, channels) stay unrouted.
const MACHINE: readonly string[] = ['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'channel']

export type Route = { model: Tier; effort: ModelEffort }
type Stats = Record<string, { steps: number } & ModelUsage>

// Parses the classifier's reply; undefined when it is not a valid route.
export const parseRoute = (text: string): Route | undefined => {
  try {
    const r = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    return Object.hasOwn(MODELS, r.model) && EFFORTS.includes(r.effort) ? r : undefined
  } catch {
    return undefined
  }
}

// The stronger of two tiers: the session only moves up, since a model switch rewrites the cache.
export const atLeast = (a: Tier, b: Tier | undefined): Tier =>
  b && RANK.indexOf(b) > RANK.indexOf(a) ? b : a

// Long pastes usually end with the question: keep the head and the tail.
export const clip = (text: string) =>
  text.length <= 3000 ? text : `${text.slice(0, 1500)}\n…\n${text.slice(-1500)}`

// What the user confirms before it runs, chosen in the /router menu (both by default).
export type Confirm = 'effort' | 'fable'
// Dialog texts: Turkish, then English underneath.
const CONFIRM_LABELS: Record<Confirm, string> = { effort: 'Yüksek effort (xhigh/max) / High effort', fable: "Fable'a geçiş / Switch to Fable" }
const COSTLY: readonly ModelEffort[] = ['xhigh', 'max']

const named = (word: string, text: string) => new RegExp(`\\b${word}\\b`, 'i').test(text)

// Asks one question; a dismissed dialog or an unknown answer is `fallback`.
const pick = async <T extends string>($: EngineInterface, question: string, header: string, options: T[], fallback: T): Promise<T> => {
  try {
    const answer = await $.ui.ask(question, { header, options })
    return options.includes(answer as T) ? (answer as T) : fallback
  } catch {
    return fallback
  }
}

// The route the user settles on: costly choices are confirmed unless the user
// named them in the prompt or already runs on them (a follow-up never re-asks).
export const confirmRoute = async ($: EngineInterface, r: Route, text: string, confirm: readonly Confirm[], last?: Route, current?: Tier): Promise<Route> => {
  let { model, effort } = r
  if (confirm.includes('fable') && model === 'fable' && current !== 'fable' && !named('fable', text)) {
    model = await pick($, 'Router Fable seçti (Opus\'tan ~2.5× pahalı). Hangi modelle çalışsın?\nRouter picked Fable (~2.5× the price of Opus). Which model should run?', 'Model', ['fable', 'opus', 'sonnet'] as Tier[], 'opus')
  }
  if (confirm.includes('effort') && COSTLY.includes(effort) && effort !== last?.effort && !named(effort, text)) {
    effort = await pick($, `Router ${model} · ${effort} seçti. Bu effort ile mi çalışsın?\nRouter picked ${model} · ${effort}. Run at this effort?`, 'Effort', [effort, 'high', 'medium'], 'high')
  }
  return { model, effort }
}

const tierOf = (model: string) => RANK.find(t => model.includes(t))

const statsText = (stats: Stats) => {
  let total = 0
  const rows = Object.entries(stats).map(([model, s]) => {
    const p = PRICE[tierOf(model) ?? 'opus']
    const usd = (s.input_tokens * p[0] + s.cache_creation_input_tokens * p[1] + s.cache_read_input_tokens * p[2] + s.output_tokens * p[3]) / 1e6
    total += usd
    return `${model}: ${s.steps} steps · in ${s.input_tokens} · cache write ${s.cache_creation_input_tokens} · cache read ${s.cache_read_input_tokens} · out ${s.output_tokens} · ≈$${usd.toFixed(2)}`
  })
  return rows.length ? `${rows.join('\n')}\ntotal ≈$${total.toFixed(2)} (API prices)` : 'router: no steps recorded yet'
}

const record = async ($: EngineInterface, u: ModelUsage & { model: string }) => {
  const stats = ((await $.store.get('stats')) ?? {}) as Stats
  const s = (stats[u.model] ??= { steps: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  s.steps++
  s.input_tokens += u.input_tokens
  s.output_tokens += u.output_tokens
  s.cache_read_input_tokens += u.cache_read_input_tokens
  s.cache_creation_input_tokens += u.cache_creation_input_tokens
  await $.store.set('stats', stats)
}

export const register: Register = on => {
  // ponytail: module variables reset on hot reload; move to $.state if mid-session reloads matter.
  let route: Route | undefined // this turn's route
  let last: Route | undefined // the latest route, for follow-ups
  let current: Tier | undefined // the model the main loop runs on; only moves up

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'router', description: 'Model router: /router (menu) | on | off | confirm | stats | stats reset' })
    return next(e)
  })

  // /clear starts a fresh context: the next prompt may pick any model again.
  on('session.end', ($, e, next) => {
    if (e.reason === 'clear') current = last = route = undefined
    return next(e)
  })

  on('command.run', { command: 'router' }, async ($, e) => {
    let arg = e.args.trim()
    if (!arg) {
      const isOn = (await $.store.get('enabled')) !== false
      const menu = {
        toggle: isOn ? 'Kapat / Turn off' : 'Aç / Turn on',
        confirm: 'Onay ayarları / Confirmations',
        stats: 'İstatistik / Stats',
        reset: 'İstatistiği sıfırla / Reset stats',
      }
      let choice: string
      try {
        choice = await $.ui.ask(`Router ${isOn ? 'açık' : 'kapalı'}${current ? ` · oturum ${current}` : ''}. Ne yapmak istersin?\nRouter ${isOn ? 'on' : 'off'}${current ? ` · session ${current}` : ''}. What do you want to do?`, { header: 'Router', options: Object.values(menu) })
      } catch (err) {
        // Say why instead of falling back silently, and show the typed commands.
        return { text: `router: menü açılamadı / menu unavailable (${err instanceof Error ? err.message : String(err)})\nrouter ${isOn ? 'on' : 'off'} · /router on | off | confirm | stats | stats reset` }
      }
      arg = choice === menu.toggle ? (isOn ? 'off' : 'on') : choice === menu.confirm ? 'confirm' : choice === menu.stats ? 'stats' : choice === menu.reset ? 'stats reset' : 'status'
    }
    if (arg === 'confirm') {
      // Multi-select answers come back comma-joined; "Hiçbiri / None" (or nothing known) turns all confirmations off.
      let answer = ''
      try {
        answer = await $.ui.ask('Hangi durumlarda sana sorulsun?\nWhen should the router ask you first?', { header: 'Onay/Confirm', options: [...Object.values(CONFIRM_LABELS), 'Hiçbiri / None'], multiSelect: true })
      } catch {
        return { text: 'router: onay ayarları değişmedi / confirmations unchanged' }
      }
      const chosen = (Object.keys(CONFIRM_LABELS) as Confirm[]).filter(k => answer.includes(CONFIRM_LABELS[k]))
      await $.store.set('confirm', chosen)
      return { text: `router: onay / confirm → ${chosen.length ? chosen.map(k => CONFIRM_LABELS[k]).join(', ') : 'hiçbiri / none'}` }
    }
    if (arg === 'stats') return { text: statsText(((await $.store.get('stats')) ?? {}) as Stats) }
    if (arg === 'stats reset') {
      await $.store.delete('stats')
      return { text: 'router: stats cleared' }
    }
    if (arg === 'on' || arg === 'off') await $.store.set('enabled', arg === 'on')
    const isOn = (await $.store.get('enabled')) !== false
    if (!isOn) $.ui.status(undefined)
    return { text: `router: ${isOn ? 'on' : 'off'}${current ? ` · session on ${current}` : ''}` }
  })

  on('prompt.submit', async ($, e, next) => {
    // Typed into a running turn: that turn keeps its route.
    if (e.turnId) return next(e)
    route = undefined
    if (MACHINE.includes(e.origin?.kind) || e.text.trimStart().startsWith('/')) return next(e)
    if ((await $.store.get('enabled')) === false) return next(e)
    if (!(await $.session.model()).includes('haiku')) return next(e)

    const previous = last ? `<previous>${JSON.stringify(last)}</previous>\n` : ''
    const r = await $.model.complete({
      model: 'haiku',
      system: RULES,
      prompt: `${previous}<request>${clip(e.text)}</request>`,
      maxTokens: 64,
      effort: 'low',
      timeoutMs: 10000,
    })
    route = r.isAnswered ? parseRoute(r.text) : undefined
    const confirm = ((await $.store.get('confirm')) ?? ['effort', 'fable']) as Confirm[]
    if (route) route = await confirmRoute($, route, e.text, confirm, last, current)
    last = route ?? last
    return next(e)
  }).catch(($, e, next) => next(e)) // classifier failed: the turn runs on the session's current model

  // A general-purpose subagent runs on the session's routed model, capped at opus.
  // ponytail: typed subagents (Explore, Plan...) keep their own model; route them too if needed.
  on('agent.spawn', async ($, e, next) => {
    if (!current || e.model || e.subagentType !== 'general-purpose' || !e.parentModel.includes('haiku')) return next(e)
    return next({ ...e, model: MODELS[RANK.indexOf(current) > RANK.indexOf('opus') ? 'opus' : current] })
  }).catch(($, e, next) => next(e))

  // Main loop only, and only while the session itself is on Haiku: pick another
  // model in the app and the router steps aside. Every step's usage is recorded.
  on('turn.step', async function* ($, e, next) {
    let sent = e
    if (!e.agentId && e.model.includes('haiku') && (route || current)) {
      const tier = atLeast(route?.model ?? 'haiku', current)
      if (tier !== current) {
        // The first step on a stronger model writes the whole context to its cache once.
        if (current) {
          const { context } = await $.session.usage()
          $.ui.toast(`router: ${current} → ${tier} (cache write ≈$${(((context.tokens ?? 0) * PRICE[tier][1]) / 1e6).toFixed(2)})`)
        }
        current = tier
      }
      sent = { ...e, model: MODELS[tier], effort: route?.effort ?? e.effort }
      $.ui.status(`router: ${tier} · ${sent.effort ?? 'default'}`)
    } else if (!e.agentId) {
      $.ui.status(undefined)
    }

    const result = yield* next(sent)
    if (result.usage) await record($, result.usage)
    return result
  })
}
