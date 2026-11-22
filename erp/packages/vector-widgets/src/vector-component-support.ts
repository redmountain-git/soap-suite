import { LitElement } from 'lit';
import { applyTheme } from './vector-theme';

export class VectorElement extends LitElement {
  private _theme: Record<string, string> = {};

  get theme(): Record<string, string> {
    return this._theme;
  }

  set theme(value: Record<string, string>) {
    const previous = this._theme;
    this._theme = value ?? {};
    if (this.isConnected) applyTheme(this, this._theme, previous);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    applyTheme(this, this._theme);
  }
}

export function defineElement(
  name: string,
  klass: CustomElementConstructor,
): void {
  if (globalThis.customElements && !customElements.get(name)) {
    customElements.define(name, klass);
  }
}
