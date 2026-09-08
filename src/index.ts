import type { CountryCode } from "./data.ts";
import { CALLING_CODE, EXAMPLE_NUMBER, EXT_PREFIX } from "./data.ts";
import { ParseError } from "./ParseError.ts";
import { PhoneNumber } from "./PhoneNumber.ts";
import type { ParseOptions } from "./parse.ts";
import { parse } from "./parse.ts";
import { checkNumberLength } from "./plan.ts";

export type { CountryCode } from "./data.ts";
export { METADATA_VERSION } from "./data.ts";
export type { ParseErrorType } from "./ParseError.ts";
export { ParseError } from "./ParseError.ts";
export type { FormatOptions, NumberFormat } from "./PhoneNumber.ts";
export { PhoneNumber } from "./PhoneNumber.ts";
export type { ParseOptions } from "./parse.ts";
export type { NumberType, PhoneNumberType } from "./plan.ts";
export type { RFC3966Number } from "./text.ts";
export {
	formatRFC3966,
	parseDigits,
	parseIncompletePhoneNumber,
	parsePhoneNumberCharacter,
	parseRFC3966,
} from "./text.ts";

/**
 * Why a number's length is wrong. Matches libphonenumber-js, which reports the
 * parse failures alongside the length ones and says nothing when the length is
 * fine.
 */
export type ValidatePhoneNumberLengthResult =
	| "INVALID_COUNTRY"
	| "NOT_A_NUMBER"
	| "TOO_SHORT"
	| "TOO_LONG"
	| "INVALID_LENGTH";

/** A number in E.164 form, e.g. `'+81312345678'`. */
export type E164Number = string;

/** Maps a country to one of its numbers; only Japan is present here. */
export type Examples = Partial<Record<CountryCode, string>>;

/** An example Japanese number, for {@link getExampleNumber}. */
export const examples: Examples = { JP: EXAMPLE_NUMBER };

/** The country a number in national format belongs to, or the full options object. */
export type DefaultCountry = CountryCode | ParseOptions;

function toOptions(
	argument: DefaultCountry | undefined,
	extract?: boolean,
): ParseOptions {
	const options: ParseOptions =
		typeof argument === "string"
			? { defaultCountry: argument }
			: { ...argument };
	if (extract !== undefined) options.extract = extract;
	return options;
}

/** Parses a phone number, throwing a {@link ParseError} if it cannot. */
export function parsePhoneNumberWithError(
	text: string,
	defaultCountry?: DefaultCountry,
): PhoneNumber {
	return parse(text, toOptions(defaultCountry));
}

// `parsePhoneNumber()` is the current name for `parsePhoneNumberWithError()`.
export { parsePhoneNumberWithError as parsePhoneNumber };

/** Parses a phone number, returning `undefined` instead of throwing. */
export function parsePhoneNumberFromString(
	text: string,
	defaultCountry?: DefaultCountry,
): PhoneNumber | undefined {
	const options = toOptions(defaultCountry);
	// A country this build has no metadata for is ignored rather than rejected,
	// which is what libphonenumber-js does with an unsupported `defaultCountry`.
	if (options.defaultCountry && options.defaultCountry !== "JP")
		options.defaultCountry = undefined;
	try {
		return parse(text, options);
	} catch (error) {
		if (error instanceof ParseError) return undefined;
		throw error;
	}
}

export default parsePhoneNumberFromString;

export function isValidPhoneNumber(
	text: string,
	defaultCountry?: DefaultCountry,
): boolean {
	return (
		parsePhoneNumberFromString(
			text,
			toOptions(defaultCountry, false),
		)?.isValid() ?? false
	);
}

export function isPossiblePhoneNumber(
	text: string,
	defaultCountry?: DefaultCountry,
): boolean {
	return (
		parsePhoneNumberFromString(
			text,
			toOptions(defaultCountry, false),
		)?.isPossible() ?? false
	);
}

/**
 * Says why a number's length is wrong, or `undefined` when it is fine.
 *
 * ```ts
 * validatePhoneNumberLength('031234567', 'JP') // 'TOO_SHORT'
 * ```
 */
export function validatePhoneNumberLength(
	text: string,
	defaultCountry?: DefaultCountry,
):
	| ReturnType<typeof checkNumberLength>
	| "NOT_A_NUMBER"
	| "INVALID_COUNTRY"
	| undefined {
	try {
		const phoneNumber = parse(text, toOptions(defaultCountry, false));
		const result = checkNumberLength(phoneNumber.nationalNumber);
		return result === "IS_POSSIBLE" ? undefined : result;
	} catch (error) {
		if (error instanceof ParseError) return error.message as "NOT_A_NUMBER";
		throw error;
	}
}

/** Always `['JP']`. */
export function getCountries(): CountryCode[] {
	return ["JP"];
}

export function isSupportedCountry(country: string): country is CountryCode {
	return country === "JP";
}

export function getCountryCallingCode(country: CountryCode): string {
	if (!isSupportedCountry(country))
		throw new Error(`Unknown country: ${country}`);
	return CALLING_CODE;
}

/** The separator written before an extension. */
export function getExtPrefix(country: CountryCode): string {
	return isSupportedCountry(country) ? EXT_PREFIX : " ext. ";
}

export function getExampleNumber(
	country: CountryCode,
	withExamples: Examples,
): PhoneNumber | undefined {
	const nationalNumber = withExamples[country];
	if (!nationalNumber || !isSupportedCountry(country)) return undefined;
	return new PhoneNumber(`+${CALLING_CODE}${nationalNumber}`);
}
