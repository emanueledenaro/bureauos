# Universal Opportunity Intake

BureauOS should handle any client or internal opportunity through the same operating logic.

The pizzeria website, mobile app, SaaS product, internal tool, landing page, automation, e-commerce store, or marketing campaign are different scopes, but the intake model is the same.

## Core Idea

The owner explains the opportunity once.

BureauOS turns it into:

- client profile
- opportunity record
- risk and compliance check
- business intake
- project intake
- scope draft
- pricing brief
- proposal draft
- delivery plan
- repository or workspace provisioning plan
- team assignment
- monitoring plan

## Universal Flow

```text
Owner explains opportunity
  -> Supreme Coordinator creates Opportunity
  -> Client / Product context is recorded
  -> Risk and Compliance Agent classifies constraints
  -> Sales Agent qualifies the commercial fit
  -> Product Agent defines requirements
  -> UX Agent defines user flows when needed
  -> Creative Agent defines brand and visual needs when needed
  -> Development Agent estimates technical approach
  -> QA Agent defines verification scope
  -> Security Agent checks technical risk
  -> Pricing Agent prepares pricing and margin notes
  -> Proposal Agent prepares proposal or SOW draft
  -> Supreme Coordinator asks owner only for important approvals
  -> Project Manager provisions project workspace and repository
  -> Delivery team starts work
  -> Always-on monitor tracks project health
```

## Examples

### Local Business Website

Input:

```text
A pizzeria wants a website with reservations, local identity, logo, menu, location, and contact details.
```

BureauOS creates:

- client profile
- website project intake
- brand brief
- booking feature spec
- local SEO plan
- proposal draft
- repository provisioning plan
- project team

### Mobile App

Input:

```text
A client wants a mobile app for bookings, notifications, payments, and admin management.
```

BureauOS creates:

- client opportunity
- mobile project intake
- platform decision notes
- payment/security review
- delivery estimate
- pricing brief
- proposal draft
- app repository plan
- project team

### Internal Product

Input:

```text
The owner wants to sell an internal service through ads and a landing page.
```

BureauOS creates:

- offer brief
- landing page brief
- campaign brief
- ad creative brief
- social content plan
- conversion audit
- tracking plan
- lead pipeline

## Repository Provisioning

When an opportunity becomes an approved project, BureauOS should prepare or create:

- repository name
- repository visibility
- README
- issue labels
- project board
- milestones
- initial issues
- branch strategy
- CI plan
- deployment plan
- secrets checklist
- project memory folder

Creation of private repositories, paid infrastructure, domains, production secrets, or third-party accounts requires owner approval or approved policy.

## Owner Approval Gates

The coordinator must ask before:

- sending proposals
- accepting a client project
- committing to final price
- committing to final scope
- signing or accepting contract terms
- publishing public content
- launching paid ads
- buying domains or hosting
- deploying production
- storing or processing sensitive client data

The system can still prepare everything before approval.

