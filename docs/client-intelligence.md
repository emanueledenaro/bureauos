# Client Intelligence

BureauOS needs a real client memory system.

Every client should have a persistent profile that records who they are, what they do, what projects they had, how much value they brought to the company, how much revenue they generated, what risks exist, and what should happen next.

## Purpose

Client intelligence helps the supreme coordinator:

- understand each client
- route work correctly
- protect client-specific context
- identify upsells
- detect retention risk
- understand profitability
- remember communication preferences
- avoid repeating questions
- make better business decisions

## Client Profile

Each client should have a durable profile.

Recommended shape:

```text
.bureauos/memory/clients/
  client-acme/
    CLIENT.md
    PROJECTS.md
    REVENUE.md
    RELATIONSHIP.md
    DECISIONS.md
    RISKS.md
    PERMISSIONS.md
    COMMUNICATION.md
    OPPORTUNITIES.md
```

## What To Store

### Identity

- client name
- company type
- industry
- location
- contacts
- website
- social links
- brand assets

### Business Context

- what the client does
- target customers
- business model
- goals
- pain points
- constraints
- competitors when relevant

### Relationship State

- relationship status
- trust level
- communication style
- preferred channels
- last contact
- next follow-up
- satisfaction signals
- retention risk

### Projects

- past projects
- active projects
- proposed projects
- cancelled projects
- project outcomes
- repositories
- deliveries
- issues
- PRs
- releases

### Financial Value

- total revenue
- paid invoices when connected
- expected revenue
- retainer value
- project value
- margin notes
- payment status
- lifetime value estimate
- upsell potential
- referral potential

### Permissions

- can use logo publicly
- can use testimonial
- can publish case study
- can mention client name
- can use screenshots
- can contact directly
- approved communication policy
- approved budget or spend

### Risks

- scope risk
- payment risk
- satisfaction risk
- legal/privacy risk
- delivery risk
- communication risk
- reputation risk

## Classification

BureauOS should classify clients.

Example fields:

```yaml
client_classification:
  revenue_tier: high | medium | low | unknown
  strategic_value: high | medium | low
  relationship_health: strong | neutral | at_risk
  payment_reliability: good | unknown | risky
  upsell_potential: high | medium | low
  referral_potential: high | medium | low
  public_proof_allowed: yes | no | partial | unknown
```

## Client Value Score

The coordinator can calculate a client value score from:

- total revenue
- expected future revenue
- margin
- payment reliability
- strategic value
- referral potential
- case study potential
- relationship quality
- delivery burden
- risk

This score should guide attention, but not override owner judgment.

## Memory Updates

Client memory should update after:

- new lead
- discovery call
- proposal sent
- project accepted
- payment received
- project delivered
- client feedback
- support request
- testimonial permission
- case study approval
- renewal
- upsell
- cancellation

## Owner Visibility

The owner should be able to ask:

```text
Who are our best clients?
Which clients made us the most money?
Which clients are at risk?
Which clients can become case studies?
Who should we follow up with this week?
Which clients are not profitable?
```

BureauOS should answer from structured memory and live connected systems when available.

