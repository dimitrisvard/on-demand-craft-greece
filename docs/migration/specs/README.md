# Build specs (Phases 2-6)

Public sections of the build specifications that drive the coding of each phase. Each spec ends before its private appendix; security detail is kept out of this public repository.

| File | Phase | Status |
|---|---|---|
| [PHASE2_SPEC.md](PHASE2_SPEC.md) | 2 API port | Built (commit 614847c) |
| [PHASE4_SPEC.md](PHASE4_SPEC.md) | 4 Agent layer | Built and gated locally 2026-10-07 (commit: see git log); deploys are owner steps (PLAN.md §5.4) |
| [PHASE5_SPEC.md](PHASE5_SPEC.md) | 5 Consolidate compute | Built and gated locally 2026-10-09 (commit: see git log); changes made during the build (BA5-1…BA5-10), the gate status and the owner steps are recorded in PLAN.md §5.5; deploys and the switch-over are owner steps |
| [PHASE36_SPEC.md](PHASE36_SPEC.md) | 3 and 6 code parts | Built and gated locally 2026-10-09 (commit: see git log); deviations (DV36-n), build amendments (BA36-n), defaults, gate status and follow-ups are recorded in PLAN.md §5.3 and §5.6, which are current where they differ from this spec. The access-model migration of P6-2 is delivered to the owner privately and committed with its policy tests after the owner has applied it. Every owner step is in [MANUAL_STEPS.md](../MANUAL_STEPS.md); deploys, DNS and database applies are owner steps |

Paths starting with a scratch directory refer to working notes of the build sessions and are not part of the repository.
