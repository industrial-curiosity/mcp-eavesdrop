---
name: git
description: Use this skill for any git operation — committing, branching, pushing, pulling, diffing, logging, status checks, stashing, merging, rebasing, or any other version control task. Activate whenever the user mentions git, GitHub, branches, commits, diffs, pull requests, or source control — even if they don't say "git" explicitly.
allowed-tools: mcp_gitkraken_git_add_or_commit mcp_gitkraken_git_blame mcp_gitkraken_git_branch mcp_gitkraken_git_checkout mcp_gitkraken_git_fetch mcp_gitkraken_git_log_or_diff mcp_gitkraken_git_pull mcp_gitkraken_git_push mcp_gitkraken_git_stash mcp_gitkraken_git_status mcp_gitkraken_git_worktree mcp_github_create_branch mcp_github_get_file_contents mcp_github_list_commits mcp_github_push_files mcp_github_create_pull_request mcp_github_get_pull_request mcp_github_list_pull_requests mcp_github_merge_pull_request mcp_github_update_pull_request_branch
---

# Git Skill

## Tool Priority

Always prefer the **git MCP tools** (`mcp_gitkraken_git_*`) for local git operations. Fall back to the **GitHub MCP tools** (`mcp_github_*`) or the `gh` CLI only when:
- The git MCP is unavailable or returns an error
- The operation is GitHub-specific (e.g., creating a PR via the API, fetching remote-only metadata)

Never use raw `git` CLI commands when an MCP tool covers the same operation.

## Safety Rules — Non-Negotiable

**Never commit, push, or publish anything without the user's explicit approval.**

This applies to:
- `git commit` / `mcp_gitkraken_git_add_or_commit`
- `git push` / `mcp_gitkraken_git_push` / `mcp_github_push_files`
- Creating or merging pull requests
- Force-pushing or amending published commits
- Any action that writes to a remote

Before any of these actions, always pause and ask the user to confirm — even if they've described the intent earlier in the conversation. A description of intent is not approval to execute.

## Allowed Without Approval

Read-only operations are safe to run freely:
- `git status`, `git log`, `git diff`, `git branch`, `git stash list`
- Fetching remote metadata (fetch, ls-remote)
- Viewing file contents, blame, or history

## Workflow

1. Use read-only tools to gather current state before proposing any changes.
2. Show the user what will happen (e.g., which files will be committed, what the commit message will be, which branch will be pushed to).
3. Wait for explicit approval before executing any write operation.
4. Report the outcome after each operation.
