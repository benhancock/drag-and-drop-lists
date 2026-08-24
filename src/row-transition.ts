export interface RowDelta {
	newLineIndex: number;
	deltaY: number;
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
