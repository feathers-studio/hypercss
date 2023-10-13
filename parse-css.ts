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

var maximumallowedcodepoint = 0x10ffff;

class InvalidCharacterError extends Error {
	constructor(public message: string) {
		super();
		this.name = "InvalidCharacterError";
	}
}

// https://drafts.csswg.org/css-syntax/#input-preprocessing
function preprocess(str: string) {
	// Turn a string into an array of code points,
	// following the preprocessing cleanup rules.
	const codepoints = [];
	for (var i = 0; i < str.length; i++) {
		let code = str.charCodeAt(i);
		if (code == 0xd && str.charCodeAt(i + 1) == 0xa) {
			code = 0xa;
			i++;
		}
		if (code == 0xd || code == 0xc) code = 0xa;
		if (code == 0x0) code = 0xfffd;
		if (between(code, 0xd800, 0xdbff) && between(str.charCodeAt(i + 1), 0xdc00, 0xdfff)) {
			// Decode a surrogate pair into an astral codepoint.
			var lead = code - 0xd800;
			var trail = str.charCodeAt(i + 1) - 0xdc00;
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

// https://drafts.csswg.org/css-syntax/#tokenization
function tokenize(str: string) {
	const codepoints = preprocess(str);
	let i = -1;
	const tokens: CSSParserToken[] = [];
	let code: number;

	// Line number information.
	var line = 0;
	var column = 0;
	// The only use of lastLineLength is in reconsume().
	var lastLineLength = 0;
	function incrLineno() {
		line += 1;
		lastLineLength = column;
		column = 0;
	}
	var locStart = { line: line, column: column };

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
		else column += num;
		//console.log('Consume '+i+' '+String.fromCharCode(code) + ' 0x' + code.toString(16));
		return true;
	}
	function reconsume() {
		i -= 1;
		if (newline(code)) {
			line -= 1;
			column = lastLineLength;
		} else {
			column -= 1;
		}
		locStart.line = line;
		locStart.column = column;
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

	// https://drafts.csswg.org/css-syntax/#consume-token
	function consumeAToken() {
		consumeComments();
		consume();
		if (code == null) return;
		if (whitespace(code)) {
			while (whitespace(next())) consume();
			return new WhitespaceToken();
		} else if (code == 0x22) return consumeAStringToken();
		else if (code == 0x23) {
			if (namechar(next()) || areAValidEscape(next(1), next(2))) {
				const isIdent = wouldStartAnIdentifier(next(1), next(2), next(3));
				return new HashToken(consumeAName()!, isIdent);
			} else {
				return new DelimToken(code);
			}
		} else if (code == 0x27) return consumeAStringToken();
		else if (code == 0x28) return new OpenParenToken();
		else if (code == 0x29) return new CloseParenToken();
		else if (code == 0x2b) {
			if (startsWithANumber()) {
				reconsume();
				return consumeANumericToken();
			} else {
				return new DelimToken(code);
			}
		} else if (code == 0x2c) return new CommaToken();
		else if (code == 0x2d) {
			if (startsWithANumber()) {
				reconsume();
				return consumeANumericToken();
			} else if (next(1) == 0x2d && next(2) == 0x3e) {
				consume(2);
				return new CDCToken();
			} else if (startsWithAnIdentifier()) {
				reconsume();
				return consumeAnIdentlikeToken();
			} else {
				return new DelimToken(code);
			}
		} else if (code == 0x2e) {
			if (startsWithANumber()) {
				reconsume();
				return consumeANumericToken();
			} else {
				return new DelimToken(code);
			}
		} else if (code == 0x3a) return new ColonToken();
		else if (code == 0x3b) return new SemicolonToken();
		else if (code == 0x3c) {
			if (next(1) == 0x21 && next(2) == 0x2d && next(3) == 0x2d) {
				consume(3);
				return new CDOToken();
			} else {
				return new DelimToken(code);
			}
		} else if (code == 0x40) {
			if (wouldStartAnIdentifier(next(1), next(2), next(3))) {
				return new AtKeywordToken(consumeAName()!);
			} else {
				return new DelimToken(code);
			}
		} else if (code == 0x5b) return new OpenSquareToken();
		else if (code == 0x5c) {
			if (startsWithAValidEscape()) {
				reconsume();
				return consumeAnIdentlikeToken();
			} else {
				parseerror();
				return new DelimToken(code);
			}
		} else if (code == 0x5d) return new CloseSquareToken();
		else if (code == 0x7b) return new OpenCurlyToken();
		else if (code == 0x7d) return new CloseCurlyToken();
		else if (digit(code)) {
			reconsume();
			return consumeANumericToken();
			reconsume();
			return consumeAnIdentlikeToken();
		} else if (namestartchar(code)) {
			reconsume();
			return consumeAnIdentlikeToken();
		} else if (eof()) return new EOFToken();
		else return new DelimToken(code);
	}

	// https://drafts.csswg.org/css-syntax/#consume-comment
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

	// https://drafts.csswg.org/css-syntax/#consume-numeric-token
	function consumeANumericToken() {
		var { value, isInteger, sign } = consumeANumber();
		if (wouldStartAnIdentifier(next(1), next(2), next(3))) {
			const unit = consumeAName();
			return new DimensionToken(value, unit, sign);
		} else if (next() == 0x25) {
			consume();
			return new PercentageToken(value, sign);
		} else {
			return new NumberToken(value, isInteger, sign);
		}
	}

	// https://drafts.csswg.org/css-syntax/#consume-ident-like-token
	function consumeAnIdentlikeToken() {
		var str = consumeAName();
		if (str.toLowerCase() == "url" && next() == 0x28) {
			consume();
			while (whitespace(next(1)) && whitespace(next(2))) consume();
			if (next() == 0x22 || next() == 0x27) {
				return new FunctionToken(str);
			} else if (whitespace(next()) && (next(2) == 0x22 || next(2) == 0x27)) {
				return new FunctionToken(str);
			} else {
				return consumeAURLToken();
			}
		} else if (next() == 0x28) {
			consume();
			return new FunctionToken(str);
		} else {
			return new IdentToken(str);
		}
	}

	// https://drafts.csswg.org/css-syntax/#consume-string-token
	function consumeAStringToken(endingCodePoint = code) {
		var string = "";
		while (consume()) {
			if (code == endingCodePoint || eof() || code == null) {
				return new StringToken(string);
			} else if (newline(code)) {
				parseerror();
				reconsume();
				return new BadStringToken();
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

	// https://drafts.csswg.org/css-syntax/#consume-url-token
	function consumeAURLToken() {
		var token = new URLToken("");
		while (whitespace(next())) consume();
		if (eof(next())) return token;
		while (consume()) {
			if (code == 0x29 || eof()) {
				return token;
			} else if (whitespace(code)) {
				while (whitespace(next())) consume();
				if (next() == 0x29 || eof(next())) {
					consume();
					return token;
				} else {
					consumeTheRemnantsOfABadURL();
					return new BadURLToken();
				}
			} else if (code == 0x22 || code == 0x27 || code == 0x28 || nonprintable(code)) {
				parseerror();
				consumeTheRemnantsOfABadURL();
				return new BadURLToken();
			} else if (code == 0x5c) {
				if (startsWithAValidEscape()) {
					token.value += String.fromCodePoint(consumeEscape());
				} else {
					parseerror();
					consumeTheRemnantsOfABadURL();
					return new BadURLToken();
				}
			} else {
				token.value += String.fromCodePoint(code);
			}
		}
	}

	// https://drafts.csswg.org/css-syntax/#consume-escaped-code-point
	function consumeEscape() {
		// Assume the the current character is the \
		// and the next code point is not a newline.
		consume();
		if (hexdigit(code)) {
			// Consume 1-6 hex digits
			var digits = [code];
			for (var total = 0; total < 5; total++) {
				if (hexdigit(next())) {
					consume();
					digits.push(code);
				} else {
					break;
				}
			}
			if (whitespace(next())) consume();
			var value = parseInt(
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

	// https://drafts.csswg.org/css-syntax/#starts-with-a-valid-escape
	function areAValidEscape(c1: number, c2: number) {
		if (c1 != 0x5c) return false;
		if (newline(c2)) return false;
		return true;
	}
	function startsWithAValidEscape() {
		return areAValidEscape(code, next());
	}

	// https://drafts.csswg.org/css-syntax/#would-start-an-identifier
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

	// https://drafts.csswg.org/css-syntax/#starts-with-a-number
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
	}

	// https://drafts.csswg.org/css-syntax/#consume-number
	function consumeANumber() {
		let isInteger = true;
		let sign;
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
		var c1 = next(1),
			c2 = next(2),
			c3 = next(3);
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

	var iterationCount = 0;
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

	constructor(public type: string) {}

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
	constructor() {
		super("BADSTRING");
	}
	toSource() {
		return '"\n"';
	}
}

class BadURLToken extends CSSParserToken {
	public tokenType: string = "BADURL";
	constructor() {
		super("BADURL");
	}
	toSource() {
		return "url(BADURL '')";
	}
}

class WhitespaceToken extends CSSParserToken {
	constructor() {
		super("WHITESPACE");
	}
	toString() {
		return "WS";
	}
	toSource() {
		return " ";
	}
}

class CDOToken extends CSSParserToken {
	constructor() {
		super("CDO");
	}
	toSource() {
		return "<!--";
	}
}

class CDCToken extends CSSParserToken {
	constructor() {
		super("CDC");
	}
	toSource() {
		return "-->";
	}
}

class ColonToken extends CSSParserToken {
	constructor() {
		super("COLON");
	}
	toSource() {
		return ":";
	}
}

class SemicolonToken extends CSSParserToken {
	constructor() {
		super("SEMICOLON");
	}
	toSource() {
		return ";";
	}
}

class CommaToken extends CSSParserToken {
	constructor() {
		super("COMMA");
	}
	toSource() {
		return ",";
	}
}

class OpenCurlyToken extends CSSParserToken {
	public grouping = true;
	public mirror: typeof CloseCurlyToken;
	constructor() {
		super("OPEN-CURLY");
		this.mirror = CloseCurlyToken;
	}
	toSource() {
		return "{";
	}
}

class CloseCurlyToken extends CSSParserToken {
	constructor() {
		super("CLOSE-CURLY");
	}
	toSource() {
		return "}";
	}
}

class OpenSquareToken extends CSSParserToken {
	public grouping = true;
	public mirror: typeof CloseSquareToken;
	constructor() {
		super("OPEN-SQUARE");
		this.mirror = CloseSquareToken;
	}
	toSource() {
		return "[";
	}
}

class CloseSquareToken extends CSSParserToken {
	constructor() {
		super("CLOSE-SQUARE");
	}
	toSource() {
		return "]";
	}
}

class OpenParenToken extends CSSParserToken {
	public grouping = true;
	public mirror: typeof CloseParenToken;
	constructor() {
		super("OPEN-PAREN");
		this.mirror = CloseParenToken;
	}
	toSource() {
		return "(";
	}
}

class CloseParenToken extends CSSParserToken {
	constructor() {
		super("CLOSE-PAREN");
	}
	toSource() {
		return ")";
	}
}

class EOFToken extends CSSParserToken {
	constructor() {
		super("EOF");
	}
	toSource() {
		return "";
	}
}

class DelimToken extends CSSParserToken {
	public value: string;
	constructor(val: number | string) {
		super("DELIM");
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
	constructor(public value: string) {
		super("IDENT");
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
	constructor(public value: string) {
		super("FUNCTION");
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
	constructor(public value: string) {
		super("AT-KEYWORD");
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
	constructor(public value: string, public isIdent: boolean) {
		super("HASH");
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
	constructor(public value: string) {
		super("STRING");
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
	constructor(public value: string) {
		super("URL");
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
	constructor(public value: number, public isInteger: boolean, public sign?: string) {
		super("NUMBER");
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
	constructor(public value: number, public sign?: string) {
		super("PERCENTAGE");
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
	constructor(public value: number, public unit: string, public sign?: string) {
		super("DIMENSION");
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

// Exportation.
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

class TokenStream {
	public i: number;
	public marks: number[];
	constructor(public tokens: CSSParserToken[]) {
		// Assume that tokens is an array.
		this.i = 0;
		this.marks = [];
	}
	nextToken() {
		if (this.i < this.tokens.length) return this.tokens[this.i];
		return new EOFToken();
	}
	empty() {
		return this.i >= this.tokens.length;
	}
	consumeToken() {
		const tok = this.nextToken();
		this.i++;
		return tok;
	}
	discardToken() {
		this.i++;
	}
	mark() {
		this.marks.push(this.i);
		return this;
	}
	restoreMark() {
		if (this.marks.length) {
			this.i = this.marks.pop()!;
			return this;
		}
		throw new Error("No marks to restore.");
	}
	discardMark() {
		if (this.marks.length) {
			this.marks.pop();
			return this;
		}
		throw new Error("No marks to restore.");
	}
	discardWhitespace() {
		while (this.nextToken() instanceof WhitespaceToken) {
			this.discardToken();
		}
		return this;
	}
}

function parseerror(s: TokenStream, msg: string) {
	console.log("Parse error at token " + s.i + ": " + s.tokens[s.i] + ".\n" + msg);
	return true;
}

function consumeAStylesheetsContents(s: TokenStream) {
	const rules: TopLevel[] = [];
	while (1) {
		const token = s.nextToken();
		if (token instanceof WhitespaceToken) {
			s.discardToken();
		} else if (token instanceof EOFToken) {
			return rules;
		} else if (token instanceof CDOToken || token instanceof CDCToken) {
			s.discardToken();
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
	const token = s.consumeToken();
	if (!(token instanceof AtKeywordToken)) {
		throw new Error("consumeAnAtRule() called with an invalid token stream state.");
	}
	const rule = new AtRule(token.value);
	while (1) {
		const token = s.nextToken();
		if (token instanceof SemicolonToken || token instanceof EOFToken) {
			s.discardToken();
			return filterValid(rule);
		} else if (token instanceof CloseCurlyToken) {
			if (nested) return filterValid(rule);
			else {
				parseerror(s, "Hit an unmatched } in the prelude of an at-rule.");
				rule.prelude.push(s.consumeToken());
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
	var rule = new QualifiedRule();
	while (1) {
		const token = s.nextToken();
		if (token instanceof EOFToken || token instanceof stopToken) {
			parseerror(s, "Hit EOF or semicolon when trying to parse the prelude of a qualified rule.");
			return;
		} else if (token instanceof CloseCurlyToken) {
			parseerror(s, "Hit an unmatched } in the prelude of a qualified rule.");
			if (nested) return;
			else {
				rule.prelude.push(s.consumeToken());
			}
		} else if (token instanceof OpenCurlyToken) {
			if (looksLikeACustomProperty(rule.prelude)) {
				consumeTheRemnantsOfABadDeclaration(s, nested);
				return;
			}
			[rule.declarations, rule.rules] = consumeABlock(s);
			return filterValid(rule);
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
	s.discardToken();
	const [decls, rules] = consumeABlocksContents(s);
	s.discardToken();
	return [decls, rules];
}

function consumeABlocksContents(s: TokenStream): [decls: CSSParserRule[], rules: CSSParserRule[]] {
	const decls: CSSParserRule[] = [];
	const rules: CSSParserRule[] = [];
	while (1) {
		const token = s.nextToken();
		if (token instanceof WhitespaceToken || token instanceof SemicolonToken) {
			s.discardToken();
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
				s.discardMark();
				continue;
			}
			s.restoreMark();
			const rule = consumeAQualifiedRule(s, true, SemicolonToken);
			if (rule) rules.push(rule);
		}
	}
	return [decls, rules];
}

function consumeADeclaration(s: TokenStream, nested = false) {
	let decl;
	if (s.nextToken() instanceof IdentToken) {
		decl = new Declaration((s.consumeToken() as IdentToken).value);
	} else {
		consumeTheRemnantsOfABadDeclaration(s, nested);
		return;
	}
	s.discardWhitespace();
	if (s.nextToken() instanceof ColonToken) {
		s.discardToken();
	} else {
		consumeTheRemnantsOfABadDeclaration(s, nested);
		return;
	}
	s.discardWhitespace();
	decl.value = consumeAListOfComponentValues(s, nested, SemicolonToken);

	var foundImportant = false;
	for (var i = decl.value.length - 1; i >= 0; i--) {
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

	var i = decl.value.length - 1;
	while (decl.value[i] instanceof WhitespaceToken) {
		decl.value.length = i;
		i--;
	}
	return filterValid(decl);
}

function consumeTheRemnantsOfABadDeclaration(s: TokenStream, nested: boolean) {
	while (1) {
		const token = s.nextToken();
		if (token instanceof EOFToken || token instanceof SemicolonToken) {
			s.discardToken();
			return;
		} else if (token instanceof CloseCurlyToken) {
			if (nested) return;
			else s.discardToken();
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
				values.push(s.consumeToken());
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
	return s.consumeToken();
}

function consumeASimpleBlock(s: TokenStream): SimpleBlock {
	// @ts-expect-error quack-checking
	if (!s.nextToken().mirror) {
		throw new Error("consumeASimpleBlock() called with an invalid token stream state.");
	}
	const start = s.nextToken();
	const block = new SimpleBlock(start.toSource() as keyof typeof mirror);
	s.discardToken();
	while (1) {
		const token = s.nextToken();
		if (
			token instanceof EOFToken ||
			// @ts-expect-error quack-checking
			token instanceof start.mirror
		) {
			s.discardToken();
			return block;
		} else {
			block.value.push(consumeAComponentValue(s));
		}
	}

	return block; // unreachable
}

function consumeAFunction(s: TokenStream): Func {
	if (!(s.nextToken() instanceof FunctionToken)) {
		throw new Error("consumeAFunction() called with an invalid token stream state.");
	}
	// safe assertion, verified above
	const func = new Func((s.consumeToken() as FunctionToken).value);
	while (1) {
		const token = s.nextToken();
		if (token instanceof EOFToken || token instanceof CloseParenToken) {
			s.discardToken();
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

function parseAStylesheet(s: string | TokenStream) {
	s = normalizeInput(s);
	var sheet = new Stylesheet();
	sheet.rules = consumeAStylesheetsContents(s);
	return sheet;
}

function parseAStylesheetsContents(s: TokenStream) {
	s = normalizeInput(s);
	return consumeAStylesheetsContents(s);
}

function parseABlocksContents(s: TokenStream) {
	s = normalizeInput(s);
	return consumeABlocksContents(s);
}

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

function parseADeclaration(s: TokenStream) {
	s = normalizeInput(s);
	s.discardWhitespace();
	const decl = consumeADeclaration(s);
	if (decl) return decl;
	throw SyntaxError();
}

function parseAComponentValue(s: TokenStream) {
	s = normalizeInput(s);
	s.discardWhitespace();
	if (s.empty()) throw SyntaxError();
	const val = consumeAComponentValue(s);
	s.discardWhitespace();
	if (s.empty()) return val;
	throw SyntaxError();
}

function parseAListOfComponentValues(s: TokenStream) {
	s = normalizeInput(s);
	return consumeAListOfComponentValues(s);
}

function parseACommaSeparatedListOfComponentValues(s: TokenStream) {
	s = normalizeInput(s);
	const groups = [];
	while (!s.empty()) {
		groups.push(consumeAListOfComponentValues(s, false, CommaToken));
		s.discardToken();
	}
	return groups;
}

class CSSParserRule<Type extends string = string> {
	constructor(public type: Type, public name?: string) {}
	toSource(ident: number = 0) {
		return "";
	}
	toString(indent?: number) {
		return JSON.stringify(this, null, indent);
	}
}

class Stylesheet extends CSSParserRule {
	public rules: CSSParserRule[] = [];
	constructor() {
		super("STYLESHEET");
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

class AtRule extends CSSParserRule<"AT-RULE"> {
	public prelude: CSSParserToken[] = [];
	public declarations: CSSParserRule[] = [];
	public rules: CSSParserRule[] = [];
	constructor(public name: string) {
		super("AT-RULE", name);
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
		let s = printIndent(indent) + "@" + escapeIdent(this.name);
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
		s += printIndent(indent) + "}";
		return s;
	}
}

class QualifiedRule extends CSSParserRule<"QUALIFIED-RULE"> {
	public prelude: CSSParserToken[] = [];
	public declarations: CSSParserRule[] = [];
	public rules: CSSParserRule[] = [];
	constructor() {
		super("QUALIFIED-RULE");
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
		let s = printIndent(indent);
		s += this.prelude.map(x => x.toSource()).join("");
		s += "{\n";
		if (this.declarations.length) {
			s += this.declarations.map(x => x.toSource(indent + 1)).join("\n") + "\n";
		}
		if (this.rules.length) {
			s += this.rules.map(x => x.toSource(indent + 1)).join("\n") + "\n";
		}
		s += printIndent(indent) + "}";
		return s;
	}
}

// https://drafts.csswg.org/css-syntax/#preserved-tokens
type PreservedToken = Exclude<Tokens, FunctionToken | OpenCurlyToken | OpenParenToken | OpenSquareToken>;

class Declaration extends CSSParserRule<"DECLARATION"> {
	public value: (PreservedToken | Func | SimpleBlock)[] = [];
	public important = false;
	constructor(public name: string) {
		super("DECLARATION", name);
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
		let s = printIndent(indent) + escapeIdent(this.name) + ": ";
		s += this.value.map(x => x.toSource()).join("");
		if (this.important) {
			s += "!important";
		}
		s += ";";
		return s;
	}
}

const mirror = { "{": "}", "[": "]", "(": ")" } as const;

class SimpleBlock extends CSSParserRule {
	public value: CSSParserRule[] = [];
	constructor(public name: keyof typeof mirror) {
		super("BLOCK", name);
	}
	toJSON() {
		return {
			type: this.type,
			name: this.name,
			value: this.value,
		};
	}
	toSource() {
		// todo: validate and remove safely
		return this.name + this.value.map(x => x.toSource()).join("") + mirror[this.name as keyof typeof mirror];
	}
}

class Func extends CSSParserRule {
	public value: CSSParserToken[] = [];
	constructor(public name: string) {
		super("FUNCTION", name);
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

function printIndent(level: number = 0) {
	return "\t".repeat(level);
}

// Exportation.
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
