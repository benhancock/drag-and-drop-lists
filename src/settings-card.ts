/** Native reorder uses cloneNode(), which copies selected attributes, not a
 * select's live value. Keep its defaults in sync so the drag copy is accurate. */
export function preserveSelectValueForClone(select: {
	readonly value: string;
	readonly options: Iterable<{ value: string; defaultSelected: boolean }>;
}): void {
	// Updating defaults can affect selection; capture the live value first.
	const value = select.value;
	for (const option of select.options) {
		option.defaultSelected = option.value === value;
	}
}
