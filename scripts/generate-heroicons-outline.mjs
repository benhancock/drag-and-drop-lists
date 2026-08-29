import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const microDirectory = new URL("../node_modules/heroicons/16/solid/", import.meta.url);
const outlineDirectory = new URL("../node_modules/heroicons/24/outline/", import.meta.url);
const outputFile = new URL("../src/heroicons-outline.ts", import.meta.url);

function attributes(source) {
	return Object.fromEntries(
		[...source.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
	);
}

const names = (await readdir(microDirectory))
	.filter((file) => file.endsWith(".svg"))
	.map((file) => basename(file, ".svg"))
	.sort((left, right) => left.localeCompare(right));
const definitions = [];
for (const name of names) {
	const file = `${name}.svg`;
	let source;
	try {
		source = await readFile(join(outlineDirectory.pathname, file), "utf8");
	} catch {
		throw new Error(`Heroicons Outline is missing the Micro icon ${file}`);
	}
	const paths = [...source.matchAll(/<path\b([^>]*)\/>/g)].map((match) => {
		const attrs = attributes(match[1]);
		if (!attrs.d) throw new Error(`Path without d attribute in ${file}`);
		return [attrs.d, attrs["stroke-linecap"] === "round"];
	});
	if (paths.length === 0) throw new Error(`No supported SVG paths in ${file}`);
	definitions.push([name, { p: paths }]);
}

const license = `/*!
Heroicons Outline v2.2.0
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

import type { HeroIconName } from "./heroicons-micro";

export interface HeroIconOutlineDefinition {
	p: readonly (readonly [d: string, roundLineCap: boolean])[];
}

// Match the 316 names offered by the Micro picker. Geometry remains encoded
// until an outlined task type actually displays a particular icon.
const ENCODED_OUTLINE_ICONS = ${JSON.stringify(Object.fromEntries(definitions.map(([name, definition]) => [name, JSON.stringify(definition)])))} as const satisfies Record<HeroIconName, string>;

const decodedIcons = new Map<HeroIconName, HeroIconOutlineDefinition>();

export function getHeroIconOutline(name: HeroIconName): HeroIconOutlineDefinition {
	const cached = decodedIcons.get(name);
	if (cached) return cached;
	const definition = JSON.parse(ENCODED_OUTLINE_ICONS[name]) as HeroIconOutlineDefinition;
	decodedIcons.set(name, definition);
	return definition;
}
`;

await writeFile(outputFile, output);
