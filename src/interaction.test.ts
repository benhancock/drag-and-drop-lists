import { describe, expect, it } from "vitest";
import {
	autoScrollConfig,
	dragStartThreshold,
	hasReachedDragStartThreshold,
	isTouchPointer,
	nearestTouchTarget,
	nearestVerticalTarget,
	touchGestureEventPolicy,
} from "./interaction";

describe("mobile pointer behavior", () => {
	it("recognizes touch without treating pen or mouse input as touch", () => {
		expect(isTouchPointer("touch")).toBe(true);
		expect(isTouchPointer("pen")).toBe(false);
		expect(isTouchPointer("mouse")).toBe(false);
	});

	it("requires more movement before starting a touch drag", () => {
		expect(dragStartThreshold(true)).toBe(10);
		expect(dragStartThreshold(false)).toBe(5);
	});

	it("keeps small touch movement as a tap but claims movement at the drag threshold", () => {
		expect(hasReachedDragStartThreshold(10, 20, 16, 27, true)).toBe(false);
		expect(hasReachedDragStartThreshold(10, 20, 16, 28, true)).toBe(true);
	});

	it("claims marker touches immediately but leaves terminal events available to other gestures", () => {
		expect(touchGestureEventPolicy("start", true)).toEqual({
			preventDefault: true,
			stopImmediatePropagation: true,
		});
		expect(touchGestureEventPolicy("move", true)).toEqual({
			preventDefault: true,
			stopImmediatePropagation: true,
		});
		expect(touchGestureEventPolicy("terminal", false)).toEqual({
			preventDefault: false,
			stopImmediatePropagation: false,
		});
	});

	it("resolves overlapping mobile hit areas to the nearest visible marker", () => {
		const targets = [
			{ value: "first", centerX: 20, centerY: 20 },
			{ value: "second", centerX: 20, centerY: 46 },
		];
		expect(nearestTouchTarget(targets, 20, 31, 22)).toBe("first");
		expect(nearestTouchTarget(targets, 20, 35, 22)).toBe("second");
	});

	it("accounts for indentation and ignores touches outside the marker gutter", () => {
		const targets = [
			{ value: "parent", centerX: 20, centerY: 20 },
			{ value: "nested", centerX: 36, centerY: 44 },
		];
		expect(nearestTouchTarget(targets, 31, 34, 22)).toBe("nested");
		expect(nearestTouchTarget(targets, 60, 34, 22)).toBeNull();
	});

	it("keeps an active touch drag on the vertically hovered row regardless of horizontal drift", () => {
		const targets = [
			{ value: "first", top: 100, bottom: 124 },
			{ value: "second", top: 124, bottom: 172 },
		];
		expect(nearestVerticalTarget(targets, 145, 8)).toBe("second");
	});

	it("uses the nearest row at a boundary but not across unrelated vertical space", () => {
		const targets = [
			{ value: "first", top: 100, bottom: 124 },
			{ value: "second", top: 132, bottom: 156 },
		];
		expect(nearestVerticalTarget(targets, 127, 8)).toBe("first");
		expect(nearestVerticalTarget(targets, 180, 8)).toBeNull();
	});

	it("uses a wider edge zone and larger scroll step for touch", () => {
		expect(autoScrollConfig(true)).toEqual({ threshold: 72, step: 22 });
		expect(autoScrollConfig(false)).toEqual({ threshold: 56, step: 18 });
	});
});
