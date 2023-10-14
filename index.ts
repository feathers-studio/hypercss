interface Pos {
	line: number;
	column: number;
}

export interface Debug {
	from: Pos;
	to: Pos;
}

function char(str: string) {
	return str.charCodeAt(0);
}
function def(code?: number): code is number {
	return code !== null;
}
function between(num: number | undefined, first: number, last: number): num is number {
	return def(num) && num >= first && num <= last;
}
function digit(code: number) {
	return between(code, 0x30, 0x39);
}
function hexdigit(code: number): code is number {
	if (code == undefined) return false;
	return digit(code) || between(code, 0x41, 0x46) || between(code, 0x61, 0x66);
}
function uppercaseletter(code: number) {
	return between(code, 0x41, 0x5a);
}
function lowercaseletter(code: number) {
	return between(code, 0x61, 0x7a);
}
function letter(code: number) {
	return uppercaseletter(code) || lowercaseletter(code);
}
function nonascii(code: number) {
	return (
		code == 0xb7 ||
		between(code, 0xc0, 0xd6) ||
		between(code, 0xd8, 0xf6) ||
		between(code, 0xf8, 0x37d) ||
		between(code, 0x37f, 0x1fff) ||
		code == 0x200c ||
		code == 0x200d ||
		code == 0x203f ||
		code == 0x2040 ||
		between(code, 0x2070, 0x218f) ||
		between(code, 0x2c00, 0x2fef) ||
		between(code, 0x3001, 0xd7ff) ||
		between(code, 0xf900, 0xfdcf) ||
		between(code, 0xfdf0, 0xfffd) ||
		code >= 0x10000
	);
}
function namestartchar(code: number) {
	return def(code) && (letter(code) || nonascii(code) || code == 0x5f);
}
function namechar(code: number) {
	return namestartchar(code) || digit(code) || code == 0x2d;
}
function nonprintable(code: number) {
	return between(code, 0, 8) || code == 0xb || between(code, 0xe, 0x1f) || code == 0x7f;
}
function newline(code: number) {
	return code == 0xa;
}
function whitespace(code: number) {
	return newline(code) || code == 9 || code == 0x20;
}
function badescape(code: number) {
	return newline(code) || isNaN(code);
}
function surrogate(code: number) {
	return between(code, 0xd800, 0xdfff);
}

const maximumallowedcodepoint = 0x10ffff;

class InvalidCharacterError extends Error {
	constructor(public message: string) {
		super();
		this.name = "InvalidCharacterError";
	}
}

/** @see https://drafts.csswg.org/css-syntax/#input-preprocessing */
function preprocess(str: string) {
	// Turn a string into an array of code points,
	// following the preprocessing cleanup rules.
	const codepoints = [];
	for (let i = 0; i < str.length; i++) {
		let code = str.charCodeAt(i);
		if (code == 0xd && str.charCodeAt(i + 1) == 0xa) {
			code = 0xa;
			i++;
		}
		if (code == 0xd || code == 0xc) code = 0xa;
		if (code == 0x0) code = 0xfffd;
		if (between(code, 0xd800, 0xdbff) && between(str.charCodeAt(i + 1), 0xdc00, 0xdfff)) {
			// Decode a surrogate pair into an astral codepoint.
			const lead = code - 0xd800;
			const trail = str.charCodeAt(i + 1) - 0xdc00;
			code = Math.pow(2, 16) + lead * Math.pow(2, 10) + trail;
			i++;
		}
		codepoints.push(code);
	}
	return codepoints;
}

function asciiCaselessMatch(s1: string, s2: string) {
	return s1.toLowerCase() == s2.toLowerCase();
}

