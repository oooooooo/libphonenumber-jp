import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import * as full from "libphonenumber-js/max";
import * as data from "../src/data.ts";
import type { CountryCode } from "../src/index.ts";
import * as jp from "../src/index.ts";

// libphonenumber-js exports these at runtime but leaves them out of its types.
const upstream = full as unknown as {
	parseRFC3966(text: string): jp.RFC3966Number;
	formatRFC3966(parts: jp.RFC3966Number): string;
};

/** Everything a parsed number exposes, so one comparison covers the whole object. */
function snapshot(
	number: jp.PhoneNumber | full.PhoneNumber | undefined,
): string {
	if (!number) return "undefined";
	return JSON.stringify([
		number.number,
		number.country,
		number.countryCallingCode,
		number.nationalNumber,
		number.carrierCode ?? null,
		number.ext ?? null,
		number.formatNational(),
		number.formatInternational(),
		number.format("E.164"),
		number.getURI(),
		number.getType() ?? null,
		number.isValid(),
		number.isPossible(),
		number.isNonGeographic(),
		number.getPossibleCountries(),
	]);
}

function thrownMessage(parse: () => unknown): string | undefined {
	try {
		parse();
		return undefined;
	} catch (error) {
		return (error as Error).message;
	}
}

/**
 * Numbers spanning the whole shape of the plan: every four-digit prefix at the
 * two lengths ordinary Japanese numbers have, and every three-digit prefix at
 * the other lengths the plan allows, which only the `00xx` service ranges
 * reach. `010` is left out — it is the prefix for dialling *out* of Japan, so
 * what follows is another country's number, and the test below pins that
 * difference down on its own.
 */
function* japaneseNumbers(): Generator<string> {
	for (const nationalLength of [10, 11]) {
		for (const filler of ["234567890", "987654321"]) {
			for (let prefix = 0; prefix < 10000; prefix++) {
				const head = `0${String(prefix).padStart(4, "0")}`;
				const number = head + filler.slice(0, nationalLength - head.length);
				if (!number.startsWith("010")) yield number;
			}
		}
	}
	for (const nationalLength of [9, 12, 13, 14, 15, 16, 17, 18]) {
		for (let prefix = 0; prefix < 1000; prefix++) {
			const head = `0${String(prefix).padStart(3, "0")}`;
			const number = head + "5".repeat(nationalLength - head.length);
			if (!number.startsWith("010")) yield number;
		}
	}
}

test("parses Japanese numbers exactly like libphonenumber-js/max", () => {
	let recognised = 0;
	for (const number of japaneseNumbers()) {
		const ours = jp.parsePhoneNumberFromString(number, "JP");
		assert.equal(
			snapshot(ours),
			snapshot(full.parsePhoneNumberFromString(number, "JP")),
			number,
		);
		if (ours) recognised++;
	}
	assert.ok(recognised > 5000, `expected a broad corpus, got ${recognised}`);
});

test("validates Japanese numbers exactly like libphonenumber-js/max", () => {
	for (const number of japaneseNumbers()) {
		assert.equal(
			jp.isValidPhoneNumber(number, "JP"),
			full.isValidPhoneNumber(number, "JP"),
			number,
		);
		assert.equal(
			jp.isPossiblePhoneNumber(number, "JP"),
			full.isPossiblePhoneNumber(number, "JP"),
			number,
		);
		assert.equal(
			jp.validatePhoneNumberLength(number, "JP"),
			full.validatePhoneNumberLength(number, "JP"),
			number,
		);
	}
});

test("reports the same parse errors", () => {
	for (const number of japaneseNumbers()) {
		assert.equal(
			thrownMessage(() => jp.parsePhoneNumberWithError(number, "JP")),
			thrownMessage(() => full.parsePhoneNumberWithError(number, "JP")),
			number,
		);
	}
});

/** The shapes a number arrives in, beyond plain national digits. */
function* inputShapes(): Generator<string> {
	const nsns = [
		"312345678",
		"9012345678",
		"126712345",
		"8001234567",
		"120123456",
		"601234567",
		"5012345678",
	];
	for (const nsn of nsns) {
		yield* [
			`0${nsn}`,
			`+81${nsn}`,
			`81${nsn}`,
			`+81 (0)${nsn}`,
			`+81-${nsn}`,
			` 0${nsn} `,
			`0${nsn} ext. 12`,
			`0${nsn}x99`,
			`0${nsn} #123`,
			`0${nsn},,123`,
			`tel:+81${nsn}`,
			`tel:+81${nsn};ext=7`,
			`tel:0${nsn};phone-context=example.com`,
			`call 0${nsn} now`,
		];
	}
	yield* [
		"",
		"+",
		"+8",
		"+81",
		"+810",
		"0",
		"00",
		"abc",
		"０３（１２３４）５６７８",
		"0".repeat(300),
		// Starts with the country code but is already the right length without
		// dropping it, so the "81" stays part of the number.
		"8112345678",
		"8100000000",
	];
}

