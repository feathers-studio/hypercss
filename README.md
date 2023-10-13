# HyperCSS: Standards-Based CSS Parser for TypeScript

This project implements a standards-based CSS Parser, fully written in modern TypeScript.
It is based on [Tab Atkins's original parser](https://github.com/tabatkins/parse-css), which is based on <http://drafts.csswg.org/css-syntax>.

Its structure and coding style are instead meant to be very close to the spec,
so that it's easy to verify that the code matches the spec (and vice versa)
and to make it easy, when the spec changes, to make the same change in the parser.

It is intended to fully and completely match browser behavior
(at least, as much as the final spec does).
The version of the spec this is based on is stored [here](./spec/drafts.csswg.org/css-syntax.html).
This will be used as the reference to diff future versions of the spec against,
and update this library.

## Using the Library

```TS (Deno)
import { parseAStylesheet } from "https://deno.land/x/hyperactive_css";

const stylesheet = parseAStylesheet(Deno.readTextFileSync("style.css"));
```

Note that the Syntax spec, and thus this parser, is _extremely generic_.
It doesn't have any specific knowledge of CSS rules, just the core syntax,
so it won't throw out invalid or unknown things.

## Parsing Functions

Here's the full list of parsing functions.
They do exactly what they say in their name,
because they're named exactly the same as the corresponding section of the Syntax spec:

-   `parseAStylesheet()`
-   `parseAListOfRules()`
-   `parseARule()`
-   `parseADeclaration()`
-   `parseAListOfDeclarations()`
-   `parseAComponentValue()`
-   `parseAListOfComponentValues()`
-   `parseACommaSeparatedListOfComponentValues()`

To reiterate, this parser intentionally has no knowledge of specifics
like "width" or "background-color",
and will happily parse any valid CSS syntax.
This makes it a very useful base to build CSS tools on top of.
A higher level API may yet be created in the future. It may also be useful to convert this parser into a streaming parser.

#### This library is heavily inspired by Tommy Hodgins's excellent video, [Why it's important to parse CSS correctly](http://youtu.be/1kHuXQhbeN0)

<a href=http://youtu.be/1kHuXQhbeN0>
	<img width=400 src=https://i.ytimg.com/vi/1kHuXQhbeN0/maxresdefault.jpg alt="Video: Why it's important to parse CSS correctly">
</a>

For the curious,
[Tommy Hodgins's YouTube](https://www.youtube.com/@innovati) has several demonstrations
on how to use a standards-compliant CSS parser.
