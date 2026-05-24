# Risk and Compliance

BureauOS should be autonomous, but the owner must be protected.

The goal is not to freeze the business. The goal is to let the system work aggressively inside safe boundaries and stop before legal, commercial, privacy, or financial risk crosses policy.

## Risk Classes

### Legal and Contract Risk

Requires approval when work involves:

- contracts
- terms of service
- statements of work
- binding proposals
- final prices
- final deadlines
- liability commitments
- refund or warranty promises

### Privacy and Data Risk

Requires review when work involves:

- personal data
- customer records
- booking systems
- payment data
- analytics tracking
- email lists
- client databases
- production logs

### Financial Risk

Requires approval when work involves:

- ad spend
- domains
- hosting
- paid APIs
- subscriptions
- refunds
- discounts
- pricing changes
- payment settings

### Public Claim Risk

Requires review when work involves:

- revenue claims
- performance claims
- client names
- testimonials
- screenshots
- logos
- before/after claims
- guarantees
- regulated industries

### Technical Risk

Requires review when work involves:

- production deploys
- auth
- payments
- secrets
- destructive migrations
- customer data
- infrastructure changes

## Compliance Agent

The Compliance Agent does not replace a lawyer or accountant.

Its role is to:

- classify risk
- enforce internal policy
- ask for owner approval
- detect missing permissions
- flag legal/accounting review needs
- prevent unsupported public claims
- preserve approval records

## Default Gates

BureauOS can draft almost anything.

BureauOS must not finalize or send high-risk commitments without approval.

Approval-gated actions:

- send final proposal
- accept project
- publish public content
- launch paid ads
- change ad budget
- use client logo/testimonial
- commit final price
- commit final timeline
- sign or accept legal terms
- deploy production
- handle sensitive data without project policy

## Approval Records

Every important approval must become action-sensitive memory.

It should record:

- who approved
- what was approved
- exact scope
- limits
- expiry
- whether it is one-off or recurring
- related artifact

Example:

```md
Owner approved launching Campaign `camp_042` on X with a maximum budget of 150 EUR. Approval expires when budget is spent or on 2026-06-15, whichever comes first.
```

## Safe Default

The safe default is:

```text
prepare everything
ask before external commitment
record the approval
execute within scope
report the result
```

