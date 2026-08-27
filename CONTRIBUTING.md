# Contributing

Thanks for helping improve Drag and Drop Lists.

## Reporting issues

Please include:

- Your operating system and Obsidian version.
- Whether the issue occurs on desktop, mobile, or both.
- Your editing mode, theme, and any relevant CSS snippets.
- A minimal Markdown example and exact reproduction steps.
- Whether the issue remains when other community plugins are disabled.

Screenshots or short recordings are especially useful for animation, alignment, and touch-interaction problems.

## Development

1. Install dependencies with `npm ci`.
2. Run `npm run dev` while developing.
3. Run `npm run check` before opening a pull request.
4. Test behavior in Live Preview on the affected platform.

Keep changes focused and avoid unrelated formatting. Add a regression test for deterministic parsing, movement, targeting, or animation logic whenever practical.

## Pull requests

Describe the user-visible change, how it was tested, and any reliance on undocumented editor DOM. Do not commit `main.js`, `node_modules`, vault data, or test-vault contents.
