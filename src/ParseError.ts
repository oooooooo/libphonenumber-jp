/** Why a number could not be parsed. Matches libphonenumber-js's error codes. */
export type ParseErrorType =
	| "NOT_A_NUMBER"
	| "INVALID_COUNTRY"
	| "TOO_SHORT"
	| "TOO_LONG";

export class ParseError extends Error {
	constructor(code: ParseErrorType) {
		super(code);
		this.name = "ParseError";
	}
}
