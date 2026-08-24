# Repository Guidelines

## Project Structure & Module Organization

The repository combines current product documentation with a runnable stage-one-to-three platform prototype.

- `apps/platform/`: Next.js 16 API/H5 application, PGlite/PostgreSQL persistence, and generation worker.
- `apps/miniprogram/`: native WeChat Mini Program client (26 pages: 23 in the main package plus 3 in the `island` subpackage); keep page `.js/.json/.wxml/.wxss` files complete and register every page in `app.json` (`pages` or `subPackages`).
- `apps/miniprogram/island/`: the Pet Island subpackage (`index`, `avatar`, `diary`) plus its `scene/` renderer and `hud-vars.js`. The island must stay a subpackage — the main package has under 700KB of headroom against the 2MB limit.
- `apps/website/`: standalone marketing site (Astro 7, static output, own domain). `src/styles/site.css` and `src/scripts/site.js` are byte-identical copies of the prototype in `docs/website/prototype/` — add new styles to `site-additions.css` or `prose.css` instead of editing them. Run commands from `apps/website/` (this repo is not a pnpm workspace).
- `apps/platform/src/app/`: mobile product pages, H5 sharing routes, and REST route handlers.
- `apps/platform/src/domain/`, `src/plugins/`, `src/server/`: schemas, plugin manifests, local repository, and business rules.
- `apps/platform/tests/e2e/`: Playwright mobile-browser flows.
- `apps/miniprogram/theme/`: token spec, four skins, theme manager, and the page mixin every page must adopt.
- `docs/product/` and `docs/operations/`: current requirements and operating plans. Treat `docs/product/01-roadmap.md` as the governing plan.
- `docs/product/07-functional-backlog.md`: authoritative remaining feature work; do not mix deployment or credential tasks into it. Its only pending code workstream is virtual-payment compliance plus the existing `growth_orders` payment defect; the remaining sections are completion registers.
- `docs/product/21-小程序功能点清单.md` and `docs/product/15-功能入口清单.md`: complementary inventories. The former is per-page Mini Program feature points (the progress ledger for item-by-item changes); the latter covers Web pages, the 9 admin consoles, REST routes, and plugin manifests. Neither duplicates the other.
- `docs/product/22-宠物小岛游戏化方案.md`, `24-宠物小岛素材清单.md`, `25-宠物小岛待完成清单.md`, `26-宠物小岛缺陷修复记录.md`: the Pet Island set. `22` is the plan (deviations in its chapter 11), `24` the art asset list, **`25` the only to-do entry point**, `26` the fixed-defect log.
- `docs/product/23-虚拟支付合规改造方案.md`: global virtual-payment compliance work, unrelated to the island.
- `docs/README.md`: the index, and the single place where drifting counts (pages, routes, migrations, test cases) are maintained.
- `docs/demand/`: finalized specifications for focused workstreams (`theme.md`, `theme-2.md`). Body text stays as originally decided; implementation deviations are recorded in each document's final "实现差异记录" chapter, which takes precedence over the body.

## Current Development State

As of 2026-08-22 all planned product batches and the Pet Island M1 coding work are complete. Do not reopen a completed batch except for shared-infrastructure or release-gate fixes. The image-template shelf, owner-photo role inputs, multi-reference image editing, shared lingsuan request queue, and the direct pet-human effect-reference runtime are implemented; remaining pet-human work is explicit release approval, object upload/seeding/freezing, and real-provider validation rather than a second template registry. `docs/README.md` is the single place where code scale and test counts are maintained — reference it rather than restating those counts elsewhere.

