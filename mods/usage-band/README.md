# usage-band

A bordered band right above the Claude Code prompt:

```
╭──────────────────────────────────────────────────────────────────────────────────────────╮
│ Context ▬▬▬▬▬───── 45% used  90k/200k  🐸🐸🐸  ■ Messages 60k   ■ System tools 18k   ...   │
│ ──────────────────────────────────────────────────────────────────────────────────────── │
│ 5h ▬▬▬▬▬▬────  38% left  │  Week ▬───────  91% left  │  Read/Write 284/71.3k   │  Tokens 20.4M │
│ ⏳ 03:20 AM (4h 13m)      │  ⏳ Fri 02:00 PM (1d 14h)   │  Cache R/W 20.2M/167.1k │  Cost   $9.87 │
╰──────────────────────────────────────────────────────────────────────────────────────────╯
```

- **Context**: how full the context window is, and the biggest categories filling it (as `/context` lists them, estimated locally).
- **5h / Week**: how much of each rate-limit window is left, when it resets (exact time and countdown, ticking each minute).
- **Read/Write, Cache R/W, Tokens**: tokens over the whole conversation, counted from the transcript at start and added to after each reply.
- **Cost**: the session's cost as `/cost` totals it.

Bars and percentages turn yellow from 70% used and red from 90%.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `timezone` | `system` | IANA timezone for reset times, e.g. `Asia/Dhaka`. |

Change it under `/config`.

## Develop

```sh
claude plugin validate mods/usage-band
claude plugin test mods/usage-band
```
