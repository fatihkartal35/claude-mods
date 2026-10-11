# claude-mods

Claude Code mods by Fatih Kartal. / Fatih Kartal'ın Claude Code modları.

## auto-model-detector

Start a session on **Haiku**. On every prompt, Haiku classifies the task and the turn runs on the right model (haiku / sonnet / opus / fable) and effort (low … max).

Oturumu **Haiku** ile başlat. Her prompt'ta Haiku görevi sınıflandırır, turn doğru model (haiku / sonnet / opus / fable) ve effort (low … max) ile çalışır.

### Install / Kurulum

In a Claude Code terminal session (Claude Code 2.1.295 or newer):

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
- Before **xhigh/max** effort or a switch to **Fable**, it asks you (configurable).
- Does nothing unless the session's own model is Haiku.

### Commands / Komutlar

| Command | |
|---|---|
| `/router` | menu / menü |
| `/router on`, `/router off` | turn the router on / off |
| `/router confirm` | choose what to confirm (high effort, Fable) |
| `/router stats` | tokens and estimated cost per model |
| `/router stats reset` | clear the stats |

### Cost / Maliyet

One Haiku call per prompt (≈ $0.0002, ~1 s). Prices in `auto-model-detector/hooks/register.ts` (`PRICE`) are API list prices; on a subscription the savings show up as usage-limit headroom.

### Customize / Özelleştir

Edit `RULES` in `auto-model-detector/hooks/register.ts`, then run `/reload-plugins`.
