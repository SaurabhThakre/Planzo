# Planzo

**Plan trips together without making everyone share their private limits.** Planzo is a collaborative travel-planning web app. An organiser creates a trip and invites friends; each person adds their own availability, budget and preferences. The group reviews a shared itinerary, resolves decisions, and confirms the current version before the organiser locks it. Included travellers can then track bookings and share expenses.

[Open the live app](https://person-siren-40913121.figma.site/) · [View the Figma design](https://www.figma.com/design/IRAXhHV3ldeGoxWwXJeZk9/Planzo-Design?node-id=22-266)

## The problem

Group trips often stall because dates, costs and personal needs are scattered across messages. A popular option can still be unaffordable or impossible for someone. Planzo makes those constraints visible in the decision process while keeping each person's raw budget and private reasons out of shared summaries.

## What the app covers

- **Shared trip setup:** organiser accounts, trip creation, invitation links, member joining and saved trip workspaces.
- **Private input:** travellers confirm their own dates, budget and preferences. They can review and edit individual requests before confirming. The trip overview shows who still needs to confirm.
- **Planning and review:** itinerary proposals, estimated costs, feasibility checks and item-level decisions. Each traveller can see how the plan covers their own requests.
- **Explicit agreement:** members respond to a specific plan version; material changes require fresh responses. Silence remains pending.
- **Final journey** shows the locked itinerary by day in the destination time zone.
- **Bookings** shows a direct provider link and expandable alternatives where available, alongside booking progress and shared reports. Travellers check availability and final prices with providers.
- **Payments** tracks manual expenses and refunds independently of booking reports, with equal or exact splits. Travellers record settlements made outside Planzo, and the ledger updates balances when a settlement is recorded.

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
- `supabase/migrations/`, `supabase/changes/` and `supabase/functions/` contain the backend source.
- `tests/` contains application tests. The [development guide](docs/DEVELOPMENT.md) maps the current routes to their source files, data contracts and regression checks.

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

Planzo is a live prototype with shared planning, Final journey, Bookings and Payments. Generated prices and schedules are planning estimates. Use the provider to check prices and availability, book and confirm reservations. The [budget planning handoff](docs/BUDGET_PLANNING_HANDOFF.md) records the limits observed in hosted itinerary generation.

The [handoff archive](docs/HANDOFF.md) and [original prototype test report](docs/TEST_REPORT.md) record earlier releases.
