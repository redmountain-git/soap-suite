// @ts-nocheck
import { html, render as litRender } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

export function renderMarkup(root, markup) {
  if (!root) {
    return;
  }
  if (root.nodeType && typeof root.appendChild === "function") {
    litRender(html`${unsafeHTML(markup)}`, root);
    return;
  }
  root.innerHTML = markup;
}
