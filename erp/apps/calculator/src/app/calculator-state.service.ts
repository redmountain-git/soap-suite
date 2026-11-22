import { Injectable, signal } from '@angular/core';
import {
  createDefaultCalculatorDocument,
  type CalculatorDocument,
} from '@redmountainsoap/calculator-core';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

const DATABASE_NAME = 'red-mountain-soap-calculator';
const DOCUMENT_KEY = 'current';

interface CalculatorDatabase extends DBSchema {
  documents: {
    key: string;
    value: CalculatorDocument;
  };
}

@Injectable({ providedIn: 'root' })
export class CalculatorStateService {
  readonly document = signal<CalculatorDocument>(
    createDefaultCalculatorDocument(),
  );
  readonly status = signal('Your recipe is stored only in this browser.');
  readonly statusIsError = signal(false);

  private databasePromise?: Promise<IDBPDatabase<CalculatorDatabase>>;

  constructor() {
    void this.load();
  }

  update(document: CalculatorDocument): void {
    this.document.set(document);
    this.statusIsError.set(false);
    this.status.set('Saved in this browser.');
    void this.persist(document);
  }

  reset(): void {
    this.update(createDefaultCalculatorDocument());
  }

  private database(): Promise<IDBPDatabase<CalculatorDatabase>> {
    this.databasePromise ??= openDB<CalculatorDatabase>(DATABASE_NAME, 1, {
      upgrade(database) {
        database.createObjectStore('documents');
      },
    });
    return this.databasePromise;
  }

  private async load(): Promise<void> {
    try {
      const database = await this.database();
      const saved = await database.get('documents', DOCUMENT_KEY);
      if (saved?.version === 1) {
        this.document.set(saved);
        this.status.set('Loaded the recipe saved in this browser.');
      }
    } catch {
      this.statusIsError.set(true);
      this.status.set(
        'Browser storage is unavailable. This recipe will last only until the page closes.',
      );
    }
  }

  private async persist(document: CalculatorDocument): Promise<void> {
    try {
      const database = await this.database();
      await database.put('documents', document, DOCUMENT_KEY);
    } catch {
      this.statusIsError.set(true);
      this.status.set(
        'The calculator could not save locally. Export important recipes before leaving.',
      );
    }
  }
}
