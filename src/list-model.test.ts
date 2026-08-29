import { describe, expect, it } from "vitest";
import {
	changeListItemStatus,
	cycleListItemStatus,
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

describe("changeListItemStatus", () => {
	it("converts an ordinary bullet into a task without changing its content", () => {
		expect(changeListItemStatus("- Pick this up", " ")).toBe("- [ ] Pick this up");
	});

	it("changes only the status character and preserves original spacing", () => {
		expect(changeListItemStatus("\t*  [ ]\tNested task", "?")).toBe("\t*  [?]\tNested task");
	});

	it("converts quoted and ordered tasks back to ordinary list items", () => {
		expect(changeListItemStatus(">  12) [x] Finished", null)).toBe(">  12) Finished");
	});

	it("supports every one-character custom status, including a star", () => {
		expect(changeListItemStatus("- [x] Task", "*")).toBe("- [*] Task");
		expect(changeListItemStatus("- [x] Task", ">")).toBe("- [>] Task");
	});

	it("returns the original line for an already-selected status", () => {
		expect(changeListItemStatus("- [?] Task", "?")).toBe("- [?] Task");
		expect(changeListItemStatus("- Bullet", null)).toBe("- Bullet");
	});

	it("rejects prose and invalid multi-character statuses", () => {
		expect(changeListItemStatus("Paragraph", "x")).toBeNull();
		expect(changeListItemStatus("- Task", "done")).toBeNull();
	});
});

describe("cycleListItemStatus", () => {
	it("cycles through every supported list-item type and back to a bullet", () => {
		const expected = [
			"- [ ] Item",
			"- [x] Item",
			"- [/] Item",
			"- [-] Item",
			"- [>] Item",
			"- [<] Item",
			"- [?] Item",
			"- [!] Item",
			"- [*] Item",
			"- Item",
		];
		let line = "- Item";
		for (const next of expected) {
			line = cycleListItemStatus(line, [" ", "x", "/", "-", ">", "<", "?", "!", "*"]) ?? "";
			expect(line).toBe(next);
		}
	});

	it("treats uppercase completion as done and resets unknown statuses to a bullet", () => {
		expect(cycleListItemStatus("- [X] Finished", ["x", "/"])).toBe("- [/] Finished");
		expect(cycleListItemStatus("- [~] Custom", [" ", "x"])).toBe("- Custom");
		expect(cycleListItemStatus("Paragraph", [" ", "x"])).toBeNull();
	});

	it("uses the configured order and custom markers", () => {
		expect(cycleListItemStatus("- Item", ["?", "~"])).toBe("- [?] Item");
		expect(cycleListItemStatus("- [?] Item", ["?", "~"])).toBe("- [~] Item");
		expect(cycleListItemStatus("- [~] Item", ["?", "~"])).toBe("- Item");
	});

	it("does nothing when no task types are configured", () => {
		expect(cycleListItemStatus("- Item", [])).toBe("- Item");
	});
});

describe("findListBlock", () => {
	it("includes nested bullets but not their prose or the next sibling", () => {
		const lines = ["- parent", "  - child", "    continuation", "- sibling"];
		expect(block(lines, 0)).toMatchObject({ start: 1, end: 2 });
	});

	it("stops before an unindented line", () => {
		const lines = ["- item", "separate paragraph", "- sibling"];
		expect(block(lines, 0)).toMatchObject({ start: 1, end: 1 });
		expect(findContainingListBlock(lines, 1)).toBeNull();
	});

	it("leaves an indented no-bullet line behind", () => {
		const lines = ["- text", "  more text", "- sibling"];
		expect(block(lines, 0)).toMatchObject({ start: 1, end: 1 });
		expect(findContainingListBlock(lines, 1)).toBeNull();
	});

	it("does not reconnect a list item to content beyond a blank line", () => {
		const lines = ["- item", "", "  continued", "", "paragraph"];
		expect(block(lines, 0)).toMatchObject({ end: 1 });
	});

	it("requires a child bullet to reach the parent content column", () => {
		const lines = ["- item", " - unrelated pseudo-child", "  - child"];
		expect(block(lines, 0)).toMatchObject({ end: 1 });
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
		expect(block(lines, 0)).toMatchObject({ end: 2, quoteDepth: 1 });
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
		expect(result?.originalLineIndexes).toEqual([2, 0, 1]);
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

	it("leaves indented prose behind while moving nested bullets", () => {
		const lines = ["- source", "  - child", "  unrelated prose", "- target"];
		const result = moveListBlock(lines, block(lines, 0), block(lines, 3), "after");
		expect(result?.lines).toEqual(["  unrelated prose", "- target", "- source", "  - child"]);
		expect(result?.insertionIndex).toBe(2);
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

	it("leaves following blank lines at their original positions", () => {
		const lines = ["- source", "", "- target", ""];
		const result = moveListBlock(lines, block(lines, 0), block(lines, 2), "after");
		expect(result?.lines).toEqual(["", "- target", "- source", ""]);
		expect(result?.originalLineIndexes).toEqual([1, 2, 0, 3]);
	});

	it("leaves preceding blank lines behind when moving the last item", () => {
		const lines = ["- first", "", "- last"];
		const result = moveListBlock(lines, block(lines, 2), block(lines, 0), "before");
		expect(result?.lines).toEqual(["- last", "- first", ""]);
		expect(result?.originalLineIndexes).toEqual([2, 0, 1]);
	});

	it("never carries multiple whitespace-only lines following a bullet", () => {
		const lines = ["- source", "   ", "\t", "- target"];
		const result = moveListBlock(lines, block(lines, 0), block(lines, 3), "after");
		expect(result?.lines).toEqual(["   ", "\t", "- target", "- source"]);
		expect(result?.originalLineIndexes).toEqual([1, 2, 3, 0]);
	});

	it("reorders within a blockquote", () => {
		const lines = ["> - source", ">   continuation", "> - target"];
		const result = moveListBlock(lines, block(lines, 0), block(lines, 2), "after");
		expect(result?.lines).toEqual([">   continuation", "> - target", "> - source"]);
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
					expect(result.originalLineIndexes[result.insertionIndex]).toBe(source.start - 1);
					expect(result.lines.map((line) => line.trim()).sort()).toEqual(expectedLabels);
					expect([...result.originalLineIndexes].sort((left, right) => left - right))
						.toEqual(lines.map((_, index) => index));
				}
			}
		}
	});
});

describe("keyboard block discovery", () => {
	it("does not treat a prose continuation as a draggable list item", () => {
		const lines = ["- parent", "  - child", "    continuation", "- sibling"];
		expect(findContainingListBlock(lines, 2)).toBeNull();
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
