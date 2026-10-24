# turn-memo

Prints a one-line memo beneath every reply, right in the terminal transcript.

```
Tokens 11k  ·  Read/Write 500/1k  ·  Cache R/W 9k/500  ·  Cost $4.57
```

- **Tokens**: this turn's total (read + write + cache read + cache write).
- **Read/Write**: uncached input tokens / generated output tokens.
- **Cache R/W**: input tokens served from the prompt cache / written to it.
- **Cost**: the session's running total, as `/cost` totals it (the API gives no per-turn price).

Nothing is printed for a turn with no usage (an interrupt, an API error) or for a subagent's turn.

## Develop

```sh
claude plugin validate mods/turn-memo
claude plugin test mods/turn-memo
```
