import type { CountryCode } from "./data.ts";
import { CALLING_CODE, IDD_PREFIX, NATIONAL_NUMBER_PATTERN } from "./data.ts";
import { ParseError } from "./ParseError.ts";
import { PhoneNumber } from "./PhoneNumber.ts";
import {
	checkNumberLength,
	extractNationalNumber,
	matchesEntirely,
} from "./plan.ts";
import {
	extractExtension,
	extractFormattedPhoneNumber,
	extractPhoneContext,
	isPhoneContextValid,
	isViablePhoneNumber,
	isViablePhoneNumberStart,
	MAX_INPUT_STRING_LENGTH,
	MAX_LENGTH_FOR_NSN,
	MIN_LENGTH_FOR_NSN,
	parseIncompletePhoneNumber,
	RFC3966_ISDN_SUBADDRESS,
	RFC3966_PHONE_CONTEXT,
	RFC3966_PREFIX,
} from "./text.ts";

export interface ParseOptions {
	/** The country a number in national format belongs to. Only `'JP'` resolves here. */
	defaultCountry?: CountryCode;
	/** The calling code a number without one belongs to. Only `'81'` resolves here. */
	defaultCallingCode?: string;
	/** Set to `false` to reject text that merely contains a number rather than being one. */
	extract?: boolean;
}

const IDD = new RegExp(IDD_PREFIX);

/** Strips the prefix dialled to leave Japan, leaving something `+`-shaped behind. */
function stripIddPrefix(
	number: string,
	country: CountryCode | undefined,
): string | undefined {
	if (!country) return undefined;
	if (number.search(IDD) !== 0) return undefined;
	const rest = number.slice((number.match(IDD) as RegExpMatchArray)[0].length);
	// "0100..." is a national number that happens to start with the IDD prefix.
	if (rest[0] === "0") return undefined;
	return rest;
}

/**
 * Decides whether a number written without a `+` nevertheless starts with the
 * country code, by checking whether dropping it is what makes the rest valid.
 */
function extractCallingCodeWithoutPlus(
	number: string,
	defaultCountry: CountryCode | undefined,
	defaultCallingCode: string | undefined,
): string | undefined {
	const callingCode = defaultCountry
		? CALLING_CODE
		: (defaultCallingCode as string);
	if (number.indexOf(callingCode) !== 0) return undefined;
	if (callingCode !== CALLING_CODE)
		throw new Error(`Unknown calling code: ${callingCode}`);

	const shorter = number.slice(callingCode.length);
	const shorterNationalNumber = extractNationalNumber(shorter).nationalNumber;
	const nationalNumber = extractNationalNumber(number).nationalNumber;

	if (
		(!matchesEntirely(nationalNumber, NATIONAL_NUMBER_PATTERN) &&
			matchesEntirely(shorterNationalNumber, NATIONAL_NUMBER_PATTERN)) ||
		checkNumberLength(nationalNumber) === "TOO_LONG"
	) {
		return shorter;
	}
	return undefined;
}

interface ExtractedCallingCode {
	countryCallingCode?: string;
	number?: string;
}

function extractCountryCallingCode(
	number: string,
	defaultCountry: CountryCode | undefined,
	defaultCallingCode: string | undefined,
): ExtractedCallingCode {
	if (!number) return {};

	if (number[0] !== "+") {
		const withoutIdd = stripIddPrefix(number, defaultCountry);
		if (withoutIdd !== undefined && withoutIdd !== number) {
			number = `+${withoutIdd}`;
		} else {
			if (defaultCountry || defaultCallingCode) {
				const shorter = extractCallingCodeWithoutPlus(
					number,
					defaultCountry,
					defaultCallingCode,
				);
				if (shorter !== undefined)
					return { countryCallingCode: CALLING_CODE, number: shorter };
			}
			return { number };
		}
	}

	// No calling code starts with a zero.
	if (number[1] === "0") return {};
	if (number.slice(1, 1 + CALLING_CODE.length) === CALLING_CODE) {
		return {
			countryCallingCode: CALLING_CODE,
			number: number.slice(1 + CALLING_CODE.length),
		};
	}
	// Some other country's number: this package has nothing to resolve it with.
	return {};
}

