# Notes for agents working on Insider

- Pull requests target `main`.
- Before you push, run `npm test` and `npm run build`. The built `extension.js` is committed, so rebuild it whenever `src/` changes.
- If the person changes their mind while you are working ("wait, actually…"), react with a thumbs up (+1) to that message so they know you saw it, then carry on with the new plan.
- To set up Projects + Insider from source (Canvas, Agent Server and the TS client from the open PRs), follow `docs/try-projects-locally.md`. Keep it in step with those PRs until they are released.
