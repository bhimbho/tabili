/**
 * macOS applies its own text substitution inside a WKWebView: typing "apple"
 * into a field yields "Apple", and straight quotes become curly. Identifiers,
 * passwords and cell values all have to survive exactly as typed.
 *
 * Setting the attributes on <body> is not enough — the inherited value is not
 * reliably applied to descendants across engines — and annotating every field
 * by hand would still miss the ones we do not render ourselves, notably
 * glide-data-grid's cell editor overlay and Radix's portalled inputs.
 *
 * A capturing focusin listener catches every field the moment before it can be
 * typed into, whoever created it, for the cost of three attribute writes.
 */
const ATTRIBUTES: Array<[string, string]> = [
  ["autocapitalize", "off"],
  ["autocorrect", "off"],
  ["spellcheck", "false"],
];

function isTextEntry(node: EventTarget | null): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  if (node instanceof HTMLTextAreaElement) return true;
  if (!(node instanceof HTMLInputElement)) return false;
  // Checkboxes and the like have no text to mangle.
  return !["checkbox", "radio", "range", "color", "file", "submit", "button"].includes(node.type);
}

export function disableTextSubstitution() {
  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      if (!isTextEntry(target)) return;
      for (const [name, value] of ATTRIBUTES) {
        if (target.getAttribute(name) !== value) target.setAttribute(name, value);
      }
    },
    // Capturing, so it runs before any handler that might read the value.
    true,
  );
}
