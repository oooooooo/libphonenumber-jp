// Measures bundle size and throughput against libphonenumber-js, then rewrites
// the tables in README.md between the `benchmark` markers.
// Run with `npm run benchmark`.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = join(ROOT, "dist", "esm", "index.js");
const NAME = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).name;
// The tables read better without the scope; the install command still needs it.
const SHORT = NAME.replace(/^@[^/]+\//, "");

// The three functions a typical caller reaches for. Bundling exactly the same
// imports from each library is what makes the sizes comparable.
const IMPORTS = [
	"parsePhoneNumberFromString",
	"isValidPhoneNumber",
	"validatePhoneNumberLength",
];

const TARGETS = [
	{ label: "`libphonenumber-js/max`", specifier: "libphonenumber-js/max" },
	{ label: "`libphonenumber-js/min`", specifier: "libphonenumber-js/min" },
	{ label: `**\`${SHORT}\`**`, specifier: SELF, self: true },
];

async function measureSize(specifier) {
	const result = await build({
		stdin: {
			contents: `import { ${IMPORTS.join(", ")} } from ${JSON.stringify(specifier)}\nglobalThis.keep = [${IMPORTS.join(", ")}]\n`,
			resolveDir: ROOT,
			loader: "js",
		},
		bundle: true,
		minify: true,
		format: "esm",
		write: false,
	});
	const bytes = result.outputFiles[0].contents;
	return {
		minified: bytes.length,
		gzip: gzipSync(bytes, { level: 9 }).length,
		brotli: brotliCompressSync(bytes).length,
	};
}

// A realistic mix: geographic numbers of every area-code length, mobile, IP
// phone, toll free, international forms, and input that should be rejected.
const NUMBERS = [
	"0312345678",
	"0664321234",
	"0451234567",
	"0112345678",
	"0422451234",
	"0463123456",
	"0123456789",
	"0126712345",
	"09012345678",
	"08012345678",
	"07012345678",
	"05012345678",
	"0120123456",
	"08001234567",
	"0570123456",
	"0201234567",
	"+81312345678",
	"+81 90 1234 5678",
	"81312345678",
	"03-1234-5678",
	"０９０－１２３４－５６７８",
	"03-1234-5678 ext. 12",
	"0312345",
];

const OPERATIONS = [
	[
		"parse",
		(lib) => {
			for (const n of NUMBERS) lib.parsePhoneNumberFromString(n, "JP");
		},
	],
	[
		"parse + formatNational",
		(lib) => {
			for (const n of NUMBERS)
				lib.parsePhoneNumberFromString(n, "JP")?.formatNational();
		},
	],
	[
		"parse + getType",
		(lib) => {
			for (const n of NUMBERS)
				lib.parsePhoneNumberFromString(n, "JP")?.getType();
		},
	],
	[
		"isValidPhoneNumber",
		(lib) => {
			for (const n of NUMBERS) lib.isValidPhoneNumber(n, "JP");
		},
	],
	[
		"validatePhoneNumberLength",
		(lib) => {
			for (const n of NUMBERS) lib.validatePhoneNumberLength(n, "JP");
		},
	],
];

const ITERATIONS = 2000;
const ROUNDS = 5;

/** Numbers per second, taking the fastest round so background noise only ever costs. */
function throughput(operation, lib) {
	operation(lib); // let the JIT and the pattern caches warm up
	let fastest = Number.POSITIVE_INFINITY;
	for (let round = 0; round < ROUNDS; round++) {
		const start = process.hrtime.bigint();
		for (let i = 0; i < ITERATIONS; i++) operation(lib);
		fastest = Math.min(fastest, Number(process.hrtime.bigint() - start) / 1e9);
	}
	return (ITERATIONS * NUMBERS.length) / fastest;
}

/** Import cost and first call, each measured in a fresh process. */
function coldStart(specifier, samples = 7) {
	const script = `
		const start = process.hrtime.bigint()
		const lib = await import(${JSON.stringify(specifier)})
		const imported = process.hrtime.bigint()
		lib.parsePhoneNumberFromString("0312345678", "JP").formatNational()
		const called = process.hrtime.bigint()
		console.log(Number(imported - start) / 1e6, Number(called - imported) / 1e6)
	`;
	const runs = [];
	for (let i = 0; i < samples; i++) {
		const output = execFileSync(
			process.execPath,
			["--input-type=module", "-e", script],
			{
				cwd: ROOT,
				encoding: "utf8",
			},
		);
		runs.push(output.trim().split(" ").map(Number));
	}
	const median = (values) =>
		values.sort((a, b) => a - b)[Math.floor(samples / 2)];
	return {
		importMs: median(runs.map((r) => r[0])),
		firstCallMs: median(runs.map((r) => r[1])),
	};
}

const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

/** Wraps prose to the width markdownlint expects. Tables are left alone. */
function wrap(text, width = 80) {
	const lines = [""];
	for (const word of text.split(" ")) {
		const line = lines[lines.length - 1];
		if (line && line.length + 1 + word.length > width) lines.push(word);
		else lines[lines.length - 1] = line ? `${line} ${word}` : word;
	}
	return lines.join("\n");
}
const perSecond = (rate) =>
	`${Math.round(rate / 1000).toLocaleString("en-US")}k/s`;

const sizes = [];
for (const target of TARGETS)
	sizes.push({ ...target, ...(await measureSize(target.specifier)) });

const libraries = {};
for (const target of TARGETS)
	libraries[target.specifier] = await import(target.specifier);

const rates = OPERATIONS.map(([label, operation]) => ({
	label,
	theirs: throughput(operation, libraries["libphonenumber-js/max"]),
	ours: throughput(operation, libraries[SELF]),
}));

const cold = {
	theirs: coldStart("libphonenumber-js/max"),
	ours: coldStart(SELF),
};

const tables = `
${wrap(`Bundled with esbuild, importing \`${IMPORTS.join("`, `")}\`:`)}

