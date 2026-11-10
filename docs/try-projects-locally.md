# Try OpenHands Projects + Insider locally

For a coding agent. Needs git, Node 24 and uv.

```bash
git clone https://github.com/OpenHands/software-agent-sdk.git sdk
cd sdk && git fetch origin pull/6602/head:projects && git checkout projects
(cd clients/typescript && npm ci && npm run build)
cd ..

git clone https://github.com/OpenHands/OpenHands.git canvas
cd canvas && git fetch origin pull/19495/head:projects && git checkout projects
npm ci
# The published client is older than #6602, so use the one just built:
cp -r ../sdk/clients/typescript/dist/. node_modules/@openhands/typescript-client/dist/
npm run build:app
OH_AGENT_SERVER_LOCAL_PATH="$(cd ../sdk && pwd)" node bin/agent-canvas.mjs
```

Then, in the browser it opens:

1. Set your LLM.
2. **Settings → Experimental**: turn on **Projects** and **Conversation reactions**.
3. **Customize → Apps → Add app**: source `github:enyst/insider`, ref `main`, then enable it.
4. Add your repo as a workspace.
5. Open **Insider → Projects**, press **New project**, and send the Cat a plan.

For now, agents only 👍 a mid-task "wait, actually" if the repo's AGENTS.md asks them to
(commit it, since workers run in git worktrees):

```
- If the person changes their mind while you are working ("wait, actually…"), react with a thumbs up (+1) to that message, then carry on.
```