/** @see https://drafts.csswg.org/css-syntax/#tokenization */
function tokenize(str: string) {
	const codepoints = preprocess(str);
	let i = -1;
	const tokens: CSSParserToken[] = [];
	let code: number;

	// Line number information.
	const position = { line: 1, column: 1 };
	// The only use of lastLineLength is in reconsume().
	let lastLineLength = 0;
	function incrLineno() {
		position.line += 1;
		lastLineLength = position.column;
		position.column = 0;
	}

	const pos = () => ({ ...position });

	// unsure why this exists
	const locstart: Pos = pos();

	function codepoint(i: number): number {
		if (i >= codepoints.length) return -1;
		// verified above that codepoints cannot return undefined
		return codepoints[i] as number;
	}
	function next(num: number = 1) {
		if (num > 3) {
			throw "Spec Error: no more than three codepoints of lookahead.";
		}
		return codepoint(i + num);
	}
	function consume(num: number = 1) {
		i += num;
		code = codepoint(i);
		if (newline(code)) incrLineno();
		else position.column += num;
		//console.log('Consume '+i+' '+String.fromCharCode(code) + ' 0x' + code.toString(16));
		return true;
	}
	function reconsume() {
		i -= 1;
		if (newline(code)) {
			position.line -= 1;
			position.column = lastLineLength;
		} else {
			position.column -= 1;
		}
		locstart.line = position.line;
		locstart.column = position.column;
		return true;
	}
	function eof(codepoint?: number) {
		if (codepoint === undefined) codepoint = code;
		return codepoint == -1;
	}
	function donothing() {}
	function parseerror() {
		if (code == null) {
			console.log("Parse error at index " + i + ", processing codepoint undefined.");
		} else {
			console.log("Parse error at index " + i + ", processing codepoint 0x" + code.toString(16) + ".");
		}
		return true;
	}

	/** @see https://drafts.csswg.org/css-syntax/#consume-token */
	function consumeAToken() {
		consumeComments();
		const from = pos();
		consume();
		if (code == null) return;
		if (whitespace(code)) {
			while (whitespace(next())) consume();
			const to = pos();
			return new WhitespaceToken({ from, to });
		} else if (code == 0x22) return consumeAStringToken(from);
		else if (code == 0x23) {
			if (namechar(next()) || areAValidEscape(next(1), next(2))) {
				const isIdent = wouldStartAnIdentifier(next(1), next(2), next(3));
				const name = consumeAName();
				const to = pos();
				return new HashToken(name, isIdent, { from, to });
			} else {
				return new DelimToken(code, { from, to: from });
			}
		} else if (code == 0x27) return consumeAStringToken(from);
		else if (code == 0x28) {
			const to = pos();
			return new OpenParenToken({ from, to });
		} else if (code == 0x29) {
			const to = pos();
			return new CloseParenToken({ from, to });
		} else if (code == 0x2b) {
			if (startsWithANumber()) {
				reconsume();
				return consumeANumericToken(from);
			} else {
				const to = pos();
				return new DelimToken(code, { from, to });
			}
		} else if (code == 0x2c) {
			const to = pos();
			return new CommaToken({ from, to });
		} else if (code == 0x2d) {
			if (startsWithANumber()) {
				reconsume();
				return consumeANumericToken(from);
			} else if (next(1) == 0x2d && next(2) == 0x3e) {
				consume(2);
				const to = pos();
				return new CDCToken({ from, to });
			} else if (startsWithAnIdentifier()) {
				reconsume();
				return consumeAnIdentlikeToken(from);
			} else {
				const to = pos();
				return new DelimToken(code, { from, to });
			}
		} else if (code == 0x2e) {
			if (startsWithANumber()) {
				reconsume();
				return consumeANumericToken(from);
			} else {
				const to = pos();
				return new DelimToken(code, { from, to });
			}
		} else if (code == 0x3a) {
			const to = pos();
			return new ColonToken({ from, to });
		} else if (code == 0x3b) {
			const to = pos();
			return new SemicolonToken({ from, to });
		} else if (code == 0x3c) {
			if (next(1) == 0x21 && next(2) == 0x2d && next(3) == 0x2d) {
				consume(3);
				const to = pos();
				return new CDOToken({ from, to });
			} else {
				const to = pos();
				return new DelimToken(code, { from, to });
			}
		} else if (code == 0x40) {
			if (wouldStartAnIdentifier(next(1), next(2), next(3))) {
				const name = consumeAName();
				const to = pos();
				return new AtKeywordToken(name, { from, to });
			} else {
				const to = pos();
				return new DelimToken(code, { from, to });
			}
		} else if (code == 0x5b) {
			const to = pos();
			return new OpenSquareToken({ from, to });
		} else if (code == 0x5c) {
			if (startsWithAValidEscape()) {
				reconsume();
				return consumeAnIdentlikeToken(from);
			} else {
				parseerror();
				const to = pos();
				return new DelimToken(code, { from, to });
			}
		} else if (code == 0x5d) {
			const to = pos();
			return new CloseSquareToken({ from, to });
		} else if (code == 0x7b) {
			const to = pos();
			return new OpenCurlyToken({ from, to });
		} else if (code == 0x7d) {
			const to = pos();
			return new CloseCurlyToken({ from, to });
		} else if (digit(code)) {
			reconsume();
			return consumeANumericToken(from);
		} else if (code == 0x55 || code == 0x75) {
			if (wouldStartAUnicodeRange(code, next(1), next(2))) {
				reconsume();
				return consumeAUnicodeRangeToken(from);
			}
			reconsume();
			return consumeAnIdentlikeToken(from);
		} else if (namestartchar(code)) {
			reconsume();
			return consumeAnIdentlikeToken(from);
		} else if (eof()) {
			const to = pos();
			return new EOFToken({ from, to });
		} else {
			const to = pos();
			return new DelimToken(code, { from, to });
		}
	}

	/** @see https://drafts.csswg.org/css-syntax/#consume-comment */
	function consumeComments() {
		while (next(1) == 0x2f && next(2) == 0x2a) {
			consume(2);
			while (true) {
				consume();
				if (code == 0x2a && next() == 0x2f) {
					consume();
					break;
				} else if (eof()) {
					parseerror();
					return;
				}
			}
		}
	}

	/** @see https://drafts.csswg.org/css-syntax/#consume-numeric-token */
	function consumeANumericToken(from: Pos) {
		const { value, isInteger, sign } = consumeANumber();
		if (wouldStartAnIdentifier(next(1), next(2), next(3))) {
			const unit = consumeAName();
			const to = pos();
			return new DimensionToken(value, unit, sign, { from, to });
		} else if (next() == 0x25) {
			consume();
			const to = pos();
			return new PercentageToken(value, sign, { from, to });
		} else {
			const to = pos();
			return new NumberToken(value, isInteger, sign, { from, to });
		}
	}

	/** @see https://drafts.csswg.org/css-syntax/#consume-ident-like-token */
	function consumeAnIdentlikeToken(from: Pos) {
		const str = consumeAName();
		if (str.toLowerCase() == "url" && next() == 0x28) {
			consume();
			while (whitespace(next(1)) && whitespace(next(2))) consume();
			if (next() == 0x22 || next() == 0x27) {
				const to = pos();
				return new FunctionToken(str, { from, to });
			} else if (whitespace(next()) && (next(2) == 0x22 || next(2) == 0x27)) {
				const to = pos();
				return new FunctionToken(str, { from, to });
			} else {
				return consumeAURLToken(from);
			}
		} else if (next() == 0x28) {
			consume();
			const to = pos();
			return new FunctionToken(str, { from, to });
		} else {
			const to = pos();
			return new IdentToken(str, { from, to });
		}
	}

	/** @see https://drafts.csswg.org/css-syntax/#consume-string-token */
	function consumeAStringToken(from: Pos, endingCodePoint = code) {
		let string = "";
		while (consume()) {
			if (code == endingCodePoint || eof() || code == null) {
				const to = pos();
				return new StringToken(string, { from, to });
			} else if (newline(code)) {
				parseerror();
				reconsume();
				const to = pos();
				return new BadStringToken({ from, to });
			} else if (code == 0x5c) {
				if (eof(next())) {
					donothing();
				} else if (newline(next())) {
					consume();
				} else {
					string += String.fromCodePoint(consumeEscape());
				}
			} else {
				string += String.fromCodePoint(code);
			}
		}
	}

	/** @see https://drafts.csswg.org/css-syntax/#consume-url-token */
	function consumeAURLToken(from: Pos) {
		const to = pos();
		const token = new URLToken("", { from, to });
		while (whitespace(next())) consume();
		if (eof(next())) return token;
		while (consume()) {
			if (code == 0x29 || eof()) {
				const to = pos();
				token.debug.to = to;
				return token;
			} else if (whitespace(code)) {
				while (whitespace(next())) consume();
				if (next() == 0x29 || eof(next())) {
					consume();
					const to = pos();
					token.debug.to = to;
					return token;
				} else {
					consumeTheRemnantsOfABadURL();
					const to = pos();
					return new BadURLToken({ from, to });
				}
			} else if (code == 0x22 || code == 0x27 || code == 0x28 || nonprintable(code)) {
				parseerror();
				consumeTheRemnantsOfABadURL();
				const to = pos();
				return new BadURLToken({ from, to });
			} else if (code == 0x5c) {
				if (startsWithAValidEscape()) {
					token.value += String.fromCodePoint(consumeEscape());
				} else {
					parseerror();
					consumeTheRemnantsOfABadURL();
					const to = pos();
					return new BadURLToken({ from, to });
				}
			} else {
				token.value += String.fromCodePoint(code);
			}
		}
	}

	/** @see https://drafts.csswg.org/css-syntax/#consume-escaped-code-point */
	function consumeEscape() {
		// Assume the the current character is the \
		// and the next code point is not a newline.
		consume();
		if (hexdigit(code)) {
			// Consume 1-6 hex digits
			const digits = [code];
			for (let total = 0; total < 5; total++) {
				if (hexdigit(next())) {
					consume();
					digits.push(code);
				} else {
					break;
				}
			}
			if (whitespace(next())) consume();
			let value = parseInt(
				digits
					.map(function (x) {
						return String.fromCharCode(x);
					})
					.join(""),
				16,
			);
			if (value > maximumallowedcodepoint) value = 0xfffd;
			return value;
		} else if (eof()) {
			return 0xfffd;
		} else {
			return code;
		}
	}

	/** @see https://drafts.csswg.org/css-syntax/#starts-with-a-valid-escape */
	function areAValidEscape(c1: number, c2: number) {
		if (c1 != 0x5c) return false;
		if (newline(c2)) return false;
		return true;
	}
	function startsWithAValidEscape() {
		return areAValidEscape(code, next());
	}

	/** @see https://drafts.csswg.org/css-syntax/#would-start-an-identifier */
	function wouldStartAnIdentifier(c1: number, c2: number, c3: number) {
		if (c1 == 0x2d) {
			return namestartchar(c2) || c2 == 0x2d || areAValidEscape(c2, c3);
		} else if (namestartchar(c1)) {
			return true;
		} else if (c1 == 0x5c) {
			return areAValidEscape(c1, c2);
		} else {
			return false;
		}
	}

	function startsWithAnIdentifier() {
		return wouldStartAnIdentifier(code, next(1), next(2));
	}

	/** @see https://drafts.csswg.org/css-syntax/#starts-with-a-number */
	function wouldStartANumber(c1: number, c2: number, c3: number) {
		if (c1 == 0x2b || c1 == 0x2d) {
			if (digit(c2)) return true;
			if (c2 == 0x2e && digit(c3)) return true;
			return false;
		} else if (c1 == 0x2e) {
			if (digit(c2)) return true;
			return false;
		} else if (digit(c1)) {
			return true;
		} else {
			return false;
		}
	}

	function startsWithANumber() {
		return wouldStartANumber(code, next(1), next(2));
	}
	/** @see https://drafts.csswg.org/css-syntax/#starts-a-unicode-range */
	function wouldStartAUnicodeRange(c1: number, c2: number, c3: number) {
		if (c1 == 0x55 || c1 == 0x75) if (c2 == 0x2b) if (c3 == 0x3f || hexdigit(c3)) return true;
		return false;
	}

	/** @see https://drafts.csswg.org/css-syntax/#consume-name */
	function consumeAName() {
		let result = "";
		while (consume()) {
			if (namechar(code)) {
				result += String.fromCodePoint(code);
			} else if (startsWithAValidEscape()) {
				result += String.fromCodePoint(consumeEscape());
			} else {
				reconsume();
				return result;
			}
		}

		return result; // unreachable
	}

	/** @see https://drafts.csswg.org/css-syntax/#consume-number */
	function consumeANumber() {
		let isInteger = true;
		let sign = "";
		let numberPart = "";
		let exponentPart = "";
		if (next() == 0x2b || next() == 0x2d) {
			consume();
			sign = String.fromCodePoint(code);
			numberPart += sign;
		}
		while (digit(next())) {
			consume();
			numberPart += String.fromCodePoint(code);
		}
		if (next(1) == 0x2e && digit(next(2))) {
			consume();
			numberPart += ".";
			while (digit(next())) {
				consume();
				numberPart += String.fromCodePoint(code);
			}
			isInteger = false;
		}
		const [c1, c2, c3] = [next(1), next(2), next(3)];
		const eDigit = (c1 == 0x45 || c1 == 0x65) && digit(c2);
		const eSignDigit = (c1 == 0x45 || c1 == 0x65) && (c2 == 0x2b || c2 == 0x2d) && digit(c3);
		if (eDigit || eSignDigit) {
			consume();
			if (eSignDigit) {
				consume();
				exponentPart += String.fromCodePoint(code);
			}
			while (digit(next())) {
				consume();
				exponentPart += String.fromCodePoint(code);
			}
			isInteger = false;
		}
		let value = +numberPart;
		if (exponentPart) value = value * Math.pow(10, +exponentPart);

		return { value, isInteger, sign };
	}

	/** @see https://drafts.csswg.org/css-syntax/#consume-a-unicode-range-token */
	function consumeAUnicodeRangeToken(from: Pos) {
		let firstSegment = "";
		let start = "";
		let end = "";
		consume();
		consume();
		while (hexdigit(next()) && firstSegment.length <= 6) {
			consume();
			firstSegment += String.fromCodePoint(code);
		}
		if (firstSegment.length < 6 && next() == 0x3f) {
			let wildcardLen = 0;
			while (next() == 0x3f && firstSegment.length <= 6) {
				consume();
				wildcardLen++;
			}
			start = firstSegment + String.fromCodePoint(0x30).repeat(wildcardLen);
			end = firstSegment + String.fromCodePoint(0x46).repeat(wildcardLen);
			const to = pos();
			return new UnicodeRangeToken(start, end, { from, to });
		}
		start = firstSegment;
		if (next(1) == 0x2d && hexdigit(next(2))) {
			consume();
			while (hexdigit(next()) && end.length <= 6) {
				consume();
				end += String.fromCodePoint(code);
			}
			const to = pos();
			return new UnicodeRangeToken(start, end, { from, to });
		}
		const to = pos();
		return new UnicodeRangeToken(start, start, { from, to });
	}

	/** @see https://drafts.csswg.org/css-syntax/#consume-remnants-of-bad-url */
	function consumeTheRemnantsOfABadURL() {
		while (consume()) {
			if (code == 0x29 || eof()) {
				return;
			} else if (startsWithAValidEscape()) {
				consumeEscape();
				donothing();
			} else {
				donothing();
			}
		}
	}

	let iterationCount = 0;
	while (!eof(next())) {
		// should reasonably be not undefined
		tokens.push(consumeAToken()!);
		iterationCount++;
		if (iterationCount > codepoints.length * 2) throw "I'm infinite-looping!";
	}
	return tokens;
}

