import { describe, expect, it } from "vitest";
import { calculateRowDeltas } from "./row-transition";

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
