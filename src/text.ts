// Character-level parsing: what counts as a phone number in free text, which
// digits are digits, and how extensions and `tel:` URIs are peeled off.

const DASHES = "-‐-―−ー－";
const SLASHES = "／/";
const DOTS = "．.";
const WHITESPACE = "  ­​⁠　";
const BRACKETS = "()（）［］\\[\\]";
const TILDES = "~⁓∼～";

const VALID_DIGITS = "0-9０-９٠-٩۰-۹";
export const VALID_PUNCTUATION =
	DASHES + SLASHES + DOTS + WHITESPACE + BRACKETS + TILDES;
const PLUS_CHARS = "+＋";

export const MIN_LENGTH_FOR_NSN = 2;
export const MAX_LENGTH_FOR_NSN = 17;
export const MAX_INPUT_STRING_LENGTH = 250;

const DIGIT_OFFSETS = [0x30, 0xff10, 0x0660, 0x06f0];

/** Reads one character as a digit, accepting full-width and Arabic-Indic forms. */
function parseDigit(character: string): string | undefined {
	const code = character.charCodeAt(0);
	for (const zero of DIGIT_OFFSETS) {
		if (code >= zero && code <= zero + 9)
			return String.fromCharCode(0x30 + code - zero);
	}
	return undefined;
}

/** Keeps only the digits, normalising them to ASCII. */
export function parseDigits(text: string): string {
	let result = "";
	for (const character of text) result += parseDigit(character) ?? "";
	return result;
}

/** Reads one character of a number being typed: a digit, or a leading `+`. */
export function parsePhoneNumberCharacter(
	character: string,
	prevParsedCharacters?: string,
	eventListener?: (eventName: "end") => void,
): string | undefined {
	if (character === "+") {
		if (prevParsedCharacters) {
			eventListener?.("end");
			return undefined;
		}
		return "+";
	}
	return parseDigit(character);
}

/** Strips punctuation, leaving digits and at most a leading `+`. */
export function parseIncompletePhoneNumber(text: string): string {
	let result = "";
	for (const character of text)
		result += parsePhoneNumberCharacter(character, result) ?? "";
	return result;
}

const extensionDigits = (maxLength: string) =>
	`([${VALID_DIGITS}]{1,${maxLength}})`;

/**
 * Google's extension pattern, verbatim: the labels people write before an
 * extension, in every form libphonenumber accepts.
 */
function createExtensionPattern(): string {
	const afterExplicitLabel = "20";
	const afterLikelyLabel = "15";
	const afterAmbiguousChar = "9";
	const whenNotSure = "6";
	const separatorsBeforeLabel = "[  \\t,]*";
	const charsAfterLabel = "[:\\.．]?[  \\t,-]*";
	const suffix = "#?";
	const explicitLabels = "(?:e?xt(?:ensi(?:ó?|ó))?n?|ｅ?ｘｔｎ?|доб|anexo)";
	const ambiguousLabels = "(?:[xｘ#＃~～]|int|ｉｎｔ)";
	const separatorsNoComma = "[  \\t]*";

	return [
		`;ext=${extensionDigits(afterExplicitLabel)}`,
		separatorsBeforeLabel +
			explicitLabels +
			charsAfterLabel +
			extensionDigits(afterExplicitLabel) +
			suffix,
		separatorsBeforeLabel +
			ambiguousLabels +
			charsAfterLabel +
			extensionDigits(afterAmbiguousChar) +
			suffix,
		`[- ]+${extensionDigits(whenNotSure)}#`,
		separatorsNoComma +
			"(?:,{2}|;)" +
			charsAfterLabel +
			extensionDigits(afterLikelyLabel) +
			suffix,
		separatorsNoComma +
			"(?:,)+" +
			charsAfterLabel +
			extensionDigits(afterAmbiguousChar) +
			suffix,
	].join("|");
}

const EXTENSION_PATTERN = createExtensionPattern();
const EXTENSION = new RegExp(`(?:${EXTENSION_PATTERN})$`, "i");

const VALID_PHONE_NUMBER =
	"[" +
	PLUS_CHARS +
	"]{0,1}" +
	"(?:[" +
	VALID_PUNCTUATION +
	"]*[" +
	VALID_DIGITS +
	"]){3,}" +
	"[" +
	VALID_PUNCTUATION +
	VALID_DIGITS +
	"]*";

const VIABLE = new RegExp(
	"^[" +
		VALID_DIGITS +
		"]{" +
		MIN_LENGTH_FOR_NSN +
		"}$" +
		"|^" +
		VALID_PHONE_NUMBER +
		"(?:" +
		EXTENSION_PATTERN +
		")?$",
	"i",
);

