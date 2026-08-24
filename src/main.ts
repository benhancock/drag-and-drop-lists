import { StateEffect, StateField } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	type PluginValue,
	type ViewUpdate,
	ViewPlugin,
} from "@codemirror/view";
import { App, type Editor, editorInfoField, Plugin, PluginSettingTab, Setting } from "obsidian";
import { autoScrollConfig, dragStartThreshold, isTouchPointer } from "./interaction";
import {
	findContainingListBlock,
	findListBlock,
	findSiblingListBlock,
	indentationWidth,
	lineIndent,
	type ListBlock,
	type MoveResult,
	moveListBlock,
	parseListLine,
} from "./list-model";
import { calculateRowDeltas } from "./row-transition";

const PLUGIN_ID = "drag-and-drop-lists";
const TASK_HANDLE_SELECTOR = ".task-list-label";
const QUOTE_HANDLE_SELECTOR = ".drag-and-drop-lists-quote-list .cm-formatting-quote";
const CONTINUATION_HANDLE_SELECTOR = ".HyperMD-list-line-nobullet .cm-hmd-list-indent";
const HANDLE_SELECTOR = `${TASK_HANDLE_SELECTOR}, .cm-formatting-list, ${QUOTE_HANDLE_SELECTOR}, ${CONTINUATION_HANDLE_SELECTOR}`;
const LIST_LINE_SELECTOR = ".HyperMD-list-line.cm-line, .HyperMD-quote.cm-line";
const ROW_TRANSITION_DURATION_MS = 160;
interface DropTarget {
	block: ListBlock;
	line: number;
	side: "before" | "after";
	indicatorLine: number;
	indicatorSide: "before" | "after";
}

type CursorPlacement = "beginning" | "end";

interface DragAndDropListsSettings {
	cursorPlacement: CursorPlacement;
}

const DEFAULT_SETTINGS: DragAndDropListsSettings = {
	cursorPlacement: "beginning",
};

interface DragContext {
	source: ListBlock;
	ghost: HTMLElement;
	target: DropTarget | null;
	touchPointer: boolean;
}

interface PendingDrag {
	pointerId: number;
	startX: number;
	startY: number;
	captureElement: HTMLElement | null;
	source: ListBlock;
	touchPointer: boolean;
}

interface VisualState {
	source: ListBlock | null;
	target: DropTarget | null;
	decorations: DecorationSet;
}

interface PendingRowTransition {
	oldTops: Map<number, number>;
	originalLineIndexes: number[];
	movingStart: number;
	movingEnd: number;
}

interface MeasuredRowTransition {
	element: HTMLElement;
	deltaY: number;
}

const setSource = StateEffect.define<ListBlock | null>();
const setTarget = StateEffect.define<DropTarget | null>();

function makeDecorations(
	doc: EditorView["state"]["doc"],
	source: ListBlock | null,
	target: DropTarget | null,
): DecorationSet {
	const ranges = [];
	if (source) {
		for (let line = source.start; line <= source.end; line += 1) {
			ranges.push(Decoration.line({ class: "drag-and-drop-lists-source" }).range(doc.line(line).from));
		}
	}
	if (target) {
		const className = target.indicatorSide === "before"
			? "drag-and-drop-lists-target-before"
			: "drag-and-drop-lists-target-after";
		ranges.push(Decoration.line({ class: className }).range(doc.line(target.indicatorLine).from));
	}
	return Decoration.set(ranges, true);
}

function makeQuoteHandleDecorations(view: EditorView): DecorationSet {
	const ranges = [];
	const seenLines = new Set<number>();
	for (const visibleRange of view.visibleRanges) {
		const firstLine = view.state.doc.lineAt(visibleRange.from).number;
		const lastLine = view.state.doc.lineAt(visibleRange.to).number;
		for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
			if (seenLines.has(lineNumber)) continue;
			seenLines.add(lineNumber);
			const line = view.state.doc.line(lineNumber);
			if ((parseListLine(line.text)?.quoteDepth ?? 0) > 0) {
				ranges.push(Decoration.line({ class: "drag-and-drop-lists-quote-list" }).range(line.from));
			}
		}
	}
	return Decoration.set(ranges, true);
}

