// The numbering plan itself: everything that operates on a national number
// once the country code and trunk prefix have been taken off.

import type { Format } from "./data.ts";
import {
	FORMATS,
	NATIONAL_NUMBER_PATTERN,
	NATIONAL_PREFIX,
	NATIONAL_PREFIX_FOR_PARSING,
	NATIONAL_PREFIX_FORMATTING_RULE,
	NATIONAL_PREFIX_IS_OPTIONAL_WHEN_FORMATTING,
	NATIONAL_PREFIX_TRANSFORM_RULE,
	POSSIBLE_LENGTHS,
	TYPES,
} from "./data.ts";
import { VALID_PUNCTUATION } from "./text.ts";

// The plan has a couple of dozen patterns and they are matched over and over,
// so every compiled form is kept rather than rebuilt.
// Keyed by the raw pattern, so a hit costs a map lookup and nothing else.
const anchored = new Map<string, RegExp>();
const prefixed = new Map<string, RegExp>();

function compile(
	cache: Map<string, RegExp>,
	pattern: string,
	anchorEnd: boolean,
): RegExp {
	let compiled = cache.get(pattern);
	if (!compiled) {
		compiled = new RegExp(`^(?:${pattern})${anchorEnd ? "$" : ""}`);
		cache.set(pattern, compiled);
	}
	return compiled;
}

/** The pattern as a regexp the whole text has to match. */
function entire(pattern: string): RegExp {
	return compile(anchored, pattern, true);
}

export function matchesEntirely(text: string, pattern: string): boolean {
	return entire(pattern).test(text);
}

/** Whether the text begins with something the pattern matches. */
function startsWith(text: string, pattern: string): boolean {
	return compile(prefixed, pattern, false).test(text);
}

/** Number types in the order libphonenumber stores their patterns. */
const TYPE_NAMES = [
	"FIXED_LINE",
	"MOBILE",
	"TOLL_FREE",
	"PREMIUM_RATE",
	"PERSONAL_NUMBER",
	"VOICEMAIL",
	"UAN",
	"PAGER",
	"VOIP",
	"SHARED_COST",
] as const;

export type PhoneNumberType = (typeof TYPE_NAMES)[number];
export type NumberType = PhoneNumberType | "FIXED_LINE_OR_MOBILE";

const FIXED_LINE = 0;
const MOBILE = 1;

/**
 * The order libphonenumber tries the non-fixed-line types in, which is not the
 * order it stores them in: mobile, premium rate, toll free, shared cost, VoIP,
 * personal number, pager, UAN, voicemail.
 */
const NON_FIXED_LINE_ORDER = [1, 3, 2, 9, 8, 4, 7, 6, 5];

/** A type's patterns, or `undefined` where the plan has no numbers of that type. */
function typeOf(type: number) {
	return TYPES[type] || undefined;
}

function isNumberTypeEqualTo(nationalNumber: string, type: number): boolean {
	const definition = typeOf(type);
	if (!definition?.[0]) return false;
	// A type carries its own possible lengths only when they differ from the
	// plan's; checking them first skips the expensive pattern most of the time.
	const lengths = definition[1];
	if (lengths && lengths.indexOf(nationalNumber.length) < 0) return false;
	return matchesEntirely(nationalNumber, definition[0]);
}

export function getNumberType(nationalNumber: string): NumberType | undefined {
	if (!matchesEntirely(nationalNumber, NATIONAL_NUMBER_PATTERN))
		return undefined;

	if (isNumberTypeEqualTo(nationalNumber, FIXED_LINE)) {
		// An absent or empty mobile pattern means it was dropped as a duplicate of
		// the fixed-line one, so a match for one is a match for both.
		return !typeOf(MOBILE)?.[0] || isNumberTypeEqualTo(nationalNumber, MOBILE)
			? "FIXED_LINE_OR_MOBILE"
			: "FIXED_LINE";
	}

	for (const type of NON_FIXED_LINE_ORDER) {
		if (isNumberTypeEqualTo(nationalNumber, type)) return TYPE_NAMES[type];
	}
	return undefined;
}

export function isValidNumber(nationalNumber: string): boolean {
	return getNumberType(nationalNumber) !== undefined;
}

/** What checking a national number's length can conclude. */
export type LengthCheck =
	| "IS_POSSIBLE"
	| "INVALID_LENGTH"
	| "TOO_SHORT"
	| "TOO_LONG";

