/** Coalesce invalidations without doing DOM work in editor update callbacks. */
export class BatchedIconUpdates<Root, Measurement> {
	private readonly dirty = new Set<Root>();
	private full = false;
	private queued = false;
	private destroyed = false;

	constructor(private readonly options: {
		root: Root;
		requestMeasure: (request: {
			key: object;
			read: () => Measurement | undefined;
			write: (measurement: Measurement | undefined) => void;
		}) => void;
		read: (roots: readonly Root[]) => Measurement;
		write: (measurement: Measurement) => void;
	}) {}

	invalidate(root?: Root): void {
		if (this.destroyed) return;
		if (root === undefined) {
			this.full = true;
			this.dirty.clear();
		} else if (!this.full) {
			this.dirty.add(root);
		}
		if (this.queued) return;
		this.queued = true;
		this.options.requestMeasure({
			key: this,
			read: () => {
				this.queued = false;
				if (this.destroyed) return undefined;
				const roots = this.full ? [this.options.root] : [...this.dirty];
				this.full = false;
				this.dirty.clear();
				return this.options.read(roots);
			},
			write: (measurement) => {
				if (!this.destroyed && measurement !== undefined) this.options.write(measurement);
			},
		});
	}

	destroy(): void {
		this.destroyed = true;
		this.dirty.clear();
		this.full = false;
	}
}