interface ParsedNumber {
	countryCallingCode?: string;
	nationalNumber?: string;
	carrierCode?: string;
}

function parseFormattedNumber(
	formattedNumber: string,
	defaultCountry: CountryCode | undefined,
	defaultCallingCode: string | undefined,
): ParsedNumber {
	const { countryCallingCode, number } = extractCountryCallingCode(
		parseIncompletePhoneNumber(formattedNumber),
		defaultCountry,
		defaultCallingCode,
	);

	let callingCode = countryCallingCode;
	if (!callingCode) {
		if (number && (defaultCountry || defaultCallingCode)) {
			if (defaultCountry) {
				callingCode = CALLING_CODE;
			} else {
				if (defaultCallingCode !== CALLING_CODE)
					throw new Error(`Unknown calling code: ${defaultCallingCode}`);
				callingCode = defaultCallingCode;
			}
		} else {
			return {};
		}
	}

	if (!number) return { countryCallingCode: callingCode };

	// `number` came back from extractCountryCallingCode() already normalised.
	const { nationalNumber, carrierCode } = extractNationalNumber(number);
	return { countryCallingCode: callingCode, nationalNumber, carrierCode };
}

/** Peels a `tel:` URI down to the number it carries. */
function extractFromPossibleRfc3966Uri(
	text: string,
	extract: boolean,
): string | undefined {
	const phoneContext = extractPhoneContext(text);
	if (!isPhoneContextValid(phoneContext)) throw new ParseError("NOT_A_NUMBER");

	let result: string;
	if (phoneContext === null) {
		if (text.length > MAX_INPUT_STRING_LENGTH) throw new ParseError("TOO_LONG");
		result = extractFormattedPhoneNumber(text, extract) || "";
	} else {
		result = phoneContext.charAt(0) === "+" ? phoneContext : "";
		const prefixAt = text.indexOf(RFC3966_PREFIX);
		const numberAt = prefixAt >= 0 ? prefixAt + RFC3966_PREFIX.length : 0;
		result += text.substring(numberAt, text.indexOf(RFC3966_PHONE_CONTEXT));
	}

	const isdnAt = result.indexOf(RFC3966_ISDN_SUBADDRESS);
	if (isdnAt > 0) result = result.substring(0, isdnAt);
	return result === "" ? undefined : result;
}

function parseInput(
	text: string,
	extract: boolean,
): { number?: string; ext?: string; error?: "TOO_SHORT" } {
	const number = extractFromPossibleRfc3966Uri(text, extract);
	if (!number) return {};

	if (!isViablePhoneNumber(number)) {
		return isViablePhoneNumberStart(number) ? { error: "TOO_SHORT" } : {};
	}

	const withExtensionStripped = extractExtension(number);
	if (withExtensionStripped?.ext) return withExtensionStripped;
	return { number };
}

/** Parses a number, throwing a {@link ParseError} when it cannot. */
export function parse(text: string, options: ParseOptions = {}): PhoneNumber {
	if (options.defaultCountry && options.defaultCountry !== "JP")
		throw new ParseError("INVALID_COUNTRY");

	const {
		number: formattedNumber,
		ext,
		error,
	} = parseInput(text, options.extract !== false);
	if (!formattedNumber)
		throw new ParseError(error === "TOO_SHORT" ? "TOO_SHORT" : "NOT_A_NUMBER");

	const parsed = parseFormattedNumber(
		formattedNumber,
		options.defaultCountry,
		options.defaultCallingCode,
	);
	if (!parsed.countryCallingCode) throw new ParseError("INVALID_COUNTRY");

	const nationalNumber = parsed.nationalNumber;
	if (!nationalNumber || nationalNumber.length < MIN_LENGTH_FOR_NSN)
		throw new ParseError("TOO_SHORT");
	if (nationalNumber.length > MAX_LENGTH_FOR_NSN)
		throw new ParseError("TOO_LONG");

	const phoneNumber = new PhoneNumber(`+${CALLING_CODE}${nationalNumber}`);
	if (parsed.carrierCode) phoneNumber.carrierCode = parsed.carrierCode;
	if (ext) phoneNumber.ext = ext;
	return phoneNumber;
}
