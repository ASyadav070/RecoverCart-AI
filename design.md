# RecoverCart AI — UI Design System & Refactor Specification

## 1. Purpose

This document is the UI source of truth for the RecoverCart AI stabilization and shadcn refactor.

The refactor must:
- standardize visual patterns across merchant and customer-facing pages,
- fix status/action rendering inconsistencies,
- improve spacing, typography, feedback, tables, and responsiveness,
- preserve all verified backend, payment, recovery, and API behavior.

This is a presentation/UI refactor. It must not redesign business logic.

---

## 2. Approved UI Foundation

RecoverCart AI uses **shadcn/ui** initialized from the approved preset.

### Preset
- Preset ID: `b5KcMrQLA`
- Framework: **Next.js**
- Base: **Base UI**
- Package manager: **npm**
- Monorepo: **disabled**
- RTL support: **disabled**
- Pointer-on-buttons option: **disabled**

### Rules
- Do not reinitialize shadcn.
- Do not replace the preset.
- Do not switch to Radix UI or React Aria.
- Do not introduce another component framework.
- Do not overwrite existing business logic while refactoring UI.
- Reuse generated shadcn components instead of recreating custom equivalents.

---

## 3. Non-Negotiable Business Logic Boundary

The UI may change how state is presented, but must not change the authoritative state machine.

Do not modify:
- Razorpay integration,
- payment order creation,
- payment verification,
- payment webhooks,
- `capture_payment_atomic`,
- `confirm_recovery_payment`,
- recovery payment polling/status,
- recovery token logic,
- proposal generation logic,
- approval/rejection RPC logic,
- outreach RPC logic,
- recovery link opening logic,
- Supabase schema/migrations,
- recovery metrics semantics,
- merchant authentication,
- customer session/security rules.

The browser must never invent recovery/payment state.

---

## 4. Authoritative Recovery Action Matrix

This matrix is the UI rendering contract.

| Recovery Status | UI Behavior | Allowed Merchant Action |
|---|---|---|
| `DETECTED` | Show actionable recovery opportunity | **Generate Strategy** |
| `ANALYSING` | Show informational/loading state only | None |
| `AWAITING_APPROVAL` | Show proposal review state | **Approve**, **Reject** |
| `APPROVED` | Show approved outreach state | **Send Simulated Outreach** |
| `SENT` | Show outreach sent / waiting state | None |
| `MONITORING` | Show customer/payment monitoring state | None |
| `RECOVERED` | Show terminal success state | None |
| `STOPPED` | Show terminal informational state | None |
| `UNRECOVERED` | Show terminal informational state | None |
| `EXPIRED` | Show terminal informational state | None |
| `ESCALATED` | Show terminal/manual-review state | None |
| `REJECTED` | Preserve existing regeneration behavior | No new manual "Generate Again" action |

### Critical rendering rule
Actions must be **mutually exclusive by authoritative status**.

Examples:
- `DETECTED` must not show `Send Simulated Outreach`.
- `APPROVED` must not show `Generate Strategy`.
- `RECOVERED` must not show any proposal-generation or outreach action.
- `SENT` / `MONITORING` must not show proposal review controls.

---

## 5. Workflow Copy Rules

### Initial strategy generation
For first-time generation from `DETECTED`:

**Correct**
> Generating recovery strategy...

**Incorrect**
> Proposal rejected. Generating a revised proposal...

The rejection wording is reserved only for the post-rejection regeneration path.

### Rejection regeneration
When the merchant rejects an existing proposal and the current workflow automatically regenerates:

> Proposal rejected. Generating a revised proposal...

### Approval success
Use concise feedback:

> Proposal approved successfully.

Do not leave stale approval feedback visible after the page has transitioned to a later authoritative state.

### Recovery success
For `RECOVERED`:

**Title**
> Revenue successfully recovered

**Supporting text**
> The recovery payment has been verified successfully.

No action button should render.

### SENT
Suggested copy:

**Title**
> Recovery outreach sent

**Supporting text**
> The approved recovery message has been sent. Waiting for customer activity.

### MONITORING
Suggested copy:

**Title**
> Monitoring recovery

**Supporting text**
> The customer has opened the recovery flow. Waiting for verified payment.

### STOPPED
Suggested copy:

**Title**
> Recovery stopped

**Supporting text**
> No further automated recovery action is available for this case.

