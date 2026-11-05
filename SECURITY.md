# Security Policy

## Supported versions

Only the latest released version of the extension receives security fixes.
Please upgrade before reporting.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting for this repository:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue, affected version, and reproduction steps.

You will receive an acknowledgement as soon as the report is triaged. Once a
fix is available it will ship in a new release and the advisory will be
published.

## Scope notes

This extension handles TM1 credentials and executes server-side objects
(TI processes, rules) against user-configured servers. Relevant to a report:

- Credential handling (SecretStorage vs. settings, transport headers).
- Any code path that sends data to a host other than the user's configured
  TM1 server.
- Injection into MDX / OData / TI generation from untrusted input.

Credentials are stored in the editor's SecretStorage; the extension sends no
telemetry and contacts only the TM1 servers you configure. The one exception is installing
Bedrock, which fetches the release from GitHub, and only when you ask for it.
