# on-demand-savior

Stops Claude before your 5-hour or weekly limit spills into on-demand (extra) usage, then picks the work back up once the limit resets.

1. **Watch**: every usage reading is checked against the 5-hour and weekly thresholds (96% by default), or the on-demand budget when one is set.
2. **Pause**: the running turn is stopped, and new prompts and tool calls are held back.
3. **Hand off**: the model writes a handoff (goal, done so far, in progress, next steps, key files, open questions) to `.claude/handoffs/handoff-<time>.md` in the project.
4. **Resume**: a minute after the window resets, the handoff is sent back as a prompt and the work carries on.

While it waits, the status line shows `🛟 Paused at 5-hour 97% · resumes 3:31 PM`, and the band right above the prompt shows the same with a **Resume the session** button (`r` once the band has focus) to go on now.

The handoff opens in a side pane on the right, with the same button. A pane opened on its own needs a terminal at least 144 columns wide; `/savior handoff` opens it at any width.

## Commands

| Command | What it does |
| --- | --- |
| `/savior` or `/savior status` | Whether it is on, and any pause in force |
| `/savior off` | Stop guarding (and clear a pause): Claude goes on into on-demand usage |
| `/savior on` | Guard again, ending an early resume's quiet; pauses at once if the last reading is already past the threshold |
| `/savior resume` | Resume from the handoff now, before the reset. Limit checks stay off until that window resets, so this may use on-demand usage |
| `/savior handoff` | Show the handoff in the side pane |

On or off is remembered across sessions.

## Settings

Set in `/config`:

| Setting | Default | What it does |
| --- | --- | --- |
| `fiveHourThreshold` | `96` | Pause once the 5-hour limit reaches this percent used |
| `weeklyThreshold` | `96` | Pause once the weekly limit reaches this percent used |
| `onDemandBudgetUsd` | `0` | On-demand usage to let through once a limit is used up, then pause |

With a budget above `0`, the thresholds step aside: the limit runs full, on-demand usage is counted from that moment (at API prices, as `/cost` counts it, within this session), and the pause comes once the budget is spent.

## Good to know

- The pause comes from a usage reading, and one arrives after each model response, so it can land a point or two past the threshold. Turning off extra usage in your claude.ai settings is the hard stop; this mod is the graceful one.
- Writing the handoff is one more model call, which is what the room below 100% is for.
- The resume needs Claude Code open. Closed, the next session in the same project finds the pause and resumes from its handoff once the window has reset.
- A pause belongs to the project it happened in.

## Develop

```sh
claude plugin validate mods/on-demand-savior
claude plugin test mods/on-demand-savior
```