const VIABLE_START = new RegExp(
	"^[" +
		PLUS_CHARS +
		"]{0,1}(?:[" +
		VALID_PUNCTUATION +
		"]*[" +
		VALID_DIGITS +
		"]){1,2}$",
	"i",
);

export function isViablePhoneNumber(number: string): boolean {
	return number.length >= MIN_LENGTH_FOR_NSN && VIABLE.test(number);
}

export function isViablePhoneNumberStart(number: string): boolean {
	return VIABLE_START.test(number);
}

export interface RFC3966Number {
	number?: string;
	ext?: string;
}

/** Reads a `tel:` URI. */
export function parseRFC3966(text: string): RFC3966Number {
	let number: string | undefined;
	let ext: string | undefined;
	for (const part of text.replace(/^tel:/, "tel=").split(";")) {
		const [name, value] = part.split("=");
		if (name === "tel") number = value;
		else if (name === "ext") ext = value;
		else if (name === "phone-context" && value && value[0] === "+")
			number = value + number;
	}
	if (!number || !isViablePhoneNumber(number)) return {};
	return ext ? { number, ext } : { number };
}

/** Writes a `tel:` URI. */
export function formatRFC3966({ number, ext }: RFC3966Number): string {
	if (!number) return "";
	if (number[0] !== "+")
		throw new Error(
			`"formatRFC3966()" expects "number" to be in E.164 format, got ${number}`,
		);
	return `tel:${number}${ext ? `;ext=${ext}` : ""}`;
}

const PHONE_NUMBER_START = new RegExp(`[${PLUS_CHARS}${VALID_DIGITS}]`);
const AFTER_PHONE_NUMBER_END = new RegExp(`[^${VALID_DIGITS}#]+$`);

/** Trims free text down to the part that looks like a phone number. */
export function extractFormattedPhoneNumber(
	text: string,
	extract: boolean,
): string | undefined {
	if (!text) return undefined;
	if (extract === false) return text;
	const startsAt = text.search(PHONE_NUMBER_START);
	if (startsAt < 0) return undefined;
	return text.slice(startsAt).replace(AFTER_PHONE_NUMBER_END, "");
}

/** Splits a trailing extension off a number. */
export function extractExtension(number: string): RFC3966Number | undefined {
	const matches = number.match(EXTENSION);
	if (!matches) return undefined;
	// Only one of the pattern's alternatives captures, so take the first that did.
	for (let i = 1; i < matches.length; i++) {
		if (matches[i])
			return { number: number.slice(0, matches.index), ext: matches[i] };
	}
	// Unreachable: every alternative has exactly one capturing group.
	return undefined;
}

export const RFC3966_PREFIX = "tel:";
export const RFC3966_PHONE_CONTEXT = ";phone-context=";
export const RFC3966_ISDN_SUBADDRESS = ";isub=";

const RFC3966_VISUAL_SEPARATOR = "[\\-\\.\\(\\)]?";
const RFC3966_PHONE_DIGIT = `([${VALID_DIGITS}]|${RFC3966_VISUAL_SEPARATOR})`;
const RFC3966_GLOBAL_NUMBER_DIGITS = new RegExp(
	"^\\+" +
		RFC3966_PHONE_DIGIT +
		"*[" +
		VALID_DIGITS +
		"]" +
		RFC3966_PHONE_DIGIT +
		"*$",
);
const DOMAIN_LABEL = `[${VALID_DIGITS}]+((\\-)*[${VALID_DIGITS}])*`;
const TOP_LABEL = `[a-zA-Z]+((\\-)*[${VALID_DIGITS}])*`;
const RFC3966_DOMAIN_NAME = new RegExp(
	`^(${DOMAIN_LABEL}\\.)*${TOP_LABEL}\\.?$`,
);

/** Reads the `;phone-context=` parameter of a `tel:` URI, or `null` when there is none. */
export function extractPhoneContext(text: string): string | null {
	const at = text.indexOf(RFC3966_PHONE_CONTEXT);
	if (at < 0) return null;
	const start = at + RFC3966_PHONE_CONTEXT.length;
	if (start >= text.length) return "";
	const end = text.indexOf(";", start);
	return end >= 0 ? text.substring(start, end) : text.substring(start);
}

export function isPhoneContextValid(phoneContext: string | null): boolean {
	if (phoneContext === null) return true;
	if (phoneContext.length === 0) return false;
	return (
		RFC3966_GLOBAL_NUMBER_DIGITS.test(phoneContext) ||
		RFC3966_DOMAIN_NAME.test(phoneContext)
	);
}