class CSSParserToken {
	public value: unknown;

	constructor(public type: string, public debug: Debug) {}

	toJSON() {
		return { type: this.type };
	}
	toString() {
		return this.type;
	}
	toSource(): string {
		throw new TypeError("Not implemented.");
	}
}

class BadStringToken extends CSSParserToken {
	constructor(debug: Debug) {
		super("BADSTRING", debug);
	}
	toSource() {
		return '"\n"';
	}
}

class BadURLToken extends CSSParserToken {
	public tokenType: string = "BADURL";
	constructor(debug: Debug) {
		super("BADURL", debug);
	}
	toSource() {
		return "url(BADURL '')";
	}
}

class WhitespaceToken extends CSSParserToken {
	constructor(debug: Debug) {
		super("WHITESPACE", debug);
	}
	toString() {
		return "WS";
	}
	toSource() {
		return " ";
	}
}

class CDOToken extends CSSParserToken {
	constructor(debug: Debug) {
		super("CDO", debug);
	}
	toSource() {
		return "<!--";
	}
}

class CDCToken extends CSSParserToken {
	constructor(debug: Debug) {
		super("CDC", debug);
	}
	toSource() {
		return "-->";
	}
}

/** @see https://drafts.csswg.org/css-syntax/#typedef-unicode-range-token */
class UnicodeRangeToken extends CSSParserToken {
	constructor(public start: string, public end: string, debug: Debug) {
		super("UNICODE-RANGE", debug);
	}
	toSource(): string {
		if (this.start === this.end) return "U+" + this.start;
		return `U+${this.start}-${this.end}`;
	}
}