test("handles international, extension and free-text input the same way", () => {
	for (const text of inputShapes()) {
		for (const country of ["JP", undefined] as const) {
			assert.equal(
				snapshot(jp.parsePhoneNumberFromString(text, country)),
				snapshot(full.parsePhoneNumberFromString(text, country)),
				`${JSON.stringify(text)} / ${country}`,
			);
			assert.equal(
				thrownMessage(() => jp.parsePhoneNumberWithError(text, country)),
				thrownMessage(() => full.parsePhoneNumberWithError(text, country)),
				`${JSON.stringify(text)} / ${country}`,
			);
			assert.equal(
				jp.validatePhoneNumberLength(text, country),
				full.validatePhoneNumberLength(text, country),
				`${JSON.stringify(text)} / ${country}`,
			);
		}
	}
});

test("formats every way libphonenumber-js does", () => {
	const ours = jp.parsePhoneNumberWithError("0312345678", "JP");
	const theirs = full.parsePhoneNumberWithError("0312345678", "JP");
	for (const format of [
		"NATIONAL",
		"INTERNATIONAL",
		"E.164",
		"RFC3966",
	] as const) {
		assert.equal(ours.format(format), theirs.format(format), format);
	}
	ours.setExt("42");
	theirs.setExt("42");
	assert.equal(ours.formatNational(), theirs.formatNational());
	assert.equal(ours.getURI(), theirs.getURI());
	assert.equal(
		ours.formatNational({
			formatExtension: (number, ext) => `${number}（内線${ext}）`,
		}),
		"03-1234-5678（内線42）",
	);
});

test("carries Japan and nothing else", () => {
	assert.deepEqual(jp.getCountries(), ["JP"]);
	assert.equal(jp.isSupportedCountry("JP"), true);
	assert.equal(jp.isSupportedCountry("US"), false);
	assert.equal(jp.getCountryCallingCode("JP"), "81");
	assert.throws(
		() => jp.getCountryCallingCode("US" as CountryCode),
		/Unknown country: US/,
	);
	assert.equal(jp.getExtPrefix("JP"), " ext. ");
	assert.equal(
		jp.getExampleNumber("JP", jp.examples)?.formatNational(),
		"090-1234-5678",
	);
	assert.match(jp.METADATA_VERSION, /^\d+\.\d+\.\d+$/);
});

test("does not recognise numbers from other countries", () => {
	assert.equal(jp.parsePhoneNumberFromString("+12025550173"), undefined);
	// TypeScript rejects a country other than "JP" outright; the cast is what a
	// JavaScript caller would be doing, and it still comes back false.
	const notJapan = "US" as unknown as CountryCode;
	assert.equal(jp.isValidPhoneNumber("2025550173", notJapan), false);
	assert.throws(() => jp.parsePhoneNumberWithError("+12025550173"), {
		message: "INVALID_COUNTRY",
	});
	// libphonenumber-js, with every country's metadata, does recognise it.
	assert.ok(full.parsePhoneNumberFromString("+12025550173"));
});

test("cannot follow 010, the prefix for dialling out of Japan", () => {
	// "010" + a foreign number resolves to that country, which needs its
	// metadata. There is no Japanese number behind "010": the prefix is reserved.
	assert.equal(
		full.parsePhoneNumberFromString("01012025550173", "JP")?.country,
		"US",
	);
	assert.equal(
		jp.parsePhoneNumberFromString("01012025550173", "JP"),
		undefined,
	);
	// Except when the next digit is a zero, which is never a country code: then
	// the prefix is not an IDD prefix after all, and both agree.
	assert.equal(
		jp.parsePhoneNumberFromString("0100000000", "JP")?.number,
		full.parsePhoneNumberFromString("0100000000", "JP")?.number,
	);
});

