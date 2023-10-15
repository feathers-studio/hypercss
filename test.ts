import { assertEquals } from "https://deno.land/std@0.204.0/assert/assert_equals.ts";

import {
	parseAStylesheet,
	AtRule,
	QualifiedRule,
	Declaration,
	IdentToken,
	WhitespaceToken,
	Stylesheet,
	Func,
	NumberToken,
	CommaToken,
	UnicodeRangeToken,
	ColonToken,
	DimensionToken,
	DelimToken,
	Debug,
	Position,
	HashToken,
} from "./index.ts";

const ws = new WhitespaceToken();
const comma = new CommaToken();
const colon = new ColonToken();

function destroyExcluded<O>(obj: O, exclude: unknown[]): void {
	if (obj && typeof obj === "object")
		for (const prop in obj) {
			if (exclude.includes(prop)) delete obj[prop];
			else if (typeof obj[prop] === "object") destroyExcluded(obj[prop], exclude);
		}
}

const assert = <T>(actual: T, expected: T) => (
	destroyExcluded(actual, ["debug"]), destroyExcluded(expected, ["debug"]), assertEquals(actual, expected)
);

Deno.test("Rule with ident token", () => {
	const src = `foo {
	bar: baz;
}`;

	const decl = new Declaration("bar");
	decl.value = [new IdentToken("baz")];

	const qualified = new QualifiedRule();
	qualified.prelude = [new IdentToken("foo"), ws];
	qualified.declarations = [decl];

	const expected = new Stylesheet();
	expected.rules = [qualified];

	const parsed = parseAStylesheet(src);
	assert(parsed.toSource(), src);
	assert(parsed, expected);
});

const debug = (line: number, column: number) => {
	const d = new Debug(new Position(line, column));
	return (line: number, column: number): Debug => {
		d.to = new Position(line, column);
		return d;
	};
};

Deno.test("Rule with function and values", () => {
	const src = `foo {
	bar: rgb(255, 0, 127);
}`;

	const rgb = new Func("rgb");
	const r = new NumberToken(255, true);
	const g = new NumberToken(0, true);
	const b = new NumberToken(127, true);
	rgb.value = [r, comma, ws, g, comma, ws, b];

	const decl = new Declaration("bar");
	decl.value = [rgb];

	const qualified = new QualifiedRule();
	qualified.prelude = [new IdentToken("foo"), ws];
	qualified.declarations = [decl];

	const expected = new Stylesheet();
	expected.rules = [qualified];

	const parsed = parseAStylesheet(src);
	assert(parsed.toSource(), src);
	assert(parsed, expected);
});

Deno.test("Empty at-rule", () => {
	const src = `@media {

}`;

	const atrule = new AtRule("media");
	atrule.prelude = [ws];

	const expected = new Stylesheet();
	expected.rules = [atrule];

	const parsed = parseAStylesheet(src);
	assert(parsed, expected);
	assert(parsed.toSource(), src);
});

Deno.test("an+b", () => {
	const src = `div:nth-child(2n + 3) {
}`;

	const func = new Func("nth-child");
	func.value = [new DimensionToken(2, "n"), ws, new DelimToken("+"), ws, new NumberToken(3, true)];

	const qualified = new QualifiedRule();
	qualified.prelude = [new IdentToken("div"), colon, func, ws];

	const expected = new Stylesheet();
	expected.rules = [qualified];

	const parsed = parseAStylesheet(src);
	assert(parsed.toSource(), src);
	assert(parsed, expected);
});

Deno.test("u+a as selector (unicodeRangesAllowed: false)", () => {
	const src = `u+a {
}`;

	const qualified = new QualifiedRule();
	qualified.prelude = [new IdentToken("u"), new DelimToken("+"), new IdentToken("a"), ws];

	const expected = new Stylesheet();
	expected.rules = [qualified];

	const parsed = parseAStylesheet(src);
	assert(parsed.toSource(), src);
	assert(parsed, expected);
});

Deno.test("unicode ranges (unicodeRangesAllowed: true)", () => {
	const src = `@font-face {
	unicode-range: U+26;
	unicode-range: U+0-7F;
	unicode-range: U+0025-00FF;
	unicode-range: U+4??;
	unicode-range: U+0025-00FF, U+4??;
}`;

	const expect = `@font-face {
	unicode-range: U+26;
	unicode-range: U+0-7F;
	unicode-range: U+0025-00FF;
	unicode-range: U+400-4FF;
	unicode-range: U+0025-00FF, U+400-4FF;
}`;

	const decl1 = new Declaration("unicode-range");
	decl1.value = [new UnicodeRangeToken("26", "26")];

	const decl2 = new Declaration("unicode-range");
	decl2.value = [new UnicodeRangeToken("0", "7F")];

	const decl3 = new Declaration("unicode-range");
	decl3.value = [new UnicodeRangeToken("0025", "00FF")];

	const decl4 = new Declaration("unicode-range");
	decl4.value = [new UnicodeRangeToken("400", "4FF")];

	const decl5 = new Declaration("unicode-range");
	decl5.value = [new UnicodeRangeToken("0025", "00FF"), comma, ws, new UnicodeRangeToken("400", "4FF")];

	const atrule = new AtRule("font-face");
	atrule.prelude = [ws];
	atrule.declarations = [decl1, decl2, decl3, decl4, decl5];

	const expected = new Stylesheet();
	expected.rules = [atrule];

	const parsed = parseAStylesheet(src, { unicodeRangesAllowed: true });
	assert(parsed.toSource(), expect);
	assert(parsed, expected);
});

Deno.test("HashToken in prelude", () => {
	const src = `h1 .class #\\36 33456 {
}`;

	const qualified = new QualifiedRule();
	qualified.prelude = [
		new IdentToken("h1"),
		ws,
		new DelimToken("."),
		new IdentToken("class"),
		ws,
		new HashToken("633456", true),
		ws,
	];

	const expected = new Stylesheet();
	expected.rules = [qualified];

	const parsed = parseAStylesheet(src);
	assert(parsed.toSource(), src);
	assert(parsed, expected);
});