const visualField = StateField.define<VisualState>({
	create(state) {
		return { source: null, target: null, decorations: Decoration.none };
	},
	update(value, transaction) {
		let source = transaction.docChanged ? null : value.source;
		let target = transaction.docChanged ? null : value.target;
		let changed = transaction.docChanged;
		for (const effect of transaction.effects) {
			if (effect.is(setSource)) {
				source = effect.value;
				changed = true;
			}
			if (effect.is(setTarget)) {
				target = effect.value;
				changed = true;
			}
		}
		if (!changed) return value;
		return {
			source,
			target,
			decorations: makeDecorations(transaction.state.doc, source, target),
		};
	},
	provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

function closestElement(target: EventTarget | null, selector: string): HTMLElement | null {
	if (!target) return null;
	const candidate = target as Partial<Element> & { parentElement?: HTMLElement | null };
	if (typeof candidate.closest === "function") return candidate.closest(selector);
	return candidate.parentElement?.closest(selector) ?? null;
}

function sameTarget(left: DropTarget | null, right: DropTarget | null): boolean {
	return left?.block.start === right?.block.start
		&& left?.block.end === right?.block.end
		&& left?.side === right?.side
		&& left?.indicatorLine === right?.indicatorLine
		&& left?.indicatorSide === right?.indicatorSide;
}

function applyEditorMove(
	editor: Editor,
	source: ListBlock,
	target: ListBlock,
	side: "before" | "after",
	cursorPlacement: CursorPlacement,
	beforeTransaction?: (result: MoveResult) => void,
): void {
	const originalLines = editor.getValue().split("\n");
	const result = moveListBlock(originalLines, source, target, side);
	if (!result) return;
	let firstChangedLine = 0;
	while (firstChangedLine < originalLines.length
		&& originalLines[firstChangedLine] === result.lines[firstChangedLine]) firstChangedLine += 1;
	if (firstChangedLine >= originalLines.length) return;
	let lastChangedLine = originalLines.length - 1;
	while (lastChangedLine > firstChangedLine
		&& originalLines[lastChangedLine] === result.lines[lastChangedLine]) lastChangedLine -= 1;
	const replacement = result.lines.slice(firstChangedLine, lastChangedLine + 1).join("\n");
	const cursorCh = cursorPlacement === "end"
		? (result.lines[result.insertionIndex]?.length ?? 0)
		: 0;
	beforeTransaction?.(result);
	editor.transaction({
		changes: [{
			from: { line: firstChangedLine, ch: 0 },
			to: { line: lastChangedLine, ch: editor.getLine(lastChangedLine).length },
			text: replacement,
		}],
		selection: { from: { line: result.insertionIndex, ch: cursorCh } },
	}, PLUGIN_ID);
}

class DragController implements PluginValue {
	quoteHandleDecorations: DecorationSet;
	private context: DragContext | null = null;
	private pending: PendingDrag | null = null;
	private suppressClickUntil = 0;
	private pointerX = 0;
	private pointerY = 0;
	private autoScrollTimer: number | null = null;
	private pendingRowTransition: PendingRowTransition | null = null;
	private readonly exitingGhosts = new Set<HTMLElement>();
	private readonly ghostExitTimers = new Set<number>();
	private readonly rowAnimations = new Map<HTMLElement, Animation>();
	private readonly eventDocument: Document;
	private readonly viewWindow: Window;
	private readonly onPointerDown = (event: PointerEvent): void => { this.pointerDown(event); };
	private readonly onPointerMove = (event: PointerEvent): void => { this.pointerMove(event); };
	private readonly onPointerUp = (event: PointerEvent): void => { this.pointerUp(event); };
	private readonly onPointerCancel = (event: PointerEvent): void => { this.pointerCancel(event); };
	private readonly onSelectStart = (event: Event): void => { this.selectStart(event); };
	private readonly onClick = (event: MouseEvent): void => { this.click(event); };
	private readonly onKeyDown = (event: KeyboardEvent): void => { this.keyDown(event); };
	private readonly onBlur = (): void => {
		if (this.pending || this.context) {
			if (this.context) this.suppressClickUntil = Number.POSITIVE_INFINITY;
			this.cleanup();
		}
	};
	private readonly onAutoScrollFrame = (): void => { this.continueAutoScroll(); };

	constructor(
		private readonly view: EditorView,
		private readonly getSettings: () => DragAndDropListsSettings,
	) {
		const viewWindow = view.dom.ownerDocument.defaultView;
		if (!viewWindow) throw new Error("The editor window is unavailable.");
		this.viewWindow = viewWindow;
		this.eventDocument = view.dom.ownerDocument;
		this.quoteHandleDecorations = makeQuoteHandleDecorations(view);
		this.eventDocument.addEventListener("pointerdown", this.onPointerDown, true);
		this.eventDocument.addEventListener("pointermove", this.onPointerMove, true);
		this.eventDocument.addEventListener("pointerup", this.onPointerUp, true);
		this.eventDocument.addEventListener("pointercancel", this.onPointerCancel, true);
		this.eventDocument.addEventListener("selectstart", this.onSelectStart, true);
		this.eventDocument.addEventListener("click", this.onClick, true);
		this.eventDocument.addEventListener("keydown", this.onKeyDown, true);
		viewWindow.addEventListener("blur", this.onBlur);
	}

	destroy(): void {
		this.eventDocument.removeEventListener("pointerdown", this.onPointerDown, true);
		this.eventDocument.removeEventListener("pointermove", this.onPointerMove, true);
		this.eventDocument.removeEventListener("pointerup", this.onPointerUp, true);
		this.eventDocument.removeEventListener("pointercancel", this.onPointerCancel, true);
		this.eventDocument.removeEventListener("selectstart", this.onSelectStart, true);
		this.eventDocument.removeEventListener("click", this.onClick, true);
		this.eventDocument.removeEventListener("keydown", this.onKeyDown, true);
		this.viewWindow.removeEventListener("blur", this.onBlur);
		this.cleanup(false);
		this.clearExitingGhosts();
		this.pendingRowTransition = null;
		this.cancelRowAnimations();
	}

	update(update: ViewUpdate): void {
		const rowTransition = update.docChanged ? this.pendingRowTransition : null;
		if (rowTransition) {
			this.pendingRowTransition = null;
			this.scheduleRowTransition(rowTransition);
		} else if (update.docChanged || update.viewportChanged) {
			this.pendingRowTransition = null;
			this.cancelRowAnimations();
		}
		if (update.docChanged || update.viewportChanged) {
			this.quoteHandleDecorations = makeQuoteHandleDecorations(update.view);
		}
		if (update.docChanged && (this.pending || this.context)) {
			if (this.context) this.suppressClickUntil = Number.POSITIVE_INFINITY;
			this.cleanup(false);
		}
	}

	private pointerDown(event: PointerEvent): void {
		if (event.button !== 0 || !event.isPrimary || this.pending || this.context) return;
		this.cancelRowAnimations();
		if (this.suppressClickUntil === Number.POSITIVE_INFINITY) this.suppressClickUntil = 0;
		const handle = closestElement(event.target, HANDLE_SELECTOR);
		if (!handle || !this.view.contentDOM.contains(handle)) return;
		const row = handle.closest<HTMLElement>(LIST_LINE_SELECTOR);
		if (!row) return;
		const position = this.view.posAtDOM(row, 0);
		const lineNumber = this.view.state.doc.lineAt(position).number;
		const lines = this.view.state.doc.toString().split("\n");
		const source = findListBlock(lines, lineNumber - 1)
			?? findContainingListBlock(lines, lineNumber - 1);
		if (!source) return;
		this.pending = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			captureElement: handle.matches(TASK_HANDLE_SELECTOR) ? null : handle,
			source,
			touchPointer: isTouchPointer(event.pointerType),
		};
		if (!handle.matches(TASK_HANDLE_SELECTOR)) {
			try {
				handle.setPointerCapture(event.pointerId);
			} catch {
				this.pending = null;
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
		}
		if (this.pending.touchPointer) {
			this.view.dom.addClass("drag-and-drop-lists-touch-pending");
		}
	}

	private pointerMove(event: PointerEvent): void {
		const pending = this.pending;
		if (!pending || pending.pointerId !== event.pointerId) return;
		if (!this.context) {
			const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
			if (distance < dragStartThreshold(pending.touchPointer)) return;
			this.beginDrag(pending, event.clientX, event.clientY);
		}
		if (!this.context) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		this.pointerX = event.clientX;
		this.pointerY = event.clientY;
		this.positionGhost(event.clientX, event.clientY);
		const continueScrolling = this.autoScroll(event.clientY);
		this.updateTarget(event.clientX, event.clientY);
		if (continueScrolling) this.scheduleAutoScroll();
	}

	private updateTarget(clientX: number, clientY: number): void {
		if (!this.context) return;
		const target = this.getTargetAtPoint(clientX, clientY);
		if (!sameTarget(this.context.target, target)) {
			this.context.target = target;
			this.view.dispatch({ effects: setTarget.of(target) });
		}
		this.view.dom.toggleClass("drag-and-drop-lists-invalid", target === null);
	}

	private pointerUp(event: PointerEvent): void {
		if (!this.pending || this.pending.pointerId !== event.pointerId) {
			if (this.suppressClickUntil === Number.POSITIVE_INFINITY) {
				this.suppressClickUntil = Date.now() + 500;
			}
			return;
		}
		const context = this.context;
		if (!context) {
			this.pending = null;
			this.view.dom.removeClass("drag-and-drop-lists-touch-pending");
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const target = this.getTargetAtPoint(event.clientX, event.clientY);
		if (target) {
			// Keep the preview alive long enough to fade out when the editor transaction
			// synchronously triggers an update and clears the active drag state.
			this.context = null;
			this.removeGhost(context.ghost, true);
			this.commitMove(context.source, target);
		}
		this.suppressClickUntil = Date.now() + 500;
		this.cleanup();
	}

	private pointerCancel(event: PointerEvent): void {
		if (!this.pending || this.pending.pointerId !== event.pointerId) return;
		if (this.context) this.suppressClickUntil = Number.POSITIVE_INFINITY;
		this.cleanup();
	}

	private selectStart(event: Event): void {
		if (this.pending?.touchPointer !== true) return;
		if (closestElement(event.target, ".cm-content") !== this.view.contentDOM) return;
		event.preventDefault();
	}

	private keyDown(event: KeyboardEvent): void {
		if (event.key !== "Escape" || (!this.pending && !this.context)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (this.context) this.suppressClickUntil = Number.POSITIVE_INFINITY;
		this.cleanup();
	}

	private click(event: MouseEvent): void {
		if (Date.now() > this.suppressClickUntil) return;
		if (closestElement(event.target, ".cm-content") !== this.view.contentDOM) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		this.suppressClickUntil = 0;
	}

	private beginDrag(pending: PendingDrag, clientX: number, clientY: number): void {
		try {
			this.view.dom.setPointerCapture(pending.pointerId);
			pending.captureElement = this.view.dom;
		} catch {
			// Keep capture on the original marker if the browser cannot transfer it.
		}
		const ghost = this.createGhost(pending.source);
		ghost.toggleClass("drag-and-drop-lists-ghost-touch", pending.touchPointer);
		this.context = { source: pending.source, ghost, target: null, touchPointer: pending.touchPointer };
		this.view.dom.addClass("drag-and-drop-lists-active");
		this.view.dom.ownerDocument.getSelection()?.removeAllRanges();
		this.positionGhost(clientX, clientY);
		this.view.dispatch({ effects: [setSource.of(pending.source), setTarget.of(null)] });
	}

	private createGhost(source: ListBlock): HTMLElement {
		const ghost = this.view.dom.ownerDocument.body.createDiv({ cls: "drag-and-drop-lists-ghost" });
		const baseIndent = indentationWidth(source.indent);
		for (let lineNumber = source.start; lineNumber <= source.end; lineNumber += 1) {
			const line = this.view.state.doc.line(lineNumber);
			const dom = this.view.domAtPos(line.from).node;
			const row = closestElement(dom, ".cm-line");
			let rowLineNumber: number | null = null;
			if (row) {
				try {
					rowLineNumber = this.view.state.doc.lineAt(this.view.posAtDOM(row, 0)).number;
				} catch {
					// Off-viewport lines may resolve to a recycled boundary node.
				}
			}
			const parsedLine = parseListLine(line.text);
			const lineIndentation = parsedLine?.quoteDepth === source.quoteDepth
				? parsedLine.indent
				: lineIndent(line.text);
			const relativeIndent = Math.max(0, indentationWidth(lineIndentation) - baseIndent);
			if (row && rowLineNumber === lineNumber && !row.hasClass("HyperMD-quote")) {
				const clone = row.cloneNode(true) as HTMLElement;
				clone.addClass("drag-and-drop-lists-ghost-row");
				clone.removeAttribute("style");
				clone.removeAttribute("contenteditable");
				for (const decoration of clone.querySelectorAll<HTMLElement>(".cm-fold-indicator, .cm-widgetBuffer")) {
					decoration.remove();
				}
				clone.setCssProps({ "--drag-and-drop-lists-indent": `${relativeIndent}ch` });
				ghost.appendChild(clone);
			} else {
				const fallback = ghost.createDiv({ cls: "drag-and-drop-lists-ghost-row" });
				fallback.setCssProps({ "--drag-and-drop-lists-indent": `${relativeIndent}ch` });
				this.renderFallbackRow(fallback, line.text);
			}
		}
		const firstRow = ghost.querySelector<HTMLElement>(".drag-and-drop-lists-ghost-row");
		const anchorHeight = firstRow?.getBoundingClientRect().height ?? 0;
		ghost.setCssProps({ "--drag-and-drop-lists-anchor-y": `${anchorHeight / 2}px` });
		return ghost;
	}

	private renderFallbackRow(row: HTMLElement, source: string): void {
		const parsed = parseListLine(source);
		if (parsed?.taskStatus !== null && parsed?.taskStatus !== undefined) {
			const checkbox = row.createEl("input", {
				cls: "task-list-item-checkbox drag-and-drop-lists-ghost-marker",
				attr: { type: "checkbox", "aria-hidden": "true", tabindex: "-1", "data-task": parsed.taskStatus },
			});
			checkbox.checked = parsed.taskStatus.trim().length > 0;
		} else {
			row.createSpan({
				cls: "drag-and-drop-lists-ghost-marker",
				text: parsed?.marker.match(/^\d/) ? parsed.marker : "•",
			});
		}
		row.createSpan({ text: parsed?.content ?? source.trim() });
	}

	private positionGhost(clientX: number, clientY: number): void {
		const ghost = this.context?.ghost;
		if (!ghost) return;
		ghost.toggleClass("drag-and-drop-lists-ghost-left", clientX > this.viewWindow.innerWidth * 0.65);
		ghost.toggleClass(
			"drag-and-drop-lists-ghost-touch-below",
			this.context?.touchPointer === true && clientY < Math.min(180, this.viewWindow.innerHeight * 0.25),
		);
		ghost.setCssProps({
			"--drag-and-drop-lists-x": `${clientX}px`,
			"--drag-and-drop-lists-y": `${clientY}px`,
		});
	}

	private getTargetAtPoint(clientX: number, clientY: number): DropTarget | null {
		if (!this.context) return null;
		const hit = this.view.dom.ownerDocument.elementFromPoint(clientX, clientY);
		const row = closestElement(hit, LIST_LINE_SELECTOR);
		if (!row || !this.view.contentDOM.contains(row)) return null;
		const line = this.view.state.doc.lineAt(this.view.posAtDOM(row, 0)).number;
		const source = this.context.source;
		if (line >= source.start && line <= source.end) return null;
		const lines = this.view.state.doc.toString().split("\n");
		const block = findListBlock(lines, line - 1);
		if (!block) return null;
		if (block.quoteDepth !== source.quoteDepth) return null;
		const side = clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2
			? "before"
			: "after";
		const followingLine = block.end + 1;
		const useFollowingLine = side === "after" && followingLine <= this.view.state.doc.lines;
		return {
			block,
			line,
			side,
			indicatorLine: useFollowingLine ? followingLine : line,
			indicatorSide: useFollowingLine ? "before" : side,
		};
	}

	private commitMove(source: ListBlock, target: DropTarget): void {
		const info = this.view.state.field(editorInfoField, false);
		const editor = info?.editor;
		if (!editor) return;
		applyEditorMove(
			editor,
			source,
			target.block,
			target.side,
			this.getSettings().cursorPlacement,
			(result) => { this.prepareRowTransition(source, result); },
		);
	}

	private visibleRows(view: EditorView): Map<number, HTMLElement> {
		const rows = new Map<number, HTMLElement>();
		for (const row of view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")) {
			try {
				const lineIndex = view.state.doc.lineAt(view.posAtDOM(row, 0)).number - 1;
				if (!rows.has(lineIndex)) rows.set(lineIndex, row);
			} catch {
				// CodeMirror may recycle a row while the viewport is changing.
			}
		}
		return rows;
	}

	private prepareRowTransition(source: ListBlock, result: MoveResult): void {
		this.pendingRowTransition = null;
		this.cancelRowAnimations();
		if (this.viewWindow.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const scrollTop = this.view.scrollDOM.scrollTop;
		const oldTops = new Map<number, number>();
		for (const [lineIndex, row] of this.visibleRows(this.view)) {
			oldTops.set(lineIndex, row.getBoundingClientRect().top + scrollTop);
		}
		this.pendingRowTransition = {
			oldTops,
			originalLineIndexes: result.originalLineIndexes,
			movingStart: source.start - 1,
			movingEnd: source.end - 1,
		};
	}

	private scheduleRowTransition(transition: PendingRowTransition): void {
		this.view.requestMeasure({
			read: (view): MeasuredRowTransition[] => {
				const rows = this.visibleRows(view);
				const scrollTop = view.scrollDOM.scrollTop;
				const newTops = new Map<number, number>();
				for (const [lineIndex, row] of rows) {
					newTops.set(lineIndex, row.getBoundingClientRect().top + scrollTop);
				}
				return calculateRowDeltas(
					transition.oldTops,
					newTops,
					transition.originalLineIndexes,
					transition.movingStart,
					transition.movingEnd,
				).flatMap(({ newLineIndex, deltaY }) => {
					const element = rows.get(newLineIndex);
					return element ? [{ element, deltaY }] : [];
				});
			},
			write: (measurements): void => { this.animateRows(measurements); },
		});
	}

	private animateRows(measurements: readonly MeasuredRowTransition[]): void {
		if (this.viewWindow.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		for (const { element, deltaY } of measurements) {
			const animation = element.animate(
				[{ translate: `0 ${deltaY}px` }, { translate: "0 0" }],
				{
					duration: ROW_TRANSITION_DURATION_MS,
					easing: "cubic-bezier(0.2, 0, 0, 1)",
				},
			);
			this.rowAnimations.set(element, animation);
			const forgetAnimation = (): void => {
				if (this.rowAnimations.get(element) === animation) this.rowAnimations.delete(element);
			};
			animation.onfinish = forgetAnimation;
			animation.oncancel = forgetAnimation;
		}
	}

	private cancelRowAnimations(): void {
		for (const animation of this.rowAnimations.values()) animation.cancel();
		this.rowAnimations.clear();
	}

	private autoScroll(clientY: number): boolean {
		const rect = this.view.scrollDOM.getBoundingClientRect();
		const { threshold, step } = autoScrollConfig(this.context?.touchPointer === true);
		if (clientY < rect.top + threshold) {
			this.view.scrollDOM.scrollBy({ top: -step });
			return true;
		}
		if (clientY > rect.bottom - threshold) {
			this.view.scrollDOM.scrollBy({ top: step });
			return true;
		}
		return false;
	}

	private scheduleAutoScroll(): void {
		if (this.autoScrollTimer !== null || !this.context) return;
		this.autoScrollTimer = this.viewWindow.setTimeout(this.onAutoScrollFrame, 16);
	}

	private continueAutoScroll(): void {
		this.autoScrollTimer = null;
		if (!this.context || !this.autoScroll(this.pointerY)) return;
		this.updateTarget(this.pointerX, this.pointerY);
		this.scheduleAutoScroll();
	}

	private removeGhost(ghost: HTMLElement, animate: boolean): void {
		if (!animate || this.viewWindow.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			ghost.remove();
			return;
		}
		ghost.addClass("drag-and-drop-lists-ghost-exiting");
		this.exitingGhosts.add(ghost);
		const timer = this.viewWindow.setTimeout(() => {
			ghost.remove();
			this.exitingGhosts.delete(ghost);
			this.ghostExitTimers.delete(timer);
		}, 110);
		this.ghostExitTimers.add(timer);
	}

	private clearExitingGhosts(): void {
		for (const timer of this.ghostExitTimers) this.viewWindow.clearTimeout(timer);
		this.ghostExitTimers.clear();
		for (const ghost of this.exitingGhosts) ghost.remove();
		this.exitingGhosts.clear();
	}

	private cleanup(dispatchEffects = true): void {
		if (this.autoScrollTimer !== null) {
			this.viewWindow.clearTimeout(this.autoScrollTimer);
			this.autoScrollTimer = null;
		}
		const pending = this.pending;
		try {
			if (pending?.captureElement?.hasPointerCapture(pending.pointerId)) {
				pending.captureElement.releasePointerCapture(pending.pointerId);
			}
		} catch {
			// The editor may have recycled a captured handle during a document or viewport update.
		}
		const ghost = this.context?.ghost;
		this.context = null;
		this.pending = null;
		if (ghost) this.removeGhost(ghost, dispatchEffects);
		this.view.dom.removeClass("drag-and-drop-lists-touch-pending");
		this.view.dom.removeClass("drag-and-drop-lists-active");
		this.view.dom.removeClass("drag-and-drop-lists-invalid");
		if (dispatchEffects) this.view.dispatch({ effects: [setSource.of(null), setTarget.of(null)] });
	}
}

class DragAndDropListsSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: DragAndDropListsPlugin) {
		super(app, plugin);
	}

	display(): void {
		this.containerEl.empty();
		new Setting(this.containerEl)
			.setName("Cursor placement")
			.setDesc("Choose where the caret appears after moving a list item.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("beginning", "Beginning of line")
					.addOption("end", "End of line")
					.setValue(this.plugin.settings.cursorPlacement)
					.onChange(async (value) => {
						if (value !== "beginning" && value !== "end") return;
						await this.plugin.setCursorPlacement(value);
					});
			});
 	}
}

export default class DragAndDropListsPlugin extends Plugin {
	settings: DragAndDropListsSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		const stored = await this.loadData() as { cursorPlacement?: unknown } | null;
		const cursorPlacement = stored?.cursorPlacement === "end" ? "end" : "beginning";
		this.settings = Object.assign({}, DEFAULT_SETTINGS, { cursorPlacement });
		this.addSettingTab(new DragAndDropListsSettingTab(this.app, this));
		const dragExtension = ViewPlugin.define(
			(view) => new DragController(view, () => this.settings),
			{ decorations: (controller) => controller.quoteHandleDecorations },
		);
		this.registerEditorExtension([visualField, dragExtension]);
		this.addCommand({
			id: "move-list-item-up",
			name: "Move current list item up",
			editorCheckCallback: (checking, editor) => this.moveCurrentListItem(editor, "up", checking),
		});
		this.addCommand({
			id: "move-list-item-down",
			name: "Move current list item down",
			editorCheckCallback: (checking, editor) => this.moveCurrentListItem(editor, "down", checking),
		});
	}

	async setCursorPlacement(cursorPlacement: CursorPlacement): Promise<void> {
		this.settings = Object.assign({}, this.settings, { cursorPlacement });
		await this.saveData(this.settings);
	}

	private moveCurrentListItem(editor: Editor, direction: "up" | "down", checking: boolean): boolean {
		const lines = editor.getValue().split("\n");
		const source = findContainingListBlock(lines, editor.getCursor().line);
		if (!source) return false;
		const target = findSiblingListBlock(lines, source, direction);
		if (!target) return false;
		if (!checking) {
			applyEditorMove(
				editor,
				source,
				target,
				direction === "up" ? "before" : "after",
				this.settings.cursorPlacement,
			);
		}
		return true;
	}
}
