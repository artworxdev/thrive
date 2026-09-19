import { DEFAULT_CONFIG, validateConfig } from '@thrive/core';
import type { SimConfig } from '@thrive/core';

/**
 * The configuration editor. Values apply only on reset — editing a running
 * simulation would break reproducibility, which the design forbids.
 */
export class ConfigEditor {
  constructor(
    private readonly textarea: HTMLTextAreaElement,
    private readonly errorEl: HTMLElement,
  ) {
    this.textarea.value = JSON.stringify(DEFAULT_CONFIG, null, 2);
  }

  /** Returns the edited config, or null if it is unparseable or invalid. */
  read(): SimConfig | null {
    try {
      const parsed = JSON.parse(this.textarea.value) as SimConfig;
      validateConfig(parsed);
      this.clearError();
      return parsed;
    } catch (error) {
      this.showError(
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  private showError(message: string): void {
    this.errorEl.textContent = message;
    this.errorEl.hidden = false;
    const details = this.textarea.closest('details');
    if (details !== null) details.open = true;
  }

  private clearError(): void {
    this.errorEl.hidden = true;
    this.errorEl.textContent = '';
  }
}

export function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error('Missing element #' + id);
  return element as T;
}
