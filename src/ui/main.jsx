import { App } from './App';

const React = window.React;
const ReactDOM = window.ReactDOM;

if (!React || !ReactDOM) {
  throw new Error('React runtime failed to load');
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
