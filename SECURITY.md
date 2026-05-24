# Security

BureauOS is designed for autonomous agents that may read repositories, create issues, modify code, open pull requests, and eventually operate in long-running daemon mode.

Security is therefore part of the core design, not an optional plugin.

## Security Principles

- least privilege by default
- explicit policy before action
- no production deploys by default
- no secret modification by default
- no destructive git operations by default
- no cross-client memory leakage
- audit all important decisions
- escalate high-risk work to humans

## Sensitive Areas

Work involving these areas should require security review:

- authentication
- authorization
- payments
- billing
- secrets
- cryptography
- dependency updates
- CI/CD credentials
- database migrations
- customer data
- production deployment

## Reporting Security Issues

Until a formal security contact exists, open a private advisory if the repository is hosted on GitHub and the issue affects runtime behavior.

Do not disclose exploitable vulnerabilities publicly before maintainers have had time to respond.