export function checkNumberLength(nationalNumber: string): LengthCheck {
	const actual = nationalNumber.length;
	const shortest = POSSIBLE_LENGTHS[0];
	if (shortest === actual) return "IS_POSSIBLE";
	if (shortest > actual) return "TOO_SHORT";
	if (POSSIBLE_LENGTHS[POSSIBLE_LENGTHS.length - 1] < actual) return "TOO_LONG";
	return POSSIBLE_LENGTHS.indexOf(actual, 1) >= 0
		? "IS_POSSIBLE"
		: "INVALID_LENGTH";
}

export function isPossibleNumber(nationalNumber: string): boolean {
	return checkNumberLength(nationalNumber) === "IS_POSSIBLE";
}

export interface ExtractedNationalNumber {
	nationalNumber: string;
	carrierCode?: string;
}

const NATIONAL_PREFIX_PATTERN = new RegExp(
	`^(?:${NATIONAL_PREFIX_FOR_PARSING})`,
);

function stripNationalPrefix(number: string): ExtractedNationalNumber {
	const match = NATIONAL_PREFIX_PATTERN.exec(number);
	if (!match) return { nationalNumber: number };

	const capturedGroupsCount = match.length - 1;
	const captured = capturedGroupsCount > 0 && match[capturedGroupsCount];

	if (NATIONAL_PREFIX_TRANSFORM_RULE && captured) {
		return {
			nationalNumber: number.replace(
				NATIONAL_PREFIX_PATTERN,
				NATIONAL_PREFIX_TRANSFORM_RULE,
			),
			carrierCode: capturedGroupsCount > 1 ? match[1] : undefined,
		};
	}
	return {
		nationalNumber: number.slice((match[0] as string).length),
		carrierCode: captured ? match[1] : undefined,
	};
}

/**
 * Takes the trunk prefix off a national number, but puts it back whenever doing
 * so would turn a number that made sense into one that does not.
 */
export function extractNationalNumber(number: string): ExtractedNationalNumber {
	const stripped = stripNationalPrefix(number);
	if (stripped.nationalNumber === number) return stripped;

	if (
		matchesEntirely(number, NATIONAL_NUMBER_PATTERN) &&
		!matchesEntirely(stripped.nationalNumber, NATIONAL_NUMBER_PATTERN)
	) {
		return { nationalNumber: number };
	}
	const length = checkNumberLength(stripped.nationalNumber);
	if (length === "TOO_SHORT" || length === "INVALID_LENGTH")
		return { nationalNumber: number };
	return stripped;
}

function chooseFormat(nationalNumber: string): Format | undefined {
	return FORMATS.find((format) => {
		// The last leading-digits pattern is the most specific one.
		const leadingDigits = format[2] || [];
		const mostSpecific = leadingDigits[leadingDigits.length - 1];
		if (mostSpecific && !startsWith(nationalNumber, mostSpecific)) return false;
		return matchesEntirely(nationalNumber, format[0]);
	});
}

const FIRST_GROUP = /(\$\d)/;
const SEPARATORS = new RegExp(`[${VALID_PUNCTUATION}]+`, "g");

export function formatNationalNumber(
	nationalNumber: string,
	formatAs: "NATIONAL" | "INTERNATIONAL",
	keepNationalPrefix: boolean,
): string {
	const format = chooseFormat(nationalNumber);
	if (!format) return nationalNumber;

	const international = formatAs === "INTERNATIONAL";
	const prefixRule = format[3] || NATIONAL_PREFIX_FORMATTING_RULE;
	// The trunk prefix can only be dropped where the plan says it is optional.
	const optional = !!format[4] || NATIONAL_PREFIX_IS_OPTIONAL_WHEN_FORMATTING;
	const withNationalPrefix = keepNationalPrefix || !optional;
	const replacement = international
		? format[5] || format[1]
		: withNationalPrefix && prefixRule
			? format[1].replace(FIRST_GROUP, prefixRule)
			: format[1];

	const formatted = nationalNumber.replace(entire(format[0]), replacement);
	// International format uses plain spaces, whatever the rule wrote.
	return international ? formatted.replace(SEPARATORS, " ").trim() : formatted;
}

export { NATIONAL_PREFIX };