- **Stages one to three plus admin batch K** (baseline `d7a0c87`, 2026-07-21) have formal server, Web/H5, Mini Program, and protected administrator entries. Batch K added unified audit, safe account suspension, live-baseline rollback, full fulfillment controls, and the video/memorial/interactive/business consoles.
- **Staging test machine**: migration `0014_password_auth.sql`, `src/server/runtime-mode.ts`, `src/proxy.ts` (Next 16 proxy convention, replaces `middleware.ts`), the `/login` page, mini-program `pages/login/login`, `deploy/compose.staging.yaml`, host-machine **Nginx** configs under `deploy/nginx/`, and the `deploy/scripts/*.sh` toolchain (`bootstrap` for first deploy, `release` for routine updates, plus `gen-env`, `preflight`, `deploy`, `seed-samples`, `health-check`, `smoke-test`, `create-admin`, `logs`, `backup`, `restore`, `release-website`). Sample imagery lives outside the image (build context is `apps/platform`, assets are in `tools/imagegen/out/`), so `seed-samples.sh` must load it into the `object-data` volume — skipping it leaves `/api/plugins` and `/api/health` green while every `<image>` 404s silently, which is why `smoke-test.sh` fetches each sample. `APP_ENV=staging` is the only switch that lets a production build use local-disk storage and simulated payment; real production must never set it.
- **Theme system and immersive glass sheet** (`da8f670`, 2026-07-29) plus the **UI refactor** (2026-07-30): structure tokens, component re-parameterisation, 13 page transformations. Styling is token-only — literal colors, radii, shadows, spacing, and font sizes in `.wxss` fail validation (`app.wxss` is the sole exempt file). `pnpm validate` runs ten checks plus `node --test`. Decisions and the image-generation pipeline are in `docs/ui-refactor/阶段0-代码盘点与方向分配.md` (chapters 8–9); day-to-day conventions are in `CLAUDE.md`. Sample imagery is produced offline by `tools/imagegen/` with the **lingsuan image API as this repository's default image-generation path** and needs `LINGSUAN_IMAGE_*` credentials in a root `.env.imagegen` — deployment and CI never need them. To avoid lingsuan `413 Payload Too Large`, run review/remediation jobs serially, submit one output per request, use at most two task-specific reference images compressed to JPEG with a maximum 1200px edge, keep their combined bytes below 1MB, and never upload a comparison/contact sheet or a directory of original full-size images as an edit input.
- **Emotional-value batch** (task sheet `docs/product/14-direction-review-emotional-value.md`): migrations `0015`–`0016`, `src/server/media/exif.ts` (hand-written EXIF reader, no new dependency), `timeline-service.ts`, `memorial/album.ts` (multi-page PDF), `annual/*` and `video/narrative.ts`, `domain/companion.ts`, `domain/video-duration.ts`, routes `GET /api/pets/[id]/timeline`, `GET /api/on-this-day`, `POST /api/annual-films`, generator `growth-compare-v1` (PL-23), mini-program `pages/timeline/`.
- **Product overhaul batches 1–3** (`docs/product/17-产品改造方案.md`): migrations `0017`–`0020`, AI-label compliance (`media/ai-label.ts`), friction-free free plays, three-state `lifeStage`, plays merged 10→7 live via `toneVariants`, accumulation-tiered pricing (`domain/pricing.ts`), membership rework, the health triage line (`server/health/*`, mini-program `pages/health/`), weight records, and deletion of `/lab`.
- **Second overhaul round, four batches** (`docs/product/20-功能改造方案-第二轮.md`): migrations `0021`–`0023`, entitlement redemption end-to-end (`entitlement_ledger` bookkeeping via `claimEntitlement`), single-source plan copy via `GET /api/membership-plans`, pre-order tier pricing via `GET /api/pets/[id]/pricing`, on-device distribution for six emotional capabilities, proactive health reminders (`health/reminders.ts`, in-app notifications), health document PDF (`health/document.ts`), yearly v4 ¥128, and removal of `growth-lab-client.tsx` and `pages/growth` (which is why the Mini Program went from 24 to **23** pages).
- **Pet Island M1** (`docs/product/22-宠物小岛游戏化方案.md`): migration `0024`, `domain/island-weather.ts`, `domain/copy-guard.ts`, `server/island-service.ts`, `server/island/{items,diary,assets,avatar,cutout}.ts`, 9 `/api/island*` routes, the `island` mini-program subpackage, and mini-program gates 11–17. Coding is complete and has passed two review rounds; all 7 art assets and anchor sets are present and `ISLAND_ASSET_PATHS` is populated. **Remaining work is not island business code** — see `docs/product/25-宠物小岛待完成清单.md`, the single entry point for category self-check/M0 submission, `downloadFile` domain registration, deployment seeding, and real-device checks. Fixed defects are logged in `docs/product/26-宠物小岛缺陷修复记录.md`. It is decided that **no mini-game account will be opened**, so exploration maps, fishing, treasure hunts, and levels are out of scope with no fields or hooks reserved. Two traps when touching island code: `island/scene/ambient.js` is a second on-device implementation of the day/night and weather curves, kept in sync with `domain/island-weather.ts` by `scripts/island-ambient.test.js` (a gate failure there after changing the TS values is by design, not a false positive); and frame-loop timing must use `Date.now()` rather than the timestamp passed to rAF, because the two have different origins and mixing them makes transitions jump instantly **on real devices only**.
- **Image template shelf and identity roles** (`docs/product/27-图片玩法研究与产品方案.md` through `31-宠物人化两阶段执行与审批记录.md`): migrations `0025`–`0026`, `server/image-template-registry.ts`, `server/owner-photo-service.ts`, `/api/image-templates*`, `/api/owner-photos*`, and the Web/Mini Program AI creation flows are implemented. Normal runtime inputs are ordered frozen master → owner (owner-pet templates only) → pet. Pet-human now makes one lingsuan edit request ordered **pet photo as Image 1 → self-owned effect image as Image 2**, returns exactly two candidates, never creates or reuses a human identity card, and does not support reroll. The same effect-image object is both the public sample and Image 2. Migration `0026` and `pet-human-identity-service.ts` remain only for historical-data compatibility and cleanup; they are not part of new-run generation. Owner identities and legacy private human identity cards must never enter public sample seeding. Exact counts live only in `docs/README.md`.
- **Virtual payment compliance** (`docs/product/23-虚拟支付合规改造方案.md`, reviewed but not started): WeChat requires all-terminal virtual payment for virtual goods, and **the 2026-04-01 deadline has passed** — memberships and work unlocks fall in scope. The same audit found a separate and more serious existing defect: `payGrowthOrder` in `growth-service.ts` moves an order to `paid` and grants entitlements **without ever calling `paymentProvider`**, so in production a user can obtain a ¥128 membership by calling `POST /api/growth-orders/[id]/pay` once. Both are fixed together; pick the provider **per SKU**, not per environment variable.
- **The current pet-human handoff is locally integrated but not released**: on 2026-08-22 the 40 self-owned V2 WebP effects were inventoried and normalized in `tools/imagegen/out/pet-human-v2/effects/`. Numeric source ID `N` maps to `human-effect-NN`; images are `720x1280`, prompts are normalized in `apps/platform/src/server/pet-human-effect-prompts.json`, and hash-based planned object keys are registered. The old 12 experimental template records are removed. Do not regenerate the effects or reuse retired `humanization-v1` outputs. All V2 entries remain `pending-review`; do not upload to production, seed, freeze, or mark `live` without explicit release approval. Other release priorities remain virtual-payment compliance, restoring automated CI gates, PostgreSQL migration/E2E, real Provider/WeChat/supplier integration, deployment rehearsal, real-device walkthroughs, and the legal opinion on health-line copy.
- Preserve existing migration history and add forward-only migrations for future schema changes. Follow `docs/operations/04-external-prerequisites.md`, `docs/delivery/`, and `docs/operations/05-release-checklist.md` for the next gates.

