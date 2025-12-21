import * as React from 'react';
import * as ReactDOM from 'react-dom';
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
  // @ts-ignore: Object.fromEntries
  const data = Object.fromEntries(new FormData(form));

  if (data.encrypt) data.encrypt = !!data.encrypt;
  if (data.trustServerCertificate) data.trustServerCertificate = !!data.trustServerCertificate;
  return data;
}

function handleSubmit(form: HTMLFormElement) {
  createConnection(processFormData(form));
}

function handleTest(form: HTMLFormElement) {
  testConnection(processFormData(form));
}

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('root');
  ReactDOM.render(<Form handleSubmit={handleSubmit} handleTest={handleTest} />, root);
});