export interface AutoScrollConfig {
	threshold: number;
	step: number;
}

export function isTouchPointer(pointerType: string): boolean {
	return pointerType === "touch";
}

export function dragStartThreshold(touchPointer: boolean): number {
	return touchPointer ? 10 : 5;
}

export function autoScrollConfig(touchPointer: boolean): AutoScrollConfig {
	return touchPointer
		? { threshold: 72, step: 22 }
		: { threshold: 56, step: 18 };
}
