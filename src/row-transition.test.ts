import { describe, expect, it } from "vitest";
import {
	calculateBlockSpanHeight,
	calculateGhostGrabAnchor,
	calculateGhostLanding,
	calculateGhostPickup,
	calculateGhostRowAlignment,
	calculateListProjection,
	calculateProjectedLandingTarget,
	calculateProjectionDeltas,
	calculateRowDeltas,
} from "./row-transition";

describe("calculateListProjection", () => {
	it("opens a same-height slot while moving a block down", () => {
		const projection = calculateListProjection(0, 1, 4, 100, 196, 24);
		expect(projection.placeholderTop).toBe(172);
		expect([0, 1, 2, 3, 4].map(projection.lineOffset)).toEqual([0, -24, -24, -24, 0]);
	});

	it("opens a same-height slot while moving a block up", () => {
		const projection = calculateListProjection(4, 5, 1, 196, 124, 24);
		expect(projection.placeholderTop).toBe(124);
		expect([0, 1, 2, 3, 4].map(projection.lineOffset)).toEqual([0, 24, 24, 24, 0]);
	});

	it("leaves rows in place for an adjacent no-op target", () => {
		const projection = calculateListProjection(2, 3, 3, 148, 172, 24);
		expect(projection.placeholderTop).toBe(148);
		expect([0, 1, 2, 3, 4].map(projection.lineOffset)).toEqual([0, 0, 0, 0, 0]);
	});
});

describe("calculateBlockSpanHeight", () => {
	it("uses the editor's complete wrapped-line height for one list row", () => {
		expect(calculateBlockSpanHeight(
			{ top: 120, height: 52 },
			{ top: 120, height: 52 },
		)).toBe(52);
	});

	it("spans the first row through the bottom of a nested final row", () => {
		expect(calculateBlockSpanHeight(
			{ top: 120, height: 26 },
			{ top: 172, height: 40 },
		)).toBe(92);
	});
});

describe("calculateGhostGrabAnchor", () => {
	it("places the touched marker center directly beneath the pointer", () => {
		expect(calculateGhostGrabAnchor(
			{ left: 200, top: 100, width: 320, height: 80 },
			{ left: 216, top: 114, width: 20, height: 20 },
		)).toEqual({ x: 26, y: 24 });
	});
});

describe("calculateProjectionDeltas", () => {
	it("animates stable rows into positions opened by a moving placeholder", () => {
		expect(calculateProjectionDeltas(
			new Map([[0, 0], [1, 24], [2, 72]]),
			new Map([[0, 0], [1, 48], [2, 72]]),
		)).toEqual([{ newLineIndex: 1, deltaY: -24 }]);
	});

	it("ignores newly visible rows and subpixel measurement noise", () => {
		expect(calculateProjectionDeltas(
			new Map([[0, 10], [1, 30]]),
			new Map([[0, 10.25], [2, 50]]),
		)).toEqual([]);
	});

	it("continues from the visible position when a drop interrupts an active projection", () => {
		expect(calculateProjectionDeltas(
			new Map([[0, 0], [1, 37.5], [2, 72]]),
			new Map([[0, 0], [1, 48], [2, 72]]),
		)).toEqual([{ newLineIndex: 1, deltaY: -10.5 }]);
	});
});

describe("calculateGhostPickup", () => {
	it("aligns the preview content without scaling the list item", () => {
		expect(calculateGhostPickup(
			{ left: 268, top: 188, width: 264, height: 28 },
			{ left: 36, top: 320, width: 520, height: 28 },
		)).toEqual({ deltaX: -232, deltaY: 132 });
	});

	it("moves an in-place touch preview from its source content toward the thumb", () => {
		expect(calculateGhostPickup(
			{ left: 96, top: 212, width: 264, height: 28 },
			{ left: 36, top: 200, width: 264, height: 28 },
		)).toEqual({ deltaX: -60, deltaY: -12 });
	});

	it("aligns pickup markers without including different row chrome", () => {
		expect(calculateGhostPickup(
			{ left: 164, top: 212, width: 16, height: 16 },
			{ left: 160, top: 208, width: 16, height: 16 },
		)).toEqual({ deltaX: -4, deltaY: -4 });
	});
});

