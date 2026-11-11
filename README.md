# Planzo

**Plan trips together without making everyone share their private limits.** Planzo is a collaborative travel-planning web app. An organiser creates a trip and invites friends; each person adds their own availability, budget and preferences. The group can review a shared itinerary, resolve decisions, and explicitly respond to the current version before treating the plan as agreed.

[Open the live app](https://person-siren-40913121.figma.site/) · [View the Figma design](https://www.figma.com/design/IRAXhHV3ldeGoxWwXJeZk9/Planzo-Design?node-id=22-266)

## The problem

Group trips often stall because dates, costs and personal needs are scattered across messages. A popular option can still be unaffordable or impossible for someone. Planzo makes those constraints visible in the decision process while keeping each person's raw budget and private reasons out of shared summaries.

## What the app covers

- **Shared trip setup:** organiser accounts, trip creation, invitation links, member joining and saved trip workspaces.
- **Private input:** individual availability, budget and preferences feed planning without displaying raw private briefs to the group.
- **Planning and review:** itinerary proposals, estimated costs, feasibility checks, human review and item-level decisions.
- **Explicit agreement:** members respond to a specific plan version; material changes require fresh responses. Silence remains pending.
- **Final journey and Bookings:** a day-by-day locked itinerary, external provider links and self-reported booking status. Check availability and final prices with the provider.
- **Payments:** a shared expense and settlement ledger for transfers made outside Planzo.

The app uses Supabase Auth, a trip-scoped database and Edge Functions.

## Use Planzo

Open the [live app](https://person-siren-40913121.figma.site/) to create a trip or join with an invitation. The [Help & documentation](https://person-siren-40913121.figma.site/#/help) page covers each step and offers a short walkthrough. Read the [Privacy policy](https://person-siren-40913121.figma.site/#/privacy) for details about shared trip data and sign-in.

## Technology and project structure

| Area | Implementation |
| --- | --- |
| Interface | React 19, TypeScript, Vite 8, Tailwind CSS 4, Figma-derived assets |
| Shared data | Supabase Auth, PostgreSQL, row-level access controls and Edge Functions |
| Assisted planning | Gemini-backed proposals with consent, validation and human review |
| Verification | Type checks, unit tests, build checks and documented hosted checks |

- `src/main.tsx` loads the shared app.
- `src/LiveApp.tsx` and related `src/Live*.tsx` files contain the shared journeys.
- `src/domain.ts`, `src/routePlanning.ts` and `src/routeCompiler.ts` hold planning rules and route checks.
- `supabase/migrations/` and `supabase/functions/` contain the backend source.
- `tests/` contains application tests; `docs/` contains implementation and verification notes.

## Run locally

Use Node.js 22 and pnpm 10 (versions are recorded in `.mise.toml`).

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

Vite uses port 8443 by default. Open `http://localhost:8443/`. Shared trips use the existing Supabase project and require working authentication and redirect configuration.

```sh
pnpm run typecheck
pnpm test
pnpm run build
```

## Current status

Planzo is a live, evolving prototype. The shared planning flow is available. Earlier release checks recorded variability in live AI route generation. The [latest route-planning handoff](docs/ROUTE_PLANNING_HANDOFF.md) records that limitation and its verification evidence. Review generated prices, schedules and locations before booking. Use the provider to book, pay and confirm reservations.

For implementation history and test detail, see the [handoff documents](docs/) and [test report](docs/TEST_REPORT.md).
