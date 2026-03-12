import { browser } from '$app/environment';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import * as smd from 'streaming-markdown';

// Module-level cache for lazily initialized instances.
let markedInstance: Marked | null = null;
// DOMPurify is browser-only; we lazy-import it at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DOMPurify: any = null;

/**
 * Lazily initialize the Marked instance with syntax highlighting.
 * Using `new Marked(markedHighlight(...))` instead of `marked.use()` to avoid
 * mutating the global singleton — safe for concurrent renders.
 */
function getMarked(): Marked {
	if (markedInstance) return markedInstance;

	markedInstance = new Marked(
		markedHighlight({
			langPrefix: 'hljs language-',
			highlight(code: string, lang: string) {
				const language = hljs.getLanguage(lang) ? lang : 'plaintext';
				return hljs.highlight(code, { language }).value;
			}
		})
	);

	return markedInstance;
}

/**
 * Lazily import DOMPurify — must be dynamic to remain SSR-safe.
 * Caches the import after the first load.
 */
async function getDOMPurify() {
	if (DOMPurify) return DOMPurify;
	const mod = await import('dompurify');
	DOMPurify = mod.default;
	return DOMPurify;
}

/**
 * Render a markdown string to sanitized HTML.
 *
 * Uses marked + highlight.js for parsing and DOMPurify for sanitization.
 * Runs only in the browser (returns plain text on the server).
 *
 * @param text - Raw markdown text from the AI response.
 * @returns Sanitized HTML string safe for innerHTML injection.
 */
export async function renderMarkdown(text: string): Promise<string> {
	if (!browser) return text;

	const marked = getMarked();
	const purify = await getDOMPurify();

	const html = await marked.parse(text);
	// ADD_ATTR: ['class'] allows highlight.js language-* classes to survive sanitization.
	return purify.sanitize(html, { ADD_ATTR: ['class'] });
}

/**
 * Animate a streaming markdown response into a container element.
 *
 * Uses streaming-markdown to progressively render markdown as it "streams"
 * (Chimera sends the full response at once in the done event, so we simulate
 * the streaming feel by writing 8 characters per 16ms tick).
 *
 * @param container - The DOM element to render into.
 * @param text      - The full response text to animate.
 * @param onDone    - Called when the animation completes naturally.
 * @returns A cancel function. Calling it stops the animation immediately.
 *          The caller is responsible for swapping to the final marked render on cancel.
 */
export function animateStreaming(
	container: HTMLElement,
	text: string,
	onDone: () => void
): () => void {
	const CHARS_PER_TICK = 8;
	const TICK_MS = 16;

	const renderer = smd.default_renderer(container);
	const parser = smd.parser(renderer);

	let offset = 0;
	let cancelled = false;

	const intervalId = setInterval(() => {
		if (cancelled) return;

		if (offset >= text.length) {
			clearInterval(intervalId);
			smd.parser_end(parser);
			onDone();
			return;
		}

		const chunk = text.slice(offset, offset + CHARS_PER_TICK);
		offset += CHARS_PER_TICK;
		smd.parser_write(parser, chunk);
	}, TICK_MS);

	return () => {
		cancelled = true;
		clearInterval(intervalId);
	};
}

/**
 * Apply highlight.js syntax highlighting to any un-highlighted code blocks
 * inside the given container.
 *
 * Call this after the streaming animation ends and before swapping to the
 * final marked render, or whenever raw code blocks are injected into the DOM.
 *
 * @param container - The DOM element containing code blocks to highlight.
 */
export function highlightCodeBlocks(container: HTMLElement): void {
	container.querySelectorAll<HTMLElement>('code[class*="language-"]').forEach((el) => {
		hljs.highlightElement(el);
	});
}
