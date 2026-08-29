import { describe, expect, it, vi } from "vitest";
import {
	HEROICON_MICRO_NAMES,
	getHeroIcon,
	isHeroIconName,
} from "./heroicons-micro";

describe("Heroicons Micro registry", () => {
	it("contains the complete Heroicons Micro 2.2.0 set", () => {
		expect(HEROICON_MICRO_NAMES).toHaveLength(316);
		expect(getHeroIcon("paper-airplane").p.length).toBeGreaterThan(0);
		expect(getHeroIcon("stop").r).toEqual([["3", "3", "10", "10", "1.5"]]);
	});

	it("recognizes only bundled icon names", () => {
		expect(isHeroIconName("check")).toBe(true);
		expect(isHeroIconName("not-a-heroicon")).toBe(false);
	});

	it("can decode every icon, including pathless rectangle icons", () => {
		for (const name of HEROICON_MICRO_NAMES) {
			const icon = getHeroIcon(name);
			expect(icon.p.length + (icon.r?.length ?? 0)).toBeGreaterThan(0);
		}
	});

	it("decodes only requested icons, once each, not during startup or validation", async () => {
		vi.resetModules();
		const registry = await import("./heroicons-micro");
		const parse = vi.spyOn(JSON, "parse");
		try {
			expect(registry.HEROICON_MICRO_NAMES).toHaveLength(316);
			expect(registry.isHeroIconName("check")).toBe(true);
			expect(parse).not.toHaveBeenCalled();
			const first = registry.getHeroIcon("check");
			expect(parse).toHaveBeenCalledTimes(1);
			expect(registry.getHeroIcon("check")).toBe(first);
			expect(parse).toHaveBeenCalledTimes(1);
			registry.getHeroIcon("star");
			expect(parse).toHaveBeenCalledTimes(2);
		} finally {
			parse.mockRestore();
		}
	});
});