describe("calculateProjectedLandingTarget", () => {
	it("keeps the source marker offset within the destination row", () => {
		expect(calculateProjectedLandingTarget(
			{ left: 40, top: 300, width: 600, height: 48 },
			{ left: 40, top: 100, width: 600, height: 48 },
			{ left: 64, top: 110, width: 18, height: 18 },
			{ left: 72, top: 210, width: 600, height: 48 },
			{ left: 88, top: 220, width: 12, height: 12 },
			true,
		)).toEqual({ left: 96, top: 310, width: 18, height: 18 });
	});

	it("uses the target marker while the moved item is being reindented", () => {
		expect(calculateProjectedLandingTarget(
			{ left: 40, top: 300, width: 600, height: 48 },
			{ left: 40, top: 100, width: 600, height: 48 },
			{ left: 64, top: 110, width: 18, height: 18 },
			{ left: 40, top: 210, width: 600, height: 48 },
			{ left: 112, top: 220, width: 12, height: 12 },
			false,
		)).toEqual({ left: 112, top: 310, width: 18, height: 18 });
	});

	it("keeps the source marker dimensions so task boxes do not scale into bullets", () => {
		const target = calculateProjectedLandingTarget(
			{ left: 0, top: 200, width: 500, height: 24 },
			{ left: 0, top: 20, width: 500, height: 24 },
			{ left: 20, top: 23, width: 20, height: 20 },
			{ left: 40, top: 90, width: 500, height: 24 },
			{ left: 60, top: 90, width: 8, height: 8 },
			true,
		);
		expect(target.width).toBe(20);
		expect(target.height).toBe(20);
	});
});

describe("calculateGhostLanding", () => {
	it("aligns the preview marker with the destination marker", () => {
		const landing = calculateGhostLanding(
			{ left: 260, top: 180, width: 280, height: 44 },
			{ left: 268, top: 188, width: 24, height: 24 },
			{ left: 36, top: 320, width: 24, height: 24 },
		);
		expect(260 + landing.deltaX + 8 * landing.scaleX).toBeCloseTo(36);
		expect(180 + landing.deltaY + 8 * landing.scaleY).toBeCloseTo(320);
		expect(landing.scaleX).toBe(1);
		expect(landing.scaleY).toBe(1);
	});

	it("bounds scaling when source and destination markers differ", () => {
		const landing = calculateGhostLanding(
			{ left: 0, top: 0, width: 400, height: 20 },
			{ left: 10, top: 2, width: 380, height: 16 },
			{ left: 0, top: 200, width: 20, height: 200 },
		);
		expect(landing.scaleX).toBe(0.9);
		expect(landing.scaleY).toBe(1.06);
	});
});

describe("calculateGhostRowAlignment", () => {
	it("moves an overhanging checkbox inside the preview gutter", () => {
		expect(calculateGhostRowAlignment(200, 8, 40, 40, 184)).toEqual({
			shiftX: 24,
			widthAdjustment: 24,
		});
	});

	it("preserves a nested marker's offset from its parent", () => {
		expect(calculateGhostRowAlignment(200, 8, 40, 76, 184)).toEqual({
			shiftX: 60,
			widthAdjustment: 60,
		});
	});
});

describe("calculateRowDeltas", () => {
	it("moves surviving rows up when the first row moves below them", () => {
		const deltas = calculateRowDeltas(
			new Map([[0, 0], [1, 20], [2, 40]]),
			new Map([[0, 0], [1, 20], [2, 40]]),
			[1, 2, 0],
			0,
			0,
		);
		expect(deltas).toEqual([
			{ newLineIndex: 0, deltaY: 20 },
			{ newLineIndex: 1, deltaY: 20 },
		]);
	});

	it("moves surviving rows down when the last row moves above them", () => {
		const deltas = calculateRowDeltas(
			new Map([[0, 0], [1, 20], [2, 40]]),
			new Map([[0, 0], [1, 20], [2, 40]]),
			[2, 0, 1],
			2,
			2,
		);
		expect(deltas).toEqual([
			{ newLineIndex: 1, deltaY: -20 },
			{ newLineIndex: 2, deltaY: -20 },
		]);
	});

	it("ignores the moved subtree, offscreen rows, and subpixel noise", () => {
		const deltas = calculateRowDeltas(
			new Map([[0, 0], [1, 20], [3, 60]]),
			new Map([[0, 0.25], [1, 20], [2, 40]]),
			[0, 3, 1],
			1,
			1,
		);
		expect(deltas).toEqual([{ newLineIndex: 1, deltaY: 40 }]);
	});
});
