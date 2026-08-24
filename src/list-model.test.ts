import { describe, expect, it } from "vitest";
import {
	findContainingListBlock,
	findListBlock,
	findSiblingListBlock,
	moveListBlock,
	parseListLine,
} from "./list-model";

function block(lines: readonly string[], line: number) {
	const result = findListBlock(lines, line);
	expect(result).not.toBeNull();
	return result!;
}

describe("parseListLine", () => {
	it.each([
		["- plain", "-", null, "plain"],
		["12) ordered", "12)", null, "ordered"],
		["\t* [??] status", "*", "??", "status"],
		[">   - [ ] quoted", "-", " ", "quoted"],
	])("parses %s", (source, marker, taskStatus, content) => {
		const parsed = parseListLine(source);
		expect(parsed).toMatchObject({ marker, taskStatus, content });
	});

	it.each(["paragraph", "---", "[ ] not a list", "1234567890. too many digits"])(
		"rejects %s",
		(source) => expect(parseListLine(source)).toBeNull(),
	);
});

describe("findListBlock", () => {
	it("includes nested descendants but not the next sibling", () => {
		const lines = ["- parent", "  - child", "    continuation", "- sibling"];
		expect(block(lines, 0)).toMatchObject({ start: 1, end: 3 });
	});

	it("stops before an unindented line", () => {
		const lines = ["- item", "separate paragraph", "- sibling"];
		expect(block(lines, 0)).toMatchObject({ start: 1, end: 1 });
		expect(findContainingListBlock(lines, 1)).toBeNull();
	});

	it("treats an indented no-bullet line as part of its parent item", () => {
		const lines = ["- text", "  more text", "- sibling"];
		expect(block(lines, 0)).toMatchObject({ start: 1, end: 2 });
		expect(findContainingListBlock(lines, 1)).toMatchObject({ start: 1, end: 2 });
	});

	it("includes a loose indented continuation but leaves its trailing separator", () => {
		const lines = ["- item", "", "  continued", "", "paragraph"];
		expect(block(lines, 0)).toMatchObject({ end: 3 });
	});

	it.each(["# Heading", "```ts", "> quote", "<div>", "---"])(
		"stops before an interrupting block: %s",
		(interruptor) => {
			const lines = ["- item", interruptor];
			expect(block(lines, 0)).toMatchObject({ end: 1 });
		},
	);

	it("supports blockquote lists and nested quote content", () => {
		const lines = ["> - item", ">   - child", ">   > nested quote", "> - sibling"];
		expect(block(lines, 0)).toMatchObject({ end: 3, quoteDepth: 1 });
	});

	it("does not consume trailing blank lines at end of file", () => {
		const lines = ["- item", "", ""];
		expect(block(lines, 0)).toMatchObject({ end: 1 });
	});
});

