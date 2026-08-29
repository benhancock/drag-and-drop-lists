import { describe, expect, it, vi } from "vitest";
import { HEROICON_MICRO_NAMES } from "./heroicons-micro";
import { getHeroIconOutline } from "./heroicons-outline";

describe("Heroicons Outline registry", () => {
	it("contains a matching outline for every offered Micro icon", () => {
		for (const name of HEROICON_MICRO_NAMES) {
			expect(getHeroIconOutline(name).p.length).toBeGreaterThan(0);
		}
	});

	it("decodes only requested icons, once each", async () => {
		vi.resetModules();
		const registry = await import("./heroicons-outline");
		const parse = vi.spyOn(JSON, "parse");
		try {
			expect(parse).not.toHaveBeenCalled();
			const first = registry.getHeroIconOutline("check");
			expect(parse).toHaveBeenCalledTimes(1);
			expect(registry.getHeroIconOutline("check")).toBe(first);
			expect(parse).toHaveBeenCalledTimes(1);
			registry.getHeroIconOutline("star");
			expect(parse).toHaveBeenCalledTimes(2);
		} finally {
			parse.mockRestore();
		}
	});
});
