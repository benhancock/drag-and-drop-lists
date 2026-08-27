export interface RowDelta {
	newLineIndex: number;
	deltaY: number;
}

export interface RectLike {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface GhostLanding {
	deltaX: number;
	deltaY: number;
	midDeltaX: number;
	midDeltaY: number;
	scaleX: number;
	scaleY: number;
}

export interface GhostPickup {
	deltaX: number;
	deltaY: number;
}

export type ProjectedLandingTarget = RectLike;

export interface GhostGrabAnchor {
	x: number;
	y: number;
}

export interface GhostRowAlignment {
	shiftX: number;
	widthAdjustment: number;
}

export interface BlockGeometry {
	top: number;
	height: number;
}

export interface ListProjection {
	placeholderTop: number;
	lineOffset: (lineIndex: number) => number;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

export function calculateBlockSpanHeight(
	first: BlockGeometry,
	last: BlockGeometry,
): number {
	return Math.max(1, last.top + last.height - first.top);
}

export function calculateListProjection(
	sourceStart: number,
	sourceEnd: number,
	insertionBoundary: number,
	sourceTop: number,
	boundaryTop: number,
	sourceHeight: number,
): ListProjection {
	const movingDown = insertionBoundary >= sourceEnd;
	const placeholderTop = movingDown ? boundaryTop - sourceHeight : boundaryTop;
	return {
		placeholderTop,
		lineOffset: (lineIndex: number): number => {
			if (insertionBoundary > sourceEnd
				&& lineIndex >= sourceEnd
				&& lineIndex < insertionBoundary) return -sourceHeight;
			if (insertionBoundary < sourceStart
				&& lineIndex >= insertionBoundary
				&& lineIndex < sourceStart) return sourceHeight;
			return 0;
		},
	};
}

export function calculateGhostLanding(
	source: RectLike,
	sourceContent: RectLike,
	target: RectLike,
): GhostLanding {
	const contentWidth = Math.max(1, sourceContent.width);
	const contentHeight = Math.max(1, sourceContent.height);
	const scaleX = clamp(target.width / contentWidth, 0.9, 1.03);
	const scaleY = clamp(target.height / contentHeight, 0.92, 1.06);
	const contentOffsetX = sourceContent.left - source.left;
	const contentOffsetY = sourceContent.top - source.top;
	const deltaX = target.left - source.left - contentOffsetX * scaleX;
	const deltaY = target.top - source.top - contentOffsetY * scaleY;
	const verticalBend = Math.sign(deltaY) * Math.min(8, Math.abs(deltaY) * 0.05);
	return {
		deltaX,
		deltaY,
		midDeltaX: deltaX * 0.64,
		midDeltaY: deltaY * 0.58 - verticalBend,
		scaleX,
		scaleY,
	};
}

export function calculateGhostPickup(
	sourceContent: RectLike,
	targetContent: RectLike,
): GhostPickup {
	return {
		deltaX: targetContent.left - sourceContent.left,
		deltaY: targetContent.top - sourceContent.top,
	};
}

export function calculateProjectedLandingTarget(
	placeholder: RectLike,
	sourceRow: RectLike,
	sourceAnchor: RectLike,
	targetRow: RectLike,
	targetAnchor: RectLike,
	preserveSourceMarkerOffset: boolean,
): ProjectedLandingTarget {
	return {
		left: preserveSourceMarkerOffset
			? targetRow.left + sourceAnchor.left - sourceRow.left
			: targetAnchor.left,
		top: placeholder.top + sourceAnchor.top - sourceRow.top,
		width: sourceAnchor.width,
		height: sourceAnchor.height,
	};
}

export function calculateGhostGrabAnchor(
	ghost: RectLike,
	anchor: RectLike,
): GhostGrabAnchor {
	return {
		x: anchor.left + anchor.width / 2 - ghost.left,
		y: anchor.top + anchor.height / 2 - ghost.top,
	};
}

export function calculateGhostRowAlignment(
	ghostLeft: number,
	ghostPaddingLeft: number,
	baseSourceAnchorLeft: number,
	sourceAnchorLeft: number,
	ghostAnchorLeft: number,
): GhostRowAlignment {
	const desiredAnchorLeft = ghostLeft + ghostPaddingLeft + sourceAnchorLeft - baseSourceAnchorLeft;
	const shiftX = desiredAnchorLeft - ghostAnchorLeft;
	return { shiftX, widthAdjustment: Math.max(0, shiftX) };
}

export function calculateRowDeltas(
	oldTops: ReadonlyMap<number, number>,
	newTops: ReadonlyMap<number, number>,
	originalLineIndexes: readonly number[],
	movingStart: number,
	movingEnd: number,
): RowDelta[] {
	const deltas: RowDelta[] = [];
	for (const [newLineIndex, newTop] of newTops) {
		const oldLineIndex = originalLineIndexes[newLineIndex];
		if (oldLineIndex === undefined || oldLineIndex >= movingStart && oldLineIndex <= movingEnd) continue;
		const oldTop = oldTops.get(oldLineIndex);
		if (oldTop === undefined) continue;
		const deltaY = oldTop - newTop;
		if (Math.abs(deltaY) <= 0.5) continue;
		deltas.push({ newLineIndex, deltaY });
	}
	return deltas;
}

export function calculateProjectionDeltas(
	oldTops: ReadonlyMap<number, number>,
	newTops: ReadonlyMap<number, number>,
): RowDelta[] {
	const deltas: RowDelta[] = [];
	for (const [lineIndex, newTop] of newTops) {
		const oldTop = oldTops.get(lineIndex);
		if (oldTop === undefined) continue;
		const deltaY = oldTop - newTop;
		if (Math.abs(deltaY) <= 0.5) continue;
		deltas.push({ newLineIndex: lineIndex, deltaY });
	}
	return deltas;
}
