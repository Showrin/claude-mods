# on-demand-savior

Stops Claude before your 5-hour or weekly limit spills into on-demand (extra) usage, then picks the work back up once the limit resets.

1. **Watch**: every usage reading is checked against the 5-hour and weekly thresholds (96% by default), or the on-demand budget when one is set.
2. **Pause**: the running turn is stopped, and new prompts and tool calls are held back.
3. **Hand off**: the model writes a handoff (goal, done so far, in progress, next steps, key files, open questions) to `handoff-<project>-<time>.md`, in the project's `.claude/handoffs` or the folder you choose. Handoffs are kept: each pause writes a new file, and nothing deletes one.
4. **Resume**: a minute after the window resets, the handoff is sent back as a prompt and the work carries on.

While it waits, the band right above the prompt shows `🛟 Paused at 5-hour 97% · resumes 3:31 PM` with a **Resume now** button (`r` once the band has focus) to go on now.

The handoff opens in a side pane on the right, with the same button. A pane opened on its own needs a terminal at least 144 columns wide; `/savior handoff` opens it at any width.

## Commands

| Command | What it does |
| --- | --- |
| `/savior` or `/savior status` | Whether it is on, and any pause in force |
| `/savior off` | Stop guarding every thread (and clear a pause): Claude goes on into on-demand usage |
| `/savior on` | Guard again, ending an early resume's quiet; pauses at once if the last reading is already past the threshold |
| `/savior resume` | Resume from the handoff now, before the reset. Checks on that limit stay off until it resets, so this may use on-demand usage; other limits still pause |
| `/savior handoff` | Show the handoff in the side pane |
| `/savior thread off` | Stop guarding this thread only: it never pauses and ignores a pause another thread hit; a pause this thread hit ends |
| `/savior thread on` | Guard this thread again; shows a pause in force, or pauses at once if the last reading is past the threshold |
| `/savior handoff off` | This thread still pauses, but writes no handoff (no extra model call) and resumes with a plain "carry on" prompt |
| `/savior handoff on` | Write the handoff again in this thread |

On or off is remembered across sessions. A thread's own switches are kept with that thread, so they come back when you resume it, and a new thread starts guarded with a handoff.

## Settings

Set in `/config`:

| Setting | Default | What it does |
| --- | --- | --- |
| `fiveHourThreshold` | `96` | Pause once the 5-hour limit reaches this percent used; `0` uses `96` |
| `weeklyThreshold` | `96` | Pause once the weekly limit reaches this percent used; `0` uses `96` |
| `onDemandBudgetUsd` | `0` | On-demand usage to let through once a limit is used up, then pause |
| `handoffDir` | empty | Folder to keep handoffs in: absolute (`D:/notes/handoffs`), under your home (`~/handoffs`), or relative to the project (`docs/handoffs`). Empty uses the project's `.claude/handoffs` |

With a budget above `0`, the thresholds step aside: the limit runs full, on-demand usage is counted from that moment (at API prices, as `/cost` counts it, within this session), and the pause comes once the budget is spent.

`/config` does not save an emptied number field; the old value stays. Type `0` instead: no budget, or the default threshold.

## Good to know

- The pause comes from a usage reading, and one arrives after each model response, so it can land a point or two past the threshold. Turning off extra usage in your claude.ai settings is the hard stop; this mod is the graceful one.
- Writing the handoff is one more model call, which is what the room below 100% is for. `/savior handoff off` skips it in that thread.
- The resume needs Claude Code open. Closed, the next session in the same project finds the pause and resumes from its handoff once the window has reset.
- A pause belongs to the project it happened in: it holds every guarded thread there, not only the one that hit the limit. At the reset, the thread that paused resumes from its handoff; another thread takes over two minutes later only if that one has not (it may be closed).
- A setting changed in `/config` counts from the next usage reading; no `/reload-plugins` needed. With two copies of the plugin installed (say, one from the marketplace and one from `--plugin-dir`), it cannot tell which settings are its own, so it keeps the ones it loaded with until `/reload-plugins`: keep one copy.

## Develop

```sh
claude plugin validate mods/on-demand-savior
claude plugin test mods/on-demand-savior
```