### UNRECOVERED
Suggested copy:

**Title**
> Recovery attempt ended without payment

**Supporting text**
> No verified recovery payment was completed for this case.

### EXPIRED
Suggested copy:

**Title**
> Recovery case expired

**Supporting text**
> This case is no longer active for automated recovery.

### ESCALATED
Suggested copy:

**Title**
> Escalated for manual review

**Supporting text**
> Automated recovery has paused for this case.

---

## 6. shadcn Component Mapping

Install/add components only when required by the refactor.

### Core components

#### `Button`
Use for:
- Generate Strategy
- Approve
- Reject
- Send Simulated Outreach
- Run Abandonment Scan
- navigation actions where button semantics are appropriate

Rules:
- one consistent height,
- one consistent radius,
- consistent loading behavior,
- disabled state must be visually obvious,
- primary/secondary/destructive variants must be meaningful,
- avoid mixing raw `<button>` styling with shadcn `Button`.

#### `Badge`
Use for:
- recovery case status,
- payment state,
- inventory state,
- compact semantic labels.

Create one shared status-to-variant mapping rather than hardcoding colors page-by-page.

#### `Card`
Use for:
- metric cards,
- Case Summary,
- Signals & Context,
- AI Recovery Proposal,
- Review Actions,
- payment/recovery sections,
- customer recovery summary.

Use consistent:
- `CardHeader`
- `CardTitle`
- `CardDescription`
- `CardContent`
- `CardFooter` where appropriate.

#### `Alert`
Use for:
- success feedback,
- errors,
- warnings,
- informational workflow states,
- terminal-state messages.

Do not build separate custom green/red/zinc banners on each page.

#### `Table`
Use for:
- Recovery Cases,
- Recent Recoveries,
- other merchant tabular views.

Standardize:
- header typography,
- row padding,
- numeric alignment,
- action column,
- status badges,
- hover behavior.

#### `Separator`
Use inside:
- Case Summary,
- Signals & Context,
- grouped metadata sections.

#### `Skeleton`
Use for:
- initial dashboard loading,
- case-list loading,
- case-detail loading,
- recovery-context loading.

Avoid blank containers or layout jumps.

### Optional components when useful

#### `Tooltip`
Use for:
- truncated IDs,
- technical metadata labels,
- icon-only controls if introduced.

#### `Dialog`
Use only where an explicit confirmation is useful.
Do not add dialogs to every action.

#### `DropdownMenu`
Use only if secondary actions later require grouping.

#### Toast / notification system
Use only if compatible with the installed shadcn preset.
Do not duplicate toast and inline-alert feedback for the same event.

---

## 7. Shared UI Components to Create

Prefer shared components under a consistent project location, for example:

```text
src/components/recovery/
src/components/merchant/
src/components/shared/
```

Recommended shared abstractions:

### `RecoveryStatusBadge`
Input:
```ts
status: RecoveryStatus
```

Responsibilities:
- normalized label,
- normalized semantic appearance,
- no business-state transitions.

### `FeedbackAlert`
For:
- success,
- error,
- warning,
- info.

### `MetricCard`
For merchant dashboard metrics.

### `RecoveryActionPanel`
Owns visual action layout only.

It must render according to the authoritative action matrix and call existing handlers passed into it.

### `EmptyState`
For:
- no proposal,
- no recoveries,
- no audit events,
- no payment attempts.

### `LoadingState`
Prefer Skeleton-based layouts matching final content structure.

Do not centralize backend state mutation into UI components.

---

## 8. Page-by-Page Design Specification

### 8.1 Merchant Dashboard — `/merchant`

Current issues from the audit include inconsistent metric-card treatment, basic table styling, and inconsistent action padding.

Target:
- shadcn `Card` for metrics,
- shadcn `Button`,
- shadcn `Table`,
- shared `MetricCard`.

Button hierarchy:
- `Run Abandonment Scan` = primary,
- `View Recovery Cases` = secondary/outline.

---

### 8.2 Recovery Cases List — `/merchant/cases`

Target:
- shadcn `Table`,
- shared `RecoveryStatusBadge`,
- consistent row/action affordance,
- horizontal overflow handling on narrow widths.

---

### 8.3 Recovery Case Detail — `/merchant/cases/[id]`

This is the highest-priority refactor.

