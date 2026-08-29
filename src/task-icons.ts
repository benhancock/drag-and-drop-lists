import { getHeroIcon, type HeroIconName } from "./heroicons-micro";
import { calculateIconOverlayGeometry, type IconOverlayGeometry } from "./icon-geometry";
import type { TaskTypeAppearance, TaskTypeDefinition } from "./task-types";

const CHECKBOX_SELECTOR = "input.task-list-item-checkbox";
const ICON_CLASS = "drag-and-drop-lists-task-icon";
const SOURCE_CLASS = "drag-and-drop-lists-task-icon-source";

function statusFromCheckbox(checkbox: HTMLInputElement): string | null {
	const status = checkbox.getAttribute("data-task");
	return status === "" ? " " : status;
}

function setCssPropsIfChanged(element: HTMLElement, properties: Record<string, string>): void {
	for (const [name, value] of Object.entries(properties)) {
		if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
	}
}

function toggleClassIfChanged(element: HTMLElement, name: string, enabled: boolean): void {
	if (element.hasClass(name) !== enabled) element.toggleClass(name, enabled);
}

export function renderHeroIcon(container: HTMLElement, iconName: HeroIconName): void {
	container.empty();
	const definition = getHeroIcon(iconName);
	const svg = container.createSvg("svg", {
		attr: { "aria-hidden": "true", fill: "currentColor", viewBox: "0 0 16 16" },
	});
	for (const [d, evenOdd] of definition.p) {
		svg.createSvg("path", {
			attr: { d, ...(evenOdd ? { "clip-rule": "evenodd", "fill-rule": "evenodd" } : {}) },
		});
	}
	for (const [x, y, width, height, rx] of definition.r ?? []) {
		svg.createSvg("rect", { attr: { height, rx, width, x, y } });
	}
}

export function setTaskIconAppearance(
	container: HTMLElement,
	color: string | null,
	appearance: TaskTypeAppearance,
	borderRadius = "var(--checkbox-radius, var(--radius-s))",
	borderWidth = "var(--checkbox-border-width, var(--border-width, 1px))",
): void {
	const chosenColor = color ?? "var(--interactive-accent)";
	toggleClassIfChanged(container, "drag-and-drop-lists-task-icon-only", appearance !== "filled");
	toggleClassIfChanged(container, "drag-and-drop-lists-task-icon-outlined", appearance === "outlined");
	setCssPropsIfChanged(container, {
		"--drag-and-drop-lists-task-background": appearance === "filled" ? chosenColor : "transparent",
		"--drag-and-drop-lists-task-foreground": appearance === "filled" ? "var(--background-primary)" : chosenColor,
		"--drag-and-drop-lists-task-border-width": borderWidth,
		"--drag-and-drop-lists-task-radius": borderRadius,
	});
}

export interface TaskIconMeasurement {
	checkbox: HTMLInputElement;
	parent: HTMLElement;
	status: string | null;
	taskType: TaskTypeDefinition | undefined;
	geometry: IconOverlayGeometry | null;
	borderRadius: string;
	borderWidth: string;
}

/** Read phase only. All layout reads finish before any icon is inserted/styled. */
export function measureTaskIcons(
	roots: readonly HTMLElement[],
	taskTypes: readonly TaskTypeDefinition[],
): TaskIconMeasurement[] {
	const types = new Map<string, TaskTypeDefinition>();
	for (const type of taskTypes) {
		if (!types.has(type.marker)) types.set(type.marker, type);
		if (type.marker === "x" && !types.has("X")) types.set("X", type);
	}
	const checkboxes = new Set<HTMLInputElement>();
	for (const root of roots) {
		if (root.matches(CHECKBOX_SELECTOR)) checkboxes.add(root as HTMLInputElement);
		for (const checkbox of root.querySelectorAll<HTMLInputElement>(CHECKBOX_SELECTOR)) checkboxes.add(checkbox);
	}
	const measurements: TaskIconMeasurement[] = [];
	const parents = new Map<HTMLElement, { rect: DOMRect; left: number; top: number }>();
	for (const checkbox of checkboxes) {
		const status = statusFromCheckbox(checkbox);
		const taskType = types.get(status ?? "");
		const parent = checkbox.parentElement;
		if (!parent) continue;
		if (!taskType) {
			if (checkbox.hasClass(SOURCE_CLASS) || checkbox.nextElementSibling?.hasClass(ICON_CLASS)) {
				measurements.push({ checkbox, parent, status, taskType, geometry: null, borderRadius: "", borderWidth: "" });
			}
			continue;
		}
		let parentGeometry = parents.get(parent);
		if (!parentGeometry) {
			parentGeometry = { rect: parent.getBoundingClientRect(), left: parent.clientLeft, top: parent.clientTop };
			parents.set(parent, parentGeometry);
		}
		const geometry = calculateIconOverlayGeometry(
			checkbox.getBoundingClientRect(), parentGeometry.rect, parentGeometry.left, parentGeometry.top,
		);
		const style = checkbox.ownerDocument.defaultView?.getComputedStyle(checkbox);
		measurements.push({
			checkbox, parent, status, taskType, geometry,
			borderRadius: style?.borderRadius ?? "",
			borderWidth: style?.borderTopWidth ?? "",
		});
	}
	return measurements;
}

