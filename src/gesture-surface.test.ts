import { describe, expect, it, vi } from "vitest";
import { editorOwnsGestureStart, markerIsExposed } from "./gesture-surface";

function surface() {
	const elementFromPoint = vi.fn<(...coords: number[]) => Element | null>();
	const editor = { isConnected: true, ownerDocument: { elementFromPoint } } as unknown as HTMLElement;
	const child = { closest: () => editor } as unknown as HTMLElement;
	elementFromPoint.mockReturnValue(child);
	return { editor, child, elementFromPoint };
}

describe("gesture acquisition surface", () => {
	it("allows the visible editor's first touch without requiring keyboard focus", () => {
		const h = surface();
		expect(editorOwnsGestureStart(h.editor, h.child, 10, 20)).toBe(true);
		expect(h.elementFromPoint).toHaveBeenCalledWith(10, 20);
	});

	it("ignores sidebar/settings targets before doing hit testing", () => {
		const h = surface();
		const panel = { closest: () => null } as unknown as HTMLElement;
		expect(editorOwnsGestureStart(h.editor, panel, 10, 20)).toBe(false);
		expect(h.elementFromPoint).not.toHaveBeenCalled();
	});

	it("rejects a covered editor even if the event target still points into it", () => {
		const h = surface();
		h.elementFromPoint.mockReturnValue({ closest: () => null } as unknown as Element);
		expect(editorOwnsGestureStart(h.editor, h.child, 10, 20)).toBe(false);
	});

	it("does not let a background editor steal a nested or adjacent editor's touch", () => {
		const background = surface();
		const foreground = surface();
		expect(editorOwnsGestureStart(background.editor, foreground.child, 10, 20)).toBe(false);
		background.elementFromPoint.mockReturnValue(foreground.child);
		expect(editorOwnsGestureStart(background.editor, background.child, 10, 20)).toBe(false);
	});

	it("rejects out-of-window coordinates and detached editors", () => {
		const h = surface();
		h.elementFromPoint.mockReturnValue(null);
		expect(editorOwnsGestureStart(h.editor, h.child, -1, 20)).toBe(false);
		const detached = { ...h.editor, isConnected: false } as HTMLElement;
		expect(editorOwnsGestureStart(detached, h.child, 10, 20)).toBe(false);
	});

	it("handles text-node targets without relying on the main window's Element class", () => {
		const h = surface();
		const textNode = { parentElement: h.child } as unknown as EventTarget;
		expect(editorOwnsGestureStart(h.editor, textNode, 10, 20)).toBe(true);
		expect(editorOwnsGestureStart(h.editor, null, 10, 20)).toBe(false);
	});

	it("accepts a marker's own glyph/input but not a covering panel or clipped neighbor", () => {
		const h = surface();
		const handle = {
			isConnected: true,
			ownerDocument: h.editor.ownerDocument,
			contains: (node: Element) => node === h.child,
		} as unknown as HTMLElement;
		expect(markerIsExposed(handle, 10, 20)).toBe(true);
		h.elementFromPoint.mockReturnValue({} as Element);
		expect(markerIsExposed(handle, 10, 20)).toBe(false);
		h.elementFromPoint.mockReturnValue(null);
		expect(markerIsExposed(handle, 10, 20)).toBe(false);
	});
});