class ColonToken extends CSSParserToken {
	constructor(debug: Debug) {
		super("COLON", debug);
	}
	toSource() {
		return ":";
	}
}

class SemicolonToken extends CSSParserToken {
	constructor(debug: Debug) {
		super("SEMICOLON", debug);
	}
	toSource() {
		return ";";
	}
}

class CommaToken extends CSSParserToken {
	constructor(debug: Debug) {
		super("COMMA", debug);
	}
	toSource() {
		return ",";
	}
}

class OpenCurlyToken extends CSSParserToken {
	public grouping = true;
	public mirror: typeof CloseCurlyToken;
	constructor(debug: Debug) {
		super("OPEN-CURLY", debug);
		this.mirror = CloseCurlyToken;
	}
	toSource() {
		return "{";
	}
}

class CloseCurlyToken extends CSSParserToken {
	constructor(debug: Debug) {
		super("CLOSE-CURLY", debug);
	}
	toSource() {
		return "}";
	}
}

class OpenSquareToken extends CSSParserToken {
	public grouping = true;
	public mirror: typeof CloseSquareToken;
	constructor(debug: Debug) {
		super("OPEN-SQUARE", debug);
		this.mirror = CloseSquareToken;
	}
	toSource() {
		return "[";
	}
}

class CloseSquareToken extends CSSParserToken {
	constructor(debug: Debug) {
		super("CLOSE-SQUARE", debug);
	}
	toSource() {
		return "]";
	}
}

class OpenParenToken extends CSSParserToken {
	public grouping = true;
	public mirror: typeof CloseParenToken;
	constructor(debug: Debug) {
		super("OPEN-PAREN", debug);
		this.mirror = CloseParenToken;
	}
	toSource() {
		return "(";
	}
}

class CloseParenToken extends CSSParserToken {
	constructor(debug: Debug) {
		super("CLOSE-PAREN", debug);
	}
	toSource() {
		return ")";
	}
}

class EOFToken extends CSSParserToken {
	constructor(debug: Debug) {
		super("EOF", debug);
	}
	toSource() {
		return "";
	}
}

class DelimToken extends CSSParserToken {
	public value: string;
	constructor(val: number | string, debug: Debug) {
		super("DELIM", debug);
		if (typeof val == "number") {
			val = String.fromCodePoint(val);
		} else {
			val = String(val);
		}
		this.value = val;
	}
	toString() {
		return `DELIM(${this.value})`;
	}
	toJSON() {
		return { type: this.type, value: this.value };
	}
	toSource() {
		if (this.value == "\\") return "\\\n";
		return this.value;
	}
}

class IdentToken extends CSSParserToken {
	constructor(public value: string, debug: Debug) {
		super("IDENT", debug);
	}
	toString() {
		return `IDENT(${this.value})`;
	}
	toJSON() {
		return { type: this.type, value: this.value };
	}
	toSource() {
		return escapeIdent(this.value);
	}
}

class FunctionToken extends CSSParserToken {
	public mirror: typeof CloseParenToken;
	constructor(public value: string, debug: Debug) {
		super("FUNCTION", debug);
		this.mirror = CloseParenToken;
	}
	toString() {
		return `FUNCTION(${this.value})`;
	}
	toJSON() {
		return { type: this.type, value: this.value };
	}
	toSource() {
		return escapeIdent(this.value) + "(";
	}
}

class AtKeywordToken extends CSSParserToken {
	constructor(public value: string, debug: Debug) {
		super("AT-KEYWORD", debug);
	}
	toString() {
		return `AT(${this.value})`;
	}
	toJSON() {
		return { type: this.type, value: this.value };
	}
	toSource() {
		return "@" + escapeIdent(this.value);
	}
}

class HashToken extends CSSParserToken {
	constructor(public value: string, public isIdent: boolean, debug: Debug) {
		super("HASH", debug);
	}
	toString() {
		return `HASH(${this.value})`;
	}
	toJSON() {
		return { type: this.type, value: this.value, isIdent: this.isIdent };
	}
	toSource() {
		if (this.isIdent) {
			return "#" + escapeIdent(this.value);
		}
		return "#" + escapeHash(this.value);
	}
}