| | Minified | Gzipped | Brotli |
| --- | --- | --- | --- |
${sizes.map((s) => `| ${s.label} | ${s.self ? `**${kB(s.minified)}**` : kB(s.minified)} | ${s.self ? `**${kB(s.gzip)}**` : kB(s.gzip)} | ${s.self ? `**${kB(s.brotli)}**` : kB(s.brotli)} |`).join("\n")}

${wrap(`Throughput over ${NUMBERS.length} representative numbers, best of ${ROUNDS} rounds:`)}

| Operation | libphonenumber-js/max | ${SHORT} | |
| --- | --- | --- | --- |
${rates.map((r) => `| ${r.label} | ${perSecond(r.theirs)} | **${perSecond(r.ours)}** | ${(r.ours / r.theirs).toFixed(1)}× |`).join("\n")}

Starting up, median of 7 fresh processes:

| | Import | First call |
| --- | --- | --- |
| libphonenumber-js/max | ${cold.theirs.importMs.toFixed(1)} ms | ${cold.theirs.firstCallMs.toFixed(1)} ms |
| **${SHORT}** | **${cold.ours.importMs.toFixed(1)} ms** | **${cold.ours.firstCallMs.toFixed(1)} ms** |

${wrap(`_Measured on Node ${process.version} with \`npm run benchmark\`; absolute numbers vary by machine._`)}
`;

const README = join(ROOT, "README.md");
const readme = readFileSync(README, "utf8");
const START = "<!-- benchmark:start -->";
const END = "<!-- benchmark:end -->";
const from = readme.indexOf(START);
const to = readme.indexOf(END);
if (from < 0 || to < 0)
	throw new Error(`README.md is missing the ${START} / ${END} markers`);

writeFileSync(
	README,
	`${readme.slice(0, from + START.length)}\n${tables}${readme.slice(to)}`,
);
console.log(tables);
console.log(`updated ${README}`);
