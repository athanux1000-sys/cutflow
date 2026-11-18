import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset?: () => void },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; onReset?: () => void }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'An unexpected application error occurred.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0B0C0E] text-[#F4F5F7] p-6">
          <div className="max-w-md w-full border border-white/10 bg-[#121418] rounded-xl p-6 space-y-4">
            <h1 className="text-lg font-semibold">CutFlow recovered from a view error</h1>
            <p className="text-sm text-[#8E95A5]">{this.state.message}</p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                this.props.onReset?.();
              }}
              className="px-4 py-2 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium cursor-pointer"
            >
              Return to Home
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