class StringToken extends CSSParserToken {
	constructor(public value: string, debug: Debug) {
		super("STRING", debug);
	}
	toString() {
		return `STRING(${this.value})`;
	}
	toJSON() {
		return { type: this.type, value: this.value };
	}
	toSource() {
		return `"${escapeString(this.value)}"`;
	}
}

class URLToken extends CSSParserToken {
	constructor(public value: string, debug: Debug) {
		super("URL", debug);
	}
	toString() {
		return `URL(${this.value})`;
	}
	toJSON() {
		return { type: this.type, value: this.value };
	}
	toSource() {
		return `url("${escapeString(this.value)}")`;
	}
}

class NumberToken extends CSSParserToken {
	constructor(public value: number, public isInteger: boolean, public sign: string, debug: Debug) {
		super("NUMBER", debug);
	}
	toString() {
		const name = this.isInteger ? "INT" : "NUMBER";
		const sign = this.sign == "+" ? "+" : "";
		return `${name}(${sign}${this.value})`;
	}
	toJSON() {
		return {
			type: this.type,
			value: this.value,
			isInteger: this.isInteger,
			sign: this.sign,
		};
	}
	toSource() {
		return formatNumber(this.value, this.sign);
	}
}

class PercentageToken extends CSSParserToken {
	constructor(public value: number, public sign: string, debug: Debug) {
		super("PERCENTAGE", debug);
	}
	toString() {
		const sign = this.sign == "+" ? "+" : "";
		return `PERCENTAGE(${sign}${this.value})`;
	}
	toJSON() {
		return { type: this.type, value: this.value, sign: this.sign };
	}
	toSource() {
		return `${formatNumber(this.value, this.sign)}%`;
	}
}

class DimensionToken extends CSSParserToken {
	constructor(public value: number, public unit: string, public sign: string, debug: Debug) {
		super("DIMENSION", debug);
	}
	toString() {
		const sign = this.sign == "+" ? "+" : "";
		return `DIM(${sign}${this.value}, ${this.unit})`;
	}
	toJSON() {
		return { type: this.type, value: this.value, unit: this.unit };
	}
	toSource() {
		let unit = escapeIdent(this.unit);
		if (unit[0].toLowerCase() == "e" && (unit[1] == "-" || digit(char(unit[1])))) {
			// Unit is ambiguous with scinot
			// Remove the leading "e", replace with escape.
			unit = "\\65 " + unit.slice(1, unit.length);
		}
		return `${formatNumber(this.value, this.sign)}${unit}`;
	}
}

type Tokens =
	| BadStringToken
	| BadURLToken
	| WhitespaceToken
	| CDOToken
	| CDCToken
	| UnicodeRangeToken
	| ColonToken
	| SemicolonToken
	| CommaToken
	| OpenCurlyToken
	| CloseCurlyToken
	| OpenSquareToken
	| CloseSquareToken
	| OpenParenToken
	| CloseParenToken
	| EOFToken
	| DelimToken
	| IdentToken
	| FunctionToken
	| AtKeywordToken
	| HashToken
	| StringToken
	| URLToken
	| NumberToken
	| PercentageToken
	| DimensionToken;

function escapeIdent(string: string) {
	return Array.from(String(string), (e, i) => {
		const code = char(e);
		if (i == 0) {
			if (namestartchar(code)) return e;
			return escapeIdentCode(code);
		}
		if (namechar(code)) return e;
		return escapeIdentCode(code);
	}).join("");
}

function escapeIdentCode(code: number) {
	if (digit(code) || letter(code)) {
		return `\\${code.toString(16)} `;
	}
	return "\\" + String.fromCodePoint(code);
}

function escapeHash(string: string) {
	// Escapes the value (after the #) of a hash.
	return Array.from(String(string), e => {
		const code = char(e);
		if (namechar(code)) return e;
		return escapeIdentCode(code);
	}).join("");
}

function escapeString(string: string) {
	// Escapes the contents (between the quotes) of a string
	return Array.from(String(string), e => {
		const code = char(e);
		if (between(code, 0x0, 0x1f) || code == 0x7f || code == 0x22 || code == 0x5c) {
			return "\\" + code.toString(16) + " ";
		}
		return e;
	}).join("");
}

function formatNumber(num: number, sign?: string) {
	// TODO: Fix this to match CSS stringification behavior.
	return (sign == "+" ? "+" : "") + String(num);
}

export {
	AtKeywordToken,
	BadStringToken,
	BadURLToken,
	CDCToken,
	CDOToken,
	UnicodeRangeToken,
	CloseCurlyToken,
	CloseParenToken,
	CloseSquareToken,
	ColonToken,
	CommaToken,
	CSSParserToken,
	DelimToken,
	DimensionToken,
	EOFToken,
	FunctionToken,
	HashToken,
	IdentToken,
	NumberToken,
	OpenCurlyToken,
	OpenParenToken,
	OpenSquareToken,
	PercentageToken,
	SemicolonToken,
	StringToken,
	tokenize,
	URLToken,
	WhitespaceToken,
};

/** @see https://drafts.csswg.org/css-syntax/#parser-definitions */
class TokenStream {
	public index: number;
	public markedIndexes: number[];
	public pos: Pos;
	constructor(public tokens: CSSParserToken[]) {
		// Assume that tokens is an array.
		this.index = 0;
		this.pos = { line: 0, column: 0 };
		this.markedIndexes = [];
	}
	nextToken() {
		if (this.index < this.tokens.length) return this.tokens[this.index];
		const pos = { ...this.pos };
		return new EOFToken({ from: pos, to: pos });
	}
	empty() {
		return this.index >= this.tokens.length;
	}
	consumeAToken() {
		const tok = this.nextToken();
		this.index++;
		this.pos = { ...tok.debug.to };
		return tok;
	}
	discardAToken() {
		this.index++;
	}
	mark() {
		this.markedIndexes.push(this.index);
		return this;
	}
	restoreAMark() {
		if (this.markedIndexes.length) {
			this.index = this.markedIndexes.pop()!;
			return this;
		}
		throw new Error("No marks to restore.");
	}
	discardAMark() {
		if (this.markedIndexes.length) {
			this.markedIndexes.pop();
			return this;
		}
		throw new Error("No marks to restore.");
	}
	discardWhitespace() {
		while (this.nextToken() instanceof WhitespaceToken) {
			this.discardAToken();
		}
		return this;
	}
}

