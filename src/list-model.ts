export interface ListBlock {
	start: number;
	end: number;
	quotePrefix: string;
	quoteDepth: number;
	indent: string;
}

export interface ParsedListLine {
	quotePrefix: string;
	quoteDepth: number;
	indent: string;
	marker: string;
	taskStatus: string | null;
	content: string;
}

export interface MoveResult {
	lines: string[];
	insertionIndex: number;
	originalLineIndexes: number[];
}

export type DropSide = "before" | "after";

const LIST_LINE_PATTERN = /^((?:(?: {0,3}|\t)>[ \t]?)*)([ \t]*)([-+*]|\d{1,9}[.)])[ \t]+(?:\[([^\]\r\n]*)\][ \t]+)?(.*)$/;
const CONTAINER_PATTERN = /^((?:(?: {0,3}|\t)>[ \t]?)*)([ \t]*)(.*)$/;
const QUOTE_SEGMENT_PATTERN = /^(?: {0,3}|\t)>[ \t]?/;

function quoteDepth(prefix: string): number {
	let depth = 0;
	for (const character of prefix) {
		if (character === ">") depth += 1;
	}
	return depth;
}

export function indentationWidth(value: string): number {
	let width = 0;
	for (const character of value) width += character === "\t" ? 4 : 1;
	return width;
}

export function lineIndent(line: string): string {
	return /^[ \t]*/.exec(line)?.[0] ?? "";
}

export function parseListLine(line: string): ParsedListLine | null {
	const match = LIST_LINE_PATTERN.exec(line);
	if (!match) return null;
	const quotePrefix = match[1] ?? "";
	return {
		quotePrefix,
		quoteDepth: quoteDepth(quotePrefix),
		indent: match[2] ?? "",
		marker: match[3] ?? "-",
		taskStatus: match[4] ?? null,
		content: match[5] ?? "",
	};
}

function parseContainerLine(line: string): {
	quotePrefix: string;
	quoteDepth: number;
	indent: string;
	content: string;
} {
	const match = CONTAINER_PATTERN.exec(line);
	const quotePrefix = match?.[1] ?? "";
	return {
		quotePrefix,
		quoteDepth: quoteDepth(quotePrefix),
		indent: match?.[2] ?? "",
		content: match?.[3] ?? line,
	};
}

function isSemanticBlank(line: string): boolean {
	return parseContainerLine(line).content.trim().length === 0;
}

export function findListBlock(lines: readonly string[], lineIndex: number): ListBlock | null {
	const source = lines[lineIndex];
	if (source === undefined) return null;
	const item = parseListLine(source);
	if (!item) return null;
	const baseWidth = indentationWidth(item.indent);
	let end = lineIndex;

	for (let index = lineIndex + 1; index < lines.length; index += 1) {
		const candidate = lines[index] ?? "";
		if (isSemanticBlank(candidate)) {
			continue;
		}

		const candidateItem = parseListLine(candidate);
		if (candidateItem) {
			if (candidateItem.quoteDepth < item.quoteDepth) break;
			if (candidateItem.quoteDepth === item.quoteDepth
				&& indentationWidth(candidateItem.indent) <= baseWidth) break;
			end = index;
			continue;
		}

		const container = parseContainerLine(candidate);
		if (container.quoteDepth < item.quoteDepth) break;
		const outerPrefixEnd = consumeQuoteSegments(candidate, item.quoteDepth);
		const nestedContainerIndent = outerPrefixEnd === null ? "" : lineIndent(candidate.slice(outerPrefixEnd));
		const isDeeperContainer = container.quoteDepth > item.quoteDepth
			&& indentationWidth(nestedContainerIndent) > baseWidth;
		if (container.quoteDepth > item.quoteDepth && !isDeeperContainer) break;
		const isIndentedContinuation = indentationWidth(container.indent) > baseWidth;
		if (!isDeeperContainer && !isIndentedContinuation) break;
		end = index;
	}

	return {
		start: lineIndex + 1,
		end: end + 1,
		quotePrefix: item.quotePrefix,
		quoteDepth: item.quoteDepth,
		indent: item.indent,
	};
}

export function findContainingListBlock(lines: readonly string[], lineIndex: number): ListBlock | null {
	if (lineIndex < 0 || lineIndex >= lines.length) return null;
	for (let candidate = lineIndex; candidate >= 0; candidate -= 1) {
		if (!parseListLine(lines[candidate] ?? "")) continue;
		const block = findListBlock(lines, candidate);
		if (block && lineIndex + 1 >= block.start && lineIndex + 1 <= block.end) return block;
	}
	return null;
}

export function findSiblingListBlock(
	lines: readonly string[],
	source: ListBlock,
	direction: "up" | "down",
): ListBlock | null {
	const sourceWidth = indentationWidth(source.indent);
	if (direction === "up") {
		for (let index = source.start - 2; index >= 0; index -= 1) {
			if (isSemanticBlank(lines[index] ?? "")) continue;
			const item = parseListLine(lines[index] ?? "");
			if (!item) continue;
			if (item.quoteDepth !== source.quoteDepth) return null;
			const width = indentationWidth(item.indent);
			if (width < sourceWidth) return null;
			if (width === sourceWidth) return findListBlock(lines, index);
		}
		return null;
	}

	for (let index = source.end; index < lines.length;) {
		if (isSemanticBlank(lines[index] ?? "")) {
			index += 1;
			continue;
		}
		const item = parseListLine(lines[index] ?? "");
		if (!item || item.quoteDepth !== source.quoteDepth) return null;
		const width = indentationWidth(item.indent);
		if (width < sourceWidth) return null;
		const block = findListBlock(lines, index);
		if (!block) return null;
		if (width === sourceWidth) return block;
		index = block.end;
	}
	return null;
}

