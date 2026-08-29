function closestEditor(target: EventTarget | null): Element | null {
	if (!target) return null;
	const element = target as Partial<Element> & { parentElement?: Element | null };
	return typeof element.closest === "function"
		? element.closest(".cm-editor")
		: element.parentElement?.closest(".cm-editor") ?? null;
}

/** Only acquire a new gesture on the editor actually receiving it. Do not use
 * focus: a visible editor must still accept a first touch without a keyboard. */
export function editorOwnsGestureStart(
	editor: HTMLElement,
	target: EventTarget | null,
	clientX: number,
	clientY: number,
): boolean {
	if (!editor.isConnected || closestEditor(target) !== editor) return false;
	// Event targets alone can be stale/retargeted. The topmost hit respects
	// sidebar backdrops, dialogs, clipping, hidden panes, and nested editors.
	return closestEditor(editor.ownerDocument.elementFromPoint(clientX, clientY)) === editor;
}

/** Expanded touch targets must not reach through UI or scroll clipping to a
 * covered marker, even when its bounding rectangle still has a nonzero size. */
export function markerIsExposed(handle: HTMLElement, clientX: number, clientY: number): boolean {
	if (!handle.isConnected) return false;
	const hit = handle.ownerDocument.elementFromPoint(clientX, clientY);
	return hit !== null && handle.contains(hit);
}
