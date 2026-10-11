# claude-mods

Claude Code mods by Fatih Kartal. / Fatih Kartal'ın Claude Code modları.

## auto-model-detector

Start a session on **Haiku**. On every prompt, Haiku classifies the task and the turn runs on the right model (haiku / sonnet / opus / fable) and effort (low … max).

Oturumu **Haiku** ile başlat. Her prompt'ta Haiku görevi sınıflandırır, turn doğru model (haiku / sonnet / opus / fable) ve effort (low … max) ile çalışır.

### Install / Kurulum

**Requires Claude Code 2.1.295 or newer** (check with `claude --version`); on older versions the mod does not load. / **Claude Code 2.1.295 veya üstü gerekir**; eski sürümlerde mod yüklenmez.

In a Claude Code terminal session:

```
/plugin install auto-model-detector --marketplace fatihkartal35/claude-mods
```

Installed at the user scope, it also loads in Claude Desktop's Code tab.

### How it routes / Nasıl yönlendirir

- The first prompt picks the model; afterwards the model only moves **up** (a model switch rewrites the prompt cache). Effort changes freely every turn. `/clear` frees the choice again.
- Money, payments, auth, security → at least opus · medium. Vague bug reports → opus · high.
- Commit, push, deploy, OTA → effort low, model unchanged.
- Short follow-ups ("devam", "go on") keep the previous route.
- Naming a model or effort in the prompt ("opus ile", "max effort") wins.
- Before **xhigh/max** effort or a switch to **Fable**, it asks you. Both are on by default; change them with `/auto-model-detector confirm`. If the dialog cannot open, it falls back to high / opus and says so.
- When the quick (low-effort) answer is unsure, Haiku is asked again at medium effort; if that is unsure too, or there is no usable answer, it lands on sonnet · medium (never below the session's current model).
- Does nothing unless the session's own model is Haiku.
- General-purpose subagents follow the session's model (capped at opus); typed subagents (Explore, Plan …) keep their own model.

### What the classifier sees / Sınıflandırıcıya ne gider

Only the rules, the previous route, the first 300 characters of the session's opening prompt, and your prompt (first and last 1500 characters) — never the conversation, files or tool output.

### Hidden notes to the model / Modele görünmeyen notlar

For long release steps (deploy, OTA update, build, publish) the mod adds a note to your prompt that the model sees and you do not: decide the exact command yourself, run it in a Haiku subagent, and bring back only success / failure, key errors and any URL or build id. This keeps long build logs out of the main conversation. The model may still choose to run it itself.

When a prompt is a separate task unrelated to the session's main work (e.g. a web-footer fix in the middle of admin-panel work), the note suggests handing it to a subagent at the classified model and effort, with a self-contained brief, and continuing that subagent for follow-ups. The main conversation stays on its model and keeps its context clean. One-step changes, and anything the model sees as a continuation, it does itself. Want a fully fresh start instead? Use `/clear` or a new session.

### Commands / Komutlar

| Command | |
|---|---|
| `/auto-model-detector` | menu / menü |
| `/auto-model-detector on`, `/auto-model-detector off` | turn the router on / off |
| `/auto-model-detector confirm` | choose what to confirm (high effort, Fable) |
| `/auto-model-detector stats` | tokens and estimated cost per model |
| `/auto-model-detector stats reset` | clear the stats |

The status line shows the current choice as `router: opus · high`, plus any handover note, e.g. `router: opus · low → subagent sonnet · medium`. Each classifier answer is written to the debug log (`claude --debug`).

### Cost / Maliyet

One Haiku call per prompt at low effort (≈ $0.0001–0.0002, ~1 s); only when it is unsure, a second call at medium effort (~1.5–2 s more). Stats use API list prices from `PRICE` in `auto-model-detector/hooks/register.ts` (cache write assumed 1.25× input; Haiku's above-100K tier ignored) and include subagent steps. On a subscription the savings show up as usage-limit headroom.

### Customize / Özelleştir

Edit `RULES` in `auto-model-detector/hooks/register.ts`, then run `/reload-plugins`.