function parseerror(s: TokenStream, msg: string) {
	console.log("Parse error at token " + s.index + ": " + s.tokens[s.index] + ".\n" + msg);
	return true;
}

function consumeAStylesheetsContents(s: TokenStream) {
	const rules: TopLevel[] = [];
	while (1) {
		const token = s.nextToken();
		if (token instanceof WhitespaceToken) {
			s.discardAToken();
		} else if (token instanceof EOFToken) {
			return rules;
		} else if (token instanceof CDOToken || token instanceof CDCToken) {
			s.discardAToken();
		} else if (token instanceof AtKeywordToken) {
			const rule = consumeAnAtRule(s);
			if (rule) rules.push(rule);
		} else {
			const rule = consumeAQualifiedRule(s);
			if (rule) rules.push(rule);
		}
	}

	return rules; // unreachable
}

function consumeAnAtRule(s: TokenStream, nested = false) {
	const token = s.consumeAToken();
	if (!(token instanceof AtKeywordToken)) {
		throw new Error("consumeAnAtRule() called with an invalid token stream state.");
	}
	const from = { ...s.pos };
	const rule = new AtRule(token.value, { from, to: from });
	while (1) {
		const token = s.nextToken();
		if (token instanceof SemicolonToken || token instanceof EOFToken) {
			s.discardAToken();
			return filterValid(rule);
		} else if (token instanceof CloseCurlyToken) {
			if (nested) return filterValid(rule);
			else {
				parseerror(s, "Hit an unmatched } in the prelude of an at-rule.");
				rule.prelude.push(s.consumeAToken());
			}
		} else if (token instanceof OpenCurlyToken) {
			[rule.declarations, rule.rules] = consumeABlock(s);
			return filterValid(rule);
		} else {
			rule.prelude.push(consumeAComponentValue(s));
		}
	}
}

function consumeAQualifiedRule(s: TokenStream, nested = false, stopToken = EOFToken) {
	const from = { ...s.pos };
	const rule = new QualifiedRule({ from, to: from });
	while (1) {
		const token = s.nextToken();
		if (token instanceof EOFToken || token instanceof stopToken) {
			parseerror(s, "Hit EOF or semicolon when trying to parse the prelude of a qualified rule.");
			return;
		} else if (token instanceof CloseCurlyToken) {
			parseerror(s, "Hit an unmatched } in the prelude of a qualified rule.");
			if (nested) return;
			else {
				rule.prelude.push(s.consumeAToken());
			}
		} else if (token instanceof OpenCurlyToken) {
			if (looksLikeACustomProperty(rule.prelude)) {
				consumeTheRemnantsOfABadDeclaration(s, nested);
				return;
			}
			[rule.declarations, rule.rules] = consumeABlock(s);
			const filtered = filterValid(rule);
			if (filtered) filtered.debug.to = { ...token.debug.to };
			return filtered;
		} else {
			rule.prelude.push(consumeAComponentValue(s));
		}
	}
}

function looksLikeACustomProperty(tokens: CSSParserToken[]) {
	let foundDashedIdent = false;
	for (const token of tokens) {
		if (token instanceof WhitespaceToken) continue;
		if (!foundDashedIdent && token instanceof IdentToken && token.value.slice(0, 2) == "--") {
			foundDashedIdent = true;
			continue;
		}
		if (foundDashedIdent && token instanceof ColonToken) {
			return true;
		}
		return false;
	}
	return false;
}

function consumeABlock(s: TokenStream) {
	if (!(s.nextToken() instanceof OpenCurlyToken)) {
		throw new Error("consumeABlock() called with an invalid token stream state.");
	}
	s.discardAToken();
	const [decls, rules] = consumeABlocksContents(s);
	s.discardAToken();
	return [decls, rules];
}

function consumeABlocksContents(s: TokenStream): [decls: CSSParserRule[], rules: CSSParserRule[]] {
	const decls: CSSParserRule[] = [];
	const rules: CSSParserRule[] = [];
	while (1) {
		const token = s.nextToken();
		if (token instanceof WhitespaceToken || token instanceof SemicolonToken) {
			s.discardAToken();
		} else if (token instanceof EOFToken || token instanceof CloseCurlyToken) {
			return [decls, rules];
		} else if (token instanceof AtKeywordToken) {
			const rule = consumeAnAtRule(s, true);
			if (rule) rules.push(rule);
		} else {
			s.mark();
			const decl = consumeADeclaration(s, true);
			if (decl) {
				decls.push(decl);
				s.discardAMark();
				continue;
			}
			s.restoreAMark();
			const rule = consumeAQualifiedRule(s, true, SemicolonToken);
			if (rule) rules.push(rule);
		}
	}
	return [decls, rules];
}

function consumeADeclaration(s: TokenStream, nested = false) {
	let decl;
	if (s.nextToken() instanceof IdentToken) {
		const token = s.consumeAToken() as IdentToken;
		decl = new Declaration(token.value, { ...token.debug });
	} else {
		consumeTheRemnantsOfABadDeclaration(s, nested);
		return;
	}
	s.discardWhitespace();
	if (s.nextToken() instanceof ColonToken) {
		s.discardAToken();
	} else {
		consumeTheRemnantsOfABadDeclaration(s, nested);
		return;
	}
	s.discardWhitespace();
	decl.value = consumeAListOfComponentValues(s, nested, SemicolonToken);

	let foundImportant = false;
	for (let i = decl.value.length - 1; i >= 0; i--) {
		const val = decl.value[i];
		if (val instanceof WhitespaceToken) {
			continue;
		} else if (!foundImportant && val instanceof IdentToken && asciiCaselessMatch(val.value, "important")) {
			foundImportant = true;
		} else if (foundImportant && val instanceof DelimToken && val.value == "!") {
			decl.value.length = i;
			decl.important = true;
			break;
		} else {
			break;
		}
	}

	let i = decl.value.length - 1;
	while (decl.value[i] instanceof WhitespaceToken) {
		decl.value.length = i;
		i--;
	}
	const valid = filterValid(decl);
	const last = decl.value.at(-1);
	if (valid && last) valid.debug.to = last.debug.to;
	return valid;
}

