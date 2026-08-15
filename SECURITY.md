# Security Policy

## Supported versions

Security fixes are applied to the latest release and the current `main` branch. Older builds may not receive fixes.

## Reporting a vulnerability

Do not disclose vulnerability details in a public issue, discussion, pull request, or log attachment.

Use GitHub's private vulnerability reporting option from the repository's **Security** tab when available. Otherwise, contact the maintainer through the contact method on their GitHub profile and request a private channel before sending technical details.

Include the affected version or commit, operating system and Node.js version, impact, prerequisites, minimal reproduction steps, and relevant logs. Remove API keys, paths, usernames, session contents, and other personal data first. Allow time to confirm the report and coordinate a fix before public disclosure.

## Security-sensitive areas

- Renderer sandbox or context-isolation bypass
- Navigation outside the expected local Harness origin
- Unsafe IPC behavior
- Command execution or argument injection
- Exposure of Harness profiles, sessions, logs, or model credentials
- Incomplete child-process cleanup with a security impact
- Unsafe update or packaging behavior

`DSH_DESKTOP_DSH_CMD` is intentionally executed by the system shell. It is a trusted local administrator/developer setting and must never be populated from untrusted input. Demonstrating that a user-supplied value can execute a command is not, by itself, a vulnerability.
