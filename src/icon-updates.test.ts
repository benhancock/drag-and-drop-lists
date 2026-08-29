import { describe, expect, it, vi } from "vitest";
import { BatchedIconUpdates } from "./icon-updates";

function harness() {
	const requests: { read: () => string[] | undefined; write: (value: string[] | undefined) => void }[] = [];
	const read = vi.fn((roots: readonly string[]) => [...roots]);
	const write = vi.fn();
	const queue = new BatchedIconUpdates({
		root: "editor",
		requestMeasure: (request) => { requests.push(request); },
		read,
		write,
	});
	const flush = (): void => {
		const request = requests.shift();
		if (request) request.write(request.read());
	};
	return { queue, requests, read, write, flush };
}

describe("batched task icon updates", () => {
	it("does no work until the scheduled measurement phase", () => {
		const h = harness();
		h.queue.invalidate();
		expect(h.read).not.toHaveBeenCalled();
		expect(h.write).not.toHaveBeenCalled();
		h.flush();
		expect(h.read).toHaveBeenCalledWith(["editor"]);
		expect(h.write).toHaveBeenCalledWith(["editor"]);
	});

	it("batches repeated notifications and deduplicates affected rows", () => {
		const h = harness();
		for (let i = 0; i < 100; i += 1) h.queue.invalidate("row-a");
		h.queue.invalidate("row-b");
		expect(h.requests).toHaveLength(1);
		h.flush();
		expect(h.read).toHaveBeenCalledExactlyOnceWith(["row-a", "row-b"]);
	});

	it("lets a full refresh subsume partial updates in either order", () => {
		const h = harness();
		h.queue.invalidate("row-a");
		h.queue.invalidate();
		h.queue.invalidate("row-b");
		h.flush();
		expect(h.read).toHaveBeenCalledExactlyOnceWith(["editor"]);
	});

	it("allows a new update after a measurement without losing it", () => {
		const h = harness();
		h.queue.invalidate("row-a");
		const request = h.requests.shift();
		const result = request?.read();
		h.queue.invalidate("row-b");
		request?.write(result);
		h.flush();
		expect(h.write.mock.calls).toEqual([[["row-a"]], [["row-b"]]]);
	});

	it("does not rescan clean rows on the next update", () => {
		const h = harness();
		h.queue.invalidate();
		h.flush();
		h.queue.invalidate("row-a");
		h.flush();
		expect(h.read).toHaveBeenLastCalledWith(["row-a"]);
	});

	it("cancels queued work when its editor is destroyed", () => {
		const h = harness();
		h.queue.invalidate();
		h.queue.destroy();
		h.flush();
		h.queue.invalidate();
		expect(h.read).not.toHaveBeenCalled();
		expect(h.write).not.toHaveBeenCalled();
		expect(h.requests).toHaveLength(0);
	});

	it("does not write if destroyed between read and write phases", () => {
		const h = harness();
		h.queue.invalidate();
		const request = h.requests.shift();
		const result = request?.read();
		h.queue.destroy();
		request?.write(result);
		expect(h.write).not.toHaveBeenCalled();
	});
});
