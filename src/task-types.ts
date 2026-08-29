import { isHeroIconName, type HeroIconName } from "./heroicons-micro";

export type TaskTypeAppearance = "filled" | "icon-only" | "outlined";

export interface TaskTypeDefinition {
	id: string;
	name: string;
	marker: string;
	icon: HeroIconName;
	color: string | null;
	appearance: TaskTypeAppearance;
}

const NATIVE_TASK_TYPES: readonly TaskTypeDefinition[] = [
	{ id: "unchecked", name: "Unchecked", marker: " ", icon: "minus", color: null, appearance: "filled" },
	{ id: "completed", name: "Completed", marker: "x", icon: "check", color: "#3b82f6", appearance: "filled" },
];

export const DEFAULT_TASK_TYPES: readonly TaskTypeDefinition[] = [
	{ id: "in-progress", name: "In progress", marker: "/", icon: "arrow-path", color: "#f59e0b", appearance: "filled" },
	{ id: "cancelled", name: "Cancelled", marker: "-", icon: "x-mark", color: "#8e8e93", appearance: "filled" },
	{ id: "forwarded", name: "Forwarded", marker: ">", icon: "paper-airplane", color: "#8e8e93", appearance: "filled" },
	{ id: "scheduled", name: "Scheduled", marker: "<", icon: "calendar-days", color: "#8e8e93", appearance: "filled" },
	{ id: "question", name: "Question", marker: "?", icon: "question-mark-circle", color: "#8b5cf6", appearance: "filled" },
	{ id: "important", name: "Important", marker: "!", icon: "exclamation-triangle", color: "#ef4444", appearance: "filled" },
	{ id: "star", name: "Star", marker: "*", icon: "star", color: "#eab308", appearance: "filled" },
];

const NEW_MARKER_CANDIDATES = "~abcdefghijklmnopqrstuvwxyz0123456789";
const LEGACY_ICON_NAMES: Readonly<Record<string, HeroIconName>> = {
	square: "minus",
	"square-check-big": "check",
	"circle-dashed": "arrow-path",
	minus: "minus",
	send: "paper-airplane",
	calendar: "calendar-days",
	"circle-help": "question-mark-circle",
	"circle-alert": "exclamation-triangle",
	star: "star",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function isValidTaskMarker(marker: string): boolean {
	return marker.length === 1 && marker !== "[" && marker !== "]" && marker !== "\t"
		&& marker !== "\r" && marker !== "\n";
}

export function isValidTaskColor(color: string | null): boolean {
	return color === null || /^#[\da-f]{6}$/i.test(color);
}

export function isValidTaskAppearance(value: string): value is TaskTypeAppearance {
	return value === "filled" || value === "icon-only" || value === "outlined";
}

export function cloneDefaultTaskTypes(): TaskTypeDefinition[] {
	return DEFAULT_TASK_TYPES.map((taskType) => ({ ...taskType }));
}

function isNativeDefaultTaskType(taskType: TaskTypeDefinition): boolean {
	return NATIVE_TASK_TYPES.some((nativeTaskType) => (
		taskType.id === nativeTaskType.id
		&& taskType.name === nativeTaskType.name
		&& taskType.marker === nativeTaskType.marker
		&& taskType.icon === nativeTaskType.icon
		&& taskType.color === nativeTaskType.color
		&& taskType.appearance === nativeTaskType.appearance
	));
}

export function sanitizeTaskTypes(value: unknown): TaskTypeDefinition[] {
	if (!Array.isArray(value)) return cloneDefaultTaskTypes();
	const result: TaskTypeDefinition[] = [];
	const usedIds = new Set<string>();
	const usedMarkers = new Set<string>();
	for (const candidate of value) {
		if (!isRecord(candidate)) continue;
		const marker = typeof candidate.marker === "string" ? candidate.marker : "";
		if (!isValidTaskMarker(marker) || usedMarkers.has(marker)) continue;
		const rawId = typeof candidate.id === "string" ? candidate.id.trim() : "";
		const idBase = rawId.length > 0 ? rawId : `task-${result.length + 1}`;
		let id = idBase;
		let suffix = 2;
		while (usedIds.has(id)) {
			id = `${idBase}-${suffix}`;
			suffix += 1;
		}
		const rawName = typeof candidate.name === "string" ? candidate.name.trim() : "";
		const rawIcon = typeof candidate.icon === "string" ? candidate.icon.trim() : "";
		const icon = isHeroIconName(rawIcon) ? rawIcon : LEGACY_ICON_NAMES[rawIcon] ?? "stop";
		const rawColor = typeof candidate.color === "string" ? candidate.color.trim() : null;
		const defaultColor = [...NATIVE_TASK_TYPES, ...DEFAULT_TASK_TYPES].find((taskType) => (
			taskType.id === id && taskType.marker === marker
		))?.color ?? null;
		const appearance = typeof candidate.appearance === "string"
			&& isValidTaskAppearance(candidate.appearance)
			? candidate.appearance
			: "filled";
		const taskType: TaskTypeDefinition = {
			id,
			name: rawName.length > 0 ? rawName : "Custom",
			marker,
			icon,
			color: candidate.color === undefined
				? defaultColor
				: isValidTaskColor(rawColor) ? rawColor?.toLowerCase() ?? null : null,
			appearance,
		};
		if (isNativeDefaultTaskType(taskType)) continue;
		result.push(taskType);
		usedIds.add(id);
		usedMarkers.add(marker);
	}
	return result;
}

export function findAvailableTaskMarker(taskTypes: readonly TaskTypeDefinition[]): string | null {
	const used = new Set([" ", "x", ...taskTypes.map((taskType) => taskType.marker)]);
	for (const marker of NEW_MARKER_CANDIDATES) {
		if (!used.has(marker)) return marker;
	}
	return null;
}

export function taskMarkersForCycle(taskTypes: readonly TaskTypeDefinition[]): string[] {
	const markers = [" ", "x"];
	for (const taskType of taskTypes) {
		if (!markers.includes(taskType.marker)) markers.push(taskType.marker);
	}
	return markers;
}

export function createTaskType(marker: string, idSeed: number): TaskTypeDefinition {
	return {
		id: `custom-${idSeed}-${marker.codePointAt(0) ?? 0}`,
		name: "Custom",
		marker,
		icon: "sparkles",
		color: null,
		appearance: "filled",
	};
}
