import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const sourceDirectory = new URL("../node_modules/heroicons/16/solid/", import.meta.url);
const outputFile = new URL("../src/heroicons-micro.ts", import.meta.url);

function attributes(source) {
	return Object.fromEntries(
		[...source.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
	);
}

const files = (await readdir(sourceDirectory))
	.filter((file) => file.endsWith(".svg"))
	.sort((left, right) => left.localeCompare(right));
const definitions = [];
for (const file of files) {
	const source = await readFile(join(sourceDirectory.pathname, file), "utf8");
	const paths = [...source.matchAll(/<path\b([^>]*)\/>/g)].map((match) => {
		const attrs = attributes(match[1]);
		if (!attrs.d) throw new Error(`Path without d attribute in ${file}`);
		return [attrs.d, attrs["fill-rule"] === "evenodd"];
	});
	const rectangles = [...source.matchAll(/<rect\b([^>]*)\/>/g)].map((match) => {
		const attrs = attributes(match[1]);
		return [attrs.x ?? "0", attrs.y ?? "0", attrs.width ?? "0", attrs.height ?? "0", attrs.rx ?? "0"];
	});
	if (paths.length === 0 && rectangles.length === 0) {
		throw new Error(`No supported SVG elements in ${file}`);
	}
	definitions.push([
		basename(file, ".svg"),
		{ p: paths, ...(rectangles.length > 0 ? { r: rectangles } : {}) },
	]);
}

const license = `/*!
Heroicons Micro v2.2.0
Copyright (c) Tailwind Labs, Inc.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/`;
const output = `${license}

export interface HeroIconDefinition {
	p: readonly (readonly [d: string, evenOdd: boolean])[];
	r?: readonly (readonly [x: string, y: string, width: string, height: string, rx: string])[];
}

// Keep geometry encoded until an icon is actually displayed. Merely validating
// saved names or loading the plugin must not allocate all 316 SVG object trees.
const ENCODED_ICONS = ${JSON.stringify(Object.fromEntries(definitions.map(([name, definition]) => [name, JSON.stringify(definition)])))} as const;

export type HeroIconName = keyof typeof ENCODED_ICONS;

export const HEROICON_MICRO_NAMES = Object.keys(ENCODED_ICONS) as HeroIconName[];
const decodedIcons = new Map<HeroIconName, HeroIconDefinition>();

export function getHeroIcon(name: HeroIconName): HeroIconDefinition {
	const cached = decodedIcons.get(name);
	if (cached) return cached;
	// Generated from the bundled, build-time-validated Heroicons package.
	const definition = JSON.parse(ENCODED_ICONS[name]) as HeroIconDefinition;
	decodedIcons.set(name, definition);
	return definition;
}

export function isHeroIconName(value: string): value is HeroIconName {
	return Object.prototype.hasOwnProperty.call(ENCODED_ICONS, value);
}
`;

await writeFile(outputFile, output);