function consumeTheRemnantsOfABadDeclaration(s: TokenStream, nested: boolean) {
	while (1) {
		const token = s.nextToken();
		if (token instanceof EOFToken || token instanceof SemicolonToken) {
			s.discardAToken();
			return;
		} else if (token instanceof CloseCurlyToken) {
			if (nested) return;
			else s.discardAToken();
		} else {
			consumeAComponentValue(s);
		}
	}
}

function consumeAListOfComponentValues(s: TokenStream, nested = false, stopToken = EOFToken) {
	const values = [];
	while (1) {
		const token = s.nextToken();
		if (token instanceof EOFToken || token instanceof stopToken) {
			return values;
		} else if (token instanceof CloseCurlyToken) {
			if (nested) return values;
			else {
				parseerror(s, "Hit an unmatched } in a declaration value.");
				values.push(s.consumeAToken());
			}
		} else {
			values.push(consumeAComponentValue(s));
		}
	}

	return values; // unreachable
}

function consumeAComponentValue(s: TokenStream) {
	const token = s.nextToken();
	if (token instanceof OpenCurlyToken || token instanceof OpenSquareToken || token instanceof OpenParenToken) {
		return consumeASimpleBlock(s);
	}
	if (token instanceof FunctionToken) return consumeAFunction(s);
	return s.consumeAToken();
}

/** @see https://drafts.csswg.org/css-syntax/#consume-a-simple-block */
function consumeASimpleBlock(s: TokenStream): SimpleBlock {
	// @ts-expect-error quack-checking
	if (!s.nextToken().mirror) {
		throw new Error("consumeASimpleBlock() called with an invalid token stream state.");
	}
	const start = s.nextToken();
	const block = new SimpleBlock(start.toSource() as keyof typeof mirror, { ...start.debug });
	s.discardAToken();
	while (1) {
		const token = s.nextToken();
		if (
			token instanceof EOFToken ||
			// @ts-expect-error quack-checking
			token instanceof start.mirror
		) {
			s.discardAToken();
			block.debug.to = { ...token.debug.from };
			return block;
		} else {
			block.value.push(consumeAComponentValue(s));
		}
	}

	return block; // unreachable
}

/** @see https://drafts.csswg.org/css-syntax/#consume-a-function */
function consumeAFunction(s: TokenStream): Func {
	if (!(s.nextToken() instanceof FunctionToken)) {
		throw new Error("consumeAFunction() called with an invalid token stream state.");
	}
	// safe assertion, verified above
	const token = s.consumeAToken() as FunctionToken;
	const func = new Func(token.value, { ...token.debug });
	while (1) {
		const token = s.nextToken();
		if (token instanceof EOFToken || token instanceof CloseParenToken) {
			s.discardAToken();
			func.debug.to = { ...token.debug.from };
			return func;
		} else {
			func.value.push(consumeAComponentValue(s));
		}
	}

	return func; // unreachable
}

export type TopLevel = AtRule | QualifiedRule | Declaration;

function isValidInContext(construct: TopLevel, context: unknown) {
	// Trivial validator, without any special CSS knowledge.

	// All at-rules are valid, who cares.
	if (construct.type == "AT-RULE") return true;

	// Exclude qualified rules that ended up with a semicolon
	// in their prelude.
	// (Can only happen at the top level of a stylesheet.)
	if (construct.type == "QUALIFIED-RULE") {
		for (const val of construct.prelude) {
			if (val.type == "SEMICOLON") return false;
		}
		return true;
	}

	// Exclude properties that ended up with a {}-block
	// in their value, unless they're custom.
	if (construct.type == "DECLARATION") {
		if (construct.name.slice(0, 2) == "--") return true;
		for (const val of construct.value ?? []) {
			if (val.type == "BLOCK" && (val as SimpleBlock).name == "{") return false;
		}
		return true;
	}
}

function filterValid(construct: TopLevel, context?: unknown) {
	if (isValidInContext(construct, context)) return construct;
	return;
}

function normalizeInput(input: string | TokenStream | CSSParserToken[]) {
	if (typeof input == "string") return new TokenStream(tokenize(input));
	if (input instanceof TokenStream) return input;
	if (input.length !== undefined) return new TokenStream(input);
	else throw SyntaxError(String(input));
}

/** @see https://drafts.csswg.org/css-syntax/#parse-a-stylesheet */
function parseAStylesheet(s: string | TokenStream) {
	s = normalizeInput(s);
	const sheet = new Stylesheet({ from: { line: 0, column: 0 }, to: s.pos });
	sheet.rules = consumeAStylesheetsContents(s);
	return sheet;
}

/** @see https://drafts.csswg.org/css-syntax/#parse-stylesheet-contents */
function parseAStylesheetsContents(s: TokenStream) {
	s = normalizeInput(s);
	return consumeAStylesheetsContents(s);
}

/** @see https://drafts.csswg.org/css-syntax/#parse-block-contents */
function parseABlocksContents(s: TokenStream) {
	s = normalizeInput(s);
	return consumeABlocksContents(s);
}

/** @see https://drafts.csswg.org/css-syntax/#parse-rule */
function parseARule(s: TokenStream) {
	s = normalizeInput(s);
	let rule;
	s.discardWhitespace();
	if (s.nextToken() instanceof EOFToken) throw SyntaxError();
	if (s.nextToken() instanceof AtKeywordToken) {
		rule = consumeAnAtRule(s);
	} else {
		rule = consumeAQualifiedRule(s);
		if (!rule) throw SyntaxError();
	}
	s.discardWhitespace();
	if (s.nextToken() instanceof EOFToken) return rule;
	throw SyntaxError();
}

/** @see https://drafts.csswg.org/css-syntax/#parse-declaration */
function parseADeclaration(s: TokenStream) {
	s = normalizeInput(s);
	s.discardWhitespace();
	const decl = consumeADeclaration(s);
	if (decl) return decl;
	throw SyntaxError();
}

/** @see https://drafts.csswg.org/css-syntax/#parse-component-value */
function parseAComponentValue(s: TokenStream) {
	s = normalizeInput(s);
	s.discardWhitespace();
	if (s.empty()) throw SyntaxError();
	const val = consumeAComponentValue(s);
	s.discardWhitespace();
	if (s.empty()) return val;
	throw SyntaxError();
}