Main sections:
1. Header / status
2. Recovery timeline
3. AI Recovery Proposal
4. Review Actions
5. Case Summary
6. Signals & Context
7. Outreach information
8. Audit/history

#### DETECTED
Show exactly:
- Generate Strategy

Loading label:
- Generating Strategy...

Feedback:
- Generating recovery strategy...

Never show rejection wording here.

#### ANALYSING
No button.
Show informational/loading state only.

#### AWAITING_APPROVAL
Show exactly:
- Approve
- Reject

#### APPROVED
Show exactly:
- Send Simulated Outreach

Never show Generate Strategy.

#### SENT
No proposal/recovery action.

#### MONITORING
No proposal/recovery action.

#### RECOVERED
No action.
Show terminal success message only.

#### STOPPED / UNRECOVERED / EXPIRED
No action.
Show terminal informational message only.

#### ESCALATED
No automated action.
Show manual-review message only.

#### REJECTED
Preserve existing automatic regeneration behavior.
During regeneration show:
> Proposal rejected. Generating a revised proposal...

Do not add a permanent Generate Again button.

---

## 9. Button System

All primary actions must use one consistent sizing rule from the installed shadcn preset.

Rules:
- no arbitrary page-specific heights,
- no arbitrary radius differences,
- one semantic primary treatment,
- use destructive/secondary variants intentionally,
- consistent gaps between actions,
- preserve button width during loading when practical,
- disable while async action is running,
- prevent double submission.

---

## 10. Card & Spacing System

Standardize around shadcn `Card` primitives.

Rules:
- consistent internal padding,
- consistent section gaps,
- consistent border/radius treatment,
- avoid arbitrary `space-y-4` vs `space-y-8` without semantic reason,
- use a consistent max-width and responsive page padding.

---

## 11. Typography System

Current audit found inconsistent heading sizes and label scales.

Use a predictable hierarchy:
- page title,
- card/section title,
- supporting description,
- metadata label,
- data value.

Avoid arbitrary `text-[10px]` labels.

Do not expose raw internal units such as paise where formatted INR is appropriate.
Do not expose internal implementation wording such as Gemini metadata unless deliberately required for the demo.

---

## 12. Status & Semantic Color System

Do not hardcode status colors independently on each page.

Use one shared mapping for:
- case list,
- case detail,
- timeline,
- dashboard.

Semantic guidance:
- success: RECOVERED / verified success,
- active/info: DETECTED, ANALYSING, AWAITING_APPROVAL, APPROVED, SENT, MONITORING,
- warning: UNRECOVERED, ESCALATED,
- neutral terminal: STOPPED, EXPIRED,
- destructive/error: reserve for actual failures, not ordinary lifecycle states.

---

## 13. Alert & Feedback System

Use shadcn `Alert` or a shared wrapper.

Rules:
- action feedback should appear near the action panel,
- fatal page errors should appear near page top,
- terminal state messages are durable,
- transient messages must be cleared when authoritative state changes,
- do not show stale "Proposal approved successfully" after the case has progressed to SENT/MONITORING/RECOVERED.

---

## 14. Timeline Design

Primary lifecycle:
```text
DETECTED
→ ANALYSING
→ AWAITING_APPROVAL
→ APPROVED
→ SENT
→ MONITORING
→ RECOVERED
```

REJECTED is a branch from AWAITING_APPROVAL followed by existing regeneration behavior.

STOPPED, UNRECOVERED, EXPIRED, and ESCALATED are alternate terminal outcomes when present.

Rules:
- timeline labels must remain readable,
- active state must be derived from authoritative case status,
- do not treat REJECTED as a normal success step,
- do not imply every case must visit every state.

---

## 15. Table Design

Use shadcn `Table` for merchant tables.

Standardize:
- header typography,
- row spacing,
- INR/date formatting,
- status badge placement,
- action column,
- hover state,
- horizontal scrolling on narrow devices.

---

## 16. Customer Recovery Page — `/recover/[token]`

Goals:
- trustworthy payment presentation,
- simple hierarchy,
- no raw technical errors.

Use:
- Card,
- Button,
- Alert,
- Skeleton,
- Separator where useful.

Important payment copy:
- verifying: `Payment submitted. Verifying payment...`
- paid but recovery finalizing: `Payment received. Finalizing recovery...`
- verified success: `Payment successful`
- supporting success: `Your payment has been verified and your order is complete.`

The UI must not claim success before authoritative verification.

