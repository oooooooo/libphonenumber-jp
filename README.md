# libphonenumber-jp

Parse, format and validate Japanese phone numbers with
[libphonenumber-js][lpnjs]'s API, in under 5 kB gzipped, several times faster,
and with no dependencies.

```js
import { parsePhoneNumberFromString } from '@noooooooode/libphonenumber-jp'

const number = parsePhoneNumberFromString('0312345678', 'JP')
number.formatNational()      // '03-1234-5678'
number.formatInternational() // '+81 3 1234 5678'
number.getType()             // 'FIXED_LINE'
number.isValid()             // true
```

```sh
npm install @noooooooode/libphonenumber-jp
```

[lpnjs]: https://github.com/catamphetamine/libphonenumber-js

## Number types

```js
parsePhoneNumberFromString("09012345678", "JP").getType() === "MOBILE"
```

| Number | `getType()` |
| --- | --- |
| `090` `080` `070` `060`, eleven digits | `MOBILE` |
| `050` | `VOIP` |
| `020` | `PAGER` |
| A geographic number, e.g. `03` | `FIXED_LINE` |
| `0120` `0800` | `TOLL_FREE` |
| `0570` | `UAN` |
| `0990` | `PREMIUM_RATE` |
| `060`, ten digits | `PERSONAL_NUMBER` |

`getType()` never returns `FIXED_LINE_OR_MOBILE` in Japan: fixed-line numbers
are nine digits after the trunk `0` and mobile ones are ten, so no number can be
both. Comparing against `"MOBILE"` is therefore enough to tell a mobile number.
Note that `050` is not one — it is a VoIP number, and cannot receive SMS.

With `libphonenumber-js` this only works when importing from
`libphonenumber-js/max`; its default import returns `undefined`.

## Size and speed

<!-- benchmark:start -->

Bundled with esbuild, importing `parsePhoneNumberFromString`,
`isValidPhoneNumber`, `validatePhoneNumberLength`:

| | Minified | Gzipped | Brotli |
| --- | --- | --- | --- |
| `libphonenumber-js/max` | 198.2 kB | 49.6 kB | 43.1 kB |
| `libphonenumber-js/min` | 124.6 kB | 29.5 kB | 25.4 kB |
| **`libphonenumber-jp`** | **11.5 kB** | **4.6 kB** | **4.1 kB** |

Throughput over 23 representative numbers, best of 5 rounds:

| Operation | libphonenumber-js/max | libphonenumber-jp | |
| --- | --- | --- | --- |
| parse | 280k/s | **1,442k/s** | 5.1× |
| parse + formatNational | 141k/s | **577k/s** | 4.1× |
| parse + getType | 195k/s | **1,156k/s** | 5.9× |
| isValidPhoneNumber | 164k/s | **1,218k/s** | 7.4× |
| validatePhoneNumberLength | 221k/s | **1,617k/s** | 7.3× |

Starting up, median of 7 fresh processes:

| | Import | First call |
| --- | --- | --- |
| libphonenumber-js/max | 35.5 ms | 2.4 ms |
| **libphonenumber-jp** | **3.6 ms** | **1.2 ms** |

_Measured on Node v24.18.0 with `npm run benchmark`; absolute numbers vary by
machine._
<!-- benchmark:end -->

Most of what libphonenumber-js carries is machinery for choosing between 250
numbering plans. Japan needs none of it: the calling code is always `81`, the
country never has to be deduced, and the whole plan is 3.4 kB of patterns. That
is also where the speed comes from — there is no 158 kB of metadata to read at
startup, and no `Metadata` object rebuilt on every call.

Run `npm run benchmark` to regenerate the tables above on your own machine.

## Differences from libphonenumber-js

`npm test` compares against `libphonenumber-js/max` over about 47,000 numbers:
every four-digit prefix at the two lengths ordinary Japanese numbers have, every
three-digit prefix at the lengths only the service ranges reach, and every shape
of input above. Each one is compared as a whole parsed object, plus its
validation results and the error code parsing throws. Everything that covers
matches, except the following, which are deliberate.

**Not implemented.** `AsYouType`, `formatIncompletePhoneNumber`,
`findPhoneNumbersInText`, `searchPhoneNumbersInText`, `PhoneNumberMatcher`,
`findNumbers`, `searchNumbers`, `Metadata`, `DIGIT_PLACEHOLDER`. Importing any
of them fails; the first seven are about 35 kB minified of libphonenumber-js,
three times what this whole package weighs.

**Japan only.** `parsePhoneNumberFromString('+12025550173')` is `undefined` and
`parsePhoneNumberWithError` throws `INVALID_COUNTRY`. `CountryCode` is `'JP'`,
so passing another country is a compile error rather than something that quietly
returns nothing.

**`010` cannot be followed.** It is the prefix for dialling out of Japan, so
`01012025550173` is a US number and needs US metadata. Nothing Japanese is lost:
`010` is reserved, and no Japanese number lives behind it.

**`formatExtension` takes two arguments, not three.** libphonenumber-js passes
its metadata object as a third one; there is no such object here.

**`format('IDD')` throws.** Formatting a number for dialling in from abroad
needs the originating country's prefix, which is not here. It fails loudly
rather than returning something that looks like a formatted number.

**`parseRFC3966` returns `{}` for text that is not a `tel:` URI.**
libphonenumber-js dereferences `undefined` and throws a `TypeError`.

**`tel:` URIs with a `phone-context` parse every time.** libphonenumber-js
validates that parameter with a `/g` regular expression and `.test()`, so
`lastIndex` carries over and it accepts the same URI only every other call. This
is deterministic instead; the test suite pins both behaviours.

## Data

`src/data.ts` is generated. The generator downloads the current metadata from
Google's libphonenumber, so the output is whatever was published on the day it
ran — hence `METADATA_VERSION` rather than a pinned version.

```sh
npm run generate
npm test
```

## License

MIT. The numbering plan is generated from Google's libphonenumber (Apache
License 2.0) and the algorithms follow libphonenumber-js (MIT); see
[NOTICE](NOTICE).
