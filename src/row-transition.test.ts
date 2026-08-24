import { describe, expect, it } from "vitest";
import { calculateGhostLanding, calculateRowDeltas } from "./row-transition";

describe("calculateGhostLanding", () => {
	it("curves and compresses a preview into a destination line", () => {
		const landing = calculateGhostLanding(
			{ left: 300, top: 200, width: 200, height: 100 },
			{ left: 100, top: 100, width: 600, height: 24 },
		);
		expect(landing).toMatchObject({
			deltaX: -216,
			deltaY: -138,
			scaleX: 0.84,
			scaleY: 0.3,
		});
		expect(landing.midDeltaX).toBeCloseTo(-138.24);
		expect(landing.midDeltaY).toBeCloseTo(-73.14);
	});

	it("bounds the effect for unusually narrow or tall destinations", () => {
		const landing = calculateGhostLanding(
			{ left: 0, top: 0, width: 400, height: 20 },
			{ left: 0, top: 200, width: 20, height: 200 },
		);
		expect(landing.scaleX).toBe(0.58);
		expect(landing.scaleY).toBe(0.72);
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
