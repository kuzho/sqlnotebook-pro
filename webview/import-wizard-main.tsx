import * as React from 'react';
import { createRoot } from 'react-dom/client';
import ImportWizard from './ImportWizard';

declare const acquireVsCodeApi: () => {
  postMessage: (message: { type: string; data?: any }) => void;
  getState: () => any;
  setState: (state: any) => void;
};

const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(<ImportWizard vscode={vscode} />);
  }
});
