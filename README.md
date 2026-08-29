# Drag and Drop Lists

Reorder Markdown list items directly in Obsidian's Live Preview editor by dragging their bullet, number, or task checkbox.

Drag and Drop Lists works on desktop and mobile. The dragged item follows the pointer while the surrounding list rearranges to show exactly where it will land.

![Dragging a task and its nested items in Obsidian](assets/drag-and-drop-lists-demo.webp)

## Features

- Drag unordered, numbered, and task-list items by their visible marker.
- Move a parent item together with its contiguous nested list items.
- Leave unrelated prose and blank lines in place.
- Preview the destination with live list rearrangement and smooth pickup and landing animations.
- Reindent a moved subtree when dropping it at another nesting level.
- Preserve the move as one undoable editor transaction.
- Choose whether the cursor lands at the beginning or end of the moved line.
- Move the current list item up or down from the command palette.
- Cycle through common task types from Obsidian's configurable mobile toolbar.
- Work with blockquotes and mixed tab-and-space indentation.

## Usage

In Live Preview, press or click a bullet, number, or task checkbox and drag it vertically. Release over the projected gap to place the item there. Release outside a valid list target, or press `Escape` on desktop, to cancel the move.

Touch interactions use an expanded marker hit area, a brief pickup delay, a mobile drag threshold, and a preview positioned beneath the finger. A quick checkbox tap still toggles it without showing the drag preview. Native text selection and workspace swipe gestures remain available when a list drag is not active.

### Mobile task types

To add the task-type action to the mobile toolbar:

1. Open **Settings → Mobile → Manage toolbar options**.
2. Add the **Cycle current list item type** command.
3. Place the cursor on a list item and tap the toolbar action to advance its type.

By default, the command cycles through these Markdown markers:

| Type | Marker |
| --- | --- |
| Bullet | `-` |
| Unchecked | `[ ]` |
| Completed | `[x]` |
| In progress | `[/]` |
| Cancelled | `[-]` |
| Forwarded | `[>]` |
| Scheduled | `[<]` |
| Question | `[?]` |
| Important | `[!]` |
| Star | `[*]` |

The active theme or CSS snippets control how alternate task markers appear. Drag and Drop Lists changes only the Markdown marker.

## Settings

**Cursor placement** controls whether the caret appears at the beginning or end of the moved item's first line after a drop.

## Compatibility

- Obsidian 1.13.7 or later.
- Desktop and mobile.
- Live Preview editing mode. Reading view and Source mode are not draggable.

The plugin integrates with Live Preview's rendered list DOM because Obsidian does not expose a public drag-handle API. The integration is scoped to editor list markers and fails harmlessly when no supported marker is present.

## Installation

### Community plugins

Once listed, install **Drag and Drop Lists** from **Settings → Community plugins → Browse**.

### Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release and place them in:

```text
<vault>/.obsidian/plugins/drag-and-drop-lists/
```

Reload Obsidian, then enable **Drag and Drop Lists** under **Community plugins**.

## Privacy

Drag and Drop Lists processes the active editor locally. It does not make network requests, collect analytics, access the clipboard, or read and write files through the vault API. It saves the cursor-placement preference in the plugin's local settings data.

## Development

```bash
npm ci
npm run check
```

Use `npm run dev` for an incremental development build. Production builds generate the ignored `main.js` release artifact at the repository root.

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