/** Write phase only. Unchanged icons cause no DOM/style writes. */
export function applyTaskIcons(root: HTMLElement, measurements: readonly TaskIconMeasurement[]): void {
	for (const { checkbox, parent, status, taskType, geometry, borderRadius, borderWidth } of measurements) {
		// Another editor/component may have replaced a widget after the read phase.
		if (!root.contains(checkbox) || checkbox.parentElement !== parent || statusFromCheckbox(checkbox) !== status) continue;
		let icon = checkbox.nextElementSibling?.hasClass(ICON_CLASS)
			? checkbox.nextElementSibling as HTMLElement : null;
		if (!taskType) {
			toggleClassIfChanged(checkbox, SOURCE_CLASS, false);
			icon?.remove();
			continue;
		}
		// Hidden panes have no measurable checkbox yet. Keep the native marker
		// until the editor's visibility/geometry update schedules another pass.
		if (!geometry) continue;
		if (!icon) {
			icon = parent.createSpan({ cls: ICON_CLASS, attr: { "aria-hidden": "true" } });
			checkbox.insertAdjacentElement("afterend", icon);
		}
		if (icon.getAttribute("data-icon-id") !== taskType.icon) {
			renderHeroIcon(icon, taskType.icon);
			icon.setAttribute("data-icon-id", taskType.icon);
		}
		setTaskIconAppearance(
			icon, taskType.color, taskType.appearance, borderRadius || undefined, borderWidth || undefined,
		);
		setCssPropsIfChanged(icon, {
			"--drag-and-drop-lists-task-height": `${geometry.height}px`,
			"--drag-and-drop-lists-task-left": `${geometry.left}px`,
			"--drag-and-drop-lists-task-top": `${geometry.top}px`,
			"--drag-and-drop-lists-task-width": `${geometry.width}px`,
		});
		toggleClassIfChanged(icon, "drag-and-drop-lists-task-icon-measured", true);
		toggleClassIfChanged(checkbox, SOURCE_CLASS, true);
	}
}

/** Drag previews need immediate alignment, but still batch their reads/writes. */
export function syncTaskIcons(root: HTMLElement, taskTypes: readonly TaskTypeDefinition[]): void {
	applyTaskIcons(root, measureTaskIcons([root], taskTypes));
}

export function clearTaskIcons(root: HTMLElement): void {
	for (const icon of root.querySelectorAll<HTMLElement>(`.${ICON_CLASS}`)) icon.remove();
	for (const checkbox of root.querySelectorAll<HTMLElement>(`.${SOURCE_CLASS}`)) checkbox.removeClass(SOURCE_CLASS);
}

/** Return only affected task rows, never rescan the note for unrelated text. */
export function taskIconMutationRoots(records: readonly MutationRecord[], content: HTMLElement): HTMLElement[] {
	const roots = new Set<HTMLElement>();
	const include = (node: Node): void => {
		const element = node.nodeType === 1 ? node as HTMLElement : node.parentElement;
		if (!element || !content.contains(element)) return;
		const row = element.closest<HTMLElement>(".cm-line") ?? element;
		if (row.matches(CHECKBOX_SELECTOR) || row.querySelector(CHECKBOX_SELECTOR)) roots.add(row);
	};
	for (const record of records) {
		if (record.type === "attributes" || record.type === "characterData") {
			include(record.target);
		} else if (record.type === "childList") {
			const target = record.target.nodeType === 1 ? record.target as HTMLElement : record.target.parentElement;
			if (target?.closest(".cm-line")) include(target);
			// Whole rows/blocks can be inserted at the content root during loading
			// and virtualization. Removed subtrees need no icon work.
			else for (const node of record.addedNodes) include(node);
		}
	}
	return [...roots];
}
