---
name: Long-running builds from the agent
description: How to run builds longer than the 120s bash limit in this environment.
---

# Long-running builds (e.g. mobile production build ~4 min)

- Detached/background processes (`nohup`, `setsid`, notebook `spawn`) do NOT survive: bash background jobs die when the bash call ends, and the code_execution notebook can be restarted arbitrarily, killing children.
- **How to apply:** create a temporary console workflow (`configureWorkflow` with the build command + `echo BUILD_OK`), poll with `getWorkflowStatus`, then `removeWorkflow` when done. Workflows persist independently of agent sessions.
- The mobile artifact's production build (`scripts/build.js`) starts its own Metro on port 8081, which collides with the mockup-sandbox dev server locally. The sandbox workflow must be stopped/finished while the build runs (deploy builds run in a clean env, so no conflict there). Artifact-managed workflows cannot be removed via `removeWorkflow` (PROHIBITED_ACTION).
- The `suggestDeploy()` code_execution callback returned "not available in task agent context" even from the main agent here — use the `suggest_deploy` tool directly instead.
