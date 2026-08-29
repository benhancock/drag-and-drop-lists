import { describe, expect, it } from "vitest";
import { preserveSelectValueForClone } from "./settings-card";

describe("settings card drag-copy selection", () => {
	it("preserves a non-first appearance option", () => {
		const select = {
			value: "outlined",
			options: [
				{ value: "filled", defaultSelected: true },
				{ value: "icon-only", defaultSelected: false },
				{ value: "outlined", defaultSelected: false },
			],
		};
		preserveSelectValueForClone(select);
		expect(select.options.map((option) => option.defaultSelected)).toEqual([false, false, true]);
	});

	it("clears the previous default after an appearance change", () => {
		const select = {
			value: "icon-only",
			options: [
				{ value: "filled", defaultSelected: false },
				{ value: "icon-only", defaultSelected: false },
			],
		};
		preserveSelectValueForClone(select);
		select.value = "filled";
		preserveSelectValueForClone(select);
		expect(select.options.map((option) => option.defaultSelected)).toEqual([true, false]);
	});

	it("uses the captured value when changing defaults affects live selection", () => {
		let currentValue = "icon-only";
		let filledDefault = true;
		const iconOnly = { value: "icon-only", defaultSelected: false };
		preserveSelectValueForClone({
			get value() { return currentValue; },
			options: [
				{
					value: "filled",
					get defaultSelected() { return filledDefault; },
					set defaultSelected(value: boolean) {
						filledDefault = value;
						currentValue = "filled";
					},
				},
				iconOnly,
			],
		});
		expect(filledDefault).toBe(false);
		expect(iconOnly.defaultSelected).toBe(true);
	});
});
