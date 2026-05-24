# Easy Setup

BureauOS should be easy to start.

The user should not need to understand every agent, memory file, MCP server, skill, provider, or policy before seeing value.

## Principle

```text
Easy by default.
Powerful when configured.
```

The default install should create a safe, useful agency workspace with minimal questions.

## First Command

```bash
bureau init
```

## Setup Wizard

The wizard should ask only what is needed.

### Profile

```text
What are you setting up?
1. Freelancer
2. Small agency
3. Startup / product team
4. Company operator
```

### Work Surface

```text
Where should BureauOS work?
1. Local memory only
2. GitHub repository
3. GitHub organization
4. Existing project folder
```

### Capability Level

```text
Which capabilities should be enabled?
1. Docs and memory only
2. GitHub issues and reports
3. Codex development runtime
4. MCP integrations
5. Custom
```

### Autonomy Level

```text
How autonomous should BureauOS be?
1. Safe draft mode
2. Issue/comment mode
3. Branch and PR mode
4. Business operations mode
5. Custom
```

## Presets

### Freelancer

Best for independent developers and consultants.

Enables:

- client memory
- opportunity tracking
- project intake
- proposal drafts
- business reports
- GitHub issue templates
- safe draft mode by default

### Small Agency

Best for teams handling multiple clients.

Enables:

- multiple project teams
- client intelligence
- revenue pipeline
- project health checks
- GitHub integration
- proposal and pricing workflows

### Startup / Product Team

Best for product companies.

Enables:

- internal product team
- roadmap
- release workflow
- QA and security
- growth and content
- GitHub PR workflow

### Company Operator

Best for internal business operators.

Enables:

- company memory
- client or department registry
- operations reports
- integrations-first setup
- conservative external action policy

## Generated Files

`bureau init` should create:

```text
.bureauos/
  config.yaml
  memory/
    ROOT.md
    COMPANY.md
    CLIENTS.md
    PROJECTS.md
    ACTIVE_WORK.md
    DECISIONS.md
    clients/
    projects/
    opportunities/
    runs/
    artifacts/
```

It should also create:

- safe default policies
- profile-specific templates
- first executive report
- next-step checklist

## Auto-Detection

BureauOS should detect:

- git repository
- GitHub remote
- package manager
- test commands
- project type
- existing README
- existing issue templates
- installed Codex capabilities when available
- available MCP connectors when configured

The user should confirm, not manually enter everything.

## Configuration Philosophy

The config file can be large internally, but the user should mostly interact with:

```bash
bureau init
bureau settings
bureau connect github
bureau connect codex
bureau connect mcp
bureau status
```

## Safe Defaults

Default behavior:

- create memory
- draft artifacts
- create internal reports
- create issues if GitHub is connected
- do not publish publicly
- do not contact clients
- do not spend money
- do not merge
- do not deploy production

The owner can enable more power later.

