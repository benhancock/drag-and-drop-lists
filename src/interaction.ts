export interface AutoScrollConfig {
	threshold: number;
	step: number;
}

export interface TouchGestureEventPolicy {
	preventDefault: boolean;
	stopImmediatePropagation: boolean;
}

export interface TouchTargetGeometry<T> {
	value: T;
	centerX: number;
	centerY: number;
}

export interface VerticalTargetGeometry<T> {
	value: T;
	top: number;
	bottom: number;
}

export type TouchGesturePhase = "start" | "move" | "terminal";

export function isTouchPointer(pointerType: string): boolean {
	return pointerType === "touch";
}

export function dragStartThreshold(touchPointer: boolean): number {
	return touchPointer ? 10 : 5;
}

export function dragPickupDelay(touchPointer: boolean): number {
	return touchPointer ? 120 : 0;
}

export function hasReachedDragStartThreshold(
	startX: number,
	startY: number,
	currentX: number,
	currentY: number,
	touchPointer: boolean,
): boolean {
	return Math.hypot(currentX - startX, currentY - startY) >= dragStartThreshold(touchPointer);
}

export function touchGestureEventPolicy(
	phase: TouchGesturePhase,
	preventDefault: boolean,
): TouchGestureEventPolicy {
	return {
		preventDefault,
		// End and cancellation events must reach Obsidian so its mobile gesture
		// recognizers can reset after this plugin releases the touch.
		stopImmediatePropagation: phase !== "terminal",
	};
}

export function nearestTouchTarget<T>(
	targets: readonly TouchTargetGeometry<T>[],
	clientX: number,
	clientY: number,
	hitRadius: number,
	isEligible?: (target: TouchTargetGeometry<T>) => boolean,
): T | null {
	let nearest: T | null = null;
	let nearestDistanceSquared = Number.POSITIVE_INFINITY;
	for (const target of targets) {
		const deltaX = clientX - target.centerX;
		const deltaY = clientY - target.centerY;
		if (Math.abs(deltaX) > hitRadius || Math.abs(deltaY) > hitRadius) continue;
		const distanceSquared = deltaX * deltaX + deltaY * deltaY;
		if (distanceSquared >= nearestDistanceSquared) continue;
		if (isEligible && !isEligible(target)) continue;
		nearest = target.value;
		nearestDistanceSquared = distanceSquared;
	}
	return nearest;
}

export function nearestVerticalTarget<T>(
	targets: readonly VerticalTargetGeometry<T>[],
	clientY: number,
	hitSlop: number,
): T | null {
	let nearest: T | null = null;
	let nearestDistance = Number.POSITIVE_INFINITY;
	let nearestCenterDistance = Number.POSITIVE_INFINITY;
	for (const target of targets) {
		const distance = clientY < target.top
			? target.top - clientY
			: clientY > target.bottom
				? clientY - target.bottom
				: 0;
		if (distance > hitSlop) continue;
		const centerDistance = Math.abs(clientY - (target.top + target.bottom) / 2);
		if (distance > nearestDistance
			|| distance === nearestDistance && centerDistance >= nearestCenterDistance) continue;
		nearest = target.value;
		nearestDistance = distance;
		nearestCenterDistance = centerDistance;
	}
	return nearest;
}

export function autoScrollConfig(touchPointer: boolean): AutoScrollConfig {
	return touchPointer
		? { threshold: 72, step: 22 }
		: { threshold: 56, step: 18 };
}