/** @see https://drafts.csswg.org/css-syntax/#parse-list-of-component-values */
function parseAListOfComponentValues(s: TokenStream) {
	s = normalizeInput(s);
	return consumeAListOfComponentValues(s);
}

/** @see https://drafts.csswg.org/css-syntax/#parse-comma-separated-list-of-component-values */
function parseACommaSeparatedListOfComponentValues(s: TokenStream) {
	s = normalizeInput(s);
	const groups = [];
	while (!s.empty()) {
		groups.push(consumeAListOfComponentValues(s, false, CommaToken));
		s.discardAToken();
	}
	return groups;
}

class CSSParserRule<Type extends string = string> {
	constructor(public type: Type, public name: string, public debug: Debug) {}
	toSource(ident: number = 0) {
		return "";
	}
	toString(indent?: number) {
		return JSON.stringify(this, null, indent);
	}
}

/** @see https://drafts.csswg.org/css-syntax/#css-stylesheet */
class Stylesheet extends CSSParserRule {
	public rules: CSSParserRule[] = [];
	constructor(debug: Debug) {
		super("STYLESHEET", "Stylesheet", debug);
	}
	toJSON() {
		return {
			type: this.type,
			rules: this.rules,
		};
	}
	toString(ident: string | number = "") {
		return JSON.stringify(this.toJSON(), null, ident);
	}
	toSource(ident?: number) {
		return this.rules.map(x => x.toSource(ident)).join("\n");
	}
}

/** @see https://drafts.csswg.org/css-syntax/#at-rule */
class AtRule extends CSSParserRule<"AT-RULE"> {
	public prelude: CSSParserToken[] = [];
	public declarations: CSSParserRule[] = [];
	public rules: CSSParserRule[] = [];
	constructor(public name: string, debug: Debug) {
		super("AT-RULE", name, debug);
	}
	toJSON() {
		return {
			type: this.type,
			name: this.name,
			prelude: this.prelude,
			declarations: this.declarations,
			rules: this.rules,
		};
	}
	toSource(indent = 0) {
		let s = getIndent(indent) + "@" + escapeIdent(this.name);
		s += this.prelude.map(x => x.toSource()).join("");
		if (this.declarations == null) {
			s += ";\n";
			return s;
		}
		s += "{\n";

		s += this.declarations.map(x => x.toSource(indent + 1)).join("\n") + "\n";

		if (this.rules?.length) {
			s += this.rules.map(x => x.toSource(indent + 1)).join("\n") + "\n";
		}
		s += getIndent(indent) + "}";
		return s;
	}
}

/** @see https://drafts.csswg.org/css-syntax/#qualified-rule */
class QualifiedRule extends CSSParserRule<"QUALIFIED-RULE"> {
	public prelude: CSSParserToken[] = [];
	public declarations: CSSParserRule[] = [];
	public rules: CSSParserRule[] = [];
	constructor(debug: Debug) {
		super("QUALIFIED-RULE", "QualifiedRule", debug);
	}
	toJSON() {
		return {
			type: this.type,
			prelude: this.prelude,
			declarations: this.declarations,
			rules: this.rules,
		};
	}
	toSource(indent = 0) {
		let s = getIndent(indent);
		s += this.prelude.map(x => x.toSource()).join("");
		s += "{\n";
		if (this.declarations.length) {
			s += this.declarations.map(x => x.toSource(indent + 1)).join("\n") + "\n";
		}
		if (this.rules.length) {
			s += this.rules.map(x => x.toSource(indent + 1)).join("\n") + "\n";
		}
		s += getIndent(indent) + "}";
		return s;
	}
}

/** @see https://drafts.csswg.org/css-syntax/#preserved-tokens */
type PreservedToken = Exclude<Tokens, FunctionToken | OpenCurlyToken | OpenParenToken | OpenSquareToken>;

/** @see https://drafts.csswg.org/css-syntax/#component-value */
type ComponentValue = PreservedToken | Func | SimpleBlock;

/** @see https://drafts.csswg.org/css-syntax/#declaration */
class Declaration extends CSSParserRule<"DECLARATION"> {
	public value: ComponentValue[] = [];
	public important = false;
	constructor(public name: string, debug: Debug) {
		super("DECLARATION", name, debug);
	}
	toJSON() {
		return {
			type: this.type,
			name: this.name,
			value: this.value,
			important: this.important,
		};
	}
	toSource(indent = 0) {
		let s = getIndent(indent) + escapeIdent(this.name) + ": ";
		s += this.value.map(x => x.toSource()).join("");
		if (this.important) {
			s += "!important";
		}
		s += ";";
		return s;
	}
}

const mirror = { "{": "}", "[": "]", "(": ")" } as const;

/** @see https://drafts.csswg.org/css-syntax/#simple-block */
class SimpleBlock extends CSSParserRule {
	public value: (CSSParserToken | Func | SimpleBlock)[] = [];
	constructor(public name: keyof typeof mirror, debug: Debug) {
		super("BLOCK", name, debug);
	}
	toJSON() {
		return {
			type: this.type,
			name: this.name,
			value: this.value,
		};
	}
	toSource(): string {
		// todo: validate and remove safely
		return this.name + this.value.map(x => x.toSource()).join("") + mirror[this.name as keyof typeof mirror];
	}
}

/** @see https://drafts.csswg.org/css-syntax/#function */
class Func extends CSSParserRule {
	public value: CSSParserToken[] = [];
	constructor(public name: string, debug: Debug) {
		super("FUNCTION", name, debug);
	}
	toJSON() {
		return {
			type: this.type,
			name: this.name,
			value: this.value,
		};
	}
	toSource() {
		return escapeIdent(this.name) + "(" + this.value.map(x => x.toSource()).join("") + ")";
	}
}

function getIndent(level: number = 0) {
	return "\t".repeat(level);
}

export {
	AtRule,
	CSSParserRule,
	Declaration,
	Func,
	parseABlocksContents,
	parseACommaSeparatedListOfComponentValues,
	parseAComponentValue,
	parseADeclaration,
	parseAListOfComponentValues,
	parseARule,
	parseAStylesheet,
	parseAStylesheetsContents,
	QualifiedRule,
	SimpleBlock,
	Stylesheet,
};
