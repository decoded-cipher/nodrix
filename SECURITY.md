# Security Policy

## Reporting a vulnerability

If you believe you've found a security vulnerability in nodrix, please report it
**privately** — do not open a public issue.

- **Preferred:** use GitHub's private vulnerability reporting on this repository
  (the **Security** tab → **Report a vulnerability**).
- **Or email:** hello@nodrix.live.

Please include:

- A description of the issue and its potential impact.
- Steps to reproduce, ideally with a proof of concept.
- The affected version or commit, and relevant environment details.

We'll acknowledge your report within a few days and keep you updated as we work on
a fix. Please give us a reasonable opportunity to address the issue before any
public disclosure.

## Scope

nodrix is self-hosted: each deployment runs in the operator's own Cloudflare
account. Vulnerabilities in the nodrix codebase — the worker, the web app, and the
shared packages — are in scope.

Out of scope: misconfiguration of a specific self-hosted deployment, and issues in
Cloudflare's own infrastructure (report those to your Cloudflare account and to
Cloudflare, respectively).

## Supported versions

nodrix is under active development. Security fixes target the latest release on the
default branch.
