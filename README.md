# claude-mods

My Claude Code mods: plugins of function hooks that change what Claude Code shows and does.
Each mod lives in its own folder under `mods/`, and the repo is also a plugin marketplace, so any of them installs straight from here.

## Mods

| Mod | What it does |
| --- | --- |
| [usage-band](mods/usage-band) | A bordered band above the prompt: context fill and what takes it, 5-hour and weekly limits with reset times, token usage and cost. |

## Install

```sh
claude plugin marketplace add F:/works/personal/claude-mods
claude plugin install usage-band@claude-mods
```

Claude Code reads an installed mod straight from this folder: after editing one, run `/reload-plugins` in a session.

To try a mod for one session without installing it:

```sh
claude --plugin-dir mods/usage-band
```

## Adding a mod

1. Create `mods/<name>/` with `.claude-plugin/plugin.json`, `hooks/hooks.json` and `hooks/register.tsx`.
2. Add it to `plugins` in `.claude-plugin/marketplace.json` with `"source": "./mods/<name>"`.
3. Check it: `claude plugin validate mods/<name>` and `claude plugin test mods/<name>`.
