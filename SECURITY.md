# Security policy

Agent Village is self-hosted: every instance belongs to one owner and runs with that owner's own accounts and keys.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repository. Include the affected file/route, steps to reproduce and the impact you expect. You will get an answer as soon as possible.

## Scope

In scope: this code (authentication and the owner lock, authorization of routes and server actions, the agent engine and its approval flow, prompt-injection guards, secret handling, the vault and ClickUp integrations).

Out of scope: misconfiguration of an individual instance (e.g. a public vault repo or missing env vars), and vulnerabilities in third-party services themselves.

## Hardening already in place

See [docs/architecture.md § 7](docs/architecture.md#7-security-reviewed-in-phase-6-2026-11-19).
