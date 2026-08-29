import { describe, expect, it } from "vitest";
import { calculateIconOverlayGeometry } from "./icon-geometry";

describe("custom task icon geometry", () => {
	it("matches the checkbox rectangle relative to its label", () => {
		expect(calculateIconOverlayGeometry(
			{ left: 147.5, top: 82.25, width: 18, height: 18 },
			{ left: 140, top: 78, width: 260, height: 25 },
			0,
			0,
		)).toEqual({ left: 7.5, top: 4.25, width: 18, height: 18 });
	});

	it("accounts for the positioned label's border", () => {
		expect(calculateIconOverlayGeometry(
			{ left: 202, top: 106, width: 16, height: 16 },
			{ left: 198, top: 100, width: 300, height: 24 },
			1,
			2,
		)).toEqual({ left: 3, top: 4, width: 16, height: 16 });
	});

	it("declines to replace an unmeasurable checkbox", () => {
		expect(calculateIconOverlayGeometry(
			{ left: 0, top: 0, width: 0, height: 0 },
			{ left: 0, top: 0, width: 100, height: 24 },
			0,
			0,
		)).toBeNull();
	});
});
