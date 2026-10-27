# Review the workstream plans

Use GitHub PR comments as the durable review record:

| Plan | Pull request | Branch |
| --- | --- | --- |
| Performance Engine | [PR #1](https://github.com/anulman/show-tools/pull/1) | `review/performance-engine` |
| Filters and patches | [PR #2](https://github.com/anulman/show-tools/pull/2) | `review/filters-and-patches` |
| EliteDesk peripherals | [PR #3](https://github.com/anulman/show-tools/pull/3) | `review/elitedesk-peripherals` |
| Video Assistant | [PR #4](https://github.com/anulman/show-tools/pull/4) | `review/video-assistant` |

Each PR contains one plan file and targets `main`. They were initially published against `review/workstream-base` because remote `main` was behind the operator's checkout. After the operator authorized publishing local `main`, the PRs were retargeted to `main`. The review-base branch remains as a historical snapshot. No plans are merged automatically.

Write comments in the PR's Files changed view and submit the review so the owning session can retrieve it. The session revises its plan in its worktree and pushes the same branch. Keep feature implementation separate from plan review.

## Recovered local review

The Performance Engine PR body preserves three operator comments captured while the Hunk session was live, with their original line numbers. This is a partial recovery, not a complete export of the finished review. Additional comments were not recovered from Hunk's on-disk state.

## Optional local diff browsing

Hunk can still display the committed plan changes from the main checkout:

```sh
hunk diff main...review/performance-engine
hunk diff main...review/filters-and-patches
hunk diff main...review/elitedesk-peripherals
hunk diff main...review/video-assistant
```

Hunk 0.24.0 holds review notes in memory. Closing the review removes its live session; Git branches and worktrees do not save those notes. The installed version's review store and broker source were inspected, and no durable comment archive was found in its config, state or runtime locations. Upstream tracks persistence after quit in [Hunk issue #113](https://github.com/modem-dev/hunk/issues/113).

Do not use Hunk comments as the only record of a review. A local persistence integration would need verified save, reopen, update and crash behavior before adoption. The earlier instruction to leave the window open was a live-session requirement, not durable storage.

Agents can load Hunk's installed skill using `hunk skill path` and inspect a live window with `hunk session list --json`. Local daemon calls may require sandbox escalation. No daemon restart or interactive Hunk launch is needed for GitHub review.

## Worktree ownership

| Branch | Owning session | Worktree |
| --- | --- | --- |
| `review/performance-engine` | Performance Engine | `/Users/anulman/.codex/worktrees/d5db/show-tools` |
| `review/filters-and-patches` | Filters and patches | `/Users/anulman/.codex/worktrees/72b3/show-tools` |
| `review/elitedesk-peripherals` | EliteDesk hosting | `/Users/anulman/.codex/worktrees/f8e7/show-tools` |
| `review/video-assistant` | Video Assistant | `/Users/anulman/.codex/worktrees/b0ba/show-tools` |

Branch comparisons show committed changes. Commit and push each verified plan revision to update its PR. Do not include another session's edits or merge branches automatically into the operator's checkout.
