import { describe, expect, it } from "vitest";
import {
	cloneDefaultTaskTypes,
	createTaskType,
	findAvailableTaskMarker,
	isValidTaskAppearance,
	isValidTaskColor,
	isValidTaskMarker,
	sanitizeTaskTypes,
	taskMarkersForCycle,
} from "./task-types";

describe("task type settings", () => {
	it("provides independent copies of the default cycle", () => {
		const first = cloneDefaultTaskTypes();
		first[0]!.name = "Changed";
		expect(cloneDefaultTaskTypes()[0]!.name).toBe("In progress");
		expect(cloneDefaultTaskTypes().map((taskType) => taskType.marker)).not.toContain(" ");
		expect(cloneDefaultTaskTypes().map((taskType) => taskType.marker)).not.toContain("x");
	});

	it.each([" ", "x", "?", "*"])("accepts the one-character marker %s", (marker) => {
		expect(isValidTaskMarker(marker)).toBe(true);
	});

	it.each(["", "done", "[", "]", "\t", "\n"])("rejects the marker %j", (marker) => {
		expect(isValidTaskMarker(marker)).toBe(false);
	});

	it.each([null, "#000000", "#abcdef", "#ABCDEF"])("accepts the color %j", (color) => {
		expect(isValidTaskColor(color)).toBe(true);
	});

	it.each(["", "red", "#fff", "#gggggg", "#00000000"])("rejects the color %j", (color) => {
		expect(isValidTaskColor(color)).toBe(false);
	});

	it.each(["filled", "icon-only", "outlined"])("accepts the appearance %s", (appearance) => {
		expect(isValidTaskAppearance(appearance)).toBe(true);
	});

	it.each(["", "icon", "outline"])("rejects the appearance %j", (appearance) => {
		expect(isValidTaskAppearance(appearance)).toBe(false);
	});

	it("sanitizes malformed, duplicate, and incomplete stored definitions", () => {
		expect(sanitizeTaskTypes([
			{ id: "same", name: " Question ", marker: "?", icon: " circle-help ", color: "#ABCDEF", appearance: "icon-only" },
			{ id: "same", name: "", marker: "!", icon: "", color: "invalid" },
			{ id: "ignored", name: "Duplicate", marker: "?", icon: "star" },
			{ id: "ignored-too", marker: "invalid" },
		])).toEqual([
			{ id: "same", name: "Question", marker: "?", icon: "question-mark-circle", color: "#abcdef", appearance: "icon-only" },
			{ id: "same-2", name: "Custom", marker: "!", icon: "stop", color: null, appearance: "filled" },
		]);
	});

	it("preserves an explicitly empty custom cycle", () => {
		expect(sanitizeTaskTypes([])).toEqual([]);
	});

	it("preserves the outlined appearance from stored settings", () => {
		expect(sanitizeTaskTypes([
			{ id: "question", name: "Question", marker: "?", icon: "question-mark-circle", color: "#8b5cf6", appearance: "outlined" },
		])).toEqual([
			{ id: "question", name: "Question", marker: "?", icon: "question-mark-circle", color: "#8b5cf6", appearance: "outlined" },
		]);
	});

	it("removes native task defaults while preserving custom overrides", () => {
		expect(sanitizeTaskTypes([
			{ id: "unchecked", name: "Unchecked", marker: " ", icon: "square" },
			{ id: "completed", name: "Completed", marker: "x", icon: "square-check-big" },
			{ id: "forwarded", name: "Forwarded", marker: ">", icon: "send" },
			{ id: "custom", name: "Custom", marker: "~", icon: "star" },
		])).toEqual([
			{ id: "forwarded", name: "Forwarded", marker: ">", icon: "paper-airplane", color: "#8e8e93", appearance: "filled" },
			{ id: "custom", name: "Custom", marker: "~", icon: "star", color: null, appearance: "filled" },
		]);
		expect(sanitizeTaskTypes([
			{ id: "completed", name: "Completed", marker: "x", icon: "star", color: "#ff0000", appearance: "icon-only" },
		])).toEqual([
			{ id: "completed", name: "Completed", marker: "x", icon: "star", color: "#ff0000", appearance: "icon-only" },
		]);
	});

	it("keeps native unchecked and completed states first without duplicating overrides", () => {
		expect(taskMarkersForCycle([
			{ id: "completed-custom", name: "Done", marker: "x", icon: "star", color: null, appearance: "filled" },
			{ id: "question", name: "Question", marker: "?", icon: "question-mark-circle", color: null, appearance: "filled" },
		])).toEqual([" ", "x", "?"]);
	});

	it("chooses an unused marker for a new definition", () => {
		expect(findAvailableTaskMarker([{
			id: "one", name: "One", marker: "~", icon: "stop", color: null, appearance: "filled",
		}])).toBe("a");
		expect(createTaskType("a", 42)).toEqual({
			id: "custom-42-97",
			name: "Custom",
			marker: "a",
			icon: "sparkles",
			color: null,
			appearance: "filled",
		});
	});
});