## Build, Test, and Development Commands

Run commands from `apps/platform/`:

```powershell
pnpm install                 # install exact dependencies
pnpm dev                     # start local mode at localhost:3000
pnpm worker                  # run the production task worker
pnpm lint                    # run Next.js ESLint rules
pnpm typecheck               # check strict TypeScript
pnpm test                    # run Vitest unit tests
pnpm test:coverage           # enforce coverage thresholds
pnpm test:e2e                # run the mobile Playwright journey
pnpm build                   # create a production build
```

Install Chromium once with `pnpm exec playwright install chromium`.

## Coding Style & Naming Conventions

Use two-space indentation, strict TypeScript, named exports for reusable modules, and early returns for error paths. Name React components in PascalCase, functions and variables in camelCase, and files/routes in lowercase kebab-case. Validate every API boundary with Zod. Keep product rules in `src/server` or `src/domain`, not inside page components. Reuse the CSS variables in `src/app/globals.css`; preserve keyboard focus, reduced-motion support, and the mobile-first visual language.

In `apps/miniprogram/`, style exclusively through theme tokens — register a new token in `theme/tokens.js` before using it, and supply it in all four skins. Avoid optional chaining and nullish coalescing to stay compatible with base library 2.9.0.

## Testing Guidelines

Use Vitest for domain and service behavior; keep tests beside the source as `*.test.ts`. Use Playwright for user-visible workflows under `tests/e2e/*.spec.ts`. Changes to quota, task states, payment, sharing, or plugin validation require regression tests. Run `pnpm check` before review, plus `pnpm test:e2e` for UI changes. Run `pnpm validate` in `apps/miniprogram/` after any page or style change. PGlite must remain in `serverExternalPackages` so Windows `memory://` E2E works; PostgreSQL E2E is still required before release.

## Commit & Pull Request Guidelines

Use short imperative subjects with a conventional prefix, such as `feat: add share revocation` or `chore: update deployment assets`. Keep commits focused. Pull requests must describe behavior and risk, list affected requirements, report verification commands, and include mobile screenshots for visual changes.

## Security & Configuration

Copy `.env.example` only when configuring adapters; never commit secrets or user photos. Local storage and simulated payment are development-only. Production requires authenticated PostgreSQL, OSS, WeChat login/payment callbacks, and protected administration routes.
