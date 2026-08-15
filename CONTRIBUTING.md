# Contributing to DSH Desktop

Contributions to code, documentation, translations, and reproducible bug reports are welcome.

## Before you start

- Use Node.js 22.12 or newer.
- Search existing issues and pull requests before opening a duplicate.
- Report vulnerabilities according to [SECURITY.md](SECURITY.md), not in a public issue.
- Never include API keys, Harness profiles, session data, npm credentials, or personal log contents.

## Local setup

```bash
git clone https://github.com/shixiliya1/dsh-desktop.git
cd dsh-desktop
npm install
npm start
```

Harness data created by the app is stored outside the repository in Electron's user-data directory.

## Making a change

1. Fork the repository and create a focused branch from `main`.
2. Keep each change limited to one purpose.
3. Preserve renderer sandboxing, context isolation, disabled Node integration, restricted navigation, and isolated Harness data.
4. Update the relevant README translations when user-facing behavior changes.
5. Use clear commit messages; short prefixes such as `feat:`, `fix:`, and `docs:` are preferred.

## Checks

```bash
node --check src/main/harness.js
node --check src/main/index.js
node --check src/main/preload.js
node --check src/renderer/renderer.js
node --check scripts/generate-icon.js
```

Run `npm run smoke` when changing startup, process management, ports, or Harness integration. It launches a real Harness process and may download `@deepseek-ai/dsh` on its first run. For packaging changes, also run `npm run dist:dir`.

## Pull requests

Explain what changed, why it changed, how it was verified, and any platform-specific behavior. Include screenshots for visible UI changes and note any documentation or release-note work still required.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE). Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
