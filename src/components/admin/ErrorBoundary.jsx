import React from 'react';
import { base44 } from '@/api/entities';

let _isLogging = false; // prevent recursive logging

function sendLog(level, message, category, details) {
    if (_isLogging) return;
    _isLogging = true;
    base44.functions.invoke('logEvent', {
        level,
        message: String(message).slice(0, 2000),
        category,
        userId: localStorage.getItem('miller_driver_id') || null,
        details,
    }).catch(() => {}).finally(() => { _isLogging = false; });
}

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
        this._origConsoleError = null;
        this._origConsoleWarn = null;
        this._handleWindowError = null;
        this._handleUnhandledRejection = null;
    }

    componentDidMount() {
        // Override console.error
        this._origConsoleError = console.error;
        console.error = (...args) => {
            this._origConsoleError?.apply(console, args);
            sendLog('error', args.map(String).join(' '), 'frontend', { type: 'console.error' });
        };

        // Override console.warn
        this._origConsoleWarn = console.warn;
        console.warn = (...args) => {
            this._origConsoleWarn?.apply(console, args);
            sendLog('warn', args.map(String).join(' '), 'frontend', { type: 'console.warn' });
        };

        // Global unhandled JS errors
        this._handleWindowError = (event) => {
            sendLog('error', event.message || 'Unhandled window error', 'frontend', {
                type: 'window.onerror',
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
            });
        };
        window.addEventListener('error', this._handleWindowError);

        // Unhandled promise rejections
        this._handleUnhandledRejection = (event) => {
            sendLog('error', String(event.reason) || 'Unhandled promise rejection', 'frontend', {
                type: 'unhandledrejection',
            });
        };
        window.addEventListener('unhandledrejection', this._handleUnhandledRejection);
    }

    componentWillUnmount() {
        if (this._origConsoleError) console.error = this._origConsoleError;
        if (this._origConsoleWarn) console.warn = this._origConsoleWarn;
        if (this._handleWindowError) window.removeEventListener('error', this._handleWindowError);
        if (this._handleUnhandledRejection) window.removeEventListener('unhandledrejection', this._handleUnhandledRejection);
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        sendLog('error', error.message || 'React component crashed', 'frontend', {
            type: 'react_error_boundary',
            stack: error.stack?.slice(0, 2000),
            componentStack: errorInfo.componentStack?.slice(0, 1000),
        });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-gray-50">
                    <div className="text-center p-8 max-w-md">
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-3xl">⚠️</span>
                        </div>
                        <h2 className="text-2xl font-bold text-gray-800 mb-2">Something went wrong</h2>
                        <p className="text-gray-500 mb-6">This error has been logged automatically.</p>
                        <button
                            onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
                            className="px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium"
                        >
                            Reload Page
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}