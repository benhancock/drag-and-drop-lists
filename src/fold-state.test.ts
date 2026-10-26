import { describe, expect, it, vi } from "vitest";
import { restoreCollapsedListFold } from "./fold-state";

describe("restoreCollapsedListFold", () => {
	it("moves the cursor to the destination before restoring the fold", () => {
		const calls: string[] = [];
		const target = {
			setCursor: vi.fn(() => { calls.push("cursor"); }),
			exec: vi.fn(() => { calls.push("fold"); }),
		};
		const cursor = { line: 8, ch: 12 };

		expect(restoreCollapsedListFold(target, cursor, true)).toBe(true);
		expect(target.setCursor).toHaveBeenCalledWith(cursor);
		expect(target.exec).toHaveBeenCalledWith("toggleFold");
		expect(calls).toEqual(["cursor", "fold"]);
	});

	it("leaves an expanded item unchanged", () => {
		const target = {
			setCursor: vi.fn(),
			exec: vi.fn(),
		};

		expect(restoreCollapsedListFold(target, { line: 3, ch: 0 }, false)).toBe(false);
		expect(target.setCursor).not.toHaveBeenCalled();
		expect(target.exec).not.toHaveBeenCalled();
	});
});