describe("moveListBlock", () => {
	it("moves a parent together with its subtree", () => {
		const lines = ["- parent", "  - child", "- target"];
		const result = moveListBlock(lines, block(lines, 0), block(lines, 2), "after");
		expect(result?.lines).toEqual(["- target", "- parent", "  - child"]);
	});

	it("moves regular and ordered items without changing their markers", () => {
		const lines = ["1. first", "2. second", "- target"];
		const result = moveListBlock(lines, block(lines, 1), block(lines, 2), "after");
		expect(result?.lines).toEqual(["1. first", "- target", "2. second"]);
	});

	it("leaves an unindented following paragraph behind", () => {
		const lines = ["- source", "separate paragraph", "- target"];
		const result = moveListBlock(lines, block(lines, 0), block(lines, 2), "after");
		expect(result?.lines).toEqual(["separate paragraph", "- target", "- source"]);
	});

	it("reindents mixed tabs and spaces by visual width", () => {
		const lines = ["\t- source", "\t  - child", "  - target"];
		const result = moveListBlock(lines, block(lines, 0), block(lines, 2), "after");
		expect(result?.lines).toEqual(["  - target", "  - source", "    - child"]);
	});

	it("moves a child after its ancestor as a sibling", () => {
		const lines = ["- parent", "  - first", "  - moving", "- target"];
		const result = moveListBlock(lines, block(lines, 2), block(lines, 0), "after");
		expect(result?.lines).toEqual(["- parent", "  - first", "- moving", "- target"]);
	});

	it("preserves a final newline and trailing blank separators", () => {
		const lines = ["- source", "", "- target", ""];
		const result = moveListBlock(lines, block(lines, 0), block(lines, 2), "after");
		expect(result?.lines).toEqual(["- target", "", "- source", ""]);
	});

	it("carries a preceding separator when moving the last item of a loose list", () => {
		const lines = ["- first", "", "- last"];
		const result = moveListBlock(lines, block(lines, 2), block(lines, 0), "before");
		expect(result?.lines).toEqual(["- last", "", "- first"]);
	});

	it("reorders within a blockquote", () => {
		const lines = ["> - source", ">   continuation", "> - target"];
		const result = moveListBlock(lines, block(lines, 0), block(lines, 2), "after");
		expect(result?.lines).toEqual(["> - target", "> - source", ">   continuation"]);
	});

	it("keeps a quoted parent, child, and surrounding separators together", () => {
		const lines = ["- outside", "", "> - parent", ">   - child", "> - sibling", "", "- after"];
		const result = moveListBlock(lines, block(lines, 2), block(lines, 4), "after");
		expect(result?.lines).toEqual([
			"- outside",
			"",
			"> - sibling",
			"> - parent",
			">   - child",
			"",
			"- after",
		]);
	});

	it("rejects moving across blockquote boundaries", () => {
		const lines = ["- outside", "> - inside"];
		expect(moveListBlock(lines, block(lines, 0), block(lines, 1), "after")).toBeNull();
	});

	it("rejects dropping a parent into its own descendant", () => {
		const lines = ["- parent", "  - child", "- sibling"];
		expect(moveListBlock(lines, block(lines, 0), block(lines, 1), "after")).toBeNull();
	});

	it("returns null for adjacent no-op drops and malformed ranges", () => {
		const lines = ["- first", "- second"];
		expect(moveListBlock(lines, block(lines, 0), block(lines, 1), "before")).toBeNull();
		expect(moveListBlock(lines, { ...block(lines, 0), end: 99 }, block(lines, 1), "after")).toBeNull();
	});

	it("never loses or duplicates labeled items across many moves", () => {
		const lines = ["- alpha", "  - alpha-child", "- beta", "- gamma", "  continuation"];
		const expectedLabels = lines.map((line) => line.trim()).sort();
		for (const sourceLine of [0, 1, 2, 3]) {
			for (const targetLine of [0, 1, 2, 3]) {
				for (const side of ["before", "after"] as const) {
					const source = findListBlock(lines, sourceLine);
					const target = findListBlock(lines, targetLine);
					if (!source || !target || targetLine + 1 >= source.start && targetLine + 1 <= source.end) continue;
					const result = moveListBlock(lines, source, target, side);
					if (!result) continue;
					expect(result.lines).toHaveLength(lines.length);
					expect(result.lines.map((line) => line.trim()).sort()).toEqual(expectedLabels);
				}
			}
		}
	});
});

describe("keyboard block discovery", () => {
	it("finds the nearest containing item from a continuation line", () => {
		const lines = ["- parent", "  - child", "    continuation", "- sibling"];
		expect(findContainingListBlock(lines, 2)).toMatchObject({ start: 2, end: 3 });
	});

	it("finds same-level siblings without crossing the parent boundary", () => {
		const lines = ["- parent", "  - first", "  - second", "- sibling"];
		const second = block(lines, 2);
		expect(findSiblingListBlock(lines, second, "up")).toMatchObject({ start: 2 });
		expect(findSiblingListBlock(lines, second, "down")).toBeNull();
		const parent = block(lines, 0);
		expect(findSiblingListBlock(lines, parent, "down")).toMatchObject({ start: 4 });
	});
});
