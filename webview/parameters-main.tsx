import * as React from 'react';
import * as ReactDOM from 'react-dom';
import Parameters from './Parameters';

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('root');
  if (root) {
    ReactDOM.render(<Parameters />, root);
  }
});