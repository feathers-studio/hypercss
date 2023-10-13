import { assertEquals } from "https://deno.land/std@0.204.0/assert/mod.ts";

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
} from "./index.ts";

const src1 = `foo {
	bar: baz;
}`;

const ws = new WhitespaceToken();
const comma = new CommaToken();
const colon = new ColonToken();

Deno.test("Rule with ident token", () => {
	const decl = new Declaration("bar");
	decl.value = [new IdentToken("baz")];

	const qualified = new QualifiedRule();
	qualified.prelude = [new IdentToken("foo"), ws];
	qualified.declarations = [decl];

	const expected = new Stylesheet();
	expected.rules = [qualified];

	const parsed = parseAStylesheet(src1);
	assertEquals(parsed.toString(" "), expected.toString(" "));
	assertEquals(parsed.toSource(0), src1);
});

const src2 = `foo {
	bar: rgb(255, 0, 127);
}`;

Deno.test("Rule with function and values", () => {
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

	const parsed = parseAStylesheet(src2);
	assertEquals(parsed.toString(" "), expected.toString(" "));
	assertEquals(parsed.toSource(0), src2);
});

const src3 = `@media {

}`;

Deno.test("Empty at-rule", () => {
	const atrule = new AtRule("media");
	atrule.prelude = [ws];

	const expected = new Stylesheet();
	expected.rules = [atrule];

	const parsed = parseAStylesheet(src3);
	assertEquals(parsed.toSource(0), src3);
	assertEquals(parsed, expected);
});

const src4 = `@font-face {
	unicode-range: U+26;
	unicode-range: U+0-7F;
	unicode-range: U+0025-00FF;
	unicode-range: U+4??;
	unicode-range: U+0025-00FF, U+4??;
}`;

const expect4 = `@font-face {
	unicode-range: U+26;
	unicode-range: U+0-7F;
	unicode-range: U+0025-00FF;
	unicode-range: U+400-4FF;
	unicode-range: U+0025-00FF, U+400-4FF;
}`;

Deno.test("unicode-range", () => {
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

	const parsed = parseAStylesheet(src4);
	assertEquals(parsed.toSource(0), expect4);
	assertEquals(parsed, expected);
});

const src5 = `div:nth-child(2n + 3) {
}`;

Deno.test("an+b", () => {
	const func = new Func("nth-child");
	func.value = [new DimensionToken(2, "n"), ws, new DelimToken("+"), ws, new NumberToken(3, true)];

	const qualified = new QualifiedRule();
	qualified.prelude = [new IdentToken("div"), colon, func, ws];

	const expected = new Stylesheet();
	expected.rules = [qualified];

	const parsed = parseAStylesheet(src5);
	assertEquals(parsed.toSource(0), src5);
	assertEquals(parsed, expected);
});
