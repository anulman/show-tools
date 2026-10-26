# Review workstream plans with Hunk

Run these commands from the main checkout, `/Users/anulman/dev/show-tools`. Each opens the named workstream's committed changes in Hunk:

```sh
hunk diff main...review/performance-engine
hunk diff main...review/filters-and-patches
hunk diff main...review/elitedesk-peripherals
hunk diff main...review/video-assistant
```

The review branches are attached to the sessions' worktrees. Their new commits update these names. The main checkout stays on `main`. The three-dot comparison uses the common ancestor, so newer coordination documents on `main` do not appear as deletions in the plans.

Press `c` in Hunk to leave an inline comment. Leave the window open and ask the owning session to address your Hunk comments. The agent can read the exact file and line anchors, revise its plan in its worktree, commit the revision, reply to the notes, and reload the comparison. Each plan can have its own review window.

Agents can inspect sessions through Hunk's local daemon:

```sh
hunk session list --json
hunk session get SESSION_ID --json
hunk session comment list SESSION_ID --type user --json
```

When several windows use the main repository, select a session ID by inspecting its source comparison. Matching only `--repo` is ambiguous in that case.

After a revision, the owning agent can refresh that window:

```sh
hunk session reload SESSION_ID -- diff main...review/performance-engine
```

Use the corresponding branch for the other plans. Hunk's complete agent workflow is available through `hunk skill show`.

## Worktree ownership

| Review branch | Owning session | Worktree |
| --- | --- | --- |
| `review/performance-engine` | Performance Engine | `/Users/anulman/.codex/worktrees/d5db/show-tools` |
| `review/filters-and-patches` | Filters & patches | `/Users/anulman/.codex/worktrees/72b3/show-tools` |
| `review/elitedesk-peripherals` | EliteDesk hosting | `/Users/anulman/.codex/worktrees/f8e7/show-tools` |
| `review/video-assistant` | Video Assistant | `/Users/anulman/.codex/worktrees/b0ba/show-tools` |

These comparisons show committed changes. A session must commit its plan revision before that revision appears here. For an active uncommitted edit, open Hunk from that worktree or use its session reload `--source` option as described in the bundled skill. Do not assume a branch comparison includes another worktree's uncommitted files.
