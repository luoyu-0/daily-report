import React, {Component, type ErrorInfo, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App.js';
import './styles.css';

class AppErrorBoundary extends Component<{children: ReactNode}, {error?: Error}> {
  state: {error?: Error} = {};
  static getDerivedStateFromError(error: Error) { return {error}; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('审核台渲染失败', error, info); }
  render() {
    if (this.state.error) return <main className="empty"><div className="empty-mark">!</div><h1>审核台加载失败</h1><p>{this.state.error.message}</p><p>请关闭旧审核台后重新运行 <code>npm run dev</code>。</p></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>);

