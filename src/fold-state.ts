export interface FoldCursor {
	line: number;
	ch: number;
}

export interface FoldRestorationTarget {
	setCursor(cursor: FoldCursor): void;
	exec(command: "toggleFold"): void;
}

export function restoreCollapsedListFold(
	target: FoldRestorationTarget,
	cursor: FoldCursor,
	wasCollapsed: boolean,
): boolean {
	if (!wasCollapsed) return false;
	target.setCursor(cursor);
	target.exec("toggleFold");
	return true;
}
