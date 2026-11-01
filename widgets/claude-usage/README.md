# Claude Usage (UNOFFICIAL)

> **Unofficial and unsupported.** Not affiliated with or endorsed by Anthropic. It reads
> `cachedUsageUtilization`, an *undocumented* cache field that Claude Code writes to
> `~/.claude.json`. The field can change or disappear in any release, and the numbers are only as
> fresh as Claude Code's last refresh.

Shows the remaining percentage of each usage window (5-hour, weekly, per-model) with its reset time.

## Enabling
Both are off by default:

```yaml
widgets:
  - use: claude-usage
    position: { anchor: top-right, x: 3.5vw, y: 52vh, width: 25vw }
providers:
  claude_usage:
    enabled: true
```

The provider forwards only `{key, pct, resets}` rows and the fetch timestamp - nothing else from
`~/.claude.json` (which also holds account and project data) ever reaches the page.

- **needs:** `claudeUsage`
- **settings:** `warn_below`, `critical_below`
