# backend/bento

Hand-authored reference for the Bento design system, consumed by the
remix agent when the "Use Bento" sidebar toggle is on.

## Files

- `bento-tokens.css` — CSS custom properties on `:root`. All variables
  prefixed `--bento-*`.
- `bento.css` — Component class rules (`.bento-button`, `.bento-card`, …)
  built from tokens. Every selector is `.bento-*`-scoped.
- `bento-reference.md` — Component catalog with canonical HTML snippets
  the agent copies from.

## How it reaches the agent

`backend/api/remix.ts` reads these three files from disk on each `useBento:
true` request and passes them to `startRemixJob` in `backend/lib/agent.ts`.
The sandbox worker writes them into each variation's dir alongside
`page.html`, then the agent Reads/Greps them directly. After the agent
finishes editing, the worker injects `<style data-bento="tokens">` and
`<style data-bento="components">` into the modified page's `<head>`.

## Refreshing from Bento

This is hand-authored today. To refresh:

1. Clone the Bento GitLab repo locally.
2. For `bento-tokens.css`: open Bento's token source (Vue variables,
   design-tokens.json, or SCSS partials) and mirror values into CSS
   custom properties. Preserve the `--bento-*` prefix.
3. For `bento.css`: for each component in v1 scope, open its `.vue` file,
   translate the `<style scoped>` block into flat `.bento-<name>`
   rules. Drop any Vue-specific class hashes.
4. For `bento-reference.md`: update the snippet, variants, and tokens
   callout to match the refreshed component.
5. Redeploy the backend (`cd backend && vercel --prod`). The extension
   picks up the new reference on the next remix.
