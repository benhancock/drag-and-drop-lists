import {
	Decoration,
	type DecorationSet,
	EditorView,
	type PluginValue,
	type ViewUpdate,
	ViewPlugin,
} from "@codemirror/view";
import {
	App,
	type Editor,
	editorInfoField,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import {
	autoScrollConfig,
	hasReachedDragStartThreshold,
	isTouchPointer,
	nearestTouchTarget,
	nearestVerticalTarget,
	touchGestureEventPolicy,
	type TouchGestureEventPolicy,
	type TouchTargetGeometry,
} from "./interaction";
import {
	cycleListItemStatus,
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
import {
	calculateBlockSpanHeight,
	calculateGhostGrabAnchor,
	calculateGhostLanding,
	calculateGhostPickup,
	calculateGhostRowAlignment,
	calculateListProjection,
	calculateProjectedLandingTarget,
	calculateProjectionDeltas,
	calculateRowDeltas,
	type GhostLanding,
} from "./row-transition";

const PLUGIN_ID = "drag-and-drop-lists";
const TASK_HANDLE_SELECTOR = ".task-list-label";
const QUOTE_HANDLE_SELECTOR = ".drag-and-drop-lists-quote-list .cm-formatting-quote";
const CONTINUATION_HANDLE_SELECTOR = ".HyperMD-list-line-nobullet .cm-hmd-list-indent";
const HANDLE_SELECTOR = `${TASK_HANDLE_SELECTOR}, .cm-formatting-list, ${QUOTE_HANDLE_SELECTOR}, ${CONTINUATION_HANDLE_SELECTOR}`;
const LIST_LINE_SELECTOR = ".HyperMD-list-line.cm-line, .HyperMD-quote.cm-line";
const LANDING_ANCHOR_SELECTORS = [
	".task-list-item-checkbox",
	".list-bullet",
	".cm-formatting-list",
	".drag-and-drop-lists-ghost-marker",
] as const;
const ROW_TRANSITION_DURATION_MS = 160;
const GHOST_ENTRY_DURATION_MS = 180;
const GHOST_TOUCH_ENTRY_DURATION_MS = 260;
const GHOST_TOUCH_PICKUP_DURATION_MS = 140;
const GHOST_DESKTOP_LANDING_DURATION_MS = 180;
const GHOST_TOUCH_LANDING_DURATION_MS = 240;
const DESKTOP_RENDER_SETTLE_FRAMES = 2;
const MOBILE_TOUCH_HIT_RADIUS = 22;
const MOBILE_TOUCH_ROW_SLOP = 10;
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
	placeholder: HTMLElement;
	placeholderHeight: number;
	target: DropTarget | null;
	touchPointer: boolean;
}

interface PendingDrag {
	pointerId: number;
	startX: number;
	startY: number;
	captureElement: HTMLElement | null;
	originElement: HTMLElement;
	rowElement: HTMLElement;
	tapActivationElement: HTMLElement | null;
	preview: HTMLElement | null;
	source: ListBlock;
	touchPointer: boolean;
}

interface TouchHandleTarget {
	handle: HTMLElement;
	originElement: HTMLElement;
	row: HTMLElement;
}

interface OwnedTouch {
	identifier: number;
	startX: number;
	startY: number;
	dragStarted: boolean;
}

interface PendingRowTransition {
	oldTops: Map<number, number>;
	originalLineIndexes: number[];
	movingStart: number;
	movingEnd: number;
	destinationLineIndex: number;
	movedLineCount: number;
	ghost: HTMLElement | null;
	sharedElementHandoff: boolean;
	desktopPrelanded: boolean;
}

interface PendingDesktopLanding {
	context: DragContext;
	target: DropTarget;
	animation: Animation | null;
	committing: boolean;
}

interface MeasuredRowTransition {
	element: HTMLElement;
	deltaY: number;
}

interface MeasuredGhostTransition extends GhostLanding {
	element: HTMLElement;
	destinationElements: HTMLElement[];
	backgroundColor: string;
	borderColor: string;
	boxShadow: string;
	anchorDeltaX: number;
	anchorDeltaY: number;
}

interface MeasuredDropTransition {
	rows: MeasuredRowTransition[];
	ghost: MeasuredGhostTransition | null;
}

interface GhostRowSourceGeometry {
	element: HTMLElement;
	sourceAnchorLeft: number;
}

interface GhostPickupSource {
	rect: DOMRect;
	anchorRect: DOMRect;
	backgroundColor: string;
	borderRadius: string;
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

function closestElement(target: EventTarget | null, selector: string): HTMLElement | null {
	if (!target) return null;
	const candidate = target as Partial<Element> & { parentElement?: HTMLElement | null };
	if (typeof candidate.closest === "function") return candidate.closest(selector);
	return candidate.parentElement?.closest(selector) ?? null;
}

function findTouch(touches: TouchList, identifier: number): Touch | null {
	for (let index = 0; index < touches.length; index += 1) {
		const touch = touches.item(index);
		if (touch?.identifier === identifier) return touch;
	}
	return null;
}

function handleOriginElement(handle: HTMLElement): HTMLElement {
	if (handle.matches(TASK_HANDLE_SELECTOR)) {
		return handle.querySelector<HTMLElement>(".task-list-item-checkbox") ?? handle;
	}
	return handle.querySelector<HTMLElement>(".list-bullet") ?? handle;
}

function applyTouchEventPolicy(event: TouchEvent, policy: TouchGestureEventPolicy): void {
	if (policy.preventDefault) event.preventDefault();
	if (policy.stopImmediatePropagation) event.stopImmediatePropagation();
}

function sameTarget(left: DropTarget | null, right: DropTarget | null): boolean {
	return left?.block.start === right?.block.start
		&& left?.block.end === right?.block.end
		&& left?.side === right?.side
		&& left?.indicatorLine === right?.indicatorLine
		&& left?.indicatorSide === right?.indicatorSide;
}

function findLandingAnchor(row: HTMLElement | null): HTMLElement | null {
	if (!row) return null;
	for (const selector of LANDING_ANCHOR_SELECTORS) {
		const anchor = row.querySelector<HTMLElement>(selector);
		if (anchor) return anchor;
	}
	return null;
}

function applyEditorMove(
	editor: Editor,
	source: ListBlock,
	target: ListBlock,
	side: "before" | "after",
	cursorPlacement: CursorPlacement,
	beforeTransaction?: (result: MoveResult) => void,
	afterTransaction?: (cursor: { line: number; ch: number }) => void,
): boolean {
	const originalLines = editor.getValue().split("\n");
	const result = moveListBlock(originalLines, source, target, side);
	if (!result) return false;
	let firstChangedLine = 0;
	while (firstChangedLine < originalLines.length
		&& originalLines[firstChangedLine] === result.lines[firstChangedLine]) firstChangedLine += 1;
	if (firstChangedLine >= originalLines.length) return false;
	let lastChangedLine = originalLines.length - 1;
	while (lastChangedLine > firstChangedLine
		&& originalLines[lastChangedLine] === result.lines[lastChangedLine]) lastChangedLine -= 1;
	const replacement = result.lines.slice(firstChangedLine, lastChangedLine + 1).join("\n");
	const cursor = {
		line: result.insertionIndex,
		ch: cursorPlacement === "end"
		? (result.lines[result.insertionIndex]?.length ?? 0)
		: 0,
	};
	beforeTransaction?.(result);
	editor.transaction({
		changes: [{
			from: { line: firstChangedLine, ch: 0 },
			to: { line: lastChangedLine, ch: editor.getLine(lastChangedLine).length },
			text: replacement,
		}],
		selection: { from: cursor },
	}, PLUGIN_ID);
	afterTransaction?.(cursor);
	return true;
}

class DragController implements PluginValue {
	quoteHandleDecorations: DecorationSet;
	private context: DragContext | null = null;
	private pending: PendingDrag | null = null;
	private ownedTouch: OwnedTouch | null = null;
	private addedIgnoreSwipe = false;
	private suppressClickUntil = 0;
	private pointerX = 0;
	private pointerY = 0;
	private autoScrollTimer: number | null = null;
	private cursorRestoreFrame: number | null = null;
	private pendingRowTransition: PendingRowTransition | null = null;
	private desktopLanding: PendingDesktopLanding | null = null;
	private readonly exitingGhosts = new Set<HTMLElement>();
	private readonly ghostExitTimers = new Set<number>();
	private readonly ghostEntryAnimations = new Map<HTMLElement, Animation>();
	private readonly ghostLandingAnimations = new Map<HTMLElement, Animation>();
	private readonly ghostRevealFrames = new Set<number>();
	private readonly rowAnimations = new Map<HTMLElement, Animation>();
	private readonly pendingSourceRows = new Set<HTMLElement>();
	private readonly projectedRows = new Set<HTMLElement>();
	private readonly eventDocument: Document;
	private readonly viewWindow: Window;
	private readonly onPointerDown = (event: PointerEvent): void => { this.pointerDown(event); };
	private readonly onPointerMove = (event: PointerEvent): void => { this.pointerMove(event); };
	private readonly onPointerUp = (event: PointerEvent): void => { this.pointerUp(event); };
	private readonly onPointerCancel = (event: PointerEvent): void => { this.pointerCancel(event); };
	private readonly onTouchStart = (event: TouchEvent): void => { this.touchStart(event); };
	private readonly onTouchMove = (event: TouchEvent): void => { this.touchMove(event); };
	private readonly onTouchEnd = (event: TouchEvent): void => { this.touchEnd(event); };
	private readonly onTouchCancel = (event: TouchEvent): void => { this.touchCancel(event); };
	private readonly onSelectStart = (event: Event): void => { this.selectStart(event); };
	private readonly onSelectionChange = (): void => { this.clearNativeSelection(); };
	private readonly onContextMenu = (event: MouseEvent): void => { this.contextMenu(event); };
	private readonly onDragStart = (event: DragEvent): void => { this.dragStart(event); };
	private readonly onClick = (event: MouseEvent): void => { this.click(event); };
	private readonly onKeyDown = (event: KeyboardEvent): void => { this.keyDown(event); };
	private readonly onBlur = (): void => {
		if (this.desktopLanding) {
			this.finishDesktopLanding();
			this.releaseTouchOwnership();
			return;
		}
		if (this.pending || this.context) {
			if (this.context) this.suppressClickUntil = Number.POSITIVE_INFINITY;
			this.cleanup();
		}
		this.releaseTouchOwnership();
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
		this.viewWindow.addEventListener("touchstart", this.onTouchStart, { capture: true, passive: false });
		this.viewWindow.addEventListener("touchmove", this.onTouchMove, { capture: true, passive: false });
		this.viewWindow.addEventListener("touchend", this.onTouchEnd, { capture: true, passive: false });
		this.viewWindow.addEventListener("touchcancel", this.onTouchCancel, { capture: true, passive: false });
		this.eventDocument.addEventListener("selectstart", this.onSelectStart, true);
		this.eventDocument.addEventListener("selectionchange", this.onSelectionChange, true);
		this.viewWindow.addEventListener("contextmenu", this.onContextMenu, true);
		this.viewWindow.addEventListener("dragstart", this.onDragStart, true);
		this.eventDocument.addEventListener("click", this.onClick, true);
		this.eventDocument.addEventListener("keydown", this.onKeyDown, true);
		viewWindow.addEventListener("blur", this.onBlur);
	}

	destroy(): void {
		this.eventDocument.removeEventListener("pointerdown", this.onPointerDown, true);
		this.eventDocument.removeEventListener("pointermove", this.onPointerMove, true);
		this.eventDocument.removeEventListener("pointerup", this.onPointerUp, true);
		this.eventDocument.removeEventListener("pointercancel", this.onPointerCancel, true);
		this.viewWindow.removeEventListener("touchstart", this.onTouchStart, true);
		this.viewWindow.removeEventListener("touchmove", this.onTouchMove, true);
		this.viewWindow.removeEventListener("touchend", this.onTouchEnd, true);
		this.viewWindow.removeEventListener("touchcancel", this.onTouchCancel, true);
		this.eventDocument.removeEventListener("selectstart", this.onSelectStart, true);
		this.eventDocument.removeEventListener("selectionchange", this.onSelectionChange, true);
		this.viewWindow.removeEventListener("contextmenu", this.onContextMenu, true);
		this.viewWindow.removeEventListener("dragstart", this.onDragStart, true);
		this.eventDocument.removeEventListener("click", this.onClick, true);
		this.eventDocument.removeEventListener("keydown", this.onKeyDown, true);
		this.viewWindow.removeEventListener("blur", this.onBlur);
		if (this.cursorRestoreFrame !== null) this.viewWindow.cancelAnimationFrame(this.cursorRestoreFrame);
		this.cancelDesktopLanding();
		this.cleanup(false);
		this.releaseTouchOwnership();
		this.clearExitingGhosts();
		this.pendingRowTransition = null;
		this.cancelRowAnimations();
	}

	update(update: ViewUpdate): void {
		if (this.desktopLanding && update.docChanged && !this.desktopLanding.committing) {
			this.cancelDesktopLanding();
		}
		const rowTransition = update.docChanged ? this.pendingRowTransition : null;
		if (rowTransition) {
			this.pendingRowTransition = null;
			this.scheduleRowTransition(rowTransition);
		} else if (update.docChanged || update.viewportChanged) {
			this.pendingRowTransition = null;
			this.cancelRowAnimations();
			this.cancelGhostLandingAnimations();
		}
		if (update.docChanged || update.viewportChanged) {
			this.quoteHandleDecorations = makeQuoteHandleDecorations(update.view);
		}
		if (update.viewportChanged && this.pending?.preview) {
			this.hidePendingSourceRows(this.pending.source);
		}
		if (update.viewportChanged && this.context) this.applyProjectedLayout();
		if (update.docChanged && (this.pending || this.context) && !this.desktopLanding?.committing) {
			if (this.context) this.suppressClickUntil = Number.POSITIVE_INFINITY;
			this.cleanup(false);
		}
	}

	private pointerDown(event: PointerEvent): void {
		if (event.button !== 0 || !event.isPrimary || this.pending || this.context || this.desktopLanding) return;
		this.cancelRowAnimations();
		this.cancelGhostLandingAnimations();
		if (this.cursorRestoreFrame !== null) {
			this.viewWindow.cancelAnimationFrame(this.cursorRestoreFrame);
			this.cursorRestoreFrame = null;
		}
		if (this.suppressClickUntil === Number.POSITIVE_INFINITY) this.suppressClickUntil = 0;
		const touchPointer = isTouchPointer(event.pointerType);
		const directHandle = closestElement(event.target, HANDLE_SELECTOR);
		const touchTarget = touchPointer
			? this.nearestTouchHandle(event.clientX, event.clientY)
			: null;
		const handle = touchTarget?.handle ?? directHandle;
		if (!handle || !this.view.contentDOM.contains(handle)) return;
		const row = touchTarget?.row ?? handle.closest<HTMLElement>(LIST_LINE_SELECTOR);
		if (!row) return;
		const position = this.view.posAtDOM(row, 0);
		const lineNumber = this.view.state.doc.lineAt(position).number;
		const lines = this.view.state.doc.toString().split("\n");
		const source = findListBlock(lines, lineNumber - 1)
			?? findContainingListBlock(lines, lineNumber - 1);
		if (!source) return;
		const originElement = touchTarget?.originElement ?? handleOriginElement(handle);
		const tapActivationElement = touchPointer
			&& originElement.matches(".task-list-item-checkbox")
			? originElement
			: null;
		this.pending = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			captureElement: handle.matches(TASK_HANDLE_SELECTOR) ? null : handle,
			originElement,
			rowElement: row,
			tapActivationElement,
			preview: null,
			source,
			touchPointer,
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
		} else if (this.pending.touchPointer) {
			// Own direct checkbox touches immediately. On iOS, leaving pointerdown's
			// default action intact lets the magnifier cancel our hold gesture before
			// its menu opens. A short tap is reproduced on pointerup instead.
			event.preventDefault();
			event.stopImmediatePropagation();
		}
		if (this.pending.touchPointer) {
			// Pointer events precede their compatibility touch events in WebKit,
			// so publish the swipe exclusion before Obsidian sees touchstart.
			this.claimTouchOwnership();
			this.view.dom.addClass("drag-and-drop-lists-touch-pending");
			this.pending.preview = this.createPendingTouchPreview(this.pending);
		}
	}

	private pointerMove(event: PointerEvent): void {
		const pending = this.pending;
		if (!pending || pending.pointerId !== event.pointerId) return;
		if (!this.context) {
			const dragReady = hasReachedDragStartThreshold(
				pending.startX,
				pending.startY,
				event.clientX,
				event.clientY,
				pending.touchPointer,
			);
			if (!dragReady) {
				if (pending.touchPointer) event.stopImmediatePropagation();
				return;
			}
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
		}
		this.applyProjectedLayout();
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
			const {
				touchPointer,
				tapActivationElement,
				preview,
				source,
			} = this.pending;
			this.pending = null;
			this.view.dom.removeClass("drag-and-drop-lists-touch-pending");
			this.clearPendingSourceRows();
			if (preview) this.scheduleGhostReturn(source, preview);
			if (touchPointer) this.releaseTouchOwnership();
			if (tapActivationElement) {
				event.preventDefault();
				tapActivationElement.click();
				this.suppressClickUntil = Date.now() + 500;
			}
			return;
		}
		event.preventDefault();
		const target = this.getTargetAtPoint(event.clientX, event.clientY);
		if (target || this.isPointOverSourcePlaceholder(event.clientY)) {
			if (target
				&& !context.touchPointer
				&& !this.viewWindow.matchMedia("(prefers-reduced-motion: reduce)").matches) {
				this.suppressClickUntil = Date.now() + 500;
				this.beginDesktopLanding(context, target);
				return;
			}
			// Detach the preview from active cleanup so the pointer-specific landing
			// handoff can finish after CodeMirror renders the destination.
			this.context = null;
			const moved = target
				? this.commitMove(
					context.source,
					target,
					context.ghost,
					context.placeholder,
					context.touchPointer,
				)
				: false;
			if (!moved) {
				this.clearProjectedLayout(context.placeholder);
				this.scheduleGhostReturn(context.source, context.ghost);
			}
		}
		this.suppressClickUntil = Date.now() + 500;
		this.cleanup();
		if (context.touchPointer) this.releaseTouchOwnership();
	}

	private beginDesktopLanding(context: DragContext, target: DropTarget): void {
		context.target = target;
		this.applyProjectedLayout();
		if (this.autoScrollTimer !== null) {
			this.viewWindow.clearTimeout(this.autoScrollTimer);
			this.autoScrollTimer = null;
		}
		this.releasePendingPointerCapture();
		this.pending = null;
		this.clearPendingSourceRows();
		this.view.dom.removeClass("drag-and-drop-lists-touch-pending");
		this.view.dom.removeClass("drag-and-drop-lists-invalid");
		const landing: PendingDesktopLanding = {
			context,
			target,
			animation: null,
			committing: false,
		};
		this.desktopLanding = landing;
		this.view.requestMeasure({
			read: (): MeasuredGhostTransition | null => {
				if (this.desktopLanding !== landing) return null;
				return this.measureProjectedDesktopLanding(context, target);
			},
			write: (measurement): void => {
				if (this.desktopLanding !== landing) return;
				if (!measurement) {
					this.finishDesktopLanding();
					return;
				}
				landing.animation = this.animateDesktopPrecommitLanding(measurement, () => {
					this.finishDesktopLanding();
				});
			},
		});
	}

	private measureProjectedDesktopLanding(
		context: DragContext,
		target: DropTarget,
	): MeasuredGhostTransition | null {
		const { ghost, placeholder, source } = context;
		if (!ghost.isConnected || !placeholder.isConnected) return null;
		const rows = this.visibleRows(this.view);
		const sourceRow = rows.get(source.start - 1) ?? null;
		const targetRow = rows.get(target.block.start - 1) ?? null;
		const ghostRow = ghost.querySelector<HTMLElement>(".drag-and-drop-lists-ghost-row");
		const ghostAnchor = findLandingAnchor(ghostRow) ?? ghostRow;
		const sourceAnchor = findLandingAnchor(sourceRow) ?? sourceRow;
		const targetAnchor = findLandingAnchor(targetRow) ?? targetRow;
		if (!sourceRow || !targetRow || !ghostAnchor || !sourceAnchor || !targetAnchor) return null;
		const computedStyle = this.viewWindow.getComputedStyle(ghost);
		const projectedTarget = calculateProjectedLandingTarget(
			placeholder.getBoundingClientRect(),
			sourceRow.getBoundingClientRect(),
			sourceAnchor.getBoundingClientRect(),
			targetRow.getBoundingClientRect(),
			targetAnchor.getBoundingClientRect(),
			indentationWidth(source.indent) === indentationWidth(target.block.indent),
		);
		const ghostAnchorRect = ghostAnchor.getBoundingClientRect();
		return Object.assign(
			{
				element: ghost,
				destinationElements: [],
				backgroundColor: computedStyle.backgroundColor,
				borderColor: computedStyle.borderTopColor,
				boxShadow: computedStyle.boxShadow,
				anchorDeltaX: projectedTarget.left - ghostAnchorRect.left,
				anchorDeltaY: projectedTarget.top - ghostAnchorRect.top,
			},
			calculateGhostLanding(
				ghost.getBoundingClientRect(),
				ghostAnchorRect,
				projectedTarget,
			),
		);
	}

	private finishDesktopLanding(): void {
		const landing = this.desktopLanding;
		if (!landing || landing.committing) return;
		landing.committing = true;
		const desktopPrelanded = landing.animation !== null;
		if (landing.animation && landing.animation.playState !== "finished") {
			landing.animation.onfinish = null;
			landing.animation.finish();
		}
		const moved = this.commitMove(
			landing.context.source,
			landing.target,
			landing.context.ghost,
			landing.context.placeholder,
			false,
			desktopPrelanded,
		);
		this.desktopLanding = null;
		this.context = null;
		this.view.dom.removeClass("drag-and-drop-lists-active");
		this.view.dom.removeClass("drag-and-drop-lists-invalid");
		if (!moved) {
			this.clearProjectedLayout(landing.context.placeholder);
			this.removeGhost(landing.context.ghost, true);
		}
	}

	private cancelDesktopLanding(): void {
		const landing = this.desktopLanding;
		if (!landing) return;
		this.desktopLanding = null;
		landing.animation?.cancel();
		if (this.context === landing.context) this.context = null;
		this.releasePendingPointerCapture();
		this.pending = null;
		this.clearPendingSourceRows();
		this.clearProjectedLayout(landing.context.placeholder);
		this.removeGhost(landing.context.ghost, true);
		this.view.dom.removeClass("drag-and-drop-lists-touch-pending");
		this.view.dom.removeClass("drag-and-drop-lists-active");
		this.view.dom.removeClass("drag-and-drop-lists-invalid");
	}

	private pointerCancel(event: PointerEvent): void {
		if (!this.pending || this.pending.pointerId !== event.pointerId) return;
		const touchPointer = this.pending.touchPointer;
		if (this.context) this.suppressClickUntil = Number.POSITIVE_INFINITY;
		this.cleanup();
		if (touchPointer) this.releaseTouchOwnership();
	}

	private touchStart(event: TouchEvent): void {
		if (this.ownedTouch) {
			applyTouchEventPolicy(event, touchGestureEventPolicy("start", true));
			return;
		}
		if (event.touches.length !== 1) return;
		const touch = event.changedTouches.item(0);
		if (!touch) return;
		if (this.pending?.touchPointer !== true
			&& !this.nearestTouchHandle(touch.clientX, touch.clientY)) return;
		this.ownedTouch = {
			identifier: touch.identifier,
			startX: touch.clientX,
			startY: touch.clientY,
			dragStarted: false,
		};
		this.claimTouchOwnership();
		// Claim the gesture before iOS can start its magnifier or text selection.
		// Direct checkbox taps are synthesized on pointerup, while terminal touch
		// events still propagate so Obsidian's other recognizers can reset.
		applyTouchEventPolicy(event, touchGestureEventPolicy("start", true));
	}

	private touchMove(event: TouchEvent): void {
		const ownedTouch = this.ownedTouch;
		if (!ownedTouch) return;
		const touch = findTouch(event.touches, ownedTouch.identifier)
			?? findTouch(event.changedTouches, ownedTouch.identifier);
		const preventDefault = ownedTouch.dragStarted || !touch || hasReachedDragStartThreshold(
			ownedTouch.startX,
			ownedTouch.startY,
			touch.clientX,
			touch.clientY,
			true,
		);
		applyTouchEventPolicy(event, touchGestureEventPolicy("move", preventDefault));
		this.clearNativeSelection();
	}

	private touchEnd(event: TouchEvent): void {
		const ownedTouch = this.ownedTouch;
		if (!ownedTouch) return;
		const ownedTouchEnded = findTouch(event.changedTouches, ownedTouch.identifier) !== null;
		applyTouchEventPolicy(event, touchGestureEventPolicy("terminal", false));
		if (ownedTouchEnded) {
			this.releaseTouchOwnership();
		}
	}

	private touchCancel(event: TouchEvent): void {
		const ownedTouch = this.ownedTouch;
		if (!ownedTouch) return;
		const ownedTouchCancelled = findTouch(event.changedTouches, ownedTouch.identifier) !== null;
		applyTouchEventPolicy(event, touchGestureEventPolicy("terminal", false));
		if (!ownedTouchCancelled) return;
		if (this.context) this.suppressClickUntil = Number.POSITIVE_INFINITY;
		this.cleanup();
		this.releaseTouchOwnership();
	}

	private selectStart(event: Event): void {
		if (!this.ownedTouch && this.pending?.touchPointer !== true && this.context?.touchPointer !== true) return;
		if (closestElement(event.target, ".cm-content") !== this.view.contentDOM) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	private contextMenu(event: MouseEvent): void {
		if (!this.ownedTouch || closestElement(event.target, ".cm-editor") !== this.view.dom) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	private dragStart(event: DragEvent): void {
		if (!this.ownedTouch || closestElement(event.target, ".cm-editor") !== this.view.dom) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	private keyDown(event: KeyboardEvent): void {
		if (event.key !== "Escape"
			|| (!this.pending && !this.context && !this.desktopLanding)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (this.desktopLanding) {
			this.cancelDesktopLanding();
			return;
		}
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
		const pickupSource = this.ghostPickupSource(pending.rowElement);
		try {
			this.view.dom.setPointerCapture(pending.pointerId);
			pending.captureElement = this.view.dom;
		} catch {
			// Keep capture on the original marker if the browser cannot transfer it.
		}
		const pendingPreview = pending.preview;
		const pendingPreviewContent = pendingPreview
			?.querySelector<HTMLElement>(".drag-and-drop-lists-ghost-row")
			?.getBoundingClientRect() ?? null;
		pending.preview = null;
		const ghost = pendingPreview ?? this.createGhost(pending.source, pickupSource?.rect.width);
		ghost.addClass("drag-and-drop-lists-ghost-under-pointer");
		const placeholderHeight = this.sourceBlockHeight(pending.source);
		const placeholder = this.view.dom.ownerDocument.body.createDiv({
			cls: "drag-and-drop-lists-placeholder drag-and-drop-lists-placeholder-initial",
			attr: { "aria-hidden": "true" },
		});
		placeholder.setCssProps({ "--drag-and-drop-lists-placeholder-height": `${placeholderHeight}px` });
		this.context = {
			source: pending.source,
			ghost,
			placeholder,
			placeholderHeight,
			target: null,
			touchPointer: pending.touchPointer,
		};
		if (pending.touchPointer && this.ownedTouch) this.ownedTouch.dragStarted = true;
		this.view.dom.addClass("drag-and-drop-lists-active");
		this.view.dom.ownerDocument.getSelection()?.removeAllRanges();
		this.positionGhost(clientX, clientY);
		if (pendingPreview && pendingPreviewContent) {
			this.animateGhostToPointer(ghost, pendingPreviewContent);
		}
		else if (pickupSource) this.animateGhostEntry(ghost, pickupSource, pending.touchPointer);
		this.applyProjectedLayout();
		this.clearPendingSourceRows();
		this.viewWindow.requestAnimationFrame(() => {
			placeholder.removeClass("drag-and-drop-lists-placeholder-initial");
		});
	}

	private createPendingTouchPreview(pending: PendingDrag): HTMLElement | null {
		const pickupSource = this.ghostPickupSource(pending.rowElement);
		if (!pickupSource) return null;
		const ghost = this.createGhost(pending.source, pickupSource.rect.width);
		ghost.addClass("drag-and-drop-lists-ghost-under-pointer", "drag-and-drop-lists-ghost-pending");
		ghost.setCssProps({
			"--drag-and-drop-lists-pickup-background": pickupSource.backgroundColor,
			"--drag-and-drop-lists-pickup-radius": pickupSource.borderRadius,
		});
		const originRect = pending.originElement.getBoundingClientRect();
		this.positionGhostElement(
			ghost,
			originRect.left + originRect.width / 2,
			originRect.top + originRect.height / 2,
		);
		this.hidePendingSourceRows(pending.source);
		return ghost;
	}

	private hidePendingSourceRows(source: ListBlock): void {
		for (const [lineIndex, row] of this.visibleRows(this.view)) {
			if (lineIndex < source.start - 1 || lineIndex >= source.end) continue;
			row.addClass("drag-and-drop-lists-pending-source");
			this.pendingSourceRows.add(row);
		}
	}

	private clearPendingSourceRows(): void {
		for (const row of this.pendingSourceRows) {
			row.removeClass("drag-and-drop-lists-pending-source");
		}
		this.pendingSourceRows.clear();
	}

	private ghostPickupSource(row: HTMLElement): GhostPickupSource | null {
		if (!row.isConnected) return null;
		const sourceStyle = this.viewWindow.getComputedStyle(row);
		const sourceAnchor = findLandingAnchor(row) ?? row;
		return {
			rect: row.getBoundingClientRect(),
			anchorRect: sourceAnchor.getBoundingClientRect(),
			backgroundColor: sourceStyle.backgroundColor,
			borderRadius: sourceStyle.borderRadius,
		};
	}

	private createGhost(source: ListBlock, sourceRowWidth?: number): HTMLElement {
		const ghost = this.view.dom.ownerDocument.body.createDiv({ cls: "drag-and-drop-lists-ghost" });
		if (sourceRowWidth !== undefined) {
			const ghostStyle = this.viewWindow.getComputedStyle(ghost);
			const horizontalChrome = (Number.parseFloat(ghostStyle.paddingLeft) || 0)
				+ (Number.parseFloat(ghostStyle.paddingRight) || 0)
				+ (Number.parseFloat(ghostStyle.borderLeftWidth) || 0)
				+ (Number.parseFloat(ghostStyle.borderRightWidth) || 0);
			ghost.setCssProps({
				"--drag-and-drop-lists-preview-width": `${sourceRowWidth + horizontalChrome}px`,
			});
			ghost.addClass("drag-and-drop-lists-ghost-source-width");
		}
		const viewContext = ghost.createDiv({ cls: "drag-and-drop-lists-ghost-editor-context" });
		const sourceView = this.view.dom.closest<HTMLElement>(".markdown-source-view");
		if (sourceView) this.copyClasses(sourceView, viewContext);
		const editorContext = viewContext.createDiv({ cls: "drag-and-drop-lists-ghost-editor-context" });
		this.copyClasses(this.view.dom, editorContext);
		const contentContext = editorContext.createDiv({ cls: "drag-and-drop-lists-ghost-editor-context" });
		this.copyClasses(this.view.contentDOM, contentContext);
		const baseIndent = indentationWidth(source.indent);
		const rowGeometries: GhostRowSourceGeometry[] = [];
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
				this.copyInlinePresentation(row, clone);
				for (const decoration of clone.querySelectorAll<HTMLElement>(".cm-fold-indicator, .cm-widgetBuffer")) {
					decoration.remove();
				}
				this.copyRowPresentation(row, clone);
				clone.setCssProps({ "--drag-and-drop-lists-indent": `${relativeIndent}ch` });
				contentContext.appendChild(clone);
				const sourceAnchor = findLandingAnchor(row);
				if (sourceAnchor) {
					rowGeometries.push({
						element: clone,
						sourceAnchorLeft: sourceAnchor.getBoundingClientRect().left,
					});
				}
			} else {
				const fallback = contentContext.createDiv({
					cls: "drag-and-drop-lists-ghost-row drag-and-drop-lists-ghost-row-fallback",
				});
				fallback.setCssProps({ "--drag-and-drop-lists-indent": `${relativeIndent}ch` });
				this.renderFallbackRow(fallback, line.text);
			}
		}
		this.alignGhostRows(ghost, rowGeometries);
		const firstRow = ghost.querySelector<HTMLElement>(".drag-and-drop-lists-ghost-row");
		const firstAnchor = findLandingAnchor(firstRow) ?? firstRow;
		if (firstAnchor) {
			const grabAnchor = calculateGhostGrabAnchor(
				ghost.getBoundingClientRect(),
				firstAnchor.getBoundingClientRect(),
			);
			ghost.setCssProps({
				"--drag-and-drop-lists-anchor-x": `${grabAnchor.x}px`,
				"--drag-and-drop-lists-anchor-y": `${grabAnchor.y}px`,
			});
		}
		return ghost;
	}

	private sourceBlockHeight(source: ListBlock): number {
		const firstLine = this.view.state.doc.line(source.start);
		const lastLine = this.view.state.doc.line(source.end);
		return calculateBlockSpanHeight(
			this.view.lineBlockAt(firstLine.from),
			this.view.lineBlockAt(lastLine.from),
		);
	}

	private insertionBoundary(source: ListBlock, target: DropTarget | null): number {
		if (!target) return source.start - 1;
		return target.side === "before" ? target.block.start - 1 : target.block.end;
	}

	private lineBoundaryTop(boundary: number): number {
		const doc = this.view.state.doc;
		if (boundary < doc.lines) {
			return this.view.lineBlockAt(doc.line(boundary + 1).from).top;
		}
		const last = this.view.lineBlockAt(doc.line(doc.lines).from);
		return last.top + last.height;
	}

	private applyProjectedLayout(): void {
		const context = this.context;
		if (!context) return;
		const sourceStart = context.source.start - 1;
		const sourceEnd = context.source.end;
		const boundary = this.insertionBoundary(context.source, context.target);
		const sourceTop = this.view.lineBlockAt(
			this.view.state.doc.line(context.source.start).from,
		).top;
		const projection = calculateListProjection(
			sourceStart,
			sourceEnd,
			boundary,
			sourceTop,
			this.lineBoundaryTop(boundary),
			context.placeholderHeight,
		);
		const visibleRows = this.visibleRows(this.view);
		for (const [lineIndex, row] of visibleRows) {
			row.addClass("drag-and-drop-lists-projected-row");
			row.toggleClass(
				"drag-and-drop-lists-projected-source",
				lineIndex >= sourceStart && lineIndex < sourceEnd,
			);
			row.setCssProps({
				"--drag-and-drop-lists-projection-y": `${projection.lineOffset(lineIndex)}px`,
			});
			this.projectedRows.add(row);
		}
		const contentRect = this.view.contentDOM.getBoundingClientRect();
		context.placeholder.setCssProps({
			"--drag-and-drop-lists-placeholder-x": `${contentRect.left}px`,
			"--drag-and-drop-lists-placeholder-y": `${this.view.documentTop + projection.placeholderTop}px`,
			"--drag-and-drop-lists-placeholder-width": `${contentRect.width}px`,
		});
	}

	private clearProjectedLayout(placeholder?: HTMLElement): void {
		for (const row of this.projectedRows) {
			row.removeClass("drag-and-drop-lists-projected-row");
			row.removeClass("drag-and-drop-lists-projected-source");
			row.style.removeProperty("--drag-and-drop-lists-projection-y");
		}
		this.projectedRows.clear();
		placeholder?.remove();
	}

	private alignGhostRows(ghost: HTMLElement, rows: readonly GhostRowSourceGeometry[]): void {
		const firstRow = rows[0];
		if (!firstRow) return;
		const ghostRect = ghost.getBoundingClientRect();
		const ghostPaddingLeft = Number.parseFloat(this.viewWindow.getComputedStyle(ghost).paddingLeft) || 0;
		for (const row of rows) {
			const anchor = findLandingAnchor(row.element);
			if (!anchor) continue;
			const alignment = calculateGhostRowAlignment(
				ghostRect.left,
				ghostPaddingLeft,
				firstRow.sourceAnchorLeft,
				row.sourceAnchorLeft,
				anchor.getBoundingClientRect().left,
			);
			row.element.setCssProps({
				"--drag-and-drop-lists-row-shift-x": `${alignment.shiftX}px`,
				"--drag-and-drop-lists-row-width-adjustment": `${alignment.widthAdjustment}px`,
			});
		}
	}

	private copyClasses(source: HTMLElement, target: HTMLElement): void {
		for (const className of source.classList) target.addClass(className);
	}

	private copyRowPresentation(source: HTMLElement, target: HTMLElement): void {
		const style = this.viewWindow.getComputedStyle(source);
		target.setCssProps({
			"--drag-and-drop-lists-row-color": style.color,
			"--drag-and-drop-lists-row-font-feature-settings": style.fontFeatureSettings,
			"--drag-and-drop-lists-row-font-family": style.fontFamily,
			"--drag-and-drop-lists-row-font-kerning": style.fontKerning,
			"--drag-and-drop-lists-row-font-size": style.fontSize,
			"--drag-and-drop-lists-row-font-stretch": style.getPropertyValue("font-stretch"),
			"--drag-and-drop-lists-row-font-style": style.fontStyle,
			"--drag-and-drop-lists-row-font-variant": style.fontVariant,
			"--drag-and-drop-lists-row-font-variation-settings": style.fontVariationSettings,
			"--drag-and-drop-lists-row-font-weight": style.fontWeight,
			"--drag-and-drop-lists-row-letter-spacing": style.letterSpacing,
			"--drag-and-drop-lists-row-line-height": style.lineHeight,
			"--drag-and-drop-lists-row-min-height": `${source.getBoundingClientRect().height}px`,
			"--drag-and-drop-lists-row-padding-bottom": style.paddingBottom,
			"--drag-and-drop-lists-row-padding-left": style.paddingLeft,
			"--drag-and-drop-lists-row-padding-right": style.paddingRight,
			"--drag-and-drop-lists-row-padding-top": style.paddingTop,
			"--drag-and-drop-lists-row-tab-size": style.tabSize,
			"--drag-and-drop-lists-row-text-indent": style.textIndent,
			"--drag-and-drop-lists-row-text-decoration-color": style.textDecorationColor,
			"--drag-and-drop-lists-row-text-decoration-line": style.textDecorationLine,
			"--drag-and-drop-lists-row-text-decoration-style": style.textDecorationStyle,
			"--drag-and-drop-lists-row-text-decoration-thickness": style.textDecorationThickness,
			"--drag-and-drop-lists-row-text-shadow": style.textShadow,
			"--drag-and-drop-lists-row-text-transform": style.textTransform,
			"--drag-and-drop-lists-row-white-space": style.whiteSpace,
			"--drag-and-drop-lists-row-word-spacing": style.wordSpacing,
		});
	}

	private copyInlinePresentation(source: HTMLElement, target: HTMLElement): void {
		const selector = "span, a, code, em, strong, mark, del, s, label, kbd, sub, sup";
		const sourceNodes = source.querySelectorAll<HTMLElement>(selector);
		const targetNodes = target.querySelectorAll<HTMLElement>(selector);
		const count = Math.min(sourceNodes.length, targetNodes.length);
		for (let index = 0; index < count; index += 1) {
			const sourceNode = sourceNodes.item(index);
			const targetNode = targetNodes.item(index);
			if (!sourceNode || !targetNode) continue;
			const style = this.viewWindow.getComputedStyle(sourceNode);
			targetNode.addClass("drag-and-drop-lists-ghost-styled-node");
			targetNode.setCssProps({
				"--drag-and-drop-lists-node-background-color": style.backgroundColor,
				"--drag-and-drop-lists-node-border-radius": style.borderRadius,
				"--drag-and-drop-lists-node-color": style.color,
				"--drag-and-drop-lists-node-font-feature-settings": style.fontFeatureSettings,
				"--drag-and-drop-lists-node-font-family": style.fontFamily,
				"--drag-and-drop-lists-node-font-kerning": style.fontKerning,
				"--drag-and-drop-lists-node-font-size": style.fontSize,
				"--drag-and-drop-lists-node-font-stretch": style.getPropertyValue("font-stretch"),
				"--drag-and-drop-lists-node-font-style": style.fontStyle,
				"--drag-and-drop-lists-node-font-variant": style.fontVariant,
				"--drag-and-drop-lists-node-font-variation-settings": style.fontVariationSettings,
				"--drag-and-drop-lists-node-font-weight": style.fontWeight,
				"--drag-and-drop-lists-node-letter-spacing": style.letterSpacing,
				"--drag-and-drop-lists-node-line-height": style.lineHeight,
				"--drag-and-drop-lists-node-opacity": style.opacity,
				"--drag-and-drop-lists-node-text-decoration-color": style.textDecorationColor,
				"--drag-and-drop-lists-node-text-decoration-line": style.textDecorationLine,
				"--drag-and-drop-lists-node-text-decoration-style": style.textDecorationStyle,
				"--drag-and-drop-lists-node-text-decoration-thickness": style.textDecorationThickness,
				"--drag-and-drop-lists-node-text-shadow": style.textShadow,
				"--drag-and-drop-lists-node-text-transform": style.textTransform,
				"--drag-and-drop-lists-node-vertical-align": style.verticalAlign,
				"--drag-and-drop-lists-node-word-spacing": style.wordSpacing,
			});
		}
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
		const context = this.context;
		if (!context) return;
		this.positionGhostElement(context.ghost, clientX, clientY);
	}

	private positionGhostElement(
		ghost: HTMLElement,
		clientX: number,
		clientY: number,
	): void {
		ghost.setCssProps({
			"--drag-and-drop-lists-x": `${clientX}px`,
			"--drag-and-drop-lists-y": `${clientY}px`,
		});
	}

	private getTargetAtPoint(clientX: number, clientY: number): DropTarget | null {
		if (!this.context) return null;
		const hit = this.view.dom.ownerDocument.elementFromPoint(clientX, clientY);
		const placeholder = closestElement(hit, ".drag-and-drop-lists-placeholder");
		const placeholderRect = this.context.placeholder.getBoundingClientRect();
		if (placeholder === this.context.placeholder
			|| clientY >= placeholderRect.top - MOBILE_TOUCH_ROW_SLOP
			&& clientY <= placeholderRect.bottom + MOBILE_TOUCH_ROW_SLOP) return this.context.target;
		const directRow = closestElement(hit, LIST_LINE_SELECTOR);
		const row = directRow && this.view.contentDOM.contains(directRow)
			? directRow
			: this.rowAtVerticalPoint(clientY);
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

	private isPointOverSourcePlaceholder(clientY: number): boolean {
		const context = this.context;
		if (!context || context.target) return false;
		const rect = context.placeholder.getBoundingClientRect();
		const withinY = clientY >= rect.top - MOBILE_TOUCH_ROW_SLOP
			&& clientY <= rect.bottom + MOBILE_TOUCH_ROW_SLOP;
		return withinY;
	}

	private rowAtVerticalPoint(clientY: number): HTMLElement | null {
		const scrollRect = this.view.scrollDOM.getBoundingClientRect();
		if (clientY < scrollRect.top || clientY > scrollRect.bottom) return null;
		const targets = [];
		for (const row of this.view.contentDOM.querySelectorAll<HTMLElement>(LIST_LINE_SELECTOR)) {
			if (row.hasClass("drag-and-drop-lists-projected-source")) continue;
			const rect = row.getBoundingClientRect();
			if (rect.height <= 0 || rect.bottom < scrollRect.top || rect.top > scrollRect.bottom) continue;
			targets.push({ value: row, top: rect.top, bottom: rect.bottom });
		}
		return nearestVerticalTarget(targets, clientY, MOBILE_TOUCH_ROW_SLOP);
	}

	private commitMove(
		source: ListBlock,
		target: DropTarget,
		ghost: HTMLElement,
		placeholder: HTMLElement,
		sharedElementHandoff: boolean,
		desktopPrelanded = false,
	): boolean {
		// Preserve the positions that are actually on screen before cancelling an
		// in-flight visual projection. Clearing it and applying the document edit
		// synchronously prevents a frame where rows snap back to their old positions.
		const visualTops = this.captureVisibleRowTops();
		this.clearProjectedLayout(placeholder);
		const info = this.view.state.field(editorInfoField, false);
		const editor = info?.editor;
		if (!editor) return false;
		const moved = applyEditorMove(
			editor,
			source,
			target.block,
			target.side,
			this.getSettings().cursorPlacement,
			(result) => {
				this.prepareRowTransition(
					source,
					result,
					ghost,
					visualTops,
					sharedElementHandoff,
					desktopPrelanded,
				);
			},
			(cursor) => {
				this.cursorRestoreFrame = this.viewWindow.requestAnimationFrame(() => {
					this.cursorRestoreFrame = null;
					editor.setCursor(cursor);
				});
			},
		);
		return moved;
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

	private captureVisibleRowTops(): Map<number, number> {
		const scrollTop = this.view.scrollDOM.scrollTop;
		const tops = new Map<number, number>();
		for (const [lineIndex, row] of this.visibleRows(this.view)) {
			tops.set(lineIndex, row.getBoundingClientRect().top + scrollTop);
		}
		return tops;
	}

	private scheduleRowsFromCapturedTops(oldTops: ReadonlyMap<number, number>): void {
		if (this.viewWindow.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		this.view.requestMeasure({
			read: (view): MeasuredRowTransition[] => {
				const rows = this.visibleRows(view);
				const scrollTop = view.scrollDOM.scrollTop;
				const newTops = new Map<number, number>();
				for (const [lineIndex, row] of rows) {
					newTops.set(lineIndex, row.getBoundingClientRect().top + scrollTop);
				}
				return calculateProjectionDeltas(oldTops, newTops).flatMap(({ newLineIndex, deltaY }) => {
					const element = rows.get(newLineIndex);
					return element ? [{ element, deltaY }] : [];
				});
			},
			write: (measurements): void => { this.animateRows(measurements); },
		});
	}

	private prepareRowTransition(
		source: ListBlock,
		result: MoveResult,
		ghost: HTMLElement | null,
		visualTops: Map<number, number>,
		sharedElementHandoff: boolean,
		desktopPrelanded: boolean,
	): void {
		this.pendingRowTransition = null;
		this.cancelRowAnimations();
		if (this.viewWindow.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			ghost?.remove();
			return;
		}
		this.pendingRowTransition = {
			oldTops: visualTops,
			originalLineIndexes: result.originalLineIndexes,
			movingStart: source.start - 1,
			movingEnd: source.end - 1,
			destinationLineIndex: result.insertionIndex,
			movedLineCount: source.end - source.start + 1,
			ghost,
			sharedElementHandoff,
			desktopPrelanded,
		};
	}

	private scheduleRowTransition(transition: PendingRowTransition): void {
		this.view.requestMeasure({
			read: (view): MeasuredDropTransition => {
				const rows = this.visibleRows(view);
				const scrollTop = view.scrollDOM.scrollTop;
				const newTops = new Map<number, number>();
				for (const [lineIndex, row] of rows) {
					newTops.set(lineIndex, row.getBoundingClientRect().top + scrollTop);
				}
				const rowTransitions = calculateRowDeltas(
					transition.oldTops,
					newTops,
					transition.originalLineIndexes,
					transition.movingStart,
					transition.movingEnd,
				).flatMap(({ newLineIndex, deltaY }) => {
					const element = rows.get(newLineIndex);
					return element ? [{ element, deltaY }] : [];
				});
				const destinationElements: HTMLElement[] = [];
				for (let offset = 0; offset < transition.movedLineCount; offset += 1) {
					const destination = rows.get(transition.destinationLineIndex + offset);
					if (destination) destinationElements.push(destination);
				}
				const ghostTransition = transition.ghost
					? this.measureGhostTransition(transition.ghost, destinationElements)
					: null;
				return { rows: rowTransitions, ghost: ghostTransition };
			},
			write: (measurement): void => {
				this.animateRows(measurement.rows);
				if (transition.desktopPrelanded && transition.ghost) {
					this.scheduleDesktopGhostReveal(transition.ghost, measurement.ghost);
				}
				else if (measurement.ghost) {
					if (transition.sharedElementHandoff) {
						this.animateDestinationRows(measurement.ghost.destinationElements);
					}
					this.animateGhostLanding(measurement.ghost, transition.sharedElementHandoff);
				}
				else if (transition.ghost) this.removeGhost(transition.ghost, true);
			},
		});
	}

	private scheduleGhostReturn(source: ListBlock, ghost: HTMLElement): void {
		if (this.viewWindow.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			ghost.remove();
			return;
		}
		this.view.requestMeasure({
			read: (view): MeasuredGhostTransition | null => {
				const rows = this.visibleRows(view);
				const destinationElements: HTMLElement[] = [];
				for (let line = source.start - 1; line < source.end; line += 1) {
					const destination = rows.get(line);
					if (destination) destinationElements.push(destination);
				}
				return this.measureGhostTransition(ghost, destinationElements);
			},
			write: (measurement): void => {
				if (!measurement) {
					this.removeGhost(ghost, true);
					return;
				}
				this.animateDestinationRows(measurement.destinationElements);
				this.animateGhostLanding(measurement, true);
			},
		});
	}

	private measureGhostTransition(
		ghost: HTMLElement,
		destinationElements: readonly HTMLElement[],
	): MeasuredGhostTransition | null {
		if (!ghost.isConnected || destinationElements.length === 0) return null;
		const firstGhostRow = ghost.querySelector<HTMLElement>(".drag-and-drop-lists-ghost-row");
		const firstDestinationRow = destinationElements[0] ?? null;
		const sourceAnchor = findLandingAnchor(firstGhostRow) ?? firstGhostRow;
		const targetAnchor = findLandingAnchor(firstDestinationRow) ?? firstDestinationRow;
		if (!sourceAnchor || !targetAnchor) return null;
		const computedStyle = this.viewWindow.getComputedStyle(ghost);
		const sourceAnchorRect = sourceAnchor.getBoundingClientRect();
		const targetAnchorRect = targetAnchor.getBoundingClientRect();
		return Object.assign(
			{
				element: ghost,
				destinationElements: [...destinationElements],
				backgroundColor: computedStyle.backgroundColor,
				borderColor: computedStyle.borderTopColor,
				boxShadow: computedStyle.boxShadow,
				anchorDeltaX: targetAnchorRect.left - sourceAnchorRect.left,
				anchorDeltaY: targetAnchorRect.top - sourceAnchorRect.top,
			},
			calculateGhostLanding(
				ghost.getBoundingClientRect(),
				sourceAnchorRect,
				targetAnchorRect,
			),
		);
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

	private animateDestinationRows(elements: readonly HTMLElement[]): void {
		for (const element of elements) {
			const animation = element.animate(
				[
					{ offset: 0, opacity: 0 },
					{ offset: 0.7, opacity: 0 },
					{ offset: 1, opacity: 1 },
				],
				{
					duration: GHOST_TOUCH_LANDING_DURATION_MS,
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

	private scheduleDesktopGhostReveal(
		ghost: HTMLElement,
		measurement: MeasuredGhostTransition | null,
	): void {
		if (measurement) {
			// Reconcile the prediction with CodeMirror's rendered marker before the
			// browser paints the committed document. Position offsets do not compete
			// with the completed landing animation's translate/scale properties.
			ghost.setCssProps({
				"--drag-and-drop-lists-landing-correction-x": `${measurement.anchorDeltaX}px`,
				"--drag-and-drop-lists-landing-correction-y": `${measurement.anchorDeltaY}px`,
			});
		}
		this.exitingGhosts.add(ghost);
		const waitForStableFrame = (framesRemaining: number): void => {
			const frame = this.viewWindow.requestAnimationFrame(() => {
				this.ghostRevealFrames.delete(frame);
				if (!ghost.isConnected) {
					this.exitingGhosts.delete(ghost);
					return;
				}
				if (framesRemaining > 1) {
					waitForStableFrame(framesRemaining - 1);
					return;
				}
				ghost.remove();
				this.exitingGhosts.delete(ghost);
			});
			this.ghostRevealFrames.add(frame);
		};
		waitForStableFrame(DESKTOP_RENDER_SETTLE_FRAMES);
	}

	private animateGhostEntry(
		element: HTMLElement,
		source: GhostPickupSource,
		touchPointer: boolean,
	): void {
		if (this.viewWindow.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const firstRow = element.querySelector<HTMLElement>(".drag-and-drop-lists-ghost-row");
		if (!firstRow) return;
		const firstAnchor = findLandingAnchor(firstRow) ?? firstRow;
		const { deltaX, deltaY } = calculateGhostPickup(
			firstAnchor.getBoundingClientRect(),
			source.anchorRect,
		);
		const computedStyle = this.viewWindow.getComputedStyle(element);
		element.addClass("drag-and-drop-lists-ghost-entering");
		const animation = element.animate(
			[
				{
					offset: 0,
					translate: `${deltaX}px ${deltaY}px`,
					scale: "1 1",
					opacity: 1,
					backgroundColor: source.backgroundColor,
					borderColor: "transparent",
					borderRadius: source.borderRadius,
					boxShadow: "none",
				},
				{
					offset: 1,
					translate: "0 0",
					scale: "1 1",
					opacity: 0.96,
					backgroundColor: computedStyle.backgroundColor,
					borderColor: computedStyle.borderTopColor,
					borderRadius: computedStyle.borderRadius,
					boxShadow: computedStyle.boxShadow,
				},
			],
			{
				duration: touchPointer ? GHOST_TOUCH_ENTRY_DURATION_MS : GHOST_ENTRY_DURATION_MS,
				easing: "ease-in-out",
				fill: "both",
			},
		);
		this.ghostEntryAnimations.set(element, animation);
		const clearEntry = (): void => {
			element.removeClass("drag-and-drop-lists-ghost-entering");
			if (this.ghostEntryAnimations.get(element) === animation) {
				this.ghostEntryAnimations.delete(element);
			}
		};
		animation.onfinish = (): void => {
			clearEntry();
			// The final keyframe matches the preview's base styles, so releasing the
			// filled effect avoids keeping a completed animation alive while dragging.
			animation.cancel();
		};
		animation.oncancel = clearEntry;
	}

	private animateGhostToPointer(element: HTMLElement, sourceContent: DOMRect): void {
		if (this.viewWindow.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const firstRow = element.querySelector<HTMLElement>(".drag-and-drop-lists-ghost-row");
		if (!firstRow) return;
		const { deltaX, deltaY } = calculateGhostPickup(
			firstRow.getBoundingClientRect(),
			sourceContent,
		);
		const animation = element.animate(
			[
				{ translate: `${deltaX}px ${deltaY}px` },
				{ translate: "0 0" },
			],
			{
				duration: GHOST_TOUCH_PICKUP_DURATION_MS,
				easing: "cubic-bezier(0.2, 0, 0, 1)",
				fill: "both",
			},
		);
		this.ghostEntryAnimations.set(element, animation);
		const clearEntry = (): void => {
			if (this.ghostEntryAnimations.get(element) === animation) {
				this.ghostEntryAnimations.delete(element);
			}
		};
		animation.onfinish = (): void => {
			clearEntry();
			animation.cancel();
		};
		animation.oncancel = clearEntry;
	}

	private animateDesktopPrecommitLanding(
		measurement: MeasuredGhostTransition,
		onFinish: () => void,
	): Animation {
		const {
			element,
			deltaX,
			deltaY,
			midDeltaX,
			midDeltaY,
			scaleX,
			scaleY,
			backgroundColor,
			borderColor,
			boxShadow,
		} = measurement;
		this.cancelGhostEntryAnimation(element);
		element.removeClass("drag-and-drop-lists-ghost-pending");
		element.addClass("drag-and-drop-lists-ghost-settling");
		const midScaleX = 1 - (1 - scaleX) * 0.28;
		const midScaleY = 1 - (1 - scaleY) * 0.18;
		const animation = element.animate(
			[
				{
					offset: 0,
					translate: "0 0",
					scale: "1 1",
					opacity: 0.96,
					backgroundColor,
					borderColor,
					boxShadow,
				},
				{
					offset: 0.58,
					translate: `${midDeltaX}px ${midDeltaY}px`,
					scale: `${midScaleX} ${midScaleY}`,
					opacity: 1,
					backgroundColor,
					borderColor: "transparent",
					boxShadow: "none",
				},
				{
					offset: 1,
					translate: `${deltaX}px ${deltaY}px`,
					scale: `${scaleX} ${scaleY}`,
					opacity: 1,
					backgroundColor,
					borderColor: "transparent",
					boxShadow: "none",
				},
			],
			{
				duration: GHOST_DESKTOP_LANDING_DURATION_MS,
				easing: "cubic-bezier(0.2, 0, 0, 1)",
				fill: "forwards",
			},
		);
		animation.onfinish = onFinish;
		return animation;
	}

	private animateGhostLanding(
		measurement: MeasuredGhostTransition,
		sharedElementHandoff: boolean,
	): void {
		const {
			element,
			deltaX,
			deltaY,
			midDeltaX,
			midDeltaY,
			scaleX,
			scaleY,
			backgroundColor,
			borderColor,
			boxShadow,
		} = measurement;
		this.cancelGhostEntryAnimation(element);
		element.removeClass("drag-and-drop-lists-ghost-pending");
		element.addClass("drag-and-drop-lists-ghost-settling");
		this.exitingGhosts.add(element);
		const midScaleX = 1 - (1 - scaleX) * 0.28;
		const midScaleY = 1 - (1 - scaleY) * 0.18;
		const keyframes: Keyframe[] = sharedElementHandoff
			? [
				{
					offset: 0,
					translate: "0 0",
					scale: "1 1",
					opacity: 0.96,
					backgroundColor,
					borderColor,
					boxShadow,
				},
				{
					offset: 0.52,
					translate: `${midDeltaX}px ${midDeltaY}px`,
					scale: `${midScaleX} ${midScaleY}`,
					opacity: 0.96,
				},
				{
					offset: 0.78,
					translate: `${deltaX}px ${deltaY}px`,
					scale: `${scaleX} ${scaleY}`,
					opacity: 0.96,
					backgroundColor: "transparent",
					borderColor: "transparent",
					boxShadow: "none",
				},
				{
					offset: 1,
					translate: `${deltaX}px ${deltaY}px`,
					scale: `${scaleX} ${scaleY}`,
					opacity: 0,
					backgroundColor: "transparent",
					borderColor: "transparent",
					boxShadow: "none",
				},
			]
			: [
				{
					offset: 0,
					translate: "0 0",
					scale: "1 1",
					opacity: 0.9,
					backgroundColor,
					borderColor,
					boxShadow,
				},
				{
					offset: 0.48,
					translate: `${midDeltaX}px ${midDeltaY}px`,
					scale: `${midScaleX} ${midScaleY}`,
					opacity: 0.42,
					backgroundColor: "transparent",
					borderColor: "transparent",
					boxShadow: "none",
				},
				{
					offset: 1,
					translate: `${deltaX}px ${deltaY}px`,
					scale: `${scaleX} ${scaleY}`,
					opacity: 0,
					backgroundColor: "transparent",
					borderColor: "transparent",
					boxShadow: "none",
				},
			];
		const animation = element.animate(
			keyframes,
			{
				duration: sharedElementHandoff
					? GHOST_TOUCH_LANDING_DURATION_MS
					: GHOST_DESKTOP_LANDING_DURATION_MS,
				easing: "cubic-bezier(0.2, 0, 0, 1)",
				fill: "forwards",
			},
		);
		this.ghostLandingAnimations.set(element, animation);
		const removeLandedGhost = (): void => {
			element.remove();
			this.exitingGhosts.delete(element);
			if (this.ghostLandingAnimations.get(element) === animation) {
				this.ghostLandingAnimations.delete(element);
			}
		};
		animation.onfinish = removeLandedGhost;
		animation.oncancel = removeLandedGhost;
	}

	private cancelGhostLandingAnimations(): void {
		for (const animation of this.ghostLandingAnimations.values()) animation.cancel();
		this.ghostLandingAnimations.clear();
	}

	private cancelGhostEntryAnimation(element: HTMLElement): void {
		this.ghostEntryAnimations.get(element)?.cancel();
		this.ghostEntryAnimations.delete(element);
	}

	private cancelGhostEntryAnimations(): void {
		for (const animation of this.ghostEntryAnimations.values()) animation.cancel();
		this.ghostEntryAnimations.clear();
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
		this.cancelGhostEntryAnimation(ghost);
		ghost.removeClass("drag-and-drop-lists-ghost-pending");
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
		this.cancelGhostEntryAnimations();
		this.cancelGhostLandingAnimations();
		for (const frame of this.ghostRevealFrames) this.viewWindow.cancelAnimationFrame(frame);
		this.ghostRevealFrames.clear();
		for (const timer of this.ghostExitTimers) this.viewWindow.clearTimeout(timer);
		this.ghostExitTimers.clear();
		for (const ghost of this.exitingGhosts) ghost.remove();
		this.exitingGhosts.clear();
	}

	private nearestTouchHandle(clientX: number, clientY: number): TouchHandleTarget | null {
		const targets: TouchTargetGeometry<TouchHandleTarget>[] = [];
		for (const row of this.view.contentDOM.querySelectorAll<HTMLElement>(LIST_LINE_SELECTOR)) {
			const handle = row.querySelector<HTMLElement>(TASK_HANDLE_SELECTOR)
				?? row.querySelector<HTMLElement>(HANDLE_SELECTOR);
			if (!handle) continue;
			const originElement = handleOriginElement(handle);
			const rect = originElement.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) continue;
			targets.push({
				value: { handle, originElement, row },
				centerX: rect.left + rect.width / 2,
				centerY: rect.top + rect.height / 2,
			});
		}
		return nearestTouchTarget(targets, clientX, clientY, MOBILE_TOUCH_HIT_RADIUS);
	}

	private claimTouchOwnership(): void {
		// Obsidian's guarded mobile swipe recognizer skips a touch whose event
		// path contains this marker. Keep it scoped to this one physical touch.
		if (!this.view.dom.hasAttribute("data-ignore-swipe")) {
			this.view.dom.setAttribute("data-ignore-swipe", "true");
			this.addedIgnoreSwipe = true;
		}
		this.view.dom.addClass("drag-and-drop-lists-touch-owned");
		this.clearNativeSelection();
	}

	private releaseTouchOwnership(): void {
		this.ownedTouch = null;
		this.view.dom.removeClass("drag-and-drop-lists-touch-owned");
		if (this.addedIgnoreSwipe) {
			this.view.dom.removeAttribute("data-ignore-swipe");
			this.addedIgnoreSwipe = false;
		}
	}

	private clearNativeSelection(): void {
		if (!this.ownedTouch) return;
		const selection = this.eventDocument.getSelection();
		const anchorNode = selection?.anchorNode;
		if (anchorNode && this.view.dom.contains(anchorNode)) selection.removeAllRanges();
	}

	private releasePendingPointerCapture(): void {
		const pending = this.pending;
		try {
			if (pending?.captureElement?.hasPointerCapture(pending.pointerId)) {
				pending.captureElement.releasePointerCapture(pending.pointerId);
			}
		} catch {
			// The editor may have recycled a captured handle during a document or viewport update.
		}
	}

	private cleanup(dispatchEffects = true): void {
		const context = this.context;
		const projectionTops = dispatchEffects && context
			? this.captureVisibleRowTops()
			: null;
		if (this.autoScrollTimer !== null) {
			this.viewWindow.clearTimeout(this.autoScrollTimer);
			this.autoScrollTimer = null;
		}
		const pending = this.pending;
		this.clearPendingSourceRows();
		this.releasePendingPointerCapture();
		this.context = null;
		this.pending = null;
		if (pending?.preview) this.removeGhost(pending.preview, dispatchEffects);
		if (context) {
			this.clearProjectedLayout(context.placeholder);
			this.removeGhost(context.ghost, dispatchEffects);
		}
		else this.clearProjectedLayout();
		this.view.dom.removeClass("drag-and-drop-lists-touch-pending");
		this.view.dom.removeClass("drag-and-drop-lists-active");
		this.view.dom.removeClass("drag-and-drop-lists-invalid");
		if (projectionTops) this.scheduleRowsFromCapturedTops(projectionTops);
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
			(view) => new DragController(
				view,
				() => this.settings,
			),
			{ decorations: (controller) => controller.quoteHandleDecorations },
		);
		this.registerEditorExtension(dragExtension);
		this.addCommand({
			id: "cycle-list-item-type",
			name: "Cycle current list item type",
			icon: "list-checks",
			mobileOnly: true,
			editorCheckCallback: (checking, editor) => this.cycleCurrentListItemType(editor, checking),
		});
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

	private cycleCurrentListItemType(editor: Editor, checking: boolean): boolean {
		const cursor = editor.getCursor();
		const original = editor.getLine(cursor.line);
		const replacement = cycleListItemStatus(original);
		if (replacement === null) return false;
		if (!checking) {
			const originalContentLength = parseListLine(original)?.content.length ?? 0;
			const replacementContentLength = parseListLine(replacement)?.content.length ?? 0;
			const originalContentStart = original.length - originalContentLength;
			const replacementContentStart = replacement.length - replacementContentLength;
			const cursorOffset = Math.max(0, cursor.ch - originalContentStart);
			const nextCursor = {
				line: cursor.line,
				ch: cursor.ch >= originalContentStart
					? replacementContentStart + cursorOffset
					: Math.min(cursor.ch, replacementContentStart),
			};
			editor.transaction({
				changes: [{
					from: { line: cursor.line, ch: 0 },
					to: { line: cursor.line, ch: original.length },
					text: replacement,
				}],
				selection: { from: nextCursor },
			}, PLUGIN_ID);
		}
		return true;
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
