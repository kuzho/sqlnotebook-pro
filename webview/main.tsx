import * as React from 'react';
import { createRoot } from 'react-dom/client';
import Form from './Form';

declare const acquireVsCodeApi: () => {
  postMessage: (message: { type: string; data: any }) => void;
  getState: () => any;
  setState: (state: any) => void;
};

const vscode = acquireVsCodeApi();

function createConnection(config: any) {
  vscode.postMessage({ type: 'create_connection', data: config });
}

function testConnection(config: any) {
  vscode.postMessage({ type: 'test_connection', data: config });
}

function processFormData(form: HTMLFormElement) {
  const formData = new FormData(form);
  const data: Record<string, FormDataEntryValue | boolean> = {};
  formData.forEach((value, key) => {
    data[key] = value;
  });

  if (data.encrypt) {
    data.encrypt = !!data.encrypt;
  }
  if (data.trustServerCertificate) {
    data.trustServerCertificate = !!data.trustServerCertificate;
  }
  if (data.legacyTls10) {
    data.legacyTls10 = !!data.legacyTls10;
  }
  return data;
}

function handleSubmit(form: HTMLFormElement, isSaveAsNew: boolean = false) {
  const data = processFormData(form) as any;
  if (isSaveAsNew) {
    data.isSaveAsNew = true;
  }
  createConnection(data);
}

function handleTest(form: HTMLFormElement) {
  testConnection(processFormData(form));
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(
      <Form
        vscode={vscode}
        handleSubmit={handleSubmit}
        handleTest={handleTest}
      />,
    );
  }
});
