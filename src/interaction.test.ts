import { describe, expect, it } from "vitest";
import { autoScrollConfig, dragStartThreshold, isTouchPointer } from "./interaction";

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

	it("uses a wider edge zone and larger scroll step for touch", () => {
		expect(autoScrollConfig(true)).toEqual({ threshold: 72, step: 22 });
		expect(autoScrollConfig(false)).toEqual({ threshold: 56, step: 18 });
	});
});