function consumeQuoteSegments(line: string, depth: number): number | null {
	let offset = 0;
	for (let index = 0; index < depth; index += 1) {
		const match = QUOTE_SEGMENT_PATTERN.exec(line.slice(offset));
		if (!match) return null;
		offset += match[0].length;
	}
	return offset;
}

function removeIndentWidth(indent: string, widthToRemove: number): string {
	let width = 0;
	for (let index = 0; index < indent.length; index += 1) {
		const nextWidth = width + (indent[index] === "\t" ? 4 : 1);
		if (nextWidth === widthToRemove) return indent.slice(index + 1);
		if (nextWidth > widthToRemove) {
			return " ".repeat(nextWidth - widthToRemove) + indent.slice(index + 1);
		}
		width = nextWidth;
	}
	return "";
}

function reindentLine(line: string, source: ListBlock, target: ListBlock): string {
	if (line.trim().length === 0) return line;
	const outerPrefixEnd = consumeQuoteSegments(line, source.quoteDepth);
	if (outerPrefixEnd === null) return line;
	const rest = line.slice(outerPrefixEnd);
	if (rest.trim().length === 0) return line;
	const indent = lineIndent(rest);
	const relativeIndent = removeIndentWidth(indent, indentationWidth(source.indent));
	return target.quotePrefix + target.indent + relativeIndent + rest.slice(indent.length);
}

export function moveListBlock(
	originalLines: readonly string[],
	source: ListBlock,
	target: ListBlock,
	side: DropSide,
): MoveResult | null {
	if (source.start < 1 || source.end < source.start || source.end > originalLines.length) return null;
	if (target.start < 1 || target.end < target.start || target.end > originalLines.length) return null;
	if (source.quoteDepth !== target.quoteDepth) return null;
	if (target.start >= source.start && target.start <= source.end) return null;

	const sourceIndex = source.start - 1;
	const sourceEnd = source.end;
	const semanticMoved = originalLines.slice(sourceIndex, sourceEnd);
	const semanticMovedIndexes = originalLines.slice(sourceIndex, sourceEnd)
		.map((_, offset) => sourceIndex + offset);
	let removalStart = sourceIndex;
	let removalEnd = sourceEnd;
	let separator: string[] = [];
	let separatorIndexes: number[] = [];

	const lastMovableBlankIndex = originalLines.at(-1) === "" ? originalLines.length - 1 : originalLines.length;
	while (removalEnd < lastMovableBlankIndex && isSemanticBlank(originalLines[removalEnd] ?? "")) {
		removalEnd += 1;
	}
	if (removalEnd > sourceEnd) {
		separator = originalLines.slice(sourceEnd, removalEnd);
		separatorIndexes = originalLines.slice(sourceEnd, removalEnd)
			.map((_, offset) => sourceEnd + offset);
	} else {
		let precedingBlankStart = removalStart;
		while (precedingBlankStart > 0 && isSemanticBlank(originalLines[precedingBlankStart - 1] ?? "")) {
			precedingBlankStart -= 1;
		}
		const previousContentIndex = precedingBlankStart - 1;
		const previousBlock = previousContentIndex >= 0
			? findContainingListBlock(originalLines, previousContentIndex)
			: null;
		const separatorBelongsToList = previousBlock?.quoteDepth === source.quoteDepth
			&& indentationWidth(previousBlock.indent) === indentationWidth(source.indent);
		if (separatorBelongsToList) {
			removalStart = precedingBlankStart;
			separator = originalLines.slice(removalStart, sourceIndex);
			separatorIndexes = originalLines.slice(removalStart, sourceIndex)
				.map((_, offset) => removalStart + offset);
		}
	}

	const removalCount = removalEnd - removalStart;
	const lines = [...originalLines];
	const originalLineIndexes = originalLines.map((_, index) => index);
	const removed = lines.splice(removalStart, removalCount);
	originalLineIndexes.splice(removalStart, removalCount);
	const originalBoundary = side === "before" ? target.start - 1 : target.end;
	let insertionIndex = originalBoundary;
	if (originalBoundary >= removalEnd) insertionIndex -= removalCount;
	else if (originalBoundary > removalStart) insertionIndex = removalStart;
	if (insertionIndex < 0 || insertionIndex > lines.length) return null;

	const reindented = semanticMoved.map((line) => reindentLine(line, source, target));
	const inserted = side === "before"
		? [...reindented, ...separator]
		: [...separator, ...reindented];
	const insertedIndexes = side === "before"
		? [...semanticMovedIndexes, ...separatorIndexes]
		: [...separatorIndexes, ...semanticMovedIndexes];
	if (insertionIndex === removalStart
		&& inserted.length === removed.length
		&& inserted.every((line, index) => line === removed[index])) return null;

	lines.splice(insertionIndex, 0, ...inserted);
	originalLineIndexes.splice(insertionIndex, 0, ...insertedIndexes);
	const semanticInsertionIndex = insertionIndex + (side === "after" ? separator.length : 0);
	return { lines, insertionIndex: semanticInsertionIndex, originalLineIndexes };
}
