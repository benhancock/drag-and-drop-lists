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

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

export function calculateGhostLanding(source: RectLike, target: RectLike): GhostLanding {
	const sourceWidth = Math.max(1, source.width);
	const sourceHeight = Math.max(1, source.height);
	const scaleX = clamp(target.width / sourceWidth, 0.58, 0.84);
	const scaleY = clamp(target.height / sourceHeight, 0.3, 0.72);
	const landingWidth = sourceWidth * scaleX;
	const sourceCenterX = source.left + sourceWidth / 2;
	const sourceCenterY = source.top + sourceHeight / 2;
	const targetCenterX = target.left + Math.min(target.width, landingWidth) / 2;
	const targetCenterY = target.top + target.height / 2;
	const deltaX = targetCenterX - sourceCenterX;
	const deltaY = targetCenterY - sourceCenterY;
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
