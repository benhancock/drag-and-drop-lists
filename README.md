# Drag and Drop Lists

Reorder list items in Obsidian's editing view by dragging task checkboxes or ordinary list markers.

Works on desktop and mobile. Touch devices use larger handles, suppress text selection while a handle is pressed, use a safer drag threshold, and position the preview away from your finger.

For synced vaults, deploy only `main.js`, `manifest.json`, and `styles.css` into the plugin folder. Keep source files, build configuration, and `node_modules` outside the vault.

- Dragging moves the entire task, including nested children and indented continuation lines.
- Drop before or after another list item.
- Dropping at another nesting level reindents the moved subtree.
- The move is a single undoable editor transaction.
- Surrounding rows glide into their new vertical positions after a drop.
- The drag preview gently converges into the moved item's destination line.
- Choose whether the cursor lands at the beginning or end of the moved line.
- Cancel an active drag with Escape or by releasing outside a valid list target.
- Reorder within blockquotes and with mixed tab/space indentation safely.
- Grab a larger invisible area around markers, or the indentation on a no-bullet continuation line.
- Use the command palette to move the current list item up or down without a mouse.

This first release targets desktop Obsidian's Live Preview editing mode, where task checkboxes are visible.