test("reads a tel: URI with a phone-context, which libphonenumber-js does only every other call", () => {
	// libphonenumber-js validates `phone-context` with a `/g` regular expression
	// and `.test()`, so its `lastIndex` carries over and the answer alternates.
	// Ours is deterministic.
	const uri = "tel:312345678;phone-context=+81";
	for (let attempt = 0; attempt < 4; attempt++) {
		assert.equal(
			jp.parsePhoneNumberFromString(uri)?.formatNational(),
			"03-1234-5678",
		);
	}
	const upstream = [1, 2].map(
		() => full.parsePhoneNumberFromString(uri)?.number,
	);
	assert.notEqual(upstream[0], upstream[1]);
});

test("exposes the parse, format and validate surface of libphonenumber-js", () => {
	const covered = [
		"parsePhoneNumber",
		"parsePhoneNumberWithError",
		"parsePhoneNumberFromString",
		"PhoneNumber",
		"ParseError",
		"isValidPhoneNumber",
		"isPossiblePhoneNumber",
		"validatePhoneNumberLength",
		"getCountries",
		"getCountryCallingCode",
		"getExtPrefix",
		"isSupportedCountry",
		"getExampleNumber",
		"parseDigits",
		"parseIncompletePhoneNumber",
		"parsePhoneNumberCharacter",
		"parseRFC3966",
		"formatRFC3966",
	];
	for (const name of covered) {
		assert.ok(name in jp, `missing ${name}`);
		assert.ok(name in full, `${name} is not a libphonenumber-js export`);
	}
	assert.equal(typeof jp.default, "function");
});

test("reports the number types the README documents", () => {
	const expected: Record<string, string> = {
		"09012345678": "MOBILE",
		"08012345678": "MOBILE",
		"07012345678": "MOBILE",
		"06012345678": "MOBILE",
		"05012345678": "VOIP",
		"02012345678": "PAGER",
		"0312345678": "FIXED_LINE",
		"0120123456": "TOLL_FREE",
		"08001234567": "TOLL_FREE",
		"0570123456": "UAN",
		"0990123456": "PREMIUM_RATE",
		"0601234567": "PERSONAL_NUMBER",
	};
	for (const [number, type] of Object.entries(expected)) {
		assert.equal(
			jp.parsePhoneNumberFromString(number, "JP")?.getType(),
			type,
			number,
		);
		assert.equal(
			full.parsePhoneNumberFromString(number, "JP")?.getType(),
			type,
			number,
		);
	}
});

test("never reports FIXED_LINE_OR_MOBILE, which is what makes === MOBILE safe", () => {
	// Fixed-line numbers are nine digits after the trunk zero and mobile ones are
	// ten, so nothing can match both patterns.
	for (const number of japaneseNumbers()) {
		assert.notEqual(
			jp.parsePhoneNumberFromString(number, "JP")?.getType(),
			"FIXED_LINE_OR_MOBILE",
			number,
		);
	}
});

test("rejects the formats it cannot produce, rather than returning something wrong", () => {
	const number = jp.parsePhoneNumberWithError("0312345678", "JP");
	assert.throws(() => number.format("IDD"), /does not carry/);
	assert.throws(
		() => number.format("NONSENSE" as jp.NumberFormat),
		/Unknown "format" argument/,
	);
});

test("the PhoneNumber constructor says what is wrong", () => {
	assert.throws(() => new jp.PhoneNumber(""), {
		message: "First argument is required",
	});
	assert.throws(
		() => new jp.PhoneNumber("nope"),
		/must consist of a "\+" followed by digits/,
	);
	assert.throws(
		() => new jp.PhoneNumber("+12025550173"),
		/not a Japanese number/,
	);
	assert.throws(() => new jp.PhoneNumber("+81"), /too short/);
	assert.equal(
		new jp.PhoneNumber("+81312345678").formatNational(),
		"03-1234-5678",
	);
});

test("isEqual compares the number and the extension", () => {
	const one = jp.parsePhoneNumberWithError("0312345678", "JP");
	const other = jp.parsePhoneNumberWithError("+81 3 1234 5678");
	assert.equal(one.isEqual(other), true);
	other.setExt("9");
	assert.equal(one.isEqual(other), false);
});

