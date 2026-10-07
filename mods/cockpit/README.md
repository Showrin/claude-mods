# cockpit

A bordered band right above the Claude Code prompt.

![cockpit above the Claude Code prompt](screenshot.png)

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
claude plugin validate mods/cockpit
claude plugin test mods/cockpit
```
