import type { CountryCode } from "./data.ts";
import { CALLING_CODE, EXT_PREFIX } from "./data.ts";
import type { NumberType } from "./plan.ts";
import {
	formatNationalNumber,
	getNumberType,
	isPossibleNumber,
	isValidNumber,
} from "./plan.ts";
import { formatRFC3966 } from "./text.ts";

export type NumberFormat =
	| "NATIONAL"
	| "INTERNATIONAL"
	| "E.164"
	| "RFC3966"
	| "IDD";

export interface FormatOptions {
	/** Set to `false` to leave the trunk prefix off, where the plan allows it. */
	nationalPrefix?: boolean;
	/** Replaces the ` ext. ` that separates an extension. */
	formatExtension?: (formattedNumber: string, extension: string) => string;
}

const E164 = /^\+[0-9]+$/;

/**
 * A parsed Japanese phone number.
 *
 * Construct one by parsing; the constructor is here for parity with
 * libphonenumber-js and takes a number already in E.164 form.
 */
export class PhoneNumber {
	/** Always `'JP'`: this package carries no other country. */
	country?: CountryCode;
	countryCallingCode: string;
	nationalNumber: string;
	/** The number in E.164 form. */
	number: string;
	carrierCode?: string;
	ext?: string;

	constructor(number: string) {
		if (typeof number !== "string")
			throw new TypeError("First argument must be a string");
		if (!number) throw new TypeError("First argument is required");
		if (!E164.test(number)) {
			throw new Error(
				'Invalid `number` argument passed: must consist of a "+" followed by digits',
			);
		}
		if (number.slice(1, 1 + CALLING_CODE.length) !== CALLING_CODE) {
			throw new Error(
				`Invalid \`number\` argument passed: not a Japanese number, this package only carries +${CALLING_CODE}`,
			);
		}
		const nationalNumber = number.slice(1 + CALLING_CODE.length);
		if (!nationalNumber)
			throw new Error("Invalid `number` argument passed: too short");

		this.country = "JP";
		this.countryCallingCode = CALLING_CODE;
		this.nationalNumber = nationalNumber;
		this.number = number;
	}

	setExt(ext: string): void {
		this.ext = ext;
	}

	/** Always `['JP']`; kept so that code written against libphonenumber-js still runs. */
	getPossibleCountries(): CountryCode[] {
		return this.country ? [this.country] : [];
	}

	isPossible(): boolean {
		return isPossibleNumber(this.nationalNumber);
	}

	isValid(): boolean {
		return isValidNumber(this.nationalNumber);
	}

	getType(): NumberType | undefined {
		return getNumberType(this.nationalNumber);
	}

	/** Always `false`: every number here belongs to Japan. */
	isNonGeographic(): boolean {
		return false;
	}

	isEqual(phoneNumber: PhoneNumber): boolean {
		return this.number === phoneNumber.number && this.ext === phoneNumber.ext;
	}

	format(format: NumberFormat, options?: FormatOptions): string {
		const addExtension = (formatted: string) =>
			this.ext
				? options?.formatExtension
					? options.formatExtension(formatted, this.ext)
					: formatted + EXT_PREFIX + this.ext
				: formatted;

		switch (format) {
			case "NATIONAL":
				if (!this.nationalNumber) return "";
				return addExtension(
					formatNationalNumber(
						this.nationalNumber,
						"NATIONAL",
						options?.nationalPrefix !== false,
					),
				);
			case "INTERNATIONAL":
				if (!this.nationalNumber) return `+${this.countryCallingCode}`;
				return addExtension(
					`+${this.countryCallingCode} ${formatNationalNumber(this.nationalNumber, "INTERNATIONAL", true)}`,
				);
			case "E.164":
				return `+${this.countryCallingCode}${this.nationalNumber}`;
			case "RFC3966":
				return formatRFC3966({ number: this.number, ext: this.ext });
			case "IDD":
				// Dialling in from abroad needs the originating country's prefix.
				// Returning an empty string would look like a formatted number, so
				// fail loudly instead.
				throw new Error(
					'format("IDD") needs the metadata of the country being dialled from, which this package does not carry',
				);
			default:
				throw new Error(
					`Unknown "format" argument passed to "format()": "${format as string}"`,
				);
		}
	}

	formatNational(options?: FormatOptions): string {
		return this.format("NATIONAL", options);
	}

	formatInternational(options?: FormatOptions): string {
		return this.format("INTERNATIONAL", options);
	}

	getURI(): string {
		return this.format("RFC3966");
	}
}
