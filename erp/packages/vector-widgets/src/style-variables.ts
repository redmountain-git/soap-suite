import { noChange } from 'lit';
import {
  Directive,
  PartType,
  directive,
  type ElementPart,
  type PartInfo,
} from 'lit/directive.js';

export type StyleVariables = Readonly<Record<`--${string}`, string | null>>;

class StyleVariablesDirective extends Directive {
  private previousNames = new Set<string>();

  constructor(partInfo: PartInfo) {
    super(partInfo);
    if (partInfo.type !== PartType.ELEMENT) {
      throw new Error('styleVariables must be used as an element directive');
    }
  }

  override render(_variables: StyleVariables) {
    return noChange;
  }

  override update(part: ElementPart, [variables]: [StyleVariables]) {
    const element = part.element as HTMLElement;
    const nextNames = new Set(Object.keys(variables));
    for (const name of this.previousNames) {
      if (!nextNames.has(name)) element.style.removeProperty(name);
    }
    for (const [name, value] of Object.entries(variables)) {
      if (value === null) element.style.removeProperty(name);
      else element.style.setProperty(name, value);
    }
    this.previousNames = nextNames;
    return noChange;
  }
}

export const styleVariables = directive(StyleVariablesDirective);
