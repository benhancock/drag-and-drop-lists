# Changelog

All notable changes to Drag and Drop Lists are documented here.

## 1.1.0 - 2026-10-26

- Preserve collapsed list-item state when moving an item and its hidden subtree.
- Indent and resize the live destination placeholder to match the target nesting level.
- Add optional completed-task fading, nested-bullet fading, and partial-progress indicators.
- Add desktop Shift-click cycling through Minimal's documented alternate task markers.

## 1.0.1 - 2026-10-24

- Tighten the desktop checkbox drag target while preserving expanded touch targeting on mobile.

## 1.0.0 - 2026-08-27

- Add marker-based drag and drop for unordered, numbered, and task-list items in Live Preview.
- Add animated pickup, live destination projection, and preview-to-row landing transitions.
- Move contiguous nested list items with their parent while leaving prose and blank lines behind.
- Add automatic subtree reindentation when moving between nesting levels.
- Add touch handling designed for Obsidian mobile without blocking unrelated gestures after a drag.
- Add command-palette actions for moving the current list item up or down.
- Add a configurable mobile-toolbar action for cycling alternate task markers.
- Add a setting for placing the cursor at the beginning or end of a moved item.
- Add blockquote and mixed-indentation support.
- Add regression coverage for list parsing, movement, touch targeting, projections, and animations.