---

## 17. Loading States

Use consistent Skeleton layouts for initial page loading.

Priority:
1. case detail,
2. dashboard,
3. case list,
4. recovery page.

Action loading:
- disabled button,
- updated label,
- optional spinner if already supported.

---

## 18. Error Handling

Never expose:
- raw Supabase errors,
- raw Gemini/provider errors,
- stack traces,
- Razorpay secrets,
- SQL/RPC details.

Use safe messages such as:
- Unable to generate recovery strategy.
- Unable to approve proposal.
- Unable to send recovery outreach.
- Unable to load recovery case.

Errors must not override authoritative terminal success states.

---

## 19. Responsive Rules

Desktop:
- two-column case-detail layout is acceptable.

Tablet:
- collapse dense sidebars where needed.

Mobile:
- stack cards,
- stack action buttons where needed,
- horizontally scroll tables,
- safely wrap long emails/IDs,
- avoid fixed-width overflow.

---

## 20. Refactor Priority

### Phase 1 — Foundation
Add/use only the shadcn components needed:
- Button
- Badge
- Card
- Alert
- Table
- Separator
- Skeleton

### Phase 2 — Merchant Case Detail
Highest priority:
- action matrix,
- initial-generation vs rejection-regeneration copy,
- duplicate/incorrect actions,
- spacing,
- badges,
- alerts,
- timeline.

### Phase 3 — Merchant Dashboard
- MetricCard,
- action hierarchy,
- Recent Recoveries table.

### Phase 4 — Cases List
- table,
- status badge,
- View Case action.

### Phase 5 — Customer Recovery
- payment card,
- alerts,
- loading,
- verified success state.

### Phase 6 — Final Consistency Pass
- typography,
- spacing,
- responsive behavior,
- INR/date formatting,
- stale feedback,
- loading/error consistency.

---

## 21. Audit-Derived Issues That Must Be Resolved

Critical:
- Initial generation incorrectly shows rejection copy.
- Timeline branch/state rendering is incomplete.

High:
- Button system inconsistency.
- Missing centralized status badge system.
- Contradictory/duplicate actions.

Medium:
- Card layout variability.
- Typography inconsistency.
- Alert placement/styling inconsistency.
- Table formatting inconsistency.

Low/cosmetic:
- minor spacing,
- hover-state polish,
- minor INR/date differences.

---

## 22. Acceptance Checklist

### Recovery actions
- [ ] DETECTED shows only Generate Strategy.
- [ ] Initial generation never shows rejection wording.
- [ ] ANALYSING shows no merchant action.
- [ ] AWAITING_APPROVAL shows only Approve / Reject.
- [ ] APPROVED shows only Send Simulated Outreach.
- [ ] SENT shows no proposal/recovery action.
- [ ] MONITORING shows no proposal/recovery action.
- [ ] RECOVERED shows terminal success only.
- [ ] STOPPED shows terminal information only.
- [ ] UNRECOVERED shows terminal information only.
- [ ] EXPIRED shows terminal information only.
- [ ] ESCALATED shows manual-review information only.
- [ ] REJECTED preserves existing regeneration behavior.
- [ ] No permanent Generate Again button exists.

### Visual consistency
- [ ] Buttons use shared shadcn variants.
- [ ] Cards use shadcn Card.
- [ ] Status badges use one mapping.
- [ ] Alerts use consistent semantic treatment.
- [ ] Tables use shared shadcn Table patterns.
- [ ] Loading uses Skeleton/consistent button loading.
- [ ] Dates and INR formatting are consistent.
- [ ] Page spacing is consistent.
- [ ] Responsive layouts do not overflow.

### Safety
- [ ] No API contracts changed.
- [ ] No database logic changed.
- [ ] No payment behavior changed.
- [ ] No Razorpay logic changed.
- [ ] No recovery attribution logic changed.
- [ ] No auth/security behavior changed.

---

## 23. Antigravity Implementation Rule

Before changing any page:
1. inspect the existing page and handlers,
2. identify business-state dependencies,
3. preserve existing API calls and handlers,
4. replace only presentation/rendering structure,
5. map rendering to this `design.md`,
6. run lint/typecheck after each page-level refactor,
7. manually test the affected lifecycle state before moving on.

Do not refactor the entire application in one uncontrolled pass.

This document is the UI source of truth for RecoverCart AI.