test("the text helpers behave like libphonenumber-js's", () => {
	for (const text of [
		"+81(90)1234-5678",
		"０９０－１２３４",
		"abc+81",
		"03--",
		"+8 1",
	]) {
		assert.equal(jp.parseDigits(text), full.parseDigits(text), text);
		assert.equal(
			jp.parseIncompletePhoneNumber(text),
			full.parseIncompletePhoneNumber(text),
			text,
		);
	}
	// A full-width plus is not converted, matching libphonenumber-js.
	for (const character of ["+", "＋", "9", "９", "a"]) {
		assert.equal(
			jp.parsePhoneNumberCharacter(character, ""),
			full.parsePhoneNumberCharacter(character, ""),
			character,
		);
	}
	assert.equal(jp.parsePhoneNumberCharacter("+", "8"), undefined);
	assert.equal(jp.getExtPrefix("JP"), full.getExtPrefix("JP"));
	assert.equal(
		jp.getCountryCallingCode("JP"),
		full.getCountryCallingCode("JP"),
	);
});

test("reads and writes tel: URIs like libphonenumber-js", () => {
	for (const uri of [
		"tel:+81-3-1234-5678",
		"tel:+81-3-1234-5678;ext=12",
		"tel:+81312345678;isub=99",
		"tel:03-1234-5678;phone-context=+81",
		"tel:03-1234-5678;phone-context=example.com",
		"tel:+81-3-1234-5678;foo=bar",
		"tel:",
		"tel:;ext=1",
	]) {
		assert.deepEqual(jp.parseRFC3966(uri), upstream.parseRFC3966(uri), uri);
	}
	for (const parts of [
		{ number: "+81312345678" },
		{ number: "+81312345678", ext: "12" },
		{},
	]) {
		assert.equal(jp.formatRFC3966(parts), upstream.formatRFC3966(parts));
	}
	assert.throws(
		() => jp.formatRFC3966({ number: "0312345678" }),
		/E\.164 format/,
	);
	// Text with no "tel:" at all leaves libphonenumber-js dereferencing
	// undefined; this returns nothing instead.
	for (const notAUri of ["nonsense", ""]) {
		assert.deepEqual(jp.parseRFC3966(notAUri), {});
		assert.throws(() => upstream.parseRFC3966(notAUri), TypeError);
	}
});

test("rejects a calling code it has no metadata for", () => {
	// Not a ParseError: libphonenumber-js throws a plain Error here too, and the
	// forgiving parse function must not swallow it.
	assert.throws(
		() =>
			jp.parsePhoneNumberFromString("312345678", { defaultCallingCode: "1" }),
		/Unknown calling code: 1/,
	);
	assert.throws(
		() =>
			jp.validatePhoneNumberLength("312345678", { defaultCallingCode: "1" }),
		/Unknown calling code: 1/,
	);
	assert.equal(
		jp.parsePhoneNumberFromString("312345678", { defaultCallingCode: "81" })
			?.number,
		"+81312345678",
	);
});

test("only drops a leading 81 when doing so is what makes the number work", () => {
	// "81" here is the country code; without it the rest is nine digits too many.
	assert.equal(
		jp.parsePhoneNumberFromString("81312345678", "JP")?.number,
		"+81312345678",
	);
	// "0813" is Yamaguchi, and the number is already the right length, so the
	// leading "81" stays part of it.
	const local = jp.parsePhoneNumberFromString("0813123456", "JP");
	assert.equal(local?.number, "+81813123456");
	assert.equal(
		local?.formatNational(),
		full.parsePhoneNumberFromString("0813123456", "JP")?.formatNational(),
	);
});

test("reads the fields libphonenumber-js's metadata actually holds", () => {
	// tools/generate.mjs picks values out of libphonenumber-js's compressed
	// metadata by position. Nothing else would notice if that layout changed and
	// a field started meaning something different, so compare the generated data
	// against the metadata this repository already depends on.
	const plan = createRequire(import.meta.url)(
		"libphonenumber-js/metadata.max.json",
	).countries.JP;
	assert.equal(data.CALLING_CODE, plan[0]);
	assert.equal(data.IDD_PREFIX, plan[1]);
	assert.equal(data.NATIONAL_NUMBER_PATTERN, plan[2]);
	assert.deepEqual(data.POSSIBLE_LENGTHS, plan[3]);
	assert.deepEqual(data.FORMATS, plan[4]);
	assert.equal(data.NATIONAL_PREFIX, plan[5]);
	assert.equal(data.NATIONAL_PREFIX_FORMATTING_RULE, plan[6] || undefined);
	assert.equal(data.NATIONAL_PREFIX_FOR_PARSING, plan[7]);
	assert.equal(data.NATIONAL_PREFIX_TRANSFORM_RULE, plan[8] || undefined);
	assert.equal(data.NATIONAL_PREFIX_IS_OPTIONAL_WHEN_FORMATTING, !!plan[9]);
	assert.deepEqual(data.TYPES, plan[11]);
});
